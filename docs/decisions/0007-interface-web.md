# 0007 — Interface do chat (Fase C, Sprint 3)

Data: 30/09/2026 · Decisões D31, D34, D35, D36

## Contexto

O servidor local (ADR 0006) já monta sets pelo chat e segura o envio até um clique. Faltava a interface: as telas aprovadas no canvas "Play.Me · Telas do MVP" (D21, D23), com os componentes reais do design system e as animações pedidas lá (orb de pensamento do `thinking-orbs`, D20; movimento do DESIGN.md §4).

## Decisão

- **`apps/web`:** React 19 + Vite 8 + TypeScript strict + Tailwind 4. O Tailwind lê `design/playme-tokens.css` por referência (`@theme inline`), então o tema troca pelo `data-theme` do `<html>` (Cabine padrão, Dia opcional, persistido no navegador). Nenhuma cor, fonte ou espaçamento fora dos tokens (grep de hex vazio).
- **Componentes:** os 15 do design system (`design/ds/components/bundle.js`) portados para TSX em `src/components/playme/`, com as classes `pm-*` do `bundle.css`; fidelidade conferida por render de servidor contra o bundle (170 casos idênticos, 10 diferenças deliberadas: Composer controlado, cards clicáveis, tom fora de 1A–12B vira "—").
- **Telas:** uma por arquivo do canvas, com a tabela de divergências de `design/telas-referencia.md` aplicada (ReccoBeats no lugar de GetSongBPM/Deezer, Jev "chave no .env", contagem real da playlist). Shell de 264 | 720 | 400 px; abaixo de 1100 px o painel vira gaveta, abaixo de 720 px a sidebar também; camadas (Transição 820, Faixa 520, Configurações 760) em `<dialog>` nativo com scrim.
- **Movimento:** o orb é a única animação contínua (`theme="auto"`, quadro estático com `prefers-reduced-motion`, pausa fora da tela); hover 120 ms; abrir 200 ms (`@starting-style`); reordenar 400 ms com View Transitions (`view-transition-name` por faixa). Sem spinner.
- **Estado e API:** contrato escrito antes das trilhas (`src/types.ts`, `api.ts`, `state.ts`, `setview.ts`, props dos componentes e das peças). Reducer puro com check em Node (`npm run test:ui`). SSE do `POST /api/chat` traduzido em itens do chat; o `summary` das ferramentas de metadados vira o card de cobertura.
- **Servidor v2 (D35):** snapshot do `dj_build_set` por versão (com origem do dado por faixa, lida do store do MCP), turnos gravados, `GET /api/status`, `GET /api/playlists` (cliente Spotify do MCP, cache de 5 min, sem duplicata), `GET/PUT /api/settings` (pesos em `data/settings.json`, injetados no prompt), guia do Mix por versão via `mixGuideStep`. Migração `user_version` 1 → 2 no primeiro start (backup `data/playme.backup-2026-09-30.sqlite`).
- **Gate (D36):** `spotify_create_playlist_from_order` com IDs fora do snapshot atual é recusado antes do clique.
- **Construção:** quatro `feature-coder` em paralelo (servidor, componentes, shell, painel) sobre o contrato; costura, verificação no navegador e auditoria de segurança na sessão principal.

## Resultados

Verificação em 30/09/2026 (Chrome real em 1440 px; Playwright em 1000, 600 e 390 px):

| Teste | Resultado |
|---|---|
| Build e checks | `tsc` 0 erros nos três workspaces; `vite build` 309 kB (99 kB gzip); testes do servidor (repo, agent, http) e os 3 checks da web verdes |
| Início, Conversa, Set proposto | Orb 64 em breathing; ThinkingStatus com o verbo da ferramenta; ToolCall rodando com orb 20; card da passagem mais arriscada e atalhos; painel com curva, seções e "A validar" |
| Ajustar | "Mais energia no meio" rodou `dj_build_set` de novo; ordem igual (faixas da web sem energia) não gerou versão (P12) |
| Aprovação com clique do usuário | Sessão "Quero montar uma playlist de techno…": 23 faixas da [DJ MIX] Eletro, gate aprovado, playlist "[DJ MIX] Eletro - Techno Set" criada privada; tela Enviado com link e aba Guia do Mix |
| Rejeição | "Revisar ordem" → ferramenta "falhou · não aprovado", set de volta a rascunho, nada criado |
| Releitura | Conversas reabertas a partir dos turnos gravados; recarregar a página restaura a conversa pelo hash |
| Camadas e tema | Transição, Faixa e Configurações iguais ao canvas; Dia troca todas as superfícies |
| Responsivo | 1000 px: painel em gaveta; 600 e 390 px: sidebar em gaveta, nenhum elemento além da viewport, composer visível, 0 erros no console |
| Achado real | O Haiku mandou ao gate 23 IDs inventados; a rejeição segurou e a D36 passa a recusar antes do clique |

Custo dos turnos no Haiku 4.5: US$ 0,012 a 0,072 por turno (o de 137 faixas com 5 chamadas repetidas de `dj_build_set`, P11).

## Consequências

- Pendências para a Sprint 4: P10 (tamanho do set por duração), P11 (Haiku e resultado grande de ferramenta), P12 (energia das faixas da web), notas 1–5 (botões já na tela, desabilitados), `playlist_id` explícito no `POST /api/chat` (hoje a playlist vai no texto).
- O canvas segue com os textos antigos (GetSongBPM, Deezer, 548 faixas); a interface já usa as decisões vigentes.
