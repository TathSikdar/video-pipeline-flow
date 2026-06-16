/**
 * @fileoverview BotGuard Proof of Origin Token generator.
 * Fetches the BotGuard challenge program from Google's JNN API,
 * executes the VM interpreter inside an isolated JSDOM environment,
 * and returns the cryptographic attestation token required by
 * YouTube's Google Video Server (GVS) to serve high-resolution
 * streams.
 *
 * This module wraps the bgutils-js library which provides the
 * reverse-engineered BotGuard VM interpreter.
 *
 * @see https://github.com/AntimatterCoder/BotGuard
 */

import { BG } from 'bgutils-js';
import { JSDOM } from 'jsdom';

/**
 * @const {string} The BotGuard request key used for YouTube
 * challenge creation via the JNN API.
 */
const BOTGUARD_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

/**
 * @const {string} YouTube InnerTube API base URL.
 */
const INNERTUBE_BASE = 'https://www.youtube.com/youtubei/v1';

/**
 * @const {string} YouTube InnerTube API key for unauthenticated
 * WEB client requests.
 */
const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

/**
 * @const {Object} Standard WEB client context for InnerTube API
 * requests. We identify as the WEB client for metadata extraction
 * as specified in the project architecture.
 */
const WEB_CLIENT_CONTEXT = {
  client: {
    clientName: 'TVHTML5_SIMPLY_EMBEDDED_PLAYER',
    clientVersion: '2.0',
    hl: 'en',
    gl: 'CA',
  },
};

/**
 * @const {string} User-Agent header matching a standard consumer
 * Chrome installation on Windows 10.
 */
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
  + 'AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'Chrome/125.0.0.0 Safari/537.36';

/**
 * Creates a sterile JSDOM environment configured to mimic a
 * genuine YouTube page context. The BotGuard VM expects certain
 * global objects to be present (window, document, navigator).
 *
 * @returns {JSDOM} A fresh, isolated JSDOM instance.
 */
function createSterileDOM() {
  return new JSDOM(
    '<!DOCTYPE html><html><head></head><body></body></html>',
    {
      url: 'https://www.youtube.com',
      referrer: 'https://www.youtube.com',
      contentType: 'text/html',
      runScripts: 'dangerously',
      pretendToBeVisual: true,
    }
  );
}

/**
 * Fetches the BotGuard challenge data from YouTube's InnerTube
 * player API for a specific video. The response contains the
 * challenge program bytecode and interpreter metadata.
 *
 * @param {string} videoId - The YouTube video ID to generate
 *   a content-bound PoToken for.
 * @returns {Promise<Object>} The raw player response containing
 *   attestation.botguardData.
 * @throws {Error} If the InnerTube request fails.
 */
async function fetchPlayerResponse(videoId) {
  const url = `${INNERTUBE_BASE}/player?key=${INNERTUBE_API_KEY}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': USER_AGENT,
    },
    body: JSON.stringify({
      context: WEB_CLIENT_CONTEXT,
      videoId: videoId,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `InnerTube player request failed: ${response.status}`
    );
  }

  return response.json();
}

/**
 * Generates a Proof of Origin Token (PoToken) for a specific
 * YouTube video. The token cryptographically proves to YouTube's
 * Google Video Server that the request originates from a genuine
 * browser environment, not an automated scraper.
 *
 * The generation flow:
 * 1. Fetch BotGuard challenge data from InnerTube player API.
 * 2. Create an isolated JSDOM environment mimicking a browser.
 * 3. Use bgutils-js to create a BotGuard challenge instance.
 * 4. Execute the VM interpreter with the challenge program.
 * 5. Generate the content-bound PoToken tied to the video ID.
 *
 * @param {string} videoId - The YouTube video ID.
 * @param {string} visitorData - The visitor data string from the
 *   VISITOR_INFO1_LIVE cookie or visitorData API response.
 * @returns {Promise<Object>} The generated token data.
 * @returns {string} return.poToken - The Proof of Origin Token to
 *   append as a `pot` URL parameter on stream requests.
 * @returns {string} return.visitorData - The visitor data used for
 *   token binding.
 * @returns {number} return.ttlSeconds - Suggested time-to-live for
 *   the generated token before regeneration.
 * @throws {Error} If challenge creation or token generation fails.
 */
export async function generatePoToken(videoId, visitorData) {
  // Step 1: Fetch the BotGuard challenge metadata
  const playerResponse = await fetchPlayerResponse(videoId);
  const botguardData =
    playerResponse?.attestation?.playerAttestationRenderer?.botguardData;

  if (!botguardData) {
    const errorBody = JSON.stringify(playerResponse).substring(0, 500);
    throw new Error(
      'No botguardData found in player response. '
      + 'Response: ' + errorBody
    );
  }

  const {
    program: challengeProgram,
    interpreterSafeUrl,
    globalName,
  } = botguardData;

  if (!challengeProgram || !interpreterSafeUrl) {
    throw new Error(
      'Incomplete botguardData: missing program or interpreter URL'
    );
  }

  // Step 2: Create an isolated browser-like environment
  const dom = createSterileDOM();

  try {
    // Step 3: Fetch the interpreter script and inject it
    const interpreterUrl = interpreterSafeUrl.startsWith('//')
      ? `https:${interpreterSafeUrl}`
      : interpreterSafeUrl;

    const interpreterResponse = await fetch(interpreterUrl, {
      headers: { 'User-Agent': USER_AGENT },
    });

    if (!interpreterResponse.ok) {
      throw new Error(
        'Failed to fetch BotGuard interpreter: '
        + `${interpreterResponse.status}`
      );
    }

    const interpreterCode = await interpreterResponse.text();
    const scriptEl = dom.window.document.createElement('script');
    scriptEl.textContent = interpreterCode;
    dom.window.document.head.appendChild(scriptEl);

    // Step 4: Create the BotGuard challenge via bgutils-js
    const bgChallenge = await BG.Challenge.create({
      requestKey: BOTGUARD_REQUEST_KEY,
      program: challengeProgram,
      globalName: globalName,
      bgConfig: {
        fetch: globalThis.fetch,
        globalObj: dom.window,
        identifier: visitorData,
      },
    });

    if (!bgChallenge) {
      throw new Error(
        'BG.Challenge.create() returned null. '
        + 'The interpreter may have changed format.'
      );
    }

    // Step 5: Generate the content-bound PoToken
    const poToken = await BG.PoToken.generate({
      program: challengeProgram,
      bgConfig: {
        globalObj: dom.window,
        fetch: globalThis.fetch,
      },
      identifier: visitorData,
      contentBinding: videoId,
    });

    return {
      poToken: poToken,
      visitorData: visitorData,
      ttlSeconds: 21600, // 6-hour suggested refresh interval
    };
  } finally {
    // Always clean up the JSDOM instance to prevent memory leaks
    dom.window.close();
  }
}
