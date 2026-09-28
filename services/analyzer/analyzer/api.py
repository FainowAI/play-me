"""Local HTTP API of the analyzer. Binds to 127.0.0.1 only."""

import os

import uvicorn
from fastapi import FastAPI

from analyzer import __version__

HOST = "127.0.0.1"

app = FastAPI(title="Play.Me analyzer", version=__version__)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": __version__}


def main() -> None:
    uvicorn.run(app, host=HOST, port=int(os.environ.get("ANALYZER_PORT", "8765")))


if __name__ == "__main__":
    main()
