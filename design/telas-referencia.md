# Referência de construção das telas — Play.Me

A `apps/web` segue as telas do canvas **"Play.Me · Telas do MVP"** (D21, D23, D31). Este documento diz, tela por tela, o que construir, com quais componentes, de onde vêm os dados e em qual pacote da EAP. Lista das telas e do fluxo aprovados: `design/telas-mvp.md`.

## Fontes

| O quê | Onde |
|---|---|
| Canvas das telas (fonte) | https://claude.ai/artifact/52ejbuCbMrXoM7fyfs8ayK (versão 1790730665-f0f6, conferida em 29/09/2026) |
| Cópia local das telas | `design/telas/*.dc.html` + `design/telas/canvas.json` (idêntica ao canvas em 29/09) |
| Design system (fonte dos componentes) | artifact "Play.Me" · https://claude.ai/artifact/MNHQn2dmZhJa4XCUwPWbxn |
| Componentes (cópia local) | `design/ds/components/bundle.js` + `bundle.css` + `index.d.ts` (tipos) + `lib/thinking-orbs.js` |
| Tokens | `design/playme-tokens.css` (fonte) e `design/ds/tokens.json`; regras em `design/DESIGN.md` |

Regra de precedência na construção:
- **Layout, hierarquia e componentes:** o canvas vale.
- **Dados, fontes e textos de status:** valem as decisões vigentes (D24 a D30).
- Onde os dois divergem (seção "Divergências"), constrói-se pelas decisões e o canvas é corrigido depois.

## Componentes: usar os reais

O bundle do design system já é React: usa `window.React` e expõe `window.PlayMe`. O `apps/web` não redesenha nada disso. Porte cada componente para TSX em `apps/web/src/components/playme/`:
- `index.d.ts` é o contrato das props.
- `bundle.css` traz as classes `pm-*`.
- Mantenha o comportamento, os nomes e os estados.

| Componente | Props principais (de `index.d.ts`) | Aparece em |
|---|---|---|
| `Button` | variant primary · signal · outline · ghost; size md · sm; icon; disabled | todas |
| `StatusTag` | tone ok · info · warn · danger · neutral | todas |
| `ChatMessage` | role user · assistant | 2, 3, 4, 5 |
| `Composer` | context, placeholder | 1, 2, 3, 4, 5 |
| `AgentOrb` | activity, size 64 · 32 · 20 | 1, Sidebar |
| `ThinkingStatus` | activity, verb, detail | 2, SetPanel |
| `ToolCall` | name, detail, status running · done · waiting | 2, 3, 4, 5 |
| `activityForTool(name)` | nome da ferramenta → estado do orb (DESIGN.md 4.1) | ToolCall |
| `TransitionCard` | index, trackA, trackB, relation, deltaBpm, deltaEnergy, type, lengthBars, reason | 3 |
| `ApprovalGate` | playlist-name, track-count | 4 |
| `KeyBadge` | camelot, size md · lg | 6, 7, SetPanel |
| `EnergyMeter` | value 1–10, estimated | 6, 7 |
| `CamelotWheel` | active, compatible, size | 6, 7 |
| `SetArc` | points (energia), current, caption | SetPanel |
| `TrackRow` | index, title, artist, bpm, camelot, energy, estimated, state | SetPanel |
| `PhraseBar` | sections, deck | trilha de áudio (fora do MVP) |
| `Icon` | play · check · arrow · send · plus · alert · tool · list · wave | via Button |

`TransitionCard`: use `trackA` e `trackB`. `from` e `to` estão depreciados, porque `from` é reservado no canvas.

## Estrutura fixa

Sidebar de 264 px, coluna do chat de 720 px e SetPanel de 400 px, este só quando existe set. Abaixo de 1100 px o painel vira gaveta; abaixo de 720 px, a sidebar também. As telas do canvas medem 1440 × 900. Tema Cabine (dark) é o padrão; Dia (light) entra pelo `data-theme`. Gavetas e janelas usam o token `--scrim` por baixo.

## Tela por tela

