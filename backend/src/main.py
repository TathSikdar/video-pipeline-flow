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

# Global queues for concurrent pipelining
download_queue = asyncio.Queue()
upload_queue = asyncio.Queue()

# Global set of cancelled task IDs
cancelled_tasks = set()

class TaskCancelledError(Exception):
    """Exception raised when a task is cancelled by the user."""
    pass

class UploadContext(BaseModel):
    task_id: str
    video_url: str
    title: str
    description: str
    resolution: str
    skip_upload: bool
    final_filename: str
    output_path: str

@app.on_event("startup")
async def startup_event():
    """Starts the background queue workers on application boot."""
    asyncio.create_task(download_worker())
    asyncio.create_task(upload_worker())

async def download_worker():
    """Background worker that pulls URLs one at a time for downloading."""
    while True:
        request = await download_queue.get()
        try:
            upload_context = await execute_download_phase(
                request.task_id,
                request.video_url,
                request.title,
                request.description,
                request.resolution,
                request.skip_upload,
            )
            if upload_context:
                await upload_queue.put(upload_context)
        except Exception as exc:
            logger.error("Download worker error: %s", str(exc))
        finally:
            download_queue.task_done()

async def upload_worker():
    """Background worker that pulls finished downloads for uploading."""
    while True:
        context = await upload_queue.get()
        try:
            await execute_upload_phase(context)
        except Exception as exc:
            logger.error("Upload worker error: %s", str(exc))
        finally:
            upload_queue.task_done()


class PipelineRequest(BaseModel):
    """Request body for the pipeline trigger endpoint.

    Attributes:
        video_url: The YouTube video URL to process.
        title: Optional custom title for the uploaded video.
        description: Optional custom description for the uploaded video.
        resolution: Optional max download resolution (1080, 720, 480).
    """

    video_url: str
    task_id: str = ""
    title: str = ""
    description: str = ""
    resolution: str = "1080"
    skip_upload: bool = False

class CancelRequest(BaseModel):
    task_id: str


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


async def execute_download_phase(
    task_id: str,
    video_url: str,
    title: str,
    description: str,
    resolution: str,
    skip_upload: bool,
) -> UploadContext | None:
    try:
        if task_id in cancelled_tasks:
            raise TaskCancelledError("Task was cancelled before starting.")

        await _broadcast("progress", "Generating Stealth Session via Camoufox...", video_url=video_url, percent=0.0, stage="download")
        
        visitor_data = ""
        visitor_cookie = ""
        
        try:
            session_data = await generate_session()
            visitor_data = session_data.visitor_data
            visitor_cookie = session_data.visitor_cookie
            await _broadcast("info", "Camoufox session generated successfully.", video_url=video_url)
        except Exception as e:
            logger.error("Camoufox session generation failed: %s", str(e))
            await _broadcast("info", "Camoufox failed, falling back to unauthenticated BotGuard request...", video_url=video_url)

        await _broadcast("info", "Initializing VideoPipelineDownloader...", video_url=video_url)

        engine = VideoPipelineDownloader(WORKSPACE_DIR, DOWNLOADS_DIR)

        await _broadcast("info", "Starting aria2c download streams (16 concurrent connections)...", video_url=video_url)

        loop = asyncio.get_event_loop()

        def download_progress_cb(percent: float):
            if task_id in cancelled_tasks:
                raise TaskCancelledError("Task cancelled during download.")
                
            scaled_percent = round(percent, 1)
            text = "Download Complete" if scaled_percent >= 100.0 else "Downloading Video..."
            asyncio.run_coroutine_threadsafe(
                _broadcast("progress", text, video_url=video_url, percent=scaled_percent, stage="download"),
                loop,
            )

        output_path = await loop.run_in_executor(
            None,
            lambda: engine.process_video_strictly_synchronous(
                video_url, visitor_data, visitor_cookie, progress_callback=download_progress_cb, resolution=resolution
            )
        )

        if not output_path:
            await _broadcast("error", "Download failed: no output file produced.", video_url=video_url)
            return None

        final_filename = os.path.basename(output_path)

        await _broadcast(
            "download_complete",
            "Download and FFmpeg multiplexing completed.",
            video_url=video_url,
            local_file=final_filename,
        )

        purge_workspace(WORKSPACE_DIR)

        if skip_upload:
            success_msg = "Pipeline complete! Video downloaded (upload skipped)."
            await _broadcast("success", success_msg, url="", local_file=final_filename, video_url=video_url)
            return None

        return UploadContext(
            task_id=task_id,
            video_url=video_url,
            title=title,
            description=description,
            resolution=resolution,
            skip_upload=skip_upload,
            final_filename=final_filename,
            output_path=output_path
        )

    except TaskCancelledError as exc:
        logger.info(f"Task {task_id} was cancelled successfully.")
        await _broadcast("error", "Task Cancelled", video_url=video_url)
        purge_workspace(WORKSPACE_DIR)
        return None
        
    except Exception as exc:
        logger.error("Download phase failed: %s", str(exc), exc_info=True)
        await _broadcast("error", f"Pipeline error: {str(exc)}", video_url=video_url)
        purge_workspace(WORKSPACE_DIR)
        return None

