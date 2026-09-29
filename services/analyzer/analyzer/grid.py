"""Time grid from Beat This! (the only source of beats and downbeats).

CLI: python -m analyzer.grid <folder> --out data/phase0/
"""

import argparse
import csv
import json
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any, Protocol

import numpy as np
from numpy.typing import NDArray

from analyzer.decode import DecodedAudio, decode

CHECKPOINT = "final0"
GRID_VERSION = f"grid-1/beat_this-1.1.0/{CHECKPOINT}/no-dbn"
AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".aif", ".aiff", ".m4a", ".ogg", ".opus"}


@dataclass(frozen=True)
class Bar:
    index: int  # 1-based: bar 1 starts at the first downbeat
    start_s: float
    end_s: float


@dataclass(frozen=True)
class Grid:
    bpm: float | None
    tempo_drift: float | None
    first_downbeat_s: float | None
    beats: list[float]
    downbeats: list[float]
    bars: list[Bar]


class BeatTracker(Protocol):
    def __call__(
        self, signal: NDArray[np.float32], sr: int
    ) -> tuple[NDArray[np.float64], NDArray[np.float64]]: ...


def grid_from_beats(
    beats: NDArray[np.float64], downbeats: NDArray[np.float64], duration_s: float
) -> Grid:
    """Derive BPM, drift and bars from beat/downbeat times. Missing data stays None."""
    intervals = np.diff(beats)
    bpm = float(60.0 / np.median(intervals)) if len(intervals) else None
    drift = float(np.std(intervals) / np.mean(intervals)) if len(intervals) >= 2 else None

    bars = [
        Bar(i + 1, float(start), float(end))
        for i, (start, end) in enumerate(zip(downbeats[:-1], downbeats[1:], strict=True))
    ]
    if len(downbeats) >= 2:
        # ponytail: last bar ends one median bar after its downbeat, clipped to the track end
        bar_len = float(np.median(np.diff(downbeats)))
        last = float(downbeats[-1])
        bars.append(Bar(len(bars) + 1, last, min(last + bar_len, duration_s)))

    return Grid(
        bpm=bpm,
        tempo_drift=drift,
        first_downbeat_s=float(downbeats[0]) if len(downbeats) else None,
        beats=[float(b) for b in beats],
        downbeats=[float(d) for d in downbeats],
        bars=bars,
    )


def load_tracker() -> BeatTracker:
    import torch
    from beat_this.inference import Audio2Beats

    device = "cuda" if torch.cuda.is_available() else "cpu"
    tracker: BeatTracker = Audio2Beats(checkpoint_path=CHECKPOINT, device=device, dbn=False)
    return tracker


def track_grid(audio: DecodedAudio, tracker: BeatTracker) -> Grid:
    beats, downbeats = tracker(audio.samples, audio.sample_rate)
    return grid_from_beats(np.asarray(beats), np.asarray(downbeats), audio.duration_s)


def save_beats_file(grid: Grid, path: Path) -> None:
    """Write a .beats file (time<TAB>beat number, 1 = downbeat) for Sonic Visualiser."""
    from beat_this.utils import save_beat_tsv

    save_beat_tsv(np.asarray(grid.beats), np.asarray(grid.downbeats), str(path))


def analyze_folder(folder: Path, out: Path) -> list[dict[str, Any]]:
    out.mkdir(parents=True, exist_ok=True)
    tracker = load_tracker()
    rows: list[dict[str, Any]] = []
    for path in sorted(p for p in folder.iterdir() if p.suffix.lower() in AUDIO_EXTENSIONS):
        row: dict[str, Any] = {"file": path.name}
        try:
            started = time.perf_counter()
            audio = decode(path)
            grid = track_grid(audio, tracker)
            row |= {
                "bpm": round(grid.bpm, 2) if grid.bpm else None,
                "tempo_drift": round(grid.tempo_drift, 4) if grid.tempo_drift else None,
                "bars": len(grid.bars),
                "first_downbeat_s": grid.first_downbeat_s,
                "analysis_s": round(time.perf_counter() - started, 2),
            }
            result = {
                "file": path.name,
                "sha256": audio.sha256,
                "duration_s": audio.duration_s,
                "grid_version": GRID_VERSION,
                **asdict(grid),
            }
            (out / f"{path.stem}.json").write_text(json.dumps(result, indent=1))
            save_beats_file(grid, out / f"{path.stem}.beats")
        except Exception as exc:  # one bad file must not stop the batch
            row["error"] = str(exc)
        rows.append(row)
        print(row, flush=True)

    fields = ["file", "bpm", "tempo_drift", "bars", "first_downbeat_s", "analysis_s", "error"]
    with (out / "report.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Beat This! grid for every audio file in a folder")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--out", type=Path, default=Path("data/phase0"))
    args = parser.parse_args()
    analyze_folder(args.folder, args.out)


if __name__ == "__main__":
    main()
