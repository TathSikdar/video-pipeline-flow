# Video Pipeline Flow

*Disclaimer: This is not an officially supported Google product.*

An automated, anti-bot evasive pipeline designed to securely download raw 4K video streams from YouTube and seamlessly re-upload them to a private YouTube/GCP account.

This architecture is built specifically to bypass strict datacenter defenses, including BotGuard cryptography, SABR headless scraping detection, UMP blob obfuscation, and Datacenter IP banning.

## Table of Contents

- [Architecture & Stack](#architecture--stack)
- [Key Engineering Features](#key-engineering-features)
- [Getting Started](#getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Configuration](#configuration)
- [Usage](#usage)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## Architecture & Stack

The project is decoupled into three main services, fully containerized via Docker Compose:

1. **Frontend (React + Vite + TailwindCSS)** 
   A modern, glassmorphism UI that accepts video URLs and communicates with the backend via REST (to trigger jobs) and WebSockets (for real-time progress updates).
2. **Backend (Python + FastAPI + yt-dlp)** 
   The core workhorse. It manages a strict Dual-Queue asynchronous pipeline, downloading videos into a `/dev/shm` RAM disk via 16 concurrent TCP threads, multiplexing streams with FFmpeg, and executing One-Shot POST uploads to the YouTube Data API.
3. **BotGuard Provider (Node.js + JSDOM)** 
   An isolated, sterile microservice that spoofs the identity of an Embedded Smart TV. It safely executes obfuscated JavaScript math challenges to generate cryptographic "Proof of Origin" tokens (PoTokens), unlocking cryptographically signed stream URLs for the Python backend.

## Key Engineering Features

* **Cloudflare WARP Egress:** Entirely bypasses Datacenter IP bans (HTTP 403) by routing both the BotGuard extraction handshake and the heavy 16-thread video download through a trusted, local Cloudflare WARP SOCKS5 proxy.
* **Smart Multi-Dimensional Quota Routing:** Bypasses strict API limits by managing a round-robin pool of GCP credentials, seamlessly hot-swapping tokens mid-upload if a Quota Exceeded error occurs, and resetting bans automatically.
* **SABR & UMP Decryption:** Bypasses headless scraper detection via custom Python byte-length bridges to strip away UMP blob obfuscation and unlock the raw 4K stream.
* **Synchronous RAM Disk Management:** Prevents the server from crashing during FFmpeg multiplexing by ensuring exactly one video occupies the `/dev/shm` temporary filesystem at any given time.
* **SEO Cloaking:** Network-level `robots.txt` and Nginx `X-Robots-Tag` headers ensure the UI and API endpoints remain completely invisible to search engine crawlers.

## Getting Started

This stack is designed to be deployed on a standard Virtual Private Server (VPS) like DigitalOcean with root access.

### Prerequisites

- Docker & Docker Compose plugin
- Git
- Cloudflare `warp-cli` installed on the host and configured to `mode proxy` on port `40000`.
- Let's Encrypt SSL certificates (Certbot) for HTTPS support.

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/TathSikdar/video-pipeline-flow.git
   cd video-pipeline-flow
   ```

2. Build the Docker containers:
   ```bash
   docker compose build
   ```

### Configuration

Copy the environment template and fill in your GCP OAuth credentials:

```bash
cp backend/.env.example backend/.env
```

Ensure that your `.env` contains valid GCP credentials to prevent upload failures. 

## Usage

Start the pipeline infrastructure in detached mode:

```bash
docker compose up -d
```

The pipeline frontend is now accessible securely via your configured Nginx domain. Enter a YouTube URL in the UI to automatically queue a download and upload task.

## Documentation

For a deep dive into the technical rationale behind every architectural decision, please see the internal logs and planning documents:
- [Project Plan](docs/project_plan.md)
- [Implementation Logs](docs/logs.md)

## Contributing

Please follow the coding standards outlined in our style guides:
- [Google Python Style Guide](docs/python_style_guide.md)
- [Google JavaScript/TypeScript Style Guide](docs/javascript_style_guide.md)

See `AGENTS.md` for specific instructions on submitting automated modifications.

## License

[Apache License 2.0](LICENSE)