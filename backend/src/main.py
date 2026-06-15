"""
Video Pipeline Flow - FastAPI Backend Entrypoint
"""

import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from .websocket_manager import manager
from .downloader.engine import VideoPipelineDownloader
from .upload.uploader import YouTubeUploader

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s"
)
logger = logging.getLogger(__name__)

app = FastAPI(title="Video Pipeline API")

# Allow the React frontend to communicate with the FastAPI backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def run_pipeline_task():
    """Background task executing the download-upload loop and pushing WebSocket updates."""
    await manager.broadcast(
        '{"type": "info", "text": "Initializing VideoPipelineDownloader..."}'
    )

    # Simulating the pipeline execution
    await manager.broadcast(
        '{"type": "info", "text": "Starting aria2c download streams..."}'
    )
    # engine = VideoPipelineDownloader()
    # engine.process_video_strictly_synchronous("url")

    await manager.broadcast(
        '{"type": "info", "text": "Multiplexing completed. Initiating One-Shot POST Upload..."}'
    )
    # uploader = YouTubeUploader()
    # uploader.upload_video("path", "title")

    # Scaffolding success response
    await manager.broadcast(
        '{"type": "success", "text": "Pipeline strictly executed and cleaned! Video is unlisted.", "url": "https://youtu.be/dQw4w9WgXcQ"}'
    )


@app.post("/api/start-pipeline")
async def start_pipeline(background_tasks: BackgroundTasks):
    """Triggers the background pipeline execution."""
    logger.info("Pipeline triggered via REST API.")
    background_tasks.add_task(run_pipeline_task)
    return {"status": "Pipeline initialized"}


@app.websocket("/ws/pipeline")
async def websocket_endpoint(websocket: WebSocket):
    """Maintains the real-time communication channel with the React frontend."""
    await manager.connect(websocket)
    try:
        while True:
            # Keeps the connection open
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
