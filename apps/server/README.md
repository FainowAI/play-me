# apps/server — backend local

Node 24 + TypeScript com o Claude Agent SDK (Sprint 2, Fase C, D08; API v2 na Sprint 3). Roda o agente de DJ com o MCP `spotify-dj`, faz streaming (SSE) para o chat, guarda sessões, turnos do chat, sets, versões (com snapshot), planos e aprovações em SQLite (`data/playme.sqlite`, fora do git), as configurações em `data/settings.json` e implementa o gate de aprovação antes de `spotify_create_playlist_from_order`.

- Escuta só em `127.0.0.1` (porta `PLAYME_SERVER_PORT`, padrão 8787).
- Precisa de `ANTHROPIC_API_KEY` no `.env` da raiz e do MCP compilado (`npm run build`).
- Modelo: `PLAYME_MODEL` (padrão `claude-haiku-4-5`: mesmo pedido custou US$ 0,03 contra US$ 0,13 no Opus 5.5). Teto por turno: `PLAYME_MAX_BUDGET_USD` (padrão 0,5).
- Segurança: só aceita `Host` 127.0.0.1/localhost na própria porta, origem de navegador só a do Vite, POST e PUT só com JSON; aprovação sem ninguém esperando expira. Nenhuma chave nem token sai pela API: `/api/status` só diz se existem.

```
npm run build
npm run start -w @playme/server
```

## Endpoints (API v2)

Os shapes estão em `src/types.ts` (espelho de `apps/web/src/types.ts`).

| Rota | Devolve |
|---|---|
| `GET /api/status` | `{ model, anthropic, spotify: { connected }, reccobeats, jev }` |
| `GET /api/playlists` | `{ items: [{ id, name, total, url }] }`, cache de 5 min; sem tokens do Spotify 503; Spotify fora do ar 502 |
| `GET /api/sessions` | sessões, mais recente primeiro, cada uma com `set` (`{ id, name, status, spotify_url }` ou `null`) |
| `GET /api/sessions/:id` | `{ session, turns, set, versions }`: `turns` reconstrói o chat (eventos `approval` com o `status` de agora); `versions` do set atual |
| `GET /api/sets/:id` | `{ set, versions }`: cada versão com `snapshot`, `plans` e `guide` (guia do Mix calculado na leitura) |
| `POST /api/approvals/:id` | `{ decision: "approved" \| "rejected" }`; 409 se já decidida ou expirada |
| `GET /api/settings`, `PUT /api/settings` | `{ weights }` em porcentagem inteira (5 chaves, soma 100); PUT inválido 400 |
| `POST /api/chat` | SSE (`data: ServerEvent`): `session`, `text`, `tool_start`, `tool_end`, `set`, `approval`, `done`, `error`; 409 se já há turno na sessão |

- **Snapshot por versão** (`set_versions.snapshot_json`): o resultado de `dj_build_set` / `dj_evaluate_order` reduzido (curva, nota média, ordem, passagens, pontos fracos, faixas fora do set, avisos; sem planos, pontes nem pesos). Cada faixa da ordem ganha `source` e `key_review`, lidos do store do MCP (`SPOTIFY_DJ_DATA_DIR` ou `~/.spotify-dj-mcp`), que o servidor só lê. Versões da Sprint 2 ficam com `snapshot: null`. O envio de uma ordem que o agente não avaliou reordena o snapshot anterior (sem passagens).
- **Mudança consciente em relação à Sprint 2:** o snapshot guarda nome e artista das faixas do set (`label`, "Título — Artista"). A Sprint 2 guardava só IDs no SQLite. É o que deixa o painel e o guia do Mix abrirem sem reler o Spotify.
- **Turnos** (`turns`): a mensagem do usuário e os eventos emitidos (menos `session` e `done`), gravados ao fim de cada turno, com erro ou abort também. `tool_start` e `tool_end` trazem `detail`, uma linha em português; `tool_end` de metadados traz `summary` (`metadata_coverage`, `metadata_lookup`).
- **Pesos**: os de `data/settings.json` (padrão 35/25/25/10/5) entram no system prompt a cada turno, com a instrução de passá-los em `weights`.
- **Banco**: `PRAGMA user_version` 2. Um banco da Sprint 2 (versão 1) sobe sozinho na abertura (`snapshot_json` e a tabela `turns`), sem perder dados.

Detalhe e regras: `docs/prompts/05-fase-c-servidor.md` e `docs/eap_play-me_fainow.md`.
