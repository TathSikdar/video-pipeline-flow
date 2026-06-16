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
    "http://botguard-provider:3000",
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

    def __init__(self, workspace_dir: str) -> None:
        """Initializes the downloader with a workspace directory.

        Args:
            workspace_dir: Absolute path to the tmpfs workspace
                where downloads and multiplexing occur.
        """
        self.workspace_dir = workspace_dir
        self.sabr_processor = SabrUmpProcessor()
        self.sabr_adapter = SabrStreamingAdapter(self.sabr_processor)

    @staticmethod
    def extract_available_resolutions(video_url: str) -> dict:
        """Rapidly extracts available resolutions and title without authentication.
        
        Returns a dict with 'resolutions' (sorted list) and 'title'.
        Raises an exception if the rapid fetch fails.
        """
        ydl_opts = {
            "quiet": True,
            "no_warnings": True,
            "extract_flat": False,
        }
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
        # Load the residential proxy for metadata extraction
        proxy_url = os.getenv("RESIDENTIAL_PROXY_URL", "")

        options = {
            "outtmpl": os.path.join(self.workspace_dir, "%(id)s.%(ext)s"),
            "format": (
                f"bestvideo[height<={resolution}][ext=mp4]"
                f"+bestaudio[ext=m4a]"
                f"/best[height<={resolution}][ext=mp4]/best"
            ),
            "merge_output_format": "mp4",
            "no_continue": True,
            "external_downloader": "aria2c",
            "external_downloader_args": {
                "aria2c": [
                    "-x",
                    "16",
                    "-k",
                    "1M",
                    "--all-proxy=",
                ],
            },
            "quiet": False,
            "no_warnings": False,
            "color": "no_color",
        }

        if proxy_url:
            options["proxy"] = proxy_url

        # Inject PoToken as extractor argument
        if po_token:
            options.setdefault("extractor_args", {})
            options["extractor_args"]["youtube"] = [
                f"po_token=web+{po_token}",
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
                po_token = data.get("poToken")

                if po_token:
                    logger.info(
                        "PoToken generated: %s...",
                        po_token[:15],
                    )
                return po_token

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
        """Executes the Strict Synchronous Lifecycle.

        1. Garbage collect lingering fragments.
        2. Generate a fresh PoToken via BotGuard microservice.
        3. Download video + audio with yt-dlp + aria2c.
        4. Block until FFmpeg multiplexing completes.
        5. Return the output file path for upload.

        The lifecycle strictly caps RAM usage to exactly one
        video at a time, ensuring we never exceed the 4GB
        tmpfs partition.

        Args:
            video_url: The YouTube video URL to process.
            visitor_data: The visitor data string for BotGuard
                token binding. Empty string if not available.

        Returns:
            The absolute path to the final multiplexed MP4 file,
            or None if the download fails.

        Raises:
            yt_dlp.utils.DownloadError: If yt-dlp encounters a
                fatal download error.
        """
        video_id = self._extract_video_id(video_url)
        logger.info(
            "Starting Strict Synchronous Lifecycle for %s (%s)",
            video_id,
            video_url,
        )

        # Step 1: Garbage Collection
        purge_workspace(self.workspace_dir)

        # Step 2: Generate PoToken
        po_token = None
        if visitor_data:
            po_token = asyncio.run(self._fetch_po_token(video_id, visitor_data))

        # Step 3 & 4: Download + Multiplex (Blocking)
        ydl_opts = self._get_ytdlp_options(
            po_token=po_token,
            visitor_data=visitor_data,
            resolution=resolution,
        )

        if progress_callback:
            def yt_dlp_progress_hook(d):
                if d.get("status") == "downloading":
                    percent_str = d.get("_percent_str", "0.0%").replace("%", "").strip()
                    try:
                        percent = float(percent_str)
                        progress_callback(percent)
                    except ValueError:
                        pass
            ydl_opts["progress_hooks"] = [yt_dlp_progress_hook]

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                logger.info("Starting yt-dlp download and " "FFmpeg multiplexing...")
                ydl.download([video_url])
                logger.info("yt-dlp and FFmpeg completed successfully.")

        except yt_dlp.utils.DownloadError as exc:
            logger.error(
                "Download failed for %s: %s",
                video_id,
                str(exc),
            )
            purge_workspace(self.workspace_dir)
            raise

        except Exception as exc:
            logger.error(
                "Unexpected error during download of %s: %s",
                video_id,
                str(exc),
            )
            purge_workspace(self.workspace_dir)
            raise

        # Step 5: Locate the output file
        output_path = self._find_output_file(video_id)
        if output_path:
            logger.info("Output file ready: %s", output_path)
        else:
            logger.error(
                "Output file not found for %s after " "successful download.",
                video_id,
            )

        return output_path
