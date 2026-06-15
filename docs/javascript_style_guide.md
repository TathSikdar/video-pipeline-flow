# Google JavaScript/TypeScript Style Guide

This document defines the JavaScript and TypeScript coding standards for this project, adhering to the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html).

---

## Formatting & Layout

*   **Indentation:** Use **2 spaces** per indentation level. Do not use tabs.
*   **Semicolons:** Semicolons are **mandatory** at the end of every statement. Do not rely on Automatic Semicolon Insertion (ASI).
*   **Line Length:** Limit lines to a maximum of **80 characters** (or 100 characters in TypeScript/JSX if layout or complex nested type signatures require it).
*   **Quotes:** Use single quotes `'` for string literals, unless writing JSON or template strings (backticks `` ` ``).
*   **Braces:** Use the Egyptian brackets style (opening brace on the same line as the statement):
    ```javascript
    if (isReady) {
      executeTask();
    } else {
      waitTask();
    }
    ```

---

## Naming Conventions

| Object Type | Case | Example |
| :--- | :--- | :--- |
| **Classes / Interfaces** | PascalCase | `VideoEncoder`, `PipelineConfig` |
| **Functions / Methods** | camelCase | `startProcessing()`, `getFrames()` |
| **Variables / Properties** | camelCase | `frameCount`, `isActive` |
| **Constants** | UPPER_SNAKE_CASE | `MAX_RETRIES`, `API_ENDPOINT` |
| **File Names** | kebab-case or camelCase | `video-decoder.js`, `utils.ts` |

---

## Language Rules & ES6+ Best Practices

1.  **Variable Declarations:**
    *   Always use `const` or `let`. Never use `var`.
    *   Prefer `const` by default. Only use `let` if the variable needs to be reassigned.
2.  **Arrow Functions:** Prefer arrow functions `() => {}` for inline functions, callbacks, and lexical scoping of `this`.
3.  **Destructuring:** Use destructuring patterns for assignment and parameter lists to improve readability:
    ```javascript
    const { videoId, status } = payload;
    ```
4.  **Modules:** Always use standard ES modules (`import`/`export`) instead of CommonJS (`require`).
5.  **Asynchronous Patterns:** Prefer `async/await` syntax over raw Promises and `.then()` callbacks for cleaner, synchronous-looking asynchronous code.
    ```javascript
    async function loadPipeline(configPath) {
      try {
        const config = await readConfigFile(configPath);
        return initializePipeline(config);
      } catch (error) {
        logger.error('Failed to load pipeline config', error);
        throw error;
      }
    }
    ```

---

## JSDoc Guidelines

All classes, methods, and exported functions must have JSDoc comments describing parameters, return values, and behavior.

### Function JSDoc Example:
```javascript
/**
 * Merges audio track and video frames into a single output container.
 *
 * @param {string} videoPath - The path to the processed silent video file.
 * @param {string} audioPath - The path to the source audio file.
 * @param {Object} options - Custom encoding configurations.
 * @param {number} options.bitrate - Target audio bitrate in kbps.
 * @returns {Promise<string>} Path to the muxed output file.
 * @throws {Error} If media processing fails or commands time out.
 */
async function muxMediaStreams(videoPath, audioPath, options) {
  // implementation here
}
```
