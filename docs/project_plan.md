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

## Phase 3: BotGuard & Anti-Bot Architecture

### Problem 3.1: Cryptographic Attestation (BotGuard PoTokens)
YouTube drops streams to 360p or blocks them (HTTP 403) unless a mathematically accurate Proof of Origin (PoToken) is submitted. Generating this requires executing the BotGuard VM script cleanly.
*   **[SELECTED] Solution A (Isolated Deno/Node Microservice):** As recommended by the analysis doc, build a completely isolated microservice (e.g., `botguard-provider`) in a sterile Deno/Node.js Docker container to handle the `api/jnn/v1/GenerateIT` challenges without blocking the Python download threads.
*   ~~Solution B (Python embedded JS engine):~~ Embed `py_mini_racer` or `QuickJS` directly into the Python worker to execute the token generation. (Highly risky due to anti-logger traps and thread-blocking).

### Problem 3.2: Signature Cipher Decryption
Video streams are encrypted with a dynamic cipher located in `base.js`.
*   **[SELECTED] Solution A (Microservice Routing):** Route all signature decryption math to the external Node.js/Deno microservice created in Problem 3.1.
*   ~~Solution B (Python Regex + QuickJS Fallback):~~ Attempt to extract the cipher locally in Python using hardcoded regex. If it fails, spin up a lightweight QuickJS instance inside Python to execute the math.

### Problem 3.3: Client Identity & Browser Fingerprinting Evasion
Generating valid visitor cookies (`VISITOR_INFO1_LIVE`) requires passing hidden `<canvas>` cryptographic pixel hashing and WebGL string checks.
*   **[SELECTED] Solution A (C++ Patched Browser Engine):** Utilize a stealth browser engine patched at the C++ level (e.g., Camoufox) to fetch initial session data, perfectly emulating consumer font tables and screen geometry without relying on detectable JavaScript overrides.
*   ~~Solution B (Standard Playwright Overrides):~~ Use standard Playwright with JavaScript prototype overrides (`Object.defineProperty`) to mask headless variables. (Faster to setup, but very easily caught by advanced BotGuard checks).

### Problem 3.4: Datacenter Authentication
The analysis states we must *never* transport residential session cookies to the datacenter. Instead, we must use the OAuth 2.0 Device Flow via the `TVHTML5` client.
*   **[SELECTED] Solution A (Automated Device Flow Script):** Implement a Python script that spoofs the `TVHTML5` client, polls `google.com/device`, and prompts the user to enter the link/code. It then automatically saves the OAuth refresh token to the `.env` file.
*   ~~Solution B (Manual Setup):~~ Provide instructions for the user to manually execute the `TVHTML5` device flow on their local machine and manually copy-paste the tokens into the environment.

---

## Phase 4: Upload Automation & Quota Management

### Problem 4.1: Google API Quota Exhaustion & Credential Pooling
The YouTube Data API strictly limits uploads to 10,000 quota units per GCP project daily. We need to upload videos infinitely.
*   **[SELECTED] Solution B (Redis-backed State Tracking) + Solution A (Fallback):** Implement an external Redis database to track token health, daily quota usage, and rotation states across multiple worker nodes. If the Redis server is unavailable, the backend gracefully falls back to an In-Memory Round Robin Pool loaded directly from the `.env` file.

### Problem 4.2: Resumable Upload Mechanics for Large Files
Uploading multi-gigabyte 4K videos directly from the Render Docker container can easily trigger HTTP connection timeouts or memory drops.
*   **[SELECTED] Solution B (Standard One-Shot POST w/ 1080p Cap):** Attempt to push the entire video payload in a single massive HTTP POST request. To explicitly guarantee we don't trigger timeouts or massive memory drops, we enforce a strict `1080p` maximum resolution cap directly inside `yt-dlp`. This keeps the file sizes significantly smaller while retaining high quality.
*   ~~Solution A (Resumable Upload Protocol):~~ Implement Google's explicit Resumable Upload API. We request a session URI, and then upload the video in sequential byte-chunks. If the connection fails mid-upload, the worker simply queries the session to find the last received byte and resumes exactly where it left off.

### Problem 4.3: Target Privacy Status & UI Feedback Loops
The requirements strictly state that all uploaded videos MUST be set to `unlisted`. Once uploaded, the backend must construct the YouTube watch URL and send it to the UI.
*   **[SELECTED] Solution A (Real-time WebSocket Push):** Upload the video as `unlisted`, parse the Video ID from the API JSON response, construct the `https://youtu.be/[ID]` URL, and instantly push it directly to the frontend UI using the `websockets` library we installed in Phase 3.
*   ~~Solution B (Synchronous UI Polling):~~ Hold the resulting YouTube link in a temporary backend status dictionary. The frontend UI will blindly poll an HTTP GET endpoint every 5 seconds until the link eventually appears.

### Problem 4.4: Synchronous Pipeline Blocking
Because tasks originally ran in a single loop, Video 2 would have to wait to download until Video 1 completely finished uploading.
*   **[SELECTED] Solution A (Dual-Queue Pipelining):** Re-architect the backend to use completely independent `download_queue` and `upload_queue` workers. This allows the system to seamlessly download Video N+1 into the RAM disk while Video N is concurrently uploading from physical storage to YouTube, maximizing throughput.
*   ~~Solution B (Sequential Blocking):~~ Maintain the monolithic pipeline queue where everything runs strictly sequentially in one worker.

