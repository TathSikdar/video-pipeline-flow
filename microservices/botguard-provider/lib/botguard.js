import { BG, base64ToU8, u8ToBase64 } from 'bgutils-js';
import { JSDOM } from 'jsdom';

/**
 * @const {string} The BotGuard request key used for YouTube
 * challenge creation via the JNN API.
 */
const BOTGUARD_REQUEST_KEY = 'O43z0dpjhgX20SCx4KAo';

/**
 * @const {string} Google API key used for WAA integrity token
 * requests. This is the standard public key embedded in
 * YouTube's web player.
 */
const GOOG_API_KEY = 'AIzaSyDyT5W0Jh49F30Pqqtyfdf7pDLFKLJoAnw';

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
 * Generates a Proof of Origin Token (PoToken) for a specific
 * YouTube video. The token cryptographically proves to YouTube's
 * Google Video Server that the request originates from a genuine
 * browser environment, not an automated scraper.
 *
 * This function manually implements the full BotGuard attestation
 * flow instead of using BG.PoToken.generate(). This is necessary
 * because bgutils-js uses `instanceof Function` to validate the
 * minting callback, which fails in JSDOM due to the cross-realm
 * prototype chain mismatch. By manually implementing the flow,
 * we replace `instanceof` with `typeof` checks.
 *
 * The generation flow:
 * 1. Fetch BotGuard challenge from YouTube's WAA API.
 * 2. Create an isolated JSDOM environment mimicking a browser.
 * 3. Inject and execute the VM interpreter script.
 * 4. Create a BotGuardClient and take a snapshot.
 * 5. Exchange the snapshot for an integrity token via GenerateIT.
 * 6. Use the integrity token to mint a content-bound PoToken.
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
  const dom = createSterileDOM();

  try {
    // Step 1: Fetch the BotGuard challenge from the WAA backend API
    const challengeData = await BG.Challenge.create({
      requestKey: BOTGUARD_REQUEST_KEY,
      fetch: globalThis.fetch,
      useYouTubeAPI: true
    });

    if (!challengeData || !challengeData.program) {
      throw new Error('Failed to generate challenge from WAA API.');
    }

    const {
      program: challengeProgram,
      globalName,
      interpreterJavascript
    } = challengeData;

    // Step 2: Extract and inject the VM interpreter script
    let interpreterCode = interpreterJavascript
      .privateDoNotAccessOrElseSafeScriptWrappedValue;

    if (!interpreterCode) {
      const safeUrl = interpreterJavascript
        .privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
      if (!safeUrl) {
        throw new Error(
          'No interpreter script or URL provided by WAA API.'
        );
      }
      const interpreterUrl = safeUrl.startsWith('//')
        ? `https:${safeUrl}`
        : safeUrl;
      const interpreterResponse = await fetch(interpreterUrl, {
        headers: { 'User-Agent': USER_AGENT }
      });
      if (!interpreterResponse.ok) {
        throw new Error(
          `Failed to fetch BotGuard interpreter: `
          + `${interpreterResponse.status}`
        );
      }
      interpreterCode = await interpreterResponse.text();
    }

    const scriptEl = dom.window.document.createElement('script');
    scriptEl.textContent = interpreterCode;
    dom.window.document.head.appendChild(scriptEl);

    // Step 3: Create BotGuardClient and take a snapshot
    // We use BG.BotGuardClient directly instead of
    // BG.PoToken.generate() to avoid the cross-realm
    // `instanceof Function` check in WebPoMinter.
    const botguard = await BG.BotGuardClient.create({
      program: challengeProgram,
      globalName: globalName,
      globalObj: dom.window,
    });

    const webPoSignalOutput = [];
    const botguardResponse = await botguard.snapshot({
      webPoSignalOutput,
    });

    // Step 4: Exchange the snapshot for an integrity token
    const payload = [BOTGUARD_REQUEST_KEY, botguardResponse];
    const itResponse = await fetch(
      'https://www.youtube.com/api/jnn/v1/GenerateIT',
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json+protobuf',
          'x-goog-api-key': GOOG_API_KEY,
          'x-user-agent': 'grpc-web-javascript/0.1',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(payload),
      }
    );

    if (!itResponse.ok) {
      throw new Error(
        `GenerateIT request failed: ${itResponse.status}`
      );
    }

    const itJson = await itResponse.json();
    const [
      integrityToken,
      estimatedTtlSecs,
    ] = itJson;

    if (!integrityToken) {
      throw new Error(
        'GenerateIT returned no integrity token.'
      );
    }

    // Step 5: Mint the PoToken manually
    // This replaces WebPoMinter.create() which uses the broken
    // `instanceof Function` cross-realm check.
    const getMinter = webPoSignalOutput[0];
    if (!getMinter) {
      throw new Error(
        'BotGuard VM did not produce a minting function '
        + '(PMD:Undefined).'
      );
    }

    const mintCallback = await getMinter(
      base64ToU8(integrityToken)
    );

    if (typeof mintCallback !== 'function') {
      throw new Error(
        'Minting callback is not callable '
        + `(type: ${typeof mintCallback}).`
      );
    }

    // Mint a token bound to the visitor data identifier
    const identifier = visitorData || videoId;
    const rawToken = await mintCallback(
      new TextEncoder().encode(identifier)
    );

    if (!rawToken) {
      throw new Error('Minting returned null (YNJ:Undefined).');
    }

    const poToken = u8ToBase64(rawToken, true);

    return {
      poToken: poToken,
      visitorData: visitorData,
      ttlSeconds: estimatedTtlSecs || 21600,
    };
  } finally {
    // Always clean up the JSDOM instance to prevent memory leaks
    dom.window.close();
  }
}
