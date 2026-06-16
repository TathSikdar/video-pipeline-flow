#!/bin/bash
set -e

echo "====================================="
echo "   TransferTube Server Setup         "
echo "====================================="

# 1. Update system and install Docker
echo "-> Installing Docker..."
sudo apt-get update -y
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 2. Install Node.js for building the React app
echo "-> Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 3. Build the Frontend
echo "-> Building the React Frontend..."
cd frontend
npm install
npm run build
cd ..

# 4. Spin up the infrastructure
echo "-> Spinning up Docker Compose Architecture..."
sudo docker compose up -d --build

echo "====================================="
echo "   Deploy Complete!                  "
echo "   Access it at http://<YOUR_IP>     "
echo "====================================="
