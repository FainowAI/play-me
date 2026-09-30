# Prompt 05 — Fase C: servidor local com Agent SDK

Sprint 2 da EAP (`docs/eap_play-me_fainow.md`), work packages 3.1, 3.2, 4.1 e 6.1.1. Rode depois do prompt 04 aceito.

```
Use o /feature-builder.

Leia antes: CLAUDE.md (seções Orquestração e interface, Regras invioláveis), docs/decisoes.md, docs/eap_play-me_fainow.md (Schema local, Regras de negócio consolidadas), design/telas-mvp.md e packages/mcp-server/README.md. Confira a documentação atual do Claude Agent SDK para TypeScript antes de escrever qualquer chamada: query, sessões, permissões (canUseTool) e configuração de MCP por stdio.

Contexto:
- apps/server está vazio. O MCP spotify-dj (packages/mcp-server) já tem as ferramentas de metadados, o planejador e o guia do Mix.
- A autenticação é por ANTHROPIC_API_KEY, que já está no .env da raiz. O login do claude.ai não é permitido em app de terceiros.
- Uso local e single-user: o servidor escuta só em 127.0.0.1.

Tarefas:
1. apps/server (Node 24, TS strict, workspace npm): HTTP em 127.0.0.1 (porta em PLAYME_SERVER_PORT, padrão 8787). Carrega o MCP spotify-dj por stdio a partir do build de packages/mcp-server.
2. SQLite em data/playme.sqlite com o schema da EAP (chat_sessions, sets, set_versions, transition_plans, transition_feedback, approvals). Use node:sqlite. Se a API dele não servir no Node instalado, pare e me mostre o erro antes de trocar por better-sqlite3. Migração simples: um arquivo .sql aplicado na subida, versionado por PRAGMA user_version.
3. Endpoints:
   - POST /api/chat: mensagem numa sessão, com resposta em streaming SSE (texto, início e fim de cada ferramenta, estado do set).
   - GET /api/sessions e GET /api/sessions/:id: histórico.
   - GET /api/sets/:id: set, versões e planos.
   - POST /api/approvals/:id: aprovar ou rejeitar.
4. Estados do set (regras de negócio 3 e 4 da EAP): toda proposta ou ajuste do agente grava uma nova versão em rascunho; o pedido de envio passa o set para aguardando_aprovacao; aprovar e criar a playlist passa para enviado; rejeitar volta para rascunho. Um set enviado nunca é editado: um ajuste cria nova versão em rascunho.
5. Gate: spotify_create_playlist_from_order só roda com uma approval 'approved' do mesmo set. A permissão do Agent SDK cria a approval 'pending', emite o evento no SSE e espera a decisão. Nenhum outro caminho cria playlist.
6. Testes sem rede: máquina de estados, gate (sem aprovação não chama a ferramenta), repositório SQLite em arquivo temporário. Um teste de fumaça que sobe o servidor e faz GET /api/sessions.
7. Commit "feat(server): local Agent SDK server with SSE, SQLite and approval gate (phase C)".

Critério de aceite:
- npm test verde no workspace.
- Uma conversa via curl no /api/chat monta um set da Eletro e grava a versão 1 em rascunho.
- O pedido de envio sem aprovação não cria playlist: a approval fica 'pending'.

Não faça:
- Criar UI (apps/web é o prompt 06).
- Guardar nome ou artista do Spotify no SQLite (só IDs).
- Expor o servidor fora de 127.0.0.1.
```
