/**
 * @fileoverview BotGuard Provider microservice entry point.
 * Exposes Express HTTP endpoints for YouTube BotGuard PoToken
 * generation, signature cipher decryption, and N-parameter
 * throttle-bypass transformation.
 *
 * This service runs in an isolated Docker container, completely
 * decoupled from the Python backend. The Python worker calls these
 * endpoints via internal Docker networking.
 */

import express from 'express';
import { generatePoToken } from './lib/botguard.js';
import {
  decryptSignature,
  transformNParam,
  clearPlayerCache,
} from './lib/cipher.js';

/** @const {number} Server listening port. */
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());

/**
 * Health check endpoint. Used by Docker health checks and the
 * Python backend to verify the microservice is operational.
 *
 * @route GET /health
 * @returns {Object} Status object with service name and uptime.
 */
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'botguard-provider',
    uptime: process.uptime(),
  });
});

/**
 * Generates a Proof of Origin Token for a specific YouTube video.
 * The Python backend calls this before initiating a yt-dlp download
 * to obtain the cryptographic attestation required by YouTube's
 * Google Video Server.
 *
 * @route POST /generate_pot
 * @param {Object} req.body
 * @param {string} req.body.videoId - The target YouTube video ID.
 * @param {string} req.body.visitorData - Visitor data from the
 *   VISITOR_INFO1_LIVE cookie.
 * @returns {Object} Generated token data including poToken.
 * @throws {400} If required parameters are missing.
 * @throws {500} If token generation fails.
 */
app.post('/generate_pot', async (req, res) => {
  const { videoId, visitorData } = req.body;

  if (!videoId || !visitorData) {
    return res.status(400).json({
      error: 'Missing required fields: videoId, visitorData',
    });
  }

  try {
    const result = await generatePoToken(videoId, visitorData);
    return res.json(result);
  } catch (err) {
    console.error(
      `[generate_pot] Failed for video ${videoId}:`,
      err.message
    );
    return res.status(500).json({
      error: 'PoToken generation failed',
      detail: err.message,
    });
  }
});

/**
 * Decrypts a YouTube signature cipher and returns the fully
 * constructed stream URL. Called by the Python backend when yt-dlp
 * encounters an encrypted stream URL.
 *
 * @route POST /decrypt_signature
 * @param {Object} req.body
 * @param {string} req.body.signatureCipher - The URL-encoded
 *   signatureCipher string containing s, url, and sp parameters.
 * @param {string} req.body.playerUrl - URL to the base.js script.
 * @returns {Object} Decrypted URL and raw signature.
 * @throws {400} If required parameters are missing.
 * @throws {500} If decryption fails.
 */
app.post('/decrypt_signature', async (req, res) => {
  const { signatureCipher, playerUrl } = req.body;

  if (!signatureCipher || !playerUrl) {
    return res.status(400).json({
      error: 'Missing required fields: signatureCipher, playerUrl',
    });
  }

  try {
    const result = await decryptSignature(
      signatureCipher, playerUrl
    );
    return res.json(result);
  } catch (err) {
    console.error(
      '[decrypt_signature] Failed:', err.message
    );
    return res.status(500).json({
      error: 'Signature decryption failed',
      detail: err.message,
    });
  }
});

/**
 * Transforms the YouTube N-parameter to bypass download throttling.
 * Without this transformation, YouTube limits download speed to
 * single-digit kilobytes per second. Called by the Python backend
 * before passing stream URLs to aria2c.
 *
 * @route POST /decrypt_nsig
 * @param {Object} req.body
 * @param {string} req.body.n - The raw N-parameter value.
 * @param {string} req.body.playerUrl - URL to the base.js script.
 * @returns {Object} The transformed N-parameter.
 * @throws {400} If required parameters are missing.
 * @throws {500} If transformation fails.
 */
app.post('/decrypt_nsig', async (req, res) => {
  const { n, playerUrl } = req.body;

  if (!n || !playerUrl) {
    return res.status(400).json({
      error: 'Missing required fields: n, playerUrl',
    });
  }

  try {
    const transformedN = await transformNParam(n, playerUrl);
    return res.json({ n: transformedN });
  } catch (err) {
    console.error('[decrypt_nsig] Failed:', err.message);
    return res.status(500).json({
      error: 'N-parameter transformation failed',
      detail: err.message,
    });
  }
});

/**
 * Invalidates the internal player script cache. Called when the
 * Python backend detects that YouTube has rotated the player
 * version and cached scripts are stale.
 *
 * @route POST /clear_cache
 * @returns {Object} Confirmation message.
 */
app.post('/clear_cache', (_req, res) => {
  clearPlayerCache();
  console.log('[clear_cache] Player script cache cleared.');
  return res.json({ status: 'Cache cleared' });
});

app.listen(PORT, () => {
  console.log(
    `BotGuard Provider microservice listening on port ${PORT}`
  );
});