| # | Tela | Arquivo | Tipo | Componentes | Estados e dados | Ferramenta ou endpoint | EAP |
|---|---|---|---|---|---|---|---|
| 1 | Início | `Main.dc.html` | tela | AgentOrb 64 (idle), Composer, Button, StatusTag | "Pista cheia."; composer com a playlist em contexto; 3 pedidos prontos; aviso do Jev | `GET /api/sessions`, playlists do Spotify | 5.1.2, 5.2.1 |
| 2 | Conversa · buscando BPM e tom | `Analisando.dc.html` | estado do chat | ChatMessage, ThinkingStatus, ToolCall, StatusTag, Composer | orb "reading"; cobertura Mixar · web conferido · a validar · pendentes; barra de progresso real | `metadata_lookup` (dry run), `metadata_coverage`, SSE de ferramentas | 5.2.1 |
| 3 | Set proposto + painel | `SetProposto.dc.html` | estado do chat + painel | ToolCall, TransitionCard, Button, SetPanel | resultado primeiro; a passagem mais arriscada em card; atalhos de ajuste; faixas fora do set | `dj_build_set`, `dj_evaluate_order`, `transition_plan`; `GET /api/sets/:id` | 5.2.2, 3.3.1 |
| 4 | Aprovação | `Aprovacao.dc.html` | estado do chat | ApprovalGate, ToolCall (waiting), SetPanel (aguardando aprovação) | set passa a `aguardando_aprovacao`; nada vai ao Spotify sem o clique | evento SSE da approval; `POST /api/approvals/:id` | 6.1.1, 6.1.2 |
| 5 | Enviado + guia do Mix | `Enviado.dc.html` | estado do chat + painel | ToolCall (done), Button, SetPanel (aba Guia do Mix, enviado) | playlist criada, privada, a original intacta; copiar guia; novo set a partir deste | `spotify_create_playlist_from_order`, `export_mix_guide` | 6.2.1 |
| 6 | Transição expandida | `Transicao.dc.html` | janela de 820 px | KeyBadge, EnergyMeter, CamelotWheel, StatusTag, Button | decks A e B (BPM, tom, energia); tipo, duração, harmonia, ΔBPM, ΔEnergia; guia do Mix; alertas; nota 1–5; trocar B; prévia desabilitada (pós-MVP) | `transition_plan`, `POST` da nota (Sprint 4) | 5.2.3, 7.1.1 |
| 7 | Faixa | `Faixa.dc.html` | gaveta de 520 px | KeyBadge lg, EnergyMeter, CamelotWheel, StatusTag, Button, form | BPM, tom e energia com a fonte de cada dado; tons compatíveis; correção manual (grava como fonte do usuário, protegida) | store do MCP (`dj_set_track_analysis` para a correção) | 5.2.3 |
| 8 | Configurações | `Configuracoes.dc.html` | janela de 760 px | StatusTag, Button, radiogroup, sliders | conexões; tema Cabine/Dia; pesos da nota do par (somam 100 %, valem para os próximos sets) | config do servidor; pesos de `constants.ts` | 5.2.4 |
| — | Sidebar | `Sidebar.dc.html` | peça | Button, AgentOrb 20 | sets com estado (rascunho, enviado), orb no set em trabalho; playlists; status das conexões | `GET /api/sessions` | 5.1.2 |
| — | SetPanel | `SetPanel.dc.html` | peça | SetArc, TrackRow, KeyBadge, StatusTag, ThinkingStatus | abas Ordem · Transições · Guia do Mix; versão V1, V2…; estados rascunho, aguardando aprovação, enviado; pendências no rodapé | `GET /api/sets/:id` | 5.2.2, 3.3.1 |

Dados do canvas: a ordem, o BPM, o Camelot e a energia do set [DJ MIX] Eletro (27/09) são reais, e a energia é estimativa (marcada com *). Tipo, duração e guia de cada transição são ilustrativos até a Fase P.

## Divergências canvas × decisões vigentes

Construa pela coluna "Construir assim". O canvas pode ser corrigido depois, sem mudar o layout.

| Onde | O canvas mostra | Construir assim | Decisão |
|---|---|---|---|
| 2 · Conversa | "GetSongBPM + Deezer · 312/548"; "Tom vem só do GetSongBPM"; "A validar = BPM diverge ou fonte única" | ReccoBeats · N/557. "Web conferido" = BPM da ReccoBeats; "A validar" = tom da web (sempre) ou BPM divergente | D24, D29 |
| 7 · Faixa | "Cruzamento: GetSongBPM + Deezer"; "danceability de apoio" | "ReccoBeats: BPM conferido, tom a validar"; "energy da ReccoBeats de apoio" | D24, D29 |
| 8 · Configurações | linhas GetSongBPM ("chave no .env") e Deezer | Uma linha só: ReccoBeats (sem chave, dados pelo ID do Spotify) | D24, D29 |
| 8 · Configurações e 1 · Início | Jev "Sem acesso" | "Chave no .env · acesso validado na Sprint 4"; até lá decide o planejador de regras | D28 |
| Sidebar | status GetSongBPM e Deezer; Eletro 548 | status ReccoBeats; Eletro 557 | D24, D29 |
| 1, 2, 4 | "Eletro · 548 faixas" | contagem real da playlist (557 em 29/09) | — |
| SetPanel · aba Transições | não desenhada (repete a Ordem) | lista de TransitionCard, uma por passagem, na ordem do set | D30 |
| Guia do Mix (5, 6) | presets Blend, Wave, Rise, Fade | usar só presets confirmados no app (prompt 04, item 3); sem lista, descrição genérica | D30 |
| Nota do canvas "Dados reais…" | cita GetSongBPM e Deezer | vale a D24 | D24 |

## O que é pós-MVP nas telas

- Botão "Prévia" na Transição expandida: desabilitado, como no canvas.
- "Casar arquivos" (6) e "Escolher arquivo" (7): pertencem à trilha de áudio (opcional, D22). No MVP aparecem desabilitados com o rótulo "trilha opcional".
- `PhraseBar` e estrutura por compasso: só com a trilha de áudio.
