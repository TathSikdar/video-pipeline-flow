import os
import tempfile
from fastapi import FastAPI

app = FastAPI(title="Video Pipeline Flow Backend")

@app.get("/")
def read_root():
    workspace = os.getenv("WORKSPACE_DIR", tempfile.gettempdir())
    return {
        "status": "online",
        "workspace_dir": workspace,
        "message": "Video Pipeline Backend is running."
    }
