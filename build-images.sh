#!/bin/bash

# Build script for Sundry Docker images
# Usage: ./build-images.sh [docker-hub-username]

VERSION="1.0.0"
DOCKER_USER="${1:-yourusername}"

echo "Building Sundry Docker images..."
echo "Version: $VERSION"
echo "Docker Hub user: $DOCKER_USER"
echo ""

# Build backend
echo "Building backend..."
docker build -t sundry-backend:$VERSION ./backend
docker build -t sundry-backend:latest ./backend

# Build frontend
echo "Building frontend..."
docker build -t sundry-frontend:$VERSION ./frontend
docker build -t sundry-frontend:latest ./frontend

echo ""
echo "Images built successfully!"
echo ""

# Tag for Docker Hub if username provided
if [ "$DOCKER_USER" != "yourusername" ]; then
  echo "Tagging images for Docker Hub..."
  docker tag sundry-backend:$VERSION $DOCKER_USER/sundry-backend:$VERSION
  docker tag sundry-backend:latest $DOCKER_USER/sundry-backend:latest
  docker tag sundry-frontend:$VERSION $DOCKER_USER/sundry-frontend:$VERSION
  docker tag sundry-frontend:latest $DOCKER_USER/sundry-frontend:latest

  echo ""
  echo "To push to Docker Hub, run:"
  echo "  docker push $DOCKER_USER/sundry-backend:$VERSION"
  echo "  docker push $DOCKER_USER/sundry-backend:latest"
  echo "  docker push $DOCKER_USER/sundry-frontend:$VERSION"
  echo "  docker push $DOCKER_USER/sundry-frontend:latest"
  echo ""
  echo "Then update umbrel-app.yml image references to:"
  echo "  - $DOCKER_USER/sundry-backend:$VERSION"
  echo "  - $DOCKER_USER/sundry-frontend:$VERSION"
fi

echo ""
echo "Done! You can now run: docker-compose up -d"
