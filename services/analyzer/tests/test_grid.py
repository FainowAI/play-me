import numpy as np

from analyzer.grid import grid_from_beats


def test_grid_from_synthetic_beats() -> None:
    period = 60.0 / 124
    beats = np.arange(64, dtype=np.float64) * period + 0.5
    downbeats = beats[::4]
    grid = grid_from_beats(beats, downbeats, duration_s=40.0)

    assert grid.bpm is not None and abs(grid.bpm - 124) <= 0.5
    assert grid.tempo_drift is not None and grid.tempo_drift < 1e-6
    assert grid.first_downbeat_s == downbeats[0]
    assert [b.index for b in grid.bars] == list(range(1, 17))
    assert grid.bars[0].start_s == downbeats[0]
