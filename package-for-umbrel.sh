#!/bin/bash

# Package Sundry for Umbrel Custom App Store
# Usage: ./package-for-umbrel.sh /path/to/your-umbrel-apps-repo

set -e

if [ -z "$1" ]; then
  echo "Usage: ./package-for-umbrel.sh /path/to/your-umbrel-apps-repo"
  echo "Example: ./package-for-umbrel.sh ../my-umbrel-apps"
  exit 1
fi

DEST_DIR="$1/sundry"
SOURCE_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "📦 Packaging Sundry for Umbrel..."
echo "Source: $SOURCE_DIR"
echo "Destination: $DEST_DIR"
echo ""

# Create destination directory
mkdir -p "$DEST_DIR"

# Copy umbrel-app.yml (use clean version without containers section)
echo "✓ Copying umbrel-app.yml..."
if [ -f "$SOURCE_DIR/umbrel-app-clean.yml" ]; then
  cp "$SOURCE_DIR/umbrel-app-clean.yml" "$DEST_DIR/umbrel-app.yml"
  echo "  Using clean version (without containers section)"
else
  cp "$SOURCE_DIR/umbrel-app.yml" "$DEST_DIR/"
  echo "  Using original version (will clean containers section later)"
fi

# Copy docker-compose.yml (rename from umbrel-docker-compose.yml)
echo "✓ Copying docker-compose.yml..."
cp "$SOURCE_DIR/umbrel-docker-compose.yml" "$DEST_DIR/docker-compose.yml"

# Copy Dockerfiles
echo "✓ Copying Dockerfiles..."
cp "$SOURCE_DIR/Dockerfile.backend" "$DEST_DIR/"
cp "$SOURCE_DIR/Dockerfile.frontend" "$DEST_DIR/"

# Copy backend source (excluding node_modules and build artifacts)
echo "✓ Copying backend source..."
# `--exclude='data'` is the load-bearing one: without it this copies the live
# expenses.db AND data/receipts/*.jpg (real receipt photographs) into a tree the
# script later tells you to commit and push to a public app-store repo. The
# *.db globs below do not cover data/receipts/ at all.
rsync -av --exclude='node_modules' \
          --exclude='dist' \
          --exclude='data' \
          --exclude='*.db' \
          --exclude='*.db-journal' \
          --exclude='.env' \
          "$SOURCE_DIR/backend/" "$DEST_DIR/backend/"

# Copy frontend source (excluding node_modules and build artifacts)
echo "✓ Copying frontend source..."
rsync -av --exclude='node_modules' \
          --exclude='dist' \
          --exclude='build' \
          --exclude='.env' \
          "$SOURCE_DIR/frontend/" "$DEST_DIR/frontend/"

# Create gallery directory
echo "✓ Creating gallery directory..."
mkdir -p "$DEST_DIR/gallery"

# Check if gallery images exist
if [ -d "$SOURCE_DIR/gallery" ]; then
  # Copy both JPG and PNG files
  copied=0
  if ls "$SOURCE_DIR/gallery"/*.jpg >/dev/null 2>&1; then
    cp "$SOURCE_DIR/gallery"/*.jpg "$DEST_DIR/gallery/" 2>/dev/null || true
    copied=1
  fi
  if ls "$SOURCE_DIR/gallery"/*.png >/dev/null 2>&1; then
    cp "$SOURCE_DIR/gallery"/*.png "$DEST_DIR/gallery/" 2>/dev/null || true
    copied=1
  fi

  if [ $copied -eq 1 ]; then
    echo "  Gallery images copied"
  else
    echo "  ⚠️  WARNING: No gallery images found!"
    echo "  Please add screenshots (1.jpg/png, 2.jpg/png, 3.jpg/png) to $DEST_DIR/gallery/"
  fi
else
  echo "  ⚠️  WARNING: Gallery directory doesn't exist!"
  echo "  Please add screenshots (1.jpg/png, 2.jpg/png, 3.jpg/png) to $DEST_DIR/gallery/"
fi

# Remove any sensitive files
echo "✓ Cleaning sensitive files..."
find "$DEST_DIR" -name "*.db" -delete 2>/dev/null || true
find "$DEST_DIR" -name "*.db-journal" -delete 2>/dev/null || true
find "$DEST_DIR" -name ".env" -delete 2>/dev/null || true
find "$DEST_DIR" -name ".DS_Store" -delete 2>/dev/null || true

# Update umbrel-app.yml to remove containers section
echo "✓ Updating umbrel-app.yml..."
if grep -q "^containers:" "$DEST_DIR/umbrel-app.yml"; then
  # Remove containers section (everything from "containers:" to end of file)
  # Use awk for better cross-platform compatibility
  awk '/^containers:/{exit} {print}' "$DEST_DIR/umbrel-app.yml" > "$DEST_DIR/umbrel-app.yml.tmp"
  mv "$DEST_DIR/umbrel-app.yml.tmp" "$DEST_DIR/umbrel-app.yml"
  echo "  Removed containers section (will use docker-compose.yml instead)"
else
  echo "  No containers section found (already clean)"
fi

echo ""
echo "✅ Packaging complete!"
echo ""
echo "Next steps:"
echo "1. Add screenshots to: $DEST_DIR/gallery/"
echo "2. Review: $DEST_DIR/umbrel-app.yml"
echo "3. Commit and push your app store repo"
echo ""
echo "Directory structure created:"
tree -L 2 "$DEST_DIR" 2>/dev/null || ls -la "$DEST_DIR"
echo ""
echo "To test the build locally:"
echo "  cd $DEST_DIR"
echo "  docker build -f Dockerfile.backend -t sundry-backend:test ."
echo "  docker build -f Dockerfile.frontend -t sundry-frontend:test ."
