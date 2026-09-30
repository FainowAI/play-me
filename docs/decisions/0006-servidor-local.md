# 0006 — Servidor local do chat (Fase C, Sprint 2)

Data: 29/09/2026 · Decisões D08, D27, D32, D33

## Contexto

O chat de DJ precisa de um backend na máquina do usuário que rode o Claude com as ferramentas do MCP `spotify-dj`, guarde sessões e versões do set e segure a criação de playlist até um clique de aprovação (regra inviolável 7).

## Decisão

- `apps/server` em Node 24 + TypeScript, sem framework:
  - `node:http` com SSE para o chat;
  - `node:sqlite` embutido, em `data/playme.sqlite`, fora do git;
  - Claude Agent SDK 0.3.285 (`@anthropic-ai/claude-agent-sdk`).
- **Agente:**
  - Só as ferramentas do MCP `spotify-dj`. As nativas ficam desligadas (`tools: []`, `disallowedTools`), e as configurações e hooks da máquina não são carregados (`settingSources: []`).
  - Limites: `maxTurns` 20 e teto de US$ 0,50 por turno (`PLAYME_MAX_BUDGET_USD`).
- **Gate de aprovação:**
  - `spotify_create_playlist_from_order` passa pelo `canUseTool`. O pedido de envio muda o set para `aguardando_aprovacao`, cria uma approval pendente e manda à tela o nome, o total e a lista de faixas.
  - Só `POST /api/approvals/:id` com "approved" libera exatamente o pedido mostrado.
  - Rejeição, desconexão ou restart deixam a approval rejeitada ou expirada e devolvem o set a rascunho.
  - O resultado do envio é gravado no set da própria approval.
- **Modelo padrão (D32): Claude Haiku 4.5** (`PLAYME_MODEL`). O Opus 5.5 fica como opção.
- **Segurança local (D33):**
  - Escuta só em `127.0.0.1`.
  - Aceita só o `Host` 127.0.0.1 ou localhost na própria porta (contra DNS rebinding).
  - A origem de navegador só pode ser a do Vite. POST só com `application/json`, o que força preflight e barra requisição forjada.
  - Um turno por conversa por vez.
  - Os erros vão ao cliente sem detalhe interno; o detalhe fica no log do servidor, sem a chave.

## Resultados

Validação real em 29/09/2026, com a playlist `[DJ MIX] Eletro`:

| Teste | Resultado |
|---|---|
| Pedido de set | O agente chamou `dj_build_set`. Versão 1 em rascunho com 21 faixas e 20 planos gravados |
| Pedido de envio | Parou em `aguardando_aprovacao` e nenhuma playlist foi criada durante a espera |
| Rejeição | Set de volta a rascunho, sem playlist; o agente explicou ao usuário. Segunda decisão recusada (409) |
| Host estranho | 403 |
| Custo do mesmo pedido de set | Opus 5.5: US$ 0,134 · Haiku 4.5: US$ 0,030 e depois US$ 0,024 (4,5 vezes menos) |
| Qualidade no Haiku | Dados certos. Usava emoji e confundia "nota" com "confiança" até o prompt proibir emoji e separar os termos; ainda erra leituras mais finas (chamou de pico faixas de energia 5 e 6) |

Auditoria de segurança (subagente) antes do fechamento:
- **Corrigidos:** 2 achados ALTOS (DNS rebinding; requisição forjada com `text/plain`) e 4 MÉDIOS (desconexão sem cancelar, sem teto de custo, registro do envio no set errado com duas aprovações, aprovação sem a lista de faixas, aprovação órfã depois de restart).
- **BAIXO, aceito:** o banco guarda o texto do próprio usuário (título, notas) e o plano de transição; não guarda nome nem artista do Spotify.

Não testado com dinheiro real: a aprovação que cria de fato uma playlist no Spotify. Fica para a Sprint 3, com a tela e o seu clique.

## Consequências

- A Sprint 3 (`apps/web`) consome `POST /api/chat` (SSE) e mostra o card de aprovação com a lista de faixas antes do botão.
- Se a qualidade do Haiku incomodar, troca-se por `PLAYME_MODEL=claude-sonnet-5-5` (cerca de metade do custo do Opus) ou pelo Opus, sem mudar código.
