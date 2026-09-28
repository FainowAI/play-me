# 0001 — Ambiente de desenvolvimento

Data: 28/09/2026

## Contexto

Levantamento da máquina para a fundação do repositório (prompt 01).

| Item | Encontrado |
|---|---|
| Windows | Windows 11 Home Single Language, 10.0.26200 (build 26200.9457) |
| WSL | 2.6.3.0, kernel 6.6.87.2-1, WSLg 1.0.71 |
| Distro | **Ubuntu 22.04.5 LTS** (`Ubuntu-22.04`, WSL 2). O CLAUDE.md previa 24.04. Também existe `docker-desktop`. |
| Python no WSL (sistema) | 3.10.12, sem `ensurepip`/`venv`. O apt do 22.04 só oferece 3.11.0rc1. |
| Python do analisador | 3.12.14 via uv 0.12.19, venv em `~/.venvs/playme-analyzer` |
| Node no Windows | v24.13.0, npm 11.6.2 |
| ffmpeg no WSL | **Não instalado** em 28/09. Instalar no terminal WSL: `sudo apt update && sudo apt install -y ffmpeg` (precisa de sudo; necessário a partir do prompt 02). |
| GPU | NVIDIA GeForce RTX 2050, 4 GB VRAM, driver 560.94, CUDA 12.6 (visível no WSL via `nvidia-smi`) |
| CPU / RAM do WSL | 12 núcleos lógicos, 7,6 GiB |

## Decisão

- Python do analisador gerenciado pelo uv (3.12), sem mexer no Python do sistema e sem sudo. Manter Ubuntu 22.04 por enquanto.
- Analisador escuta só em `127.0.0.1:8765` (`ANALYZER_PORT` muda).
- Node do Windows (24.x) atende `engines >= 20.12`.

## Consequências

- A RTX 2050 tem só 4 GB de VRAM: Demucs (htdemucs) cabe com `--segment` pequeno; allin1 pode estourar memória. Medir no prompt 02+ e cair para CPU quando preciso.
- 7,6 GiB de RAM no WSL é pouco para Demucs + allin1 em paralelo: a fila deve processar uma faixa por vez. Se faltar memória, aumentar `memory` no `.wslconfig`.
- Se um dia migrar para Ubuntu 24.04, só o venv precisa ser recriado.
