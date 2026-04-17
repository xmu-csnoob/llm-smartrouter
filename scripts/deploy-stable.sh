#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/wangwenfei/llm-router"
SERVICE_DIR="/Users/wangwenfei/.local/share/llm-router-service"
SERVICE_REPO="$SERVICE_DIR/repo"
SERVICE_LABEL="ai.wangwenfei.llm-router"
PYTHON_BIN="/Users/wangwenfei/miniforge3/bin/python"

cd "$ROOT_DIR"

echo "[1/4] Building dashboard"
npm run build --prefix dashboard >/dev/null

echo "[2/4] Syncing runtime files"
rsync -a \
  --delete \
  --exclude "__pycache__/" \
  --exclude "*.pyc" \
  "$ROOT_DIR/llm_router/" \
  "$SERVICE_REPO/llm_router/"

echo "[3/5] Verifying runtime imports"
PYTHONPATH="$SERVICE_REPO" "$PYTHON_BIN" - <<'PY'
import importlib

for module_name in ("llm_router.proxy", "llm_router.main"):
    importlib.import_module(module_name)
PY

echo "[4/5] Syncing dashboard assets"
rsync -a \
  "$ROOT_DIR/dashboard/dist/" \
  "$SERVICE_REPO/dashboard/dist/"

echo "[5/5] Restarting stable service"
launchctl kickstart -k "gui/$(id -u)/$SERVICE_LABEL" >/dev/null

sleep 2
health="$(curl -fsS http://127.0.0.1:8000/health)"
echo "Stable health: $health"
