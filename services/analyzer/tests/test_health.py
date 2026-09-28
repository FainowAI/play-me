from analyzer.api import HOST, health


def test_health() -> None:
    assert health() == {"status": "ok", "version": "0.0.1"}


def test_binds_to_loopback_only() -> None:
    assert HOST == "127.0.0.1"
