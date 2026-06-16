/**
 * @fileoverview YouTube player signature cipher and N-parameter
 * decryption module. Extracts the dynamic decryption functions from
 * YouTube's base.js player script, executes them in an isolated JSDOM
 * sandbox, and returns the decrypted values.
 *
 * The signature cipher and N-parameter transform are obfuscated
 * functions embedded in YouTube's player JavaScript. Their names and
 * structure change with every player release, so we use ordered regex
 * pattern lists with fallbacks to locate them dynamically.
 */

import { JSDOM } from 'jsdom';
import { LRUCache } from 'lru-cache';

/** @const {number} Maximum number of cached player scripts. */
const MAX_CACHE_ENTRIES = 10;

/** @const {number} Cache TTL in milliseconds (2 hours). */
const CACHE_TTL_MS = 7_200_000;

/**
 * LRU cache for fetched and parsed player scripts, keyed by URL.
 * Prevents re-fetching base.js on every request when the player
 * version has not changed.
 * @type {LRUCache<string, string>}
 */
const playerScriptCache = new LRUCache({
  max: MAX_CACHE_ENTRIES,
  ttl: CACHE_TTL_MS,
});

/**
 * Ordered regex patterns for locating the initial signature
 * decryption function name within the player script. Each pattern
 * targets a different call-site variant where the encrypted
 * signature is passed into the decryption function.
 * @const {RegExp[]}
 */
