# Play.Me

Sistema local que transforma playlists do Spotify em sets de DJ. Você conversa num chat de DJ; o Claude (Agent SDK, local) usa BPM e tom por metadados (Mixar e ReccoBeats) para propor a ordem e as transições; a análise de áudio é trilha opcional para faixas com arquivo. No MVP, o set aprovado vira uma playlist nova e privada no Spotify.

- Arquitetura, regras e fases: `CLAUDE.md`
- Decisões e pendências: `docs/decisoes.md`
- Pesquisa com fontes: `docs/pesquisa-tecnica.md`
- Design system: `design/DESIGN.md` e `design/playme-tokens.css`
- Prompts para o Claude Code: `docs/prompts/`
- Quadro do projeto (fonte central): https://claude.ai/artifact/JEd8bN1irubJJigj5nKziX

## Como começar

1. `npm install` e `npm run build` (MCP, servidor e web).
2. `npm run start -w @playme/server` (precisa de `ANTHROPIC_API_KEY` no `.env` e do login do Spotify: `npm run auth -w packages/mcp-server`).
3. `npm run dev -w @playme/web` e abra http://127.0.0.1:5173.
4. Para continuar o projeto no Claude Code, cole o próximo prompt de `docs/prompts/` (07 = Sprint 4).

## Estrutura

```
apps/web          chat de DJ (React 19 + Vite 8 + TS + Tailwind 4), telas do canvas em design/telas/
apps/server       backend local com Claude Agent SDK
packages/         mcp-server (spotify-dj) e pacotes compartilhados
services/analyzer análise de áudio em Python (WSL2/Docker)
design/           DESIGN.md, tokens, telas (design/telas/) e componentes (design/ds/)
docs/             pesquisa, decisões, sets, prompts
data/             banco e caches locais (fora do git)
```

## Fontes de dados

- BPM e tom: [ReccoBeats](https://reccobeats.com), pelo ID do Spotify, com o Mixar do Spotify como verdade. O tom vindo da web fica marcado [A VALIDAR].
- Catálogo e playlists: Spotify Web API. Nenhum áudio vem de fora (D04).
