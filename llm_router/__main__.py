"""Entry point for `python -m llm_router`."""

import signal
import sys

from .main import create_app
from .config import RouterConfig


def main():
    config_path = sys.argv[1] if len(sys.argv) > 1 else "config.yaml"
    config = RouterConfig(config_path)

    import uvicorn
    app = create_app(config)

    host = config.server.get("host", "127.0.0.1")
    port = config.server.get("port", 8000)
    log_level = config.server.get("log_level", "info")

    # SIGHUP → hot reload config
    def _reload(signum, frame):
        config.load()

    signal.signal(signal.SIGHUP, _reload)

    uvicorn.run(app, host=host, port=port, log_level=log_level)


if __name__ == "__main__":
    main()
