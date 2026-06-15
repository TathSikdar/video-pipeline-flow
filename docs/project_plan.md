# Video Pipeline Flow — Project Plan

This document outlines the detailed plan for each phase of the project. For each phase, we identify the primary problems we will tackle and present possible solutions. 

**Process:** We will discuss the possible solutions for each problem. We will only proceed with implementation once the preferred solution for each problem has been explicitly approved.

---

## Phase 1: Environment and Directory Initialization

### Problem 1.1: Repository and Architecture Structure
The project requires a strictly decoupled architecture with a modern UI frontend (hosted on Render/GitHub Pages) and a backend worker engine (hosted on Render via Docker).
*   **[SELECTED] Solution A (Monorepo):** Create a single repository with root-level `frontend/` and `backend/` directories. This centralizes code management, linting rules, and documentation while still allowing separate deployment pipelines.
*   ~~Solution B (Polyrepo):~~ Create completely separate repositories for the frontend and backend. This enforces strict decoupling but requires managing multiple Git environments.
*   ~~Solution C (Submodules):~~ Use Git submodules to link independent frontend and backend repositories into a master project repository.

### Problem 1.2: Storage & RAM Disk (`tmpfs`) Configuration
The pipeline analysis strictly mandates that downloads and FFmpeg multiplexing must execute entirely within a Linux `tmpfs` RAM disk to prevent disk I/O saturation.
*   **[RECOMMENDED FOR RENDER] Solution A (Modified Docker-native `/dev/shm`):** Render blocks privileged Docker containers, meaning scripts trying to run `mount -t tmpfs` will fail. However, Render automatically mounts `/dev/shm` (shared memory) in all Docker containers, which *is* a native `tmpfs` RAM disk. We will map our temp directories directly to `/dev/shm` in the Docker environment.
*   ~~Solution B (Dynamic Init Script):~~ Create an environment initialization script (`init_env.sh`) that dynamically mounts a `tmpfs` partition to a `temp/` folder if run on Linux, falling back to a standard directory on Windows/macOS for easier local testing.

### Problem 1.3: Linting and Style Guide Enforcement
The project requires strict adherence to Google Python and JavaScript/TypeScript style guides, enforcing the use of `black`, `flake8`, `eslint`, and `prettier`.
*   ~~Solution A (Unified Root Scripts):~~ Implement a root-level `Makefile` or `package.json` that orchestrates all formatters and linters across both the frontend and backend directories concurrently.
*   **[RECOMMENDED FOR GOOGLE STYLE] Solution B (Independent Tooling):** Maintain completely separate configurations where the frontend manages its own `eslint`/`prettier` via npm scripts, and the backend manages `black`/`flake8` via Python's `pre-commit` hooks. Google natively embraces language-specific idiomatic toolchains (often orchestrated by Bazel), so keeping JS tooling in JS and Python tooling in Python is the standard approach.

### Problem 1.4: Environment Variables & Credential Management
The backend will require sensitive proxy credentials, OAuth2 refresh token pools, and GCP project IDs.
*   **[SELECTED] Solution A (`.env` with Template):** Use a standard `.env` file for local development (ignored in git) alongside a documented `.env.example` file that lists all required keys without values.
*   ~~Solution B (Secret Manager Integration):~~ Integrate a cloud secret manager (like Google Secret Manager or Doppler) from the start, pulling credentials dynamically during initialization rather than relying on local `.env` files.

---

## Phase 2: Core Download Pipeline & Extraction Logic

### Problem 2.1: Download Concurrency & Throttling Evasion
YouTube throttles single HTTP connections. The pipeline analysis requires forcing fragment concurrency to bypass these limits.
*   **[SELECTED] Solution A (External `aria2c`):** Integrate `aria2c` as the external downloader for `yt-dlp`, establishing 16 concurrent TCP byte-range connections (`-x 16 -k 1M`). This is highly robust but requires installing `aria2c` in our Docker container.
*   ~~Solution B (Native `yt-dlp` Concurrency):~~ Utilize `yt-dlp`'s built-in `--concurrent-fragments` flag. It requires no external dependencies but can sometimes fail to maintain persistent connections compared to `aria2c`.

### Problem 2.2: Universal Media Protocol (UMP) & SABR Handling
YouTube enforces the SABR protocol, which drops resolution to 360p for non-compliant clients and obfuscates stream data inside UMP blobs.
*   **[SELECTED] Solution A (Custom Protocol Bridges):** As mandated by the pipeline analysis, we inject custom Python bridges (`SabrStreamingAdapter` and `SabrUmpProcessor`) into `yt-dlp`'s core extraction hooks to programmatically unpack UMP wrappers in-memory and bypass fake server-side buffering.
*   ~~Solution B (Wait for Upstream):~~ Rely entirely on upstream updates from the `yt-dlp` community to eventually handle SABR/UMP natively. (Note: This is risky if zero-day patching is required).

### Problem 2.3: FFmpeg Multiplexing RAM Exhaustion During Serial Downloads
Because the pipeline downloads videos *serially*, we avoid the problem of concurrent FFmpeg instances. However, downloading large 4K video files alongside high-quality audio files into the 4GB RAM disk and then running FFmpeg to merge them still causes massive memory spikes.
*   **[SELECTED] Solution A (Strict Synchronous Blocking):** Ensure the Python worker completely blocks until `yt-dlp` finishes the download AND FFmpeg finishes multiplexing and the final file is uploaded/deleted before moving to the next video in the serial queue. This strictly caps RAM usage to exactly one video lifecycle and guarantees we never exceed 4GB.
*   ~~Solution B (Streamed Multiplexing / Piped Output):~~ Force `yt-dlp` to pipe the downloaded streams directly into FFmpeg (`ffmpeg -i pipe:0 ...`) so that the raw video and audio `.part` files are never written to the RAM disk simultaneously. This drastically reduces the required RAM footprint but is much more complex to implement and debug.

### Problem 2.4: Lingering Fragments Causing RAM Disk Saturation
Failed downloads leave behind `.part` or `.ytdl` fragments. Over time, these will exhaust our 4GB RAM disk.
*   **[SELECTED] Solution A (Python Garbage Collection Wrapper):** Create an explicit Python cleanup function that aggressively purges the temporary workspace of any lingering fragments *before* initiating any new download, combined with `yt-dlp`'s `--no-continue` flag.
*   ~~Solution B (`yt-dlp` Exec Hook):~~ Pass `--no-continue` and use `yt-dlp`'s native `--exec before_dl:"rm -rf /tmp/*.part"` bash hooks to handle cleanup.

---

## Future Phases (To Be Detailed)

*   **Phase 3: BotGuard & Anti-Bot Architecture** (Microservices for PoToken generation, Visitor ID binding, and Signature Decryption).
*   **Phase 4: Upload Automation & Quota Management** (OAuth2 token rotation, quota load-balancing, and privacy settings).
*   **Phase 5: Frontend UI & API Integration** (Building the modern UI, decoupled API boundaries, and real-time link delivery).
*   **Phase 6: Deployment & IP Rotation Topology** (Configuring Render Docker environments, SLAAC IPv6 rotation, and residential proxy routing).
