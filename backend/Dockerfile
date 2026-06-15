FROM python:3.11-slim

# Install system dependencies (ffmpeg is required for yt-dlp multiplexing, aria2 for concurrency)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    aria2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The environment variable mapping for /dev/shm is handled in docker-compose.yml / render config
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
