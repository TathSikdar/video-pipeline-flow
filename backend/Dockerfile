FROM python:3.11-slim

# Install system dependencies (ffmpeg is required for yt-dlp multiplexing, aria2 for concurrency)
# Also adding standard Linux dependencies required for headless Firefox/Camoufox execution
RUN apt-get update && apt-get install -y \
    ffmpeg \
    aria2 \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# The environment variable mapping for /dev/shm is handled in docker-compose.yml / render config
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