const SIG_FUNCTION_NAME_PATTERNS = [
  /\b[cs]\s*&&\s*[adf]\.set\([^,]+,\s*encodeURIComponent\(([a-zA-Z0-9$]+)\(/,
  /\bm=([a-zA-Z0-9$]{2,})\(decodeURIComponent\(h\.s\)\)/,
  /\bc\s*&&\s*d\.set\([^,]+,\s*(?:encodeURIComponent\s*\()([a-zA-Z0-9$]+)\(/,
  /\bc\s*&&\s*[a-z]\.set\([^,]+,\s*([a-zA-Z0-9$]+)\(/,
  /\bc\s*&&\s*[a-z]\.set\([^,]+,\s*encodeURIComponent\(([a-zA-Z0-9$]+)\(/,
  /([a-zA-Z0-9$]+)\s*=\s*function\(\s*a\s*\)\s*\{\s*a\s*=\s*a\.split\(\s*""\s*\)/,
];

/**
 * Regex patterns for locating the N-parameter throttle-bypass
 * function name. YouTube throttles connections to kilobytes/sec
 * if this parameter is not correctly transformed.
 * @const {RegExp[]}
 */
const NSIG_FUNCTION_NAME_PATTERNS = [
  /\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]+)(?:\[(\d+)\])?\([a-zA-Z0-9]\)/,
  /\b([a-zA-Z0-9$]+)\s*=\s*function\(\s*a\s*\)\s*\{\s*var\s+b=a\.split\(""\)/,
  /([a-zA-Z0-9$]{2,})\s*=\s*function\(\s*a\s*\)\s*\{[^}]*?join\(""\)/,
];

/**
 * Fetches and caches a YouTube player script from the given URL.
 *
 * @param {string} playerUrl - Full HTTPS URL to the base.js script.
 * @returns {Promise<string>} The raw JavaScript source text.
 * @throws {Error} If the fetch fails or returns a non-OK status.
 */
async function fetchPlayerScript(playerUrl) {
  const cached = playerScriptCache.get(playerUrl);
  if (cached) {
    return cached;
  }

  const normalizedUrl = playerUrl.startsWith('//')
    ? `https:${playerUrl}`
    : playerUrl;

  const response = await fetch(normalizedUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
        + 'AppleWebKit/537.36 (KHTML, like Gecko) '
        + 'Chrome/125.0.0.0 Safari/537.36',
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch player script: ${response.status}`
    );
  }

  const script = await response.text();
  playerScriptCache.set(playerUrl, script);
  return script;
}

/**
 * Applies an ordered list of regex patterns to a source string and
 * returns the first successful capture group match.
 *
 * @param {string} source - The JavaScript source to search.
 * @param {RegExp[]} patterns - Ordered regex patterns to attempt.
 * @param {string} label - Human-readable label for error messages.
 * @returns {string} The captured function name.
 * @throws {Error} If no pattern matches.
 */
function extractFunctionName(source, patterns, label) {
  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  throw new Error(
    `Could not extract ${label} function name from player script`
  );
}

/**
 * Extracts a JavaScript function body and its helper object from
 * the player script given the function name.
 *
 * The signature function has the form:
 *   var FUNC = function(a) { a=a.split(""); HELPER.op(a,N); ... return a.join("") };
 *
 * The helper object has the form:
 *   var HELPER = { op1:function(a,b){...}, op2:function(a){a.reverse()}, ... };
 *
 * @param {string} source - The raw player script source.
 * @param {string} funcName - The decryption function name.
 * @returns {string} A self-contained JavaScript snippet defining
 *   both the helper object and the decryption function.
 * @throws {Error} If the function or helper cannot be extracted.
 */
function extractSigFunctionCode(source, funcName) {
  const escaped = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Match the function definition
  const funcPattern = new RegExp(
    `(?:var|const|let)?\\s*${escaped}`
    + '\\s*=\\s*function\\(a\\)\\s*\\{(.*?)\\}\\s*[;,]',
    's'
  );
  const funcMatch = source.match(funcPattern);
  if (!funcMatch) {
    throw new Error(
      `Could not extract function body for: ${funcName}`
    );
  }
  const funcBody = funcMatch[1];

  // Extract the helper object name from the function body.
  // The body references methods like: HELPER.methodName(a, N)
  const helperMatch = funcBody.match(
    /([a-zA-Z0-9$]+)\.[a-zA-Z0-9$]+\s*\(/
  );
  if (!helperMatch) {
    throw new Error(
      'Could not extract helper object name from sig function'
    );
  }
  const helperName = helperMatch[1];
  const helperEscaped = helperName.replace(
    /[.*+?^${}()|[\]\\]/g, '\\$&'
  );

  // Extract the full helper object definition
  const helperPattern = new RegExp(
    `(?:var|const|let)\\s+${helperEscaped}`
    + '\\s*=\\s*\\{([\\s\\S]*?)\\}\\s*;',
    's'
  );
  const helperMatch2 = source.match(helperPattern);
  if (!helperMatch2) {
    throw new Error(
      `Could not extract helper object: ${helperName}`
    );
  }

  // Assemble a self-contained executable script
  return `var ${helperName} = {${helperMatch2[1]}};\n`
    + `var ${funcName} = function(a) {${funcBody}};\n`;
}

/**
 * Extracts the N-parameter transform function from the player
 * script. This function is more complex than the sig function and
 * may reference additional helper arrays.
 *
 * @param {string} source - The raw player script source.
 * @param {string} funcName - The N-transform function name.
 * @returns {string} A self-contained JavaScript snippet.
 * @throws {Error} If extraction fails.
 */
function extractNsigFunctionCode(source, funcName) {
  const escaped = funcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // The N-param function is typically longer and uses split/join.
  // Try multiple extraction patterns.
  const patterns = [
    new RegExp(
      `(?:var|const|let)?\\s*${escaped}`
      + '\\s*=\\s*function\\(a\\)\\s*\\{([\\s\\S]*?)'
      + 'return\\s+[a-zA-Z0-9$]*\\.join\\(""\\)\\s*\\}\\s*[;,]',
      's'
    ),
    new RegExp(
      `(?:var|const|let)?\\s*${escaped}`
      + '\\s*=\\s*function\\(a\\)\\s*\\{([\\s\\S]{50,800}?)'
      + '\\}\\s*[;,]',
      's'
    ),
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);
    if (match) {
      return `var ${funcName} = function(a) {${match[1]}`
        + 'return b.join("")};';
    }
  }

  throw new Error(
    `Could not extract N-param function body for: ${funcName}`
  );
}

/**
 * Executes a JavaScript snippet inside an isolated JSDOM sandbox
 * and returns the result of calling the specified function with
 * the given argument.
 *
 * @param {string} code - The JavaScript code to inject.
 * @param {string} funcName - The function to call after injection.
 * @param {string} arg - The string argument to pass.
 * @returns {string} The function's return value.
 * @throws {Error} If execution fails or produces no result.
 */
function executeInSandbox(code, funcName, arg) {
  const escaped = JSON.stringify(arg);
  const fullScript = `${code}\nvar __result = ${funcName}(${escaped});`;

  const dom = new JSDOM(
    `<!DOCTYPE html><html><body></body></html>`,
    {
      url: 'https://www.youtube.com',
      runScripts: 'dangerously',
    }
  );

  try {
    const scriptEl = dom.window.document.createElement('script');
    scriptEl.textContent = fullScript;
    dom.window.document.body.appendChild(scriptEl);

    const result = dom.window.__result;
    if (typeof result !== 'string' || result.length === 0) {
      throw new Error(
        `Sandbox execution returned invalid result: ${result}`
      );
    }
    return result;
  } finally {
    dom.window.close();
  }
}

/**
 * Decrypts a YouTube signature cipher and returns the fully
 * constructed stream URL with the decrypted signature appended.
 *
 * @param {string} signatureCipher - The URL-encoded signatureCipher
 *   string from the streaming data, containing `s`, `url`, and `sp`
 *   parameters.
 * @param {string} playerUrl - URL to the base.js player script.
 * @returns {Promise<Object>} Decrypted result.
 * @returns {string} return.url - The final playable stream URL.
 * @returns {string} return.signature - The decrypted signature.
 * @throws {Error} If decryption fails at any stage.
 */
export async function decryptSignature(signatureCipher, playerUrl) {
  // Parse the signature cipher components
  const params = new URLSearchParams(signatureCipher);
  const encryptedSig = params.get('s');
  const baseUrl = params.get('url');
  const sigParam = params.get('sp') || 'sig';

  if (!encryptedSig || !baseUrl) {
    throw new Error(
      'Invalid signatureCipher: missing s or url parameter'
    );
  }

  // Fetch the player script
  const playerScript = await fetchPlayerScript(playerUrl);

  // Extract the decryption function name and code
  const funcName = extractFunctionName(
    playerScript,
    SIG_FUNCTION_NAME_PATTERNS,
    'signature'
  );
  const funcCode = extractSigFunctionCode(playerScript, funcName);

  // Execute in sandbox
  const decryptedSig = executeInSandbox(
    funcCode, funcName, decodeURIComponent(encryptedSig)
  );

  // Construct the final URL
  const finalUrl = `${baseUrl}&${sigParam}=${encodeURIComponent(decryptedSig)}`;

  return {
    url: finalUrl,
    signature: decryptedSig,
  };
}

/**
 * Transforms the YouTube N-parameter to bypass download throttling.
 * Without this transformation, YouTube limits download speed to
 * single-digit kilobytes per second.
 *
 * @param {string} n - The raw N-parameter value from the stream URL.
 * @param {string} playerUrl - URL to the base.js player script.
 * @returns {Promise<string>} The transformed N-parameter value.
 * @throws {Error} If the transform function cannot be extracted
 *   or execution fails.
 */
export async function transformNParam(n, playerUrl) {
  const playerScript = await fetchPlayerScript(playerUrl);

  const funcName = extractFunctionName(
    playerScript,
    NSIG_FUNCTION_NAME_PATTERNS,
    'n-parameter'
  );
  const funcCode = extractNsigFunctionCode(playerScript, funcName);

  return executeInSandbox(funcCode, funcName, n);
}

/**
 * Clears the internal player script cache. Useful when a player
 * version update is detected.
 */
export function clearPlayerCache() {
  playerScriptCache.clear();
}
