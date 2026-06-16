"""Video Pipeline Flow - FastAPI Backend Entrypoint.

Exposes REST API endpoints for triggering the video pipeline and
WebSocket channels for real-time status updates to the React
frontend. Orchestrates the complete download-upload lifecycle
as a background task.
"""

import asyncio
import json
import logging
import os
import shutil
from pathlib import Path

from dotenv import load_dotenv
from fastapi import (
    FastAPI,
    WebSocket,
    WebSocketDisconnect,
    HTTPException,
)
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .auth.camoufox_session import generate_session
from .downloader.engine import VideoPipelineDownloader
from .downloader.garbage_collector import purge_workspace
from .upload.uploader import YouTubeUploader
from .websocket_manager import manager

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

# Load .env file
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

app = FastAPI(
    title="Video Pipeline API",
    description="Automated YouTube download and upload engine",
    version="1.0.0",
)

# Allow the React frontend to communicate with the backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Workspace directory (tmpfs RAM disk)
WORKSPACE_DIR = os.getenv("WORKSPACE_DIR", "/dev/shm")

# Persistent downloads directory (physical disk)
DOWNLOADS_DIR = os.path.join(Path(__file__).resolve().parent.parent.parent, "downloads")
os.makedirs(DOWNLOADS_DIR, exist_ok=True)

# Global queue for strictly serial processing
pipeline_queue = asyncio.Queue()

@app.on_event("startup")
async def startup_event():
    """Starts the background queue worker on application boot."""
    asyncio.create_task(queue_worker())

async def queue_worker():
    """Background worker that pulls URLs one at a time and strictly awaits completion."""
    while True:
        request = await pipeline_queue.get()
        try:
            await run_pipeline_task(
                request.video_url,
                request.title,
                request.description,
                request.resolution,
                request.skip_upload,
            )
        except Exception as exc:
            logger.error("Queue worker error: %s", str(exc))
        finally:
            pipeline_queue.task_done()


class PipelineRequest(BaseModel):
    """Request body for the pipeline trigger endpoint.

    Attributes:
        video_url: The YouTube video URL to process.
        title: Optional custom title for the uploaded video.
        description: Optional custom description for the uploaded video.
        resolution: Optional max download resolution (1080, 720, 480).
    """

    video_url: str
    title: str = ""
    description: str = ""
    resolution: str = "1080"
    skip_upload: bool = False


async def _broadcast(
    msg_type: str,
    text: str,
    url: str = "",
    local_file: str = "",
    video_url: str = "",
    percent: float = 0.0,
    stage: str = "",
) -> None:
    """Broadcasts a structured JSON message to all WebSocket clients.

    Args:
        msg_type: The message type (info, success, error, system, progress).
        text: The human-readable status message.
        url: Optional YouTube watch URL for success messages.
        local_file: Optional filename for local downloading.
        video_url: The original YouTube URL this status belongs to.
    """
    payload = {"type": msg_type, "text": text}
    if url:
        payload["url"] = url
    if local_file:
        payload["local_file"] = local_file
    if video_url:
        payload["video_url"] = video_url
    if percent > 0 or stage:
        payload["percent"] = percent
        payload["stage"] = stage

    await manager.broadcast(json.dumps(payload))


