import hashlib
import shutil
import subprocess
from pathlib import Path

import pytest

from analyzer.decode import SAMPLE_RATE, decode


def test_decode_sine(tmp_path: Path) -> None:
    if shutil.which("ffmpeg") is None:
        pytest.skip("ffmpeg not installed")
    wav = tmp_path / "sine.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-nostdin", "-f", "lavfi",
         "-i", "sine=frequency=440:duration=2", "-ar", str(SAMPLE_RATE), str(wav)],
        check=True,
    )
    audio = decode(wav)
    assert audio.sample_rate == SAMPLE_RATE
    assert abs(audio.duration_s - 2.0) <= 0.01
    assert audio.sha256 == hashlib.sha256(wav.read_bytes()).hexdigest()
