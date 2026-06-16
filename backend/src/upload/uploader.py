"""YouTube Data API v3 Uploader.

Uploads 1080p MP4 files to YouTube using the Data API v3 with a
standard One-Shot POST request. Enforces the 'unlisted' privacy
status on all uploads. Catches 403 quotaExceeded errors to trigger
automatic credential rotation via the CredentialPool.

The One-Shot approach avoids the complexity of Google's Resumable
Upload protocol. Since we enforce a strict 1080p resolution cap in
the download engine, file sizes remain small enough to upload in a
single HTTP request without triggering memory timeouts.
"""

import logging
import os
from typing import Optional

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

from .credential_pool import CredentialPool

logger = logging.getLogger(__name__)

# Maximum number of upload retry attempts on quota exhaustion
MAX_ROTATION_RETRIES = 5

# GCP Client credentials for token refresh
GCP_CLIENT_ID = os.getenv("GCP_CLIENT_ID", "")
GCP_CLIENT_SECRET = os.getenv("GCP_CLIENT_SECRET", "")
TOKEN_URI = "https://oauth2.googleapis.com/token"


class YouTubeUploader:
    """Uploads videos to YouTube via the Data API v3.

    Uses the CredentialPool to obtain OAuth tokens and
    automatically rotates credentials when quota limits are
    reached.

    Attributes:
        cred_pool: The CredentialPool managing OAuth tokens.
    """

    def __init__(
        self,
        redis_url: str = "redis://redis:6379/0",
    ) -> None:
        """Initializes the uploader with a credential pool.

        Args:
            redis_url: Redis connection URL for the credential
                pool. Falls back to in-memory if unreachable.
        """
        self.cred_pool = CredentialPool(redis_url=redis_url)

    def _build_youtube_service(
        self,
        refresh_token: str,
    ):
        """Constructs an authenticated YouTube API service.

        Creates OAuth2 credentials from the refresh token and
        builds a YouTube Data API v3 service client.

        Args:
            refresh_token: The OAuth 2.0 refresh token.

        Returns:
            A googleapiclient Resource object for the YouTube
            Data API v3.
        """
        credentials = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri=TOKEN_URI,
            client_id=GCP_CLIENT_ID,
            client_secret=GCP_CLIENT_SECRET,
        )

        return build(
            "youtube",
            "v3",
            credentials=credentials,
            cache_discovery=False,
        )

    def upload_video(
        self,
        file_path: str,
        title: str,
        description: str = "",
        progress_callback=None,
    ) -> Optional[str]:
        """Uploads a video to YouTube as unlisted.

        Executes a One-Shot HTTP POST upload using the YouTube
        Data API v3 videos.insert endpoint. If a 403
        quotaExceeded error is received, rotates to the next
        credential and retries.

        Args:
            file_path: Absolute path to the MP4 file.
            title: The video title.
            description: Optional video description.

        Returns:
            The YouTube watch URL (https://youtu.be/VIDEO_ID),
            or None if all credentials are exhausted.

        Raises:
            FileNotFoundError: If the video file does not exist.
            HttpError: If a non-quota API error occurs.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Video file not found: {file_path}")

        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        logger.info(
            "Preparing upload: %s (%.1f MB)",
            title,
            file_size_mb,
        )

        for attempt in range(1, MAX_ROTATION_RETRIES + 1):
            refresh_token = self.cred_pool.get_active_token()

            if not refresh_token:
                logger.error("No tokens available in credential pool.")
                return None

            logger.info(
                "Upload attempt %d/%d using token: %s...",
                attempt,
                MAX_ROTATION_RETRIES,
                refresh_token[:8],
            )

            try:
                youtube = self._build_youtube_service(refresh_token)

                body = {
                    "snippet": {
                        "title": title,
                        "description": description,
                        "categoryId": "22",
                    },
                    "status": {
                        "privacyStatus": "unlisted",
                        "selfDeclaredMadeForKids": False,
                    },
                }

                media = MediaFileUpload(
                    file_path,
                    mimetype="video/mp4",
                    resumable=True,
                    chunksize=1024 * 1024 * 5,  # 5MB chunks
                )

                request = youtube.videos().insert(
                    part="snippet,status",
                    body=body,
                    media_body=media,
                )

                response = None
                while response is None:
                    status, response = request.next_chunk()
                    if status and progress_callback:
                        percent = round(status.progress() * 100, 1)
                        progress_callback(percent)

                video_id = response.get("id")

                if not video_id:
                    logger.error(
                        "Upload response missing video ID: %s",
                        response,
                    )
                    return None

                watch_url = f"https://youtu.be/{video_id}"
                logger.info(
                    "Upload successful! " "Privacy: unlisted. URL: %s",
                    watch_url,
                )

                return watch_url

            except HttpError as exc:
                error_reason = ""
                if exc.error_details:
                    for detail in exc.error_details:
                        if isinstance(detail, dict):
                            error_reason = detail.get("reason", "")

                if exc.resp.status == 403 and "quota" in str(exc).lower():
                    logger.warning(
                        "Quota exhausted for current token. " "Rotating credentials..."
                    )
                    self.cred_pool.rotate_token()
                    continue

                logger.error(
                    "YouTube API error (status=%d, " "reason=%s): %s",
                    exc.resp.status,
                    error_reason,
                    str(exc),
                )
                raise

        logger.error("All credential rotation attempts exhausted.")
        return None
