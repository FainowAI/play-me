# Play.Me

Sistema local que transforma playlists do Spotify em sets de DJ. Você conversa num chat de DJ; o Claude (Agent SDK, local) usa BPM e tom por metadados (Mixar, ReccoBeats, GetSongBPM) para propor a ordem e as transições; a análise de áudio é trilha opcional para faixas com arquivo. No MVP, o set aprovado vira uma playlist nova e privada no Spotify.

- Arquitetura, regras e fases: `CLAUDE.md`
- Decisões e pendências: `docs/decisoes.md`
- Pesquisa com fontes: `docs/pesquisa-tecnica.md`
- Design system: `design/DESIGN.md` e `design/playme-tokens.css`
- Prompts para o Claude Code: `docs/prompts/`
- Quadro do projeto (fonte central): https://claude.ai/artifact/JEd8bN1irubJJigj5nKziX

## Como começar

1. Abra esta pasta no Claude Code.
2. Cole `docs/prompts/01-fundacao.md`.
3. Depois, `docs/prompts/02-fase-0-grade.md`.

## Estrutura

```
apps/web          chat de DJ (React + Vite + TS), a partir das telas em design/telas/
apps/server       backend local com Claude Agent SDK
packages/         mcp-server (spotify-dj) e pacotes compartilhados
services/analyzer análise de áudio em Python (WSL2/Docker)
design/           DESIGN.md, tokens, telas (design/telas/) e componentes (design/ds/)
docs/             pesquisa, decisões, sets, prompts
data/             banco e caches locais (fora do git)
```

## Fontes de dados

- BPM e tom: [ReccoBeats](https://reccobeats.com) (principal, pelo ID do Spotify) e [GetSongBPM](https://getsongbpm.com) (reserva; API com backlink exigido), com o Mixar do Spotify como verdade. O tom vindo da web fica marcado [A VALIDAR].
- Catálogo e playlists: Spotify Web API. Nenhum áudio vem de fora (D04).
