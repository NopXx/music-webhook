#!/usr/bin/env bash
# Deploy the music-webhook container from origin/main on the prod host.
# Heals the recurring loose-ref lock, hard-aligns to origin/main, rebuilds,
# and waits for the container healthcheck to report healthy.
#
# Usage (on the server):  ~/apps/deploy-webhook.sh
#   or from anywhere:     ssh root@<host> 'bash -s' < scripts/deploy.sh
# Assumes the compose project lives in ~/apps and the repo in ~/apps/music-webhook.
set -euo pipefail

APP_DIR="$HOME/apps/music-webhook"
COMPOSE_DIR="$HOME/apps"
CONTAINER="apps-webhook-1"
SERVICE="webhook"

cd "$APP_DIR"
echo "→ HEAD before: $(git rev-parse --short HEAD)"

# Heal the loose remote-tracking ref that intermittently blocks fetch/pull
git update-ref -d refs/remotes/origin/main 2>/dev/null || true
rm -f .git/refs/remotes/origin/main.lock

git fetch --prune origin
git reset --hard origin/main
echo "→ deployed: $(git rev-parse --short HEAD) $(git log -1 --pretty=%s)"

cd "$COMPOSE_DIR"
docker compose up -d --build "$SERVICE"

echo "→ waiting for health..."
for i in $(seq 1 24); do
  s=$(docker inspect --format "{{.State.Health.Status}}" "$CONTAINER" 2>/dev/null || echo none)
  if [ "$s" = healthy ]; then echo "✅ healthy"; exit 0; fi
  if [ "$s" = unhealthy ]; then echo "❌ unhealthy — check: docker logs --tail 50 $CONTAINER"; exit 1; fi
  sleep 5
done
echo "⚠️ health still: $s after timeout"; exit 1
