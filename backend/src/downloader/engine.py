"""Video Pipeline Downloader Engine.

Orchestrates the complete video download lifecycle using yt-dlp with
aria2c concurrency, BotGuard PoToken injection via the external
microservice, and Camoufox session cookie integration.

The download follows the Strict Synchronous Lifecycle:
1. Garbage collection of lingering fragments.
2. Generate a fresh PoToken via the BotGuard microservice.
3. Inject the PoToken and session cookies into yt-dlp.
4. Block until yt-dlp + FFmpeg complete.
5. Return the output file path for the upload phase.
6. Purge the workspace on completion or failure.
"""

import asyncio
import glob
import logging
import os
from typing import Optional

import httpx
import yt_dlp

from .garbage_collector import purge_workspace
from .sabr_bridge import SabrStreamingAdapter, SabrUmpProcessor

logger = logging.getLogger(__name__)

# BotGuard microservice URL (internal Docker network)
BOTGUARD_SERVICE_URL = os.getenv(
    "BOTGUARD_SERVICE_URL",
    "http://127.0.0.1:3000",
)

# Timeout for BotGuard microservice requests (seconds)
BOTGUARD_TIMEOUT = 30.0


class VideoPipelineDownloader:
    """Manages the full video download and multiplexing pipeline.

    Integrates with the BotGuard microservice for PoToken
    generation, uses Camoufox session cookies for authentication,
    and delegates binary downloads to aria2c for concurrency.

    Attributes:
        workspace_dir: Path to the tmpfs RAM disk workspace.
        sabr_processor: The UMP blob decoder instance.
        sabr_adapter: The SABR backoff suppression adapter.
    """

    def __init__(self, workspace_dir: str, persistent_dir: str = "/tmp") -> None:
        """Initializes the downloader with a workspace directory.

        Args:
            workspace_dir: Absolute path to the tmpfs workspace
                where downloads and multiplexing occur.
            persistent_dir: Absolute path to the HDD storage
                where chunks and final videos are kept.
        """
        self.workspace_dir = workspace_dir
        self.persistent_dir = persistent_dir
        self.sabr_processor = SabrUmpProcessor()
        self.sabr_adapter = SabrStreamingAdapter(self.sabr_processor)

    @staticmethod
    def extract_available_resolutions(video_url: str) -> dict:
        """Rapidly extracts available resolutions and title without authentication.
        
        Returns a dict with 'resolutions' (sorted list) and 'title'.
        Raises an exception if the rapid fetch fails.
        """
        proxy_url = os.getenv("RESIDENTIAL_PROXY_URL", "")
        
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
            "geo_bypass": True,
        }
        
        if proxy_url:
            ydl_opts["proxy"] = proxy_url
        
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(video_url, download=False)
            formats = info.get("formats", [])
            heights = set()
            for f in formats:
                h = f.get("height")
                # Filter for video streams with a valid height
                if h and isinstance(h, int) and f.get("vcodec") != "none":
                    heights.add(h)
            
            if not heights:
                raise ValueError("No video formats found")
                
            return {
                "resolutions": sorted(list(heights), reverse=True),
                "title": info.get("title", ""),
            }

    def _get_ytdlp_options(
        self,
        po_token: Optional[str] = None,
        visitor_data: Optional[str] = None,
        resolution: str = "1080",
    ) -> dict:
        """Configures yt-dlp with aria2c and authentication params.

        Builds the yt-dlp options dictionary with:
        - Strict 1080p resolution cap for One-Shot POST uploads.
        - aria2c external downloader with 16 TCP connections.
        - Residential proxy for metadata (bypassed by aria2c).
        - PoToken and visitor data injection when available.

        Args:
            po_token: The BotGuard Proof of Origin Token.
            visitor_data: The visitor data string for session
                binding.

        Returns:
            A dictionary of yt-dlp configuration options.
        """
        options = {
            "outtmpl": os.path.join(self.workspace_dir, "%(id)s.%(ext)s"),
            "format": (
                f"bestvideo[height<={resolution}][ext=mp4]"
                f"+bestaudio[ext=m4a]"
                f"/best[height<={resolution}][ext=mp4]/best"
            ),
            "merge_output_format": "mp4",
            "no_continue": True,
            "concurrent_fragment_downloads": 16,
            "quiet": False,
            "no_warnings": False,
            "color": "no_color",
            "geo_bypass": True,
        }

        proxy_url = os.getenv("RESIDENTIAL_PROXY_URL", "")
        if proxy_url:
            options["proxy"] = proxy_url

        # Inject PoToken as extractor argument and force WEB client.
        # ANDROID_VR ignores PoTokens entirely, so stream URLs are
        # strictly IP-locked to the proxy. By forcing the WEB client,
        # the PoToken is injected as a `pot=` URL parameter, which
        # relaxes IP enforcement on the Google Video Server.
        if po_token:
            options.setdefault("extractor_args", {})
            options["extractor_args"]["youtube"] = [
                f"po_token=web+{po_token}",
                "player_client=web",
            ]

        # Inject visitor data for session binding
        if visitor_data:
            options.setdefault("extractor_args", {})
            yt_args = options["extractor_args"].setdefault("youtube", [])
            yt_args.append(f"visitor_data={visitor_data}")

        return options

    async def _fetch_po_token(
        self,
        video_id: str,
        visitor_data: str,
    ) -> Optional[str]:
        """Requests a PoToken from the BotGuard microservice.

        Sends the video ID and visitor data to the BotGuard
        provider's /generate_pot endpoint and returns the
        computed PoToken.

        Args:
            video_id: The YouTube video ID.
            visitor_data: The visitor data string.

        Returns:
            The PoToken string, or None if generation fails.
        """
        try:
            async with httpx.AsyncClient(
                timeout=BOTGUARD_TIMEOUT,
            ) as client:
                response = await client.post(
                    f"{BOTGUARD_SERVICE_URL}/generate_pot",
                    json={
                        "videoId": video_id,
                        "visitorData": visitor_data,
                    },
                )
                response.raise_for_status()

                data = response.json()
                if data and isinstance(data, dict):
                    po_token = data.get("poToken")
                    if po_token:
                        logger.info(
                            "PoToken generated: %s...",
                            po_token[:15],
                        )
                    return po_token
                return None

        except httpx.HTTPError as exc:
            logger.error(
                "BotGuard microservice request failed: %s",
                str(exc),
            )
            return None

    @staticmethod
    def _extract_video_id(video_url: str) -> str:
        """Extracts the video ID from a YouTube URL.

        Handles standard, short, and embed URL formats.

        Args:
            video_url: The full YouTube video URL.

        Returns:
            The 11-character video ID string.

        Raises:
            ValueError: If the video ID cannot be extracted.
        """
        import re

        patterns = [
            r"(?:v=|/v/|youtu\.be/|shorts/)([a-zA-Z0-9_-]{11})",
            r"(?:embed/)([a-zA-Z0-9_-]{11})",
            r"^([a-zA-Z0-9_-]{11})$",
        ]

        for pattern in patterns:
            match = re.search(pattern, video_url)
            if match:
                return match.group(1)

        raise ValueError(f"Could not extract video ID from: {video_url}")

    def _find_output_file(self, video_id: str) -> Optional[str]:
        """Locates the final multiplexed output file.

        After yt-dlp and FFmpeg complete, the output file should
        exist in the workspace directory matching the video ID.

        Args:
            video_id: The YouTube video ID.

        Returns:
            The absolute path to the output file, or None if
            not found.
        """
        pattern = os.path.join(self.workspace_dir, f"{video_id}.*")
        matches = glob.glob(pattern)

        # Filter to final output files (not .part or .ytdl)
        for match in matches:
            if not match.endswith((".part", ".ytdl")):
                return match

        return None

    def process_video_strictly_synchronous(
        self,
        video_url: str,
        visitor_data: str = "",
        progress_callback=None,
        resolution: str = "1080",
    ) -> Optional[str]:
        video_id = self._extract_video_id(video_url)
        logger.info(
            "Starting Strict Synchronous Lifecycle for %s (%s)",
            video_id,
            video_url,
        )

        # Step 1: Garbage Collection
        purge_workspace(self.workspace_dir)

        # Step 2: Generate PoToken
        po_token = asyncio.run(self._fetch_po_token(video_id, visitor_data or ""))

        # Determine video size to decide if we need to chunk
        info_opts = {"quiet": True, "no_warnings": True, "extract_flat": False, "geo_bypass": True}
        proxy_url = os.getenv("RESIDENTIAL_PROXY_URL", "")
        if proxy_url:
            info_opts["proxy"] = proxy_url

        if po_token:
            info_opts.setdefault("extractor_args", {})
            info_opts["extractor_args"]["youtube"] = [
                f"po_token=web+{po_token}",
                "player_client=web",
            ]
        if visitor_data:
            info_opts.setdefault("extractor_args", {})
            info_opts["extractor_args"].setdefault("youtube", []).append(f"visitor_data={visitor_data}")

        try:
            with yt_dlp.YoutubeDL(info_opts) as ydl:
                info = ydl.extract_info(video_url, download=False)
        except Exception as exc:
            logger.error("Failed to extract info for chunking check: %s", str(exc))
            raise

        duration = info.get("duration", 0)
        
        # Calculate total filesize
        filesize = 0
        if "requested_formats" in info:
            for f in info["requested_formats"]:
                filesize += f.get("filesize") or f.get("filesize_approx") or 0
        else:
            filesize = info.get("filesize") or info.get("filesize_approx") or 0
            
        if filesize == 0 and duration > 0:
            # Fallback estimation for 1080p: ~50MB per minute = ~833 KB/sec
            filesize = duration * 833333

        # Threshold: 1.0 GB
        # Rationale: During FFmpeg multiplexing, the RAM disk holds both the raw 
        # video/audio streams AND the newly generated final file simultaneously.
        # A 1.0GB video requires ~2.0GB of space at peak. This leaves a 500MB buffer 
        # for a 2.5GB RAM disk.
        THRESHOLD_BYTES = 1.0 * 1024 * 1024 * 1024
        
        ydl_opts = self._get_ytdlp_options(
            po_token=po_token,
            visitor_data=visitor_data,
            resolution=resolution,
        )

        try:
            if filesize > THRESHOLD_BYTES and duration > 0:
                logger.info("Video size %.2f GB exceeds 1.0GB threshold. Bypassing RAM disk and downloading directly to HDD.", filesize / (1024**3))
                ydl_opts["outtmpl"] = os.path.join(self.persistent_dir, "%(id)s.%(ext)s")
                return self._process_single_shot(video_id, video_url, ydl_opts, progress_callback, direct_to_hdd=True)
            else:
                logger.info("Video size %.2f GB under threshold. Triggering standard RAM disk workflow.", filesize / (1024**3))
                return self._process_single_shot(video_id, video_url, ydl_opts, progress_callback, direct_to_hdd=False)
        except Exception as exc:
            if type(exc).__name__ == 'TaskCancelledError':
                logger.info("Download cancelled for %s", video_id)
            else:
                logger.error("Unexpected error during download of %s: %s", video_id, str(exc))
            purge_workspace(self.workspace_dir)
            raise

    def _process_single_shot(self, video_id, video_url, ydl_opts, progress_callback, direct_to_hdd=False):
        if progress_callback:
            def yt_dlp_progress_hook(d):
                if d.get("status") == "downloading":
                    percent_str = str(d.get("_percent_str", "0.0%"))
                    import re
                    match = re.search(r'([0-9]+\.[0-9]+)', percent_str)
                    if match:
                        try:
                            percent = float(match.group(1))
                            progress_callback(percent)
                        except ValueError:
                            pass
            ydl_opts["progress_hooks"] = [yt_dlp_progress_hook]

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                logger.info("Starting yt-dlp download and FFmpeg multiplexing...")
                ydl.download([video_url])
                logger.info("yt-dlp and FFmpeg completed successfully.")
        except yt_dlp.utils.DownloadError as exc:
            logger.error("Download failed for %s: %s", video_id, str(exc))
            if not direct_to_hdd:
                purge_workspace(self.workspace_dir)
            raise

        # Locate the output file in the correct directory
        search_dir = self.persistent_dir if direct_to_hdd else self.workspace_dir
        import glob
        pattern = os.path.join(search_dir, f"{video_id}.*")
        matches = glob.glob(pattern)
        output_path = None
        for match in matches:
            if not match.endswith((".part", ".ytdl")):
                output_path = match
                break

        if output_path:
            logger.info("Output file ready: %s", output_path)
            if not direct_to_hdd:
                # Move to persistent directly from here
                final_filename = os.path.basename(output_path)
                import shutil
                persistent_path = os.path.join(self.persistent_dir, final_filename)
                shutil.move(output_path, persistent_path)
                return persistent_path
            return output_path
        else:
            logger.error("Output file not found for %s after successful download.", video_id)
            return None
