#!/bin/zsh
set -euo pipefail

PROJECT_DIR="/Users/wangwenfei/llm-router"
PYTHON_BIN="/Users/wangwenfei/miniforge3/bin/python"
CONFIG_PATH="$PROJECT_DIR/config.yaml"

cd "$PROJECT_DIR"
exec "$PYTHON_BIN" -m llm_router "$CONFIG_PATH"