### Problem 4.5: Multi-Project Quota Scaling & Smart Routing
The default YouTube Data API v3 quota is extremely strict (100 uploads per project per day), and YouTube Channel upload limits are even stricter (~10-100 per day).
*   **[SELECTED] Solution A (Smart Quota Routing & Timezone Reset):** We scale horizontally by allowing unlimited GCP projects and YouTube Accounts. The `.env` file maps combinations using suffixes (`_1`, `_2`, etc.). A `CredentialPool` singleton dynamically discovers these at startup. 
    *   If an upload throws a 403 `quotaExceeded` error, it permanently bans that **GCP Client ID** from the pool. 
    *   If it throws a 403 `uploadLimitExceeded` or a 400 `invalid_grant` (dead token), it permanently bans that **YouTube Account's Refresh Token** from the pool.
    *   The system silently grabs the next valid, unbanned combination and instantly retries the upload without failing the active task or alerting the UI.
    *   All bans automatically expire precisely at Midnight Pacific Time (3:00 AM EST), exactly matching Google's internal API reset clocks, rather than using a rigid 24-hour math cooldown.
*   ~~Solution B (Redis Distributed Pool):~~ Use Redis to manage token states. (Overkill for a local single-node architecture).
*   ~~Solution C (Hardcoded Fallbacks):~~ Hardcode exactly two sets of credentials into the python script. (Not scalable and blindly wastes time retrying exhausted accounts).

---

## Phase 5: Frontend UI & API Integration

### Problem 5.1: State Management & WebSocket Integration
The frontend must trigger the backend API to start the pipeline and actively listen to the WebSocket channel for real-time video link updates.
*   **[SELECTED] Solution A (Native React Hooks + WebSocket API):** Use lightweight React `useState` and `useEffect` combined with the native browser `WebSocket` API. This keeps the frontend incredibly fast, decoupled, and free of unnecessary heavy dependencies.
*   ~~Solution B (Heavy State Libraries):~~ Implement Redux or Zustand for global state management alongside `socket.io-client`. This is highly robust but likely massive overkill for a single-page pipeline tool.

### Problem 5.2: Styling & Modern Aesthetics
The requirements demand a clean, responsive, and modern UI. You previously specified using TailwindCSS v3.
*   **[SELECTED] Solution A (Tailwind v3 + Custom Glassmorphism):** Utilize pure Tailwind v3 utility classes combined with custom `index.css` rules to implement advanced glassmorphism, dynamic gradients, and smooth micro-animations. This creates a "WOW" factor and highly premium feel.
*   ~~Solution B (Pre-built Component Libraries):~~ Rely on a heavy pre-built component library like Material-UI or Bootstrap. This is faster to build but often results in generic, corporate-looking interfaces that lack a truly premium aesthetic.

---

## Phase 6: Deployment & IP Rotation Topology

### Problem 6.1: Control Plane vs. Data Plane Routing
The analysis doc strictly dictates that we must route BotGuard challenges and InnerTube metadata through expensive Residential Proxies ($15/GB) to bypass bans, but the actual 4GB video downloads *must* be routed through cheap Datacenter/IPv6 IPs ($0.60/GB).
*   **[SELECTED] Solution A (Dynamic `yt-dlp` Injection):** Configure the Python backend to pass a residential proxy URL specifically for the initial `yt-dlp` metadata extraction phase. However, when handing the raw stream URL over to `aria2c` for the heavy binary download, we instruct `aria2c` to bypass the proxy and use the server's default IPv6 address.
*   ~~Solution B (Global OS Proxy):~~ Route the entire Docker container through a residential proxy. (This violates the requirements and would cost roughly $60 per 4K download).

### Problem 6.2: Automated IPv6 Rotation (Environment Constraints)
Native SLAAC and cronjob IP assignments are frequently blocked by cloud hosts (like Render) due to missing kernel privileges. Since Cloudflare WARP IPs are highly cataloged by Google, and public APIs are too slow, we must move off PaaS.
*   **[SELECTED] Solution E (Dedicated VPS Root Routing):** We abandon PaaS hosts like Render and deploy the stack to a standard $5 Dedicated Virtual Private Server (VPS) via Hetzner or DigitalOcean. Because we have root access to the host kernel, we can safely execute the `rotate_ipv6.sh` cronjob directly on the host machine every 30 minutes, dynamically binding random IPs from our assigned `/64` block to the egress network interface.

### Problem 6.3: Infrastructure as Code (VPS Topology)
Since we are no longer using Render, we need a way to deploy this entire architecture to a raw Linux server securely.
*   **[SELECTED] Solution A (Docker Compose + Nginx + Host Networking):** We deploy the existing `docker-compose.yml` to the VPS. To solve the Docker IPv4 NAT isolation issue, we configure the backend container with `network_mode: "host"`. This bypasses the Docker bridge, allowing the Python worker to directly inherit the host's rotating IPv6 addresses. We then install `nginx` on the host to act as a reverse proxy.
*   ~~Solution B (Bare Metal Execution):~~ Run the Python, Node.js, and React dev servers directly on the Linux host without Docker. (Highly prone to dependency conflicts and not recommended).
