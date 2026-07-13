#!/bin/bash

# Build script for Expense Tracker Docker images
# Usage: ./build-images.sh [docker-hub-username]

VERSION="1.0.0"
DOCKER_USER="${1:-yourusername}"

echo "Building Expense Tracker Docker images..."
echo "Version: $VERSION"
echo "Docker Hub user: $DOCKER_USER"
echo ""

# Build backend
echo "Building backend..."
docker build -t expense-tracker-backend:$VERSION ./backend
docker build -t expense-tracker-backend:latest ./backend

# Build frontend
echo "Building frontend..."
docker build -t expense-tracker-frontend:$VERSION ./frontend
docker build -t expense-tracker-frontend:latest ./frontend

echo ""
echo "Images built successfully!"
echo ""

# Tag for Docker Hub if username provided
if [ "$DOCKER_USER" != "yourusername" ]; then
  echo "Tagging images for Docker Hub..."
  docker tag expense-tracker-backend:$VERSION $DOCKER_USER/expense-tracker-backend:$VERSION
  docker tag expense-tracker-backend:latest $DOCKER_USER/expense-tracker-backend:latest
  docker tag expense-tracker-frontend:$VERSION $DOCKER_USER/expense-tracker-frontend:$VERSION
  docker tag expense-tracker-frontend:latest $DOCKER_USER/expense-tracker-frontend:latest

  echo ""
  echo "To push to Docker Hub, run:"
  echo "  docker push $DOCKER_USER/expense-tracker-backend:$VERSION"
  echo "  docker push $DOCKER_USER/expense-tracker-backend:latest"
  echo "  docker push $DOCKER_USER/expense-tracker-frontend:$VERSION"
  echo "  docker push $DOCKER_USER/expense-tracker-frontend:latest"
  echo ""
  echo "Then update umbrel-app.yml image references to:"
  echo "  - $DOCKER_USER/expense-tracker-backend:$VERSION"
  echo "  - $DOCKER_USER/expense-tracker-frontend:$VERSION"
fi

echo ""
echo "Done! You can now run: docker-compose up -d"
