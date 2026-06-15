# Implementation Logs

This file contains a historical log of all implementation choices and technical reasoning for the Video Pipeline Flow project.

## Initialization
- **Action**: Initialized monorepo structure with `frontend/` and `backend/`.
- **Reasoning**: To maintain a unified codebase while explicitly decoupling the architecture.
- **Action**: Configured `/dev/shm` mapping via Docker `shm_size` for backend.
- **Reasoning**: To fulfill the strict RAM Disk `tmpfs` requirement for `yt-dlp` and `ffmpeg` multiplexing locally, bypassing "No space left on device" errors without triggering unprivileged blockages on Render.
- **Action**: Selected Python 3.11 and Tailwind v3.
- **Reasoning**: Python 3.11 provides maximum performance while avoiding standard library removal breaks in 3.12. Tailwind v3 ensures maximum plugin compatibility.

## Phase 2: Core Download Pipeline
- **Action**: Installed `aria2` via Dockerfile and configured `yt-dlp` to utilize it.
- **Reasoning**: Bypass YouTube's single HTTP connection throttle by establishing 16 concurrent TCP byte-range connections, maximizing download bandwidth.
- **Action**: Created Python garbage collection wrappers and configured Strict Synchronous Blocking.
- **Reasoning**: Prevents FFmpeg from concurrently multiplexing massive 4K/Audio files which would instantly crash the 4GB `/dev/shm` RAM disk. Synchronous limits guarantee exactly 1 video memory footprint at any given time.
- **Action**: Injected `SabrStreamingAdapter` and `SabrUmpProcessor` classes.
- **Reasoning**: Reverses the Universal Media Protocol (UMP) and server-side fake buffering algorithms to bypass the SABR 360p resolution downgrade enforced on headless clients.
