"""Integration tests for the VideoPipelineDownloader engine."""

import logging
import os
import sys
import tempfile

# Adjust path to import from src
sys.path.append(os.path.join(os.path.dirname(__file__), "..", "src"))

from downloader.engine import VideoPipelineDownloader

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")


def test_public_video_download() -> None:
    """Tests the strictly synchronous download loop on a short public video."""
    test_url = "https://www.youtube.com/watch?v=jNQXAC9IVRw"
    workspace = os.getenv("WORKSPACE_DIR", tempfile.gettempdir())

    logging.info("Initializing VideoPipelineDownloader in %s", workspace)
    engine = VideoPipelineDownloader(workspace_dir=workspace)

    logging.info("Testing Strict Synchronous Lifecycle with URL: %s", test_url)
    try:
        engine.process_video_strictly_synchronous(test_url)
        logging.info("SUCCESS: Video downloaded via aria2, multiplexed by FFmpeg, and strictly garbage collected!")
    except Exception as e:
        logging.error("FAILED: %s", e)
        sys.exit(1)


if __name__ == "__main__":
    test_public_video_download()
