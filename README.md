# Play.Me

Sistema local que transforma playlists do Spotify em sets de DJ. Você conversa num chat de DJ; o Claude (Agent SDK, local) usa a análise de áudio (Beat This! + extratores) e as decisões do Jev para propor a ordem e as transições. No MVP, o set aprovado vira uma playlist nova e privada no Spotify.

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
apps/web          chat de DJ (React + Vite + TS), a partir das telas do Stitch
apps/server       backend local com Claude Agent SDK
packages/         mcp-server (spotify-dj) e pacotes compartilhados
services/analyzer análise de áudio em Python (WSL2/Docker)
design/           DESIGN.md, tokens e telas exportadas do Stitch
docs/             pesquisa, decisões, sets, prompts
data/             banco e caches locais (fora do git)
```