async def execute_upload_phase(ctx: UploadContext) -> None:
    try:
        if ctx.task_id in cancelled_tasks:
            raise TaskCancelledError("Task cancelled before upload started.")

        await _broadcast("info", "Initiating upload to YouTube...", video_url=ctx.video_url)

        raw_title = ctx.title or f"Pipeline Upload - {ctx.video_url}"
        upload_title = raw_title.replace("<", "").replace(">", "")[:100].strip()
        if not upload_title:
            upload_title = "Untitled Pipeline Upload"

        uploader = YouTubeUploader()
        loop = asyncio.get_event_loop()

        def upload_progress_cb(percent: float):
            if ctx.task_id in cancelled_tasks:
                raise TaskCancelledError("Task cancelled during upload.")
                
            text = "Upload Complete" if percent >= 100.0 else "Uploading..."
            asyncio.run_coroutine_threadsafe(
                _broadcast("progress", text, video_url=ctx.video_url, percent=percent, stage="upload"),
                loop,
            )

        watch_url = await loop.run_in_executor(
            None,
            lambda: uploader.upload_video(
                file_path=ctx.output_path,
                title=upload_title,
                description=ctx.description,
                progress_callback=upload_progress_cb,
            )
        )

        if watch_url:
            success_msg = "Pipeline complete! Video uploaded as unlisted."
            await _broadcast("success", success_msg, url=watch_url, local_file=ctx.final_filename, video_url=ctx.video_url)
        else:
            await _broadcast("error", "Daily quota reached please try again tomorrow.", video_url=ctx.video_url)

    except TaskCancelledError as exc:
        logger.info(f"Task {ctx.task_id} was cancelled successfully during upload.")
        await _broadcast("error", "Task Cancelled", video_url=ctx.video_url)
        
    except Exception as exc:
        logger.error("Upload phase failed: %s", str(exc), exc_info=True)
        # Catch any uncaught HTTP errors related to quota to show a friendly UI message
        error_msg = str(exc)
        if "quotaExceeded" in error_msg or "uploadLimitExceeded" in error_msg:
            error_msg = "Daily quota reached please try again tomorrow."
        else:
            error_msg = f"Upload error: {error_msg}"
            
        await _broadcast("error", error_msg, video_url=ctx.video_url)


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

    await download_queue.put(request)

    return {
        "status": "Pipeline queued",
        "video_url": request.video_url,
        "task_id": request.task_id,
        "queue_size": download_queue.qsize(),
    }


@app.post("/api/cancel-pipeline")
async def cancel_pipeline(request: CancelRequest) -> dict:
    """Cancels a queued or running task by adding its ID to the cancel set."""
    if not request.task_id:
        raise HTTPException(status_code=400, detail="Missing task_id")
        
    logger.info("Task %s added to cancelled list", request.task_id)
    cancelled_tasks.add(request.task_id)
    
    return {"status": "Cancelled", "task_id": request.task_id}

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
