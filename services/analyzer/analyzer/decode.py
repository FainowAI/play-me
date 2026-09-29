"""Audio decoding: ffmpeg -> mono float32 PCM at 44.1 kHz, plus file hash and duration."""

import hashlib
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

SAMPLE_RATE = 44_100


@dataclass(frozen=True)
class DecodedAudio:
    samples: NDArray[np.float32]
    sample_rate: int
    sha256: str
    duration_s: float


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def decode(path: Path) -> DecodedAudio:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found; install it with: sudo apt install -y ffmpeg")
    result = subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-i", str(path),
         "-f", "f32le", "-ac", "1", "-ar", str(SAMPLE_RATE), "pipe:1"],
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed on {path}: {result.stderr.decode(errors='replace')}")
    samples = np.frombuffer(result.stdout, dtype=np.float32)
    return DecodedAudio(
        samples=samples,
        sample_rate=SAMPLE_RATE,
        sha256=sha256_file(path),
        duration_s=len(samples) / SAMPLE_RATE,
    )
