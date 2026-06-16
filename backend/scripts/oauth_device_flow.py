"""Automated OAuth 2.0 Device Flow for datacenter authentication.

Spoofs the TVHTML5 (Smart TV) client identity to execute the
OAuth 2.0 Device Authorization Grant (RFC 8628). This generates
datacenter-safe OAuth tokens without transporting or leaking
residential browser cookies into the server environment.

Usage:
    python -m scripts.oauth_device_flow

The script will print a verification URL and user code. Navigate
to the URL on any device, enter the code, and grant access. The
resulting refresh token is automatically written to backend/.env.
"""

import json
import logging
import os

import sys  # noqa: E402
import time
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Google OAuth 2.0 endpoints
DEVICE_CODE_URL = "https://oauth2.googleapis.com/device/code"
TOKEN_URL = "https://oauth2.googleapis.com/token"

# OAuth scopes required for YouTube video uploads
YOUTUBE_UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload"

# Path to the backend .env file
ENV_FILE_PATH = Path(__file__).resolve().parent.parent / ".env"


def request_device_code(
    client: httpx.Client,
    client_id: str,
) -> dict:
    """Initiates the device authorization flow.

    Sends a POST request to Google's device code endpoint with
    the TVHTML5 client ID, requesting authorization for the
    YouTube upload scope.

    Args:
        client: An httpx client instance for making requests.
        client_id: The GCP client ID.

    Returns:
        A dictionary containing device_code, user_code,
        verification_url, expires_in, and interval.

    Raises:
        httpx.HTTPStatusError: If the request fails.
    """
    response = client.post(
        DEVICE_CODE_URL,
        data={
            "client_id": client_id,
            "scope": YOUTUBE_UPLOAD_SCOPE,
        },
    )
    response.raise_for_status()
    return response.json()


def poll_for_token(
    client: httpx.Client,
    device_code: str,
    interval: int,
    expires_in: int,
    client_id: str,
    client_secret: str,
) -> Optional[dict]:
    """Polls the token endpoint until the user grants access.

    Handles the following error states from the polling endpoint:
    - authorization_pending: User hasn't acted yet, continue.
    - slow_down: Increase polling interval by 5 seconds.
    - expired_token: Device code has expired, abort.
    - access_denied: User denied access, abort.

    Args:
        client: An httpx client instance for making requests.
        device_code: The device code from the authorization step.
        interval: Minimum seconds between polling requests.
        expires_in: Total seconds before the device code expires.
        client_id: The GCP client ID.
        client_secret: The GCP client secret.

    Returns:
        A dictionary containing access_token, refresh_token,
        token_type, and expires_in. Returns None if the flow
        is denied or expires.
    """
    deadline = time.time() + expires_in
    poll_interval = interval

    while time.time() < deadline:
        time.sleep(poll_interval)

        response = client.post(
            TOKEN_URL,
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "device_code": device_code,
                "grant_type": ("urn:ietf:params:oauth:grant-type:device_code"),
            },
        )

        data = response.json()

        if "access_token" in data:
            return data

        error = data.get("error", "")

        if error == "authorization_pending":
            logger.info("Waiting for user authorization...")
            continue
        elif error == "slow_down":
            poll_interval += 5
            logger.info(
                "Rate limited. Increasing interval to %ds.",
                poll_interval,
            )
            continue
        elif error == "expired_token":
            logger.error("Device code expired. Please restart the flow.")
            return None
        elif error == "access_denied":
            logger.error("User denied access.")
            return None
        else:
            logger.error("Unexpected error: %s", error)
            return None

    logger.error("Polling timed out.")
    return None


def write_token_to_env(
    refresh_token: str,
    index: str,
) -> None:
    """Appends or updates a refresh token in the .env file.

    Writes the token as GCP_REFRESH_TOKEN_{index}.

    Args:
        refresh_token: The OAuth 2.0 refresh token string.
        index: The project index string (e.g., '1', '2').
    """
    env_key = f"GCP_REFRESH_TOKEN_{index}"
    env_line = f"{env_key}={refresh_token}\n"

    # Read existing content if the file exists
    existing_lines = []
    if ENV_FILE_PATH.exists():
        with open(ENV_FILE_PATH, "r", encoding="utf-8") as f:
            existing_lines = f.readlines()

    # Check if the key already exists and update it
    key_found = False
    for i, line in enumerate(existing_lines):
        if line.startswith(f"{env_key}="):
            existing_lines[i] = env_line
            key_found = True
            break

    if not key_found:
        existing_lines.append(env_line)

    with open(ENV_FILE_PATH, "w", encoding="utf-8") as f:
        f.writelines(existing_lines)

    logger.info(
        "Refresh token written to %s as %s",
        ENV_FILE_PATH,
        env_key,
    )


def execute_device_flow() -> None:
    """Executes the full OAuth 2.0 Device Authorization Grant.

    This is the main entry point. It requests a device code,
    displays the user code and verification URL, polls for
    authorization, and writes the resulting refresh token to
    the .env file.

    Raises:
        SystemExit: If the authorization flow fails.
    """
    print("\n" + "=" * 50)
    print("  YouTube OAuth Device Flow Configuration")
    print("=" * 50)
    index = input("Enter the project index to configure (e.g., 1, 2, 3): ").strip()

    if not index:
        logger.error("Project index cannot be empty.")
        sys.exit(1)

    client_id = os.getenv(f"GCP_CLIENT_ID_{index}")
    client_secret = os.getenv(f"GCP_CLIENT_SECRET_{index}")

    if not client_id or not client_secret:
        logger.error(
            f"GCP_CLIENT_ID_{index} or GCP_CLIENT_SECRET_{index} is missing from the .env file. "
            "Please create a 'TVs and Limited Input devices' OAuth Client ID "
            "in the Google Cloud Console and add the credentials to backend/.env."
        )
        sys.exit(1)

    logger.info("Initiating OAuth 2.0 Device Authorization Grant for project %s...", index)

    with httpx.Client(timeout=30.0) as client:
        # Step 1: Request device code
        device_data = request_device_code(client, client_id)

        device_code = device_data["device_code"]
        user_code = device_data["user_code"]
        verification_url = device_data["verification_url"]
        interval = device_data.get("interval", 5)
        expires_in = device_data.get("expires_in", 1800)

        # Step 2: Display instructions to the user
        print("\n" + "=" * 50)
        print("  YouTube OAuth Device Flow")
        print("=" * 50)
        print(f"\n  1. Navigate to: {verification_url}")
        print(f"  2. Enter code:  {user_code}")
        print(f"\n  Code expires in {expires_in // 60} minutes.")
        print("=" * 50 + "\n")

        # Step 3: Poll for authorization
        token_data = poll_for_token(client, device_code, interval, expires_in, client_id, client_secret)

        if not token_data:
            logger.error("Device flow failed. Exiting.")
            sys.exit(1)

        # Step 4: Write the refresh token to .env
        refresh_token = token_data.get("refresh_token")
        if not refresh_token:
            logger.error(
                "No refresh_token in response. Full response: %s",
                json.dumps(token_data, indent=2),
            )
            sys.exit(1)

        write_token_to_env(refresh_token, index)

        logger.info(
            "Device flow completed successfully! " "Refresh token is ready for use."
        )


if __name__ == "__main__":
    execute_device_flow()
