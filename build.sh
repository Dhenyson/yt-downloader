#!/bin/bash

# Script de build e push para Docker Hub
# Usage: ./build.sh [tag]

set -e

IMAGE_NAME="dhenyson/yt-downloader"
TAG="${1:-latest}"
FULL_IMAGE="${IMAGE_NAME}:${TAG}"

echo "Building Docker image: ${FULL_IMAGE}"
docker build -t "${FULL_IMAGE}" .

echo "Image size:"
docker images "${IMAGE_NAME}" --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"

echo ""
read -p "Push to Docker Hub? (y/N): " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Pushing to Docker Hub..."
    docker push "${FULL_IMAGE}"
    
    if [ "$TAG" != "latest" ]; then
        echo "Tagging as latest..."
        docker tag "${FULL_IMAGE}" "${IMAGE_NAME}:latest"
        docker push "${IMAGE_NAME}:latest"
    fi
    
    echo "Done! Image available at: ${FULL_IMAGE}"
else
    echo "Skipping push"
fi

echo ""
echo "Test locally with:"
echo "docker run -d -p 3000:3000 -e YT_API_KEY=your_key ${FULL_IMAGE}"
