# services/analyzer — análise de áudio

Python 3.11+, roda no WSL2 (Ubuntu) ou Docker. Pipeline: decode → Beat This! (grade) → compassos → loudness → energia por banda → tom → stems → seções/frases → cues → planejador (regras + Jev).

Regras: Beat This! é a única fonte da grade; tudo indexado por compasso; análise idempotente por sha256 + versão.

## Ambiente (WSL2)

O Python vem do [uv](https://docs.astral.sh/uv/) (sem sudo). O venv fica no home do WSL, fora de `/mnt/c`, por desempenho.

```bash
# uma vez
curl -LsSf https://astral.sh/uv/install.sh | sh
uv python install 3.12
uv venv --python 3.12 ~/.venvs/playme-analyzer

# a cada sessão
source ~/.venvs/playme-analyzer/bin/activate
cd /mnt/c/Users/Antônio/Desktop/Play.me/services/analyzer
uv pip install -r pyproject.toml --extra dev
```

## Rodar

```bash
python -m analyzer.api            # escuta só em 127.0.0.1:8765 (ANALYZER_PORT muda a porta)
curl http://127.0.0.1:8765/health # {"status":"ok","version":"0.0.1"}
```

## Verificar

```bash
pytest && ruff check . && mypy
```
