import os
import glob
import logging

logger = logging.getLogger(__name__)


def purge_workspace(workspace_dir: str):
    """
    Aggressively purges the temporary workspace of any lingering fragments
    before initiating any new download.
    """
    if not os.path.exists(workspace_dir):
        return

    patterns = ["*.part", "*.ytdl", "*.mp4", "*.m4a", "*.webm"]
    deleted_count = 0

    for pattern in patterns:
        for file_path in glob.glob(os.path.join(workspace_dir, pattern)):
            try:
                os.remove(file_path)
                deleted_count += 1
            except Exception as e:
                logger.error(f"Failed to delete {file_path}: {e}")

    if deleted_count > 0:
        logger.info(
            f"Garbage collection purged {deleted_count} lingering fragments from {workspace_dir}"
        )