async def run_pipeline_task(
    video_url: str,
    title: str,
    description: str,
    resolution: str = "1080",
    skip_upload: bool = False,
) -> None:
    """Background task executing the full download-upload pipeline.

    Orchestrates the complete lifecycle:
    1. Generate Camoufox session for visitor data.
    2. Download the video via yt-dlp with PoToken injection.
    3. Upload the video to YouTube as unlisted.
    4. Broadcast the watch URL to the frontend.
    5. Clean up the workspace.

    Args:
        video_url: The YouTube video URL to process.
        title: The title for the uploaded video.
    """
    try:
        # Step 1: Session Generation
        # Step 1: Initialization
        await _broadcast(
            "progress", 
            "Initializing Download Engine...", 
            video_url=video_url, 
            percent=0.0, 
            stage="download"
        )
        
        visitor_data = ""
        po_token = None
        await _broadcast(
            "info",
            "Initializing VideoPipelineDownloader...",
            video_url=video_url,
        )

        engine = VideoPipelineDownloader(WORKSPACE_DIR, DOWNLOADS_DIR)

        await _broadcast(
            "info",
            "Starting aria2c download streams " "(16 concurrent connections)...",
            video_url=video_url,
        )

        # Run the synchronous download in a thread pool
        # to avoid blocking the async event loop
        loop = asyncio.get_event_loop()

        def download_progress_cb(percent: float):
            scaled_percent = round(percent, 1)
            text = "Download Complete" if scaled_percent >= 100.0 else "Downloading Video..."
            asyncio.run_coroutine_threadsafe(
                _broadcast(
                    "progress",
                    text,
                    video_url=video_url,
                    percent=scaled_percent,
                    stage="download",
                ),
                loop,
            )

        output_path = await loop.run_in_executor(
            None,
            lambda: engine.process_video_strictly_synchronous(
                video_url,
                visitor_data,
                progress_callback=download_progress_cb,
                resolution=resolution,
            )
        )

        if not output_path:
            await _broadcast(
                "error",
                "Download failed: no output file produced.",
                video_url=video_url,
            )
            return

        # The engine moves the final MP4 from RAM disk to persistent physical storage directly.
        final_filename = os.path.basename(output_path)

        await _broadcast(
            "download_complete",
            "Download and FFmpeg multiplexing completed.",
            video_url=video_url,
            local_file=final_filename,
        )

        # Step 3: Upload
        await _broadcast(
            "info",
            "Initiating upload to YouTube...",
            video_url=video_url,
        )

        upload_title = title or f"Pipeline Upload - {video_url}"
        uploader = YouTubeUploader()

        def upload_progress_cb(percent: float):
            text = "Upload Complete" if percent >= 100.0 else "Uploading..."
            asyncio.run_coroutine_threadsafe(
                _broadcast(
                    "progress",
                    text,
                    video_url=video_url,
                    percent=percent,
                    stage="upload",
                ),
                loop,
            )

        if skip_upload:
            watch_url = None
            await _broadcast("info", "Skipping upload phase as requested.", video_url=video_url)
        else:
            watch_url = await loop.run_in_executor(
                None,
                lambda: uploader.upload_video(
                    file_path=output_path,
                    title=upload_title,
                    description=description,
                    progress_callback=upload_progress_cb,
                )
            )

        if watch_url or skip_upload:
            success_msg = "Pipeline complete! Video downloaded (upload skipped)." if skip_upload else "Pipeline complete! Video uploaded as unlisted."

            await _broadcast(
                "success",
                success_msg,
                url=watch_url or "",
                local_file=final_filename,
                video_url=video_url,
            )
        else:
            await _broadcast(
                "error",
                "Upload failed: all credentials exhausted.",
            )

        # Step 4: Cleanup
        purge_workspace(WORKSPACE_DIR)
        await _broadcast("info", "Workspace cleaned. Ready for next job.")

    except Exception as exc:
        logger.error(
            "Pipeline task failed: %s",
            str(exc),
            exc_info=True,
        )
        await _broadcast("error", f"Pipeline error: {str(exc)}")
        purge_workspace(WORKSPACE_DIR)


@app.get("/api/video-info")
async def get_video_info(url: str):
    """Rapidly fetches available resolutions for a YouTube video."""
    if not url:
        raise HTTPException(status_code=400, detail="Missing URL")
    
    loop = asyncio.get_event_loop()
    try:
        video_info = await loop.run_in_executor(
            None,
            VideoPipelineDownloader.extract_available_resolutions,
            url
        )
        return {
            "success": True, 
            "resolutions": video_info["resolutions"],
            "title": video_info.get("title", "")
        }
    except Exception as exc:
        logger.warning(f"Rapid extraction failed for {url}: {exc}")
        return {"success": False, "fallback": True}


@app.post("/api/start-pipeline")
async def start_pipeline(
    request: PipelineRequest,
) -> dict:
    """Triggers the background pipeline execution.

    Accepts a YouTube video URL and optional title, then
    launches the download-upload pipeline as a background task.

    Args:
        request: The pipeline request body.
        background_tasks: FastAPI background task manager.

    Returns:
        A status dictionary confirming the pipeline was started.
    """
    logger.info("Pipeline queued for URL: %s", request.video_url)

    await pipeline_queue.put(request)

    return {
        "status": "Pipeline queued",
        "video_url": request.video_url,
        "queue_size": pipeline_queue.qsize(),
    }


@app.get("/api/health")
async def health_check() -> dict:
    """Health check endpoint for monitoring.

    Returns:
        Service health status with workspace info.
    """
    workspace_exists = os.path.exists(WORKSPACE_DIR)
    return {
        "status": "ok",
        "workspace": WORKSPACE_DIR,
        "workspace_available": workspace_exists,
    }

@app.get("/api/download/{filename}")
async def download_file(filename: str, title: str = None):
    """Serves the downloaded MP4 file for local saving."""
    file_path = os.path.join(DOWNLOADS_DIR, filename)
    if not os.path.exists(file_path):
        return {"error": "File not found or session expired"}
    
    download_name = filename
    if title:
        import re
        # Sanitize title to remove invalid filename characters
        clean_title = re.sub(r'[\\/*?:"<>|]', "", title).strip()
        if clean_title:
            download_name = f"{clean_title}.mp4"
            
    return FileResponse(path=file_path, filename=download_name, media_type="video/mp4")


@app.websocket("/ws/pipeline")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """Maintains the real-time WebSocket channel with the frontend.

    Accepts WebSocket connections and keeps them alive until
    the client disconnects. All pipeline status updates are
    broadcast via the ConnectionManager.

    Args:
        websocket: The incoming WebSocket connection.
    """
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
        logger.info("WebSocket disconnected. Cleaning up persistent downloads...")
        shutil.rmtree(DOWNLOADS_DIR, ignore_errors=True)
        os.makedirs(DOWNLOADS_DIR, exist_ok=True)
