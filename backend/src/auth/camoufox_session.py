"""Camoufox Stealth Session Generator.

Launches a C++ patched headless browser (Camoufox) to fetch valid
YouTube session cookies without triggering BotGuard's canvas pixel
hashing, WebGL string checks, or navigator.webdriver detection.

Camoufox patches these fingerprint surfaces at the C++ engine level,
making them invisible to JavaScript prototype chain traversal checks
that detect standard Playwright/Puppeteer overrides.
"""

import asyncio
import logging
from dataclasses import dataclass
from typing import Optional

from camoufox import AsyncCamoufox

logger = logging.getLogger(__name__)

# Maximum number of retry attempts for session generation
MAX_RETRIES = 3

# Seconds to wait for YouTube page to fully render
PAGE_LOAD_TIMEOUT_MS = 30_000

# Consumer-grade viewport dimensions matching a standard
# 1920x1080 Windows desktop
VIEWPORT_WIDTH = 1920
VIEWPORT_HEIGHT = 1080


@dataclass
class SessionData:
    """Container for YouTube session authentication data.

    Attributes:
        visitor_cookie: The VISITOR_INFO1_LIVE cookie value
            required for binding session-bound BotGuard tokens.
        visitor_data: The visitorData string extracted from
            YouTube's initial page data, used as the BotGuard
            identifier.
        user_agent: The User-Agent string used during session
            creation, which must match subsequent API requests.
    """

    visitor_cookie: str
    visitor_data: str
    user_agent: str


async def _extract_visitor_data(page) -> Optional[str]:
    """Extracts the visitorData string from YouTube's page context.

    YouTube embeds visitorData in the ytcfg global config object
    and also in the initial player response. We try both sources.

    Args:
        page: The Playwright page instance.

    Returns:
        The visitorData string, or None if extraction fails.
    """
    # Primary: extract from ytcfg global
    visitor_data = await page.evaluate(
        "() => {"
        "  try {"
        "    return window.ytcfg"
        "      && window.ytcfg.get"
        '      && window.ytcfg.get("VISITOR_DATA");'
        "  } catch(e) { return null; }"
        "}"
    )

    if visitor_data:
        return visitor_data

    # Fallback: extract from ytInitialPlayerResponse
    visitor_data = await page.evaluate(
        "() => {"
        "  try {"
        "    return window.ytInitialPlayerResponse"
        "      ?.responseContext"
        "      ?.visitorData;"
        "  } catch(e) { return null; }"
        "}"
    )

    return visitor_data


async def generate_session() -> SessionData:
    """Launches a stealth Camoufox browser to fetch YouTube session data.

    Navigates to youtube.com, waits for full page render, then
    extracts the VISITOR_INFO1_LIVE cookie and visitorData payload.
    Implements retry logic with exponential backoff if the page
    fails to load or cookies are not set.

    Returns:
        A SessionData instance containing the visitor cookie,
        visitor data, and user-agent string.

    Raises:
        RuntimeError: If session generation fails after all retry
            attempts are exhausted.
    """
    last_error = None

    for attempt in range(1, MAX_RETRIES + 1):
        logger.info(
            "Camoufox session attempt %d/%d",
            attempt,
            MAX_RETRIES,
        )

        try:
            import os
            proxy_url = os.getenv("RESIDENTIAL_PROXY_URL", "")
            camoufox_args = {
                "headless": True,
                "geoip": True,
            }
            if proxy_url:
                camoufox_args["proxy"] = {"server": proxy_url}

            async with AsyncCamoufox(**camoufox_args) as browser:
                context = await browser.new_context(
                    viewport={
                        "width": VIEWPORT_WIDTH,
                        "height": VIEWPORT_HEIGHT,
                    },
                    locale="en-US",
                )

                page = await context.new_page()
                user_agent = await page.evaluate("() => navigator.userAgent")

                # Navigate and wait for YouTube to fully render
                await page.goto(
                    "https://www.youtube.com",
                    wait_until="networkidle",
                    timeout=PAGE_LOAD_TIMEOUT_MS,
                )

                # Wait for ytcfg to populate
                await page.wait_for_function(
                    "() => window.ytcfg && window.ytcfg.get('VISITOR_DATA')",
                    timeout=10000,
                )

                # Extract the VISITOR_INFO1_LIVE cookie
                cookies = await context.cookies("https://www.youtube.com")
                visitor_cookie = None
                for cookie in cookies:
                    if cookie["name"] == "VISITOR_INFO1_LIVE":
                        visitor_cookie = cookie["value"]
                        break

                if not visitor_cookie:
                    raise RuntimeError(
                        "VISITOR_INFO1_LIVE cookie not found " "in browser context"
                    )

                # Extract visitorData from page context
                visitor_data = await _extract_visitor_data(page)
                if not visitor_data:
                    raise RuntimeError(
                        "visitorData could not be extracted " "from YouTube page"
                    )

                logger.info(
                    "Session generated successfully. "
                    "Cookie: %s..., VisitorData: %s...",
                    visitor_cookie[:10],
                    visitor_data[:10],
                )

                return SessionData(
                    visitor_cookie=visitor_cookie,
                    visitor_data=visitor_data,
                    user_agent=user_agent,
                )

        except Exception as exc:
            last_error = exc
            backoff = 2**attempt
            logger.warning(
                "Session attempt %d failed: %s. " "Retrying in %ds...",
                attempt,
                str(exc),
                backoff,
            )
            await asyncio.sleep(backoff)

    raise RuntimeError(
        f"Session generation failed after {MAX_RETRIES} "
        f"attempts. Last error: {last_error}"
    )
