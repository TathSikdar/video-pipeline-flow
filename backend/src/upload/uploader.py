"""YouTube Data API v3 Uploader.

Uploads 1080p MP4 files to YouTube using the Data API v3 with a
standard One-Shot POST request. Enforces the 'unlisted' privacy
status on all uploads.

The One-Shot approach avoids the complexity of Google's Resumable
Upload protocol. Since we enforce a strict 1080p resolution cap in
the download engine, file sizes remain small enough to upload in a
single HTTP request without triggering memory timeouts.
"""

import logging
import os
from typing import Optional

from google.oauth2.credentials import Credentials
from google.auth.exceptions import RefreshError
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from googleapiclient.http import MediaFileUpload

logger = logging.getLogger(__name__)

# GCP token URI
TOKEN_URI = "https://oauth2.googleapis.com/token"


class YouTubeUploader:
    """Uploads videos to YouTube via the Data API v3.

    Uses a single GCP refresh token to obtain OAuth tokens.
    """

    def __init__(self) -> None:
        """Initializes the uploader."""
        pass

    def _build_youtube_service(self, client_id: str, client_secret: str, refresh_token: str):
        """Constructs an authenticated YouTube API service.

        Creates OAuth2 credentials from the refresh token and
        builds a YouTube Data API v3 service client.

        Args:
            client_id: The GCP client ID.
            client_secret: The GCP client secret.
            refresh_token: The GCP refresh token.

        Returns:
            A googleapiclient Resource object for the YouTube
            Data API v3.
        """
        credentials = Credentials(
            token=None,
            refresh_token=refresh_token,
            token_uri=TOKEN_URI,
            client_id=client_id,
            client_secret=client_secret,
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
        Data API v3 videos.insert endpoint.

        Args:
            file_path: Absolute path to the MP4 file.
            title: The video title.
            description: Optional video description.

        Returns:
            The YouTube watch URL (https://youtu.be/VIDEO_ID),
            or None if the upload fails.

        Raises:
            FileNotFoundError: If the video file does not exist.
            HttpError: If an API error occurs.
        """
        if not os.path.exists(file_path):
            raise FileNotFoundError(f"Video file not found: {file_path}")

        file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
        logger.info(
            "Preparing upload: %s (%.1f MB)",
            title,
            file_size_mb,
        )

        from .credential_pool import CredentialPool
        pool = CredentialPool()
        max_attempts = max(1, pool.get_pool_size())

        for attempt in range(max_attempts):
            creds = pool.get_next_credential()
            if not creds:
                logger.error("No valid credentials in pool.")
                return None
                
            client_id, client_secret, refresh_token = creds

            try:
                youtube = self._build_youtube_service(client_id, client_secret, refresh_token)

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
                    logger.error("Upload response missing video ID: %s", response)
                    return None

                watch_url = f"https://youtu.be/{video_id}"
                logger.info("Upload successful! Privacy: unlisted. URL: %s", watch_url)

                return watch_url

            except HttpError as exc:
                error_reason = ""
                if exc.error_details:
                    for detail in exc.error_details:
                        if isinstance(detail, dict):
                            error_reason = detail.get("reason", "")

                if error_reason in ("quotaExceeded", "uploadLimitExceeded"):
                    logger.warning("Quota/Upload limit exceeded for project (attempt %d/%d). Trying next credential...", attempt + 1, max_attempts)
                    pool.mark_exhausted(client_id, refresh_token, error_reason)
                    continue

                logger.error(
                    "YouTube API error (status=%d, reason=%s): %s",
                    exc.resp.status,
                    error_reason,
                    str(exc),
                )
                raise

            except RefreshError as exc:
                logger.warning("Invalid or revoked refresh token (attempt %d/%d). Trying next credential...", attempt + 1, max_attempts)
                pool.mark_exhausted(client_id, refresh_token, "invalid_grant")
                continue

        logger.error("All credentials in the pool have exhausted their daily quota.")
        return None
