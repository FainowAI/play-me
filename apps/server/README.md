# apps/server — backend local

Node 24 + TypeScript com o Claude Agent SDK (Sprint 2, Fase C, D08). Roda o agente de DJ com o MCP `spotify-dj`, faz streaming (SSE) para o chat, guarda sessões, sets, versões, planos e aprovações em SQLite (`data/playme.sqlite`, fora do git) e implementa o gate de aprovação antes de `spotify_create_playlist_from_order`.

- Escuta só em `127.0.0.1` (porta `PLAYME_SERVER_PORT`, padrão 8787).
- Precisa de `ANTHROPIC_API_KEY` no `.env` da raiz e do MCP compilado (`npm run build`).
- Modelo: `PLAYME_MODEL` (padrão `claude-haiku-4-5`: mesmo pedido custou US$ 0,03 contra US$ 0,13 no Opus 5.5). Teto por turno: `PLAYME_MAX_BUDGET_USD` (padrão 0,5).
- Segurança: só aceita `Host` 127.0.0.1/localhost na própria porta, origem de navegador só a do Vite, POST só com JSON; aprovação sem ninguém esperando expira.

```
npm run build
npm run start -w @playme/server
```

Endpoints: `POST /api/chat` (SSE), `GET /api/sessions`, `GET /api/sessions/:id`, `GET /api/sets/:id`, `POST /api/approvals/:id`. Detalhe e regras: `docs/prompts/05-fase-c-servidor.md` e `docs/eap_play-me_fainow.md`.
