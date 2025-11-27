#!/usr/bin/env bash
# Render build script for quick-voicebot

set -e

echo "==> Installing dependencies (including dev dependencies)..."
npm install --production=false

echo "==> Running TypeScript compilation..."
npx tsc

echo "==> Running Vite build..."
npx vite build

echo "==> Build complete! Checking output..."
ls -la dist/
echo "Files in dist:"
find dist -type f

if [ -f dist/server.js ]; then
  echo "✅ dist/server.js found!"
else
  echo "❌ ERROR: dist/server.js not found!"
  exit 1
fi
