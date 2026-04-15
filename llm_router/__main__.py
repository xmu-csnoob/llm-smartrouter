"""Entry point for `python -m llm_router`."""

import argparse
import os
import signal
import sys

from .main import create_app
from .config import RouterConfig


def main():
    parser = argparse.ArgumentParser(description="LLM Router")
    parser.add_argument("config", nargs="?", default="config.yaml", help="Config file path")
    parser.add_argument("--port", type=int, default=None, help="Override server port")
    parser.add_argument("--host", default=None, help="Override server host")
    args = parser.parse_args()

    config = RouterConfig(args.config)

    import uvicorn
    app = create_app(config)

    host = args.host or config.server.get("host", "127.0.0.1")
    port = args.port or config.server.get("port", 8000)
    log_level = config.server.get("log_level", "info")

    # SIGHUP → hot reload config
    def _reload(signum, frame):
        config.load()

    signal.signal(signal.SIGHUP, _reload)

    if os.environ.get("LLM_ROUTER_DEV") == "1":
        print(f"[DEV MODE] Proxying frontend to Vite on port {os.environ.get('VITE_PORT', '5173')}", flush=True)

    uvicorn.run(app, host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()
