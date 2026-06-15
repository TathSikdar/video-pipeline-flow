import os
import yt_dlp
import logging
from .garbage_collector import purge_workspace
from .sabr_bridge import SabrStreamingAdapter, SabrUmpProcessor

logger = logging.getLogger(__name__)


class VideoPipelineDownloader:
    def __init__(self, workspace_dir: str):
        self.workspace_dir = workspace_dir
        self.sabr_processor = SabrUmpProcessor()
        self.sabr_adapter = SabrStreamingAdapter(self.sabr_processor)

    def _get_ytdlp_options(self) -> dict:
        """
        Configures yt-dlp with aria2c concurrency and SABR bridging.
        """
        # Load the residential proxy strictly for metadata extraction
        proxy_url = os.getenv("RESIDENTIAL_PROXY_URL", "")

        options = {
            "outtmpl": os.path.join(self.workspace_dir, "%(id)s.%(ext)s"),
            "format": "bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]/best[height<=1080][ext=mp4]/best",
            "merge_output_format": "mp4",
            "no_continue": True,  # Prevents lingering fragments from corrupting downloads
            "external_downloader": "aria2c",
            # Force aria2c to bypass proxy, utilizing the raw host IPv6 address instead
            "external_downloader_args": {
                "aria2c": ["-x", "16", "-k", "1M", "--all-proxy="]
            },
            "quiet": False,
            "no_warnings": False,
        }

        if proxy_url:
            options["proxy"] = proxy_url

        return options

    def process_video_strictly_synchronous(self, video_url: str):
        """
        Implements Strict Synchronous Lifecycle:
        1. Trigger Garbage Collection.
        2. Block and wait for yt-dlp to download Video + Audio.
        3. Block and wait for FFmpeg multiplexing.
        4. Upload file (Future phase).
        5. Delete final multiplexed file from RAM.
        """
        logger.info(f"Initiating Strict Synchronous processing for {video_url}")

        # 1. Garbage Collection
        purge_workspace(self.workspace_dir)

        # 2 & 3. Download & Multiplex (Blocking)
        ydl_opts = self._get_ytdlp_options()
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                logger.info("Starting yt-dlp download and FFmpeg multiplexing...")
                ydl.download([video_url])
                logger.info("yt-dlp and FFmpeg operations completed successfully.")
        except Exception as e:
            logger.error(f"Failed to process video: {e}")
            raise
        finally:
            # 5. Delete final multiplexed file
            purge_workspace(self.workspace_dir)
            logger.info(f"Strict Synchronous Lifecycle completed for {video_url}")
