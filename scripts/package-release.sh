#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PLATFORM="${PLATFORM:-linux/amd64}"
VERSION="${1:-$(date +%F)}"
BACKEND_IMAGE="${BACKEND_IMAGE:-artha/backend:${VERSION}}"
FRONTEND_IMAGE="${FRONTEND_IMAGE:-artha/frontend:${VERSION}}"
OUTPUT_DIR="${OUTPUT_DIR:-${ROOT_DIR}/dist/release-${VERSION}}"

mkdir -p "$OUTPUT_DIR"

echo "Building backend image: ${BACKEND_IMAGE} (${PLATFORM})"
docker buildx build \
  --platform "$PLATFORM" \
  -t "$BACKEND_IMAGE" \
  --load \
  ./backend

echo "Building frontend image: ${FRONTEND_IMAGE} (${PLATFORM})"
docker buildx build \
  --platform "$PLATFORM" \
  -t "$FRONTEND_IMAGE" \
  --load \
  ./frontend

echo "Saving image archives into ${OUTPUT_DIR}"
docker save -o "${OUTPUT_DIR}/artha-backend-${VERSION}.tar" "$BACKEND_IMAGE"
docker save -o "${OUTPUT_DIR}/artha-frontend-${VERSION}.tar" "$FRONTEND_IMAGE"

cp docker-compose.deploy.yml "${OUTPUT_DIR}/docker-compose.deploy.yml"

cat > "${OUTPUT_DIR}/.env.images" <<EOF
BACKEND_IMAGE=${BACKEND_IMAGE}
FRONTEND_IMAGE=${FRONTEND_IMAGE}
EOF

echo "Package created at ${OUTPUT_DIR}"
