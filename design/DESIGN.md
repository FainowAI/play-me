# Play.Me — DESIGN.md

Referência visual para o Claude Code implementar a UI do Play.Me (React + Vite + TypeScript). Fonte da verdade dos valores: `playme-tokens.json` / `playme-tokens.css`. Design system navegável: artifact "Play.Me" (Design System), com os componentes em `design/ds/`. Telas: canvas "Play.Me · Telas do MVP" (https://claude.ai/artifact/52ejbuCbMrXoM7fyfs8ayK), com cópia em `design/telas/` (D23; o Google Stitch saiu). Guia de construção tela por tela: `design/telas-referencia.md` (D31).

## 1. Conceito

Chat local do DJ, estilo ChatGPT, que lê playlists do Spotify, analisa os arquivos do DJ e planeja ordem e transições. Estética de **cabine escura**: cromo neutro e silencioso, cor reservada para dado musical.

- Tema padrão: **dark (Cabine)**. Tema alternativo: light (Dia).
- Um acento só: **signal** (magenta-UV). Usos permitidos: ação decisiva (aprovar e criar playlist), faixa tocando/em foco, anel de foco.
- Cor como informação: tom Camelot, energia 1–10, seção da faixa, faixa A (sai) e B (entra), estados.
- Unidade de tempo da interface: **compasso**. Nunca segundos para estrutura.

## 2. Cor

### Neutros (dark · light)

| Token | Dark | Light | Uso |
|---|---|---|---|
| surface-base | #06070A | #F6F7F9 | Fundo do app e do chat |
| surface-raised | #0F1014 | #FFFFFF | Sidebar, painel do set, cards |
| surface-overlay | #18191D | #EFF0F3 | Hover, input, bolha do usuário |
| surface-sunken | #222429 | #E5E6EA | Linha selecionada, trilhos |
| line | #2C2E33 | #D9DBDF | Hairline entre linhas |
| line-strong | #67696F | #84868C | Borda de controle (≥3:1) |
| ink | #F4F5F8 | #101116 | Texto principal |
| ink-muted | #BCBEC3 | #3B3D43 | Artista, metadado |
| ink-subtle | #909299 | #616369 | Rótulo, placeholder |
| ink-inverse | #06070A | #FFFFFF | Texto do botão primário |
| scrim | rgba(6,7,10,.72) | rgba(16,17,22,.32) | Fundo escurecido sob gavetas e janelas |

### Acento e decks

| Token | Dark | Light | Uso |
|---|---|---|---|
| signal | #F847AC | #C91B86 | Aprovar, tocando, foco |
| signal-soft | #4A1A33 | #FFE2EE | Fundo da faixa tocando |
| on-signal | #06070A | #FFFFFF | Texto sobre signal |
| focus-ring | #FF77C2 | #BB007A | Outline 2px + offset 2px |
| deck-a | #37D2F2 | #0080A2 | Faixa A (sai) |
| deck-b | #FFB147 | #AA5300 | Faixa B (entra) |
| on-deck | #101116 | #FFFFFF | Texto do rótulo A/B |

### Estados (texto sobre `*-soft`, sempre com palavra e ícone)

| Token | Dark | Light | Significado |
|---|---|---|---|
| ok | #59D38C | #00793D | Harmonia segura, concluído |
| info | #58C0FF | #0068AD | Harmonia criativa, dica |
| warn | #E9AB2B | #8C5700 | [A VALIDAR], estimado, divergência |
| danger | #FF8E86 | #A43B38 | Choque de tom, veto, erro |

### Tons Camelot (fill, texto `key-ink` #101116, iguais nos dois temas)

Matiz = círculo de quintas: começa em ciano no 1 e avança 30° por número; vizinhos compatíveis têm cores vizinhas. B é a versão clara de A.

| n | A (menor) | B (maior) |
|---|---|---|
| 1 | #00C4CD | #85E3E8 |
| 2 | #25BAF2 | #91DDFF |
| 3 | #75ABFF | #AFD2FF |
| 4 | #AA9AFC | #D0C8FF |
| 5 | #D28CE1 | #ECBEF6 |
| 6 | #EC84B7 | #FFB9D9 |
| 7 | #F68486 | #FFBAB9 |
| 8 | #F08E54 | #FFC09C |
| 9 | #D9A02C | #F0CB8D |
| 10 | #B1B239 | #D4D791 |
| 11 | #79C069 | #B2E0A8 |
| 12 | #23C79D | #93E5C8 |

### Energia 1–10 (sempre com o número)

Rampa 1 → 10: #433E7B · #395493 · #1A6DA5 · #0087AD · #009FAC · #00B6A2 · #3BC98F · #84D777 · #C3E15B · #FFE648

### Seções da faixa (fill; vocal = hachura diagonal por cima)

intro #61AFDA · groove #7F8699 · build #F5AE39 · drop #FF6557 · break #58C8AD · outro #A18CC8

## 3. Tipografia

- **Geist** (interface e texto) e **Geist Mono** (BPM, tom, energia, compasso, nome de tool). Google Fonts.
- Pesos 400 e 500. 600 só no wordmark e no rótulo A/B. Hierarquia por tamanho e tracking negativo.

| Estilo | Família | Tamanho/entrelinha | Peso | Tracking | Uso |
|---|---|---|---|---|---|
| display | Geist | 56/56 | 500 | −0.03em | Tela vazia |
| title-1 | Geist | 32/36 | 500 | −0.02em | Nome do set |
| title-2 | Geist | 24/30 | 500 | −0.015em | Seção do set |
| title-3 | Geist | 18/24 | 500 | −0.01em | Título de card |
| body | Geist | 15/24 | 400 | 0 | Mensagens |
| body-strong | Geist | 15/24 | 500 | 0 | Título de faixa |
| body-sm | Geist | 13/20 | 400 | 0 | Artista, legenda |
| label | Geist | 11/16 CAIXA ALTA | 500 | +0.08em | Eyebrow, cabeçalho de coluna |
| button | Geist | 14/20 | 500 | 0 | Botões |
| data-xl | Geist Mono | 40/40 | 500 | −0.02em | BPM em foco |
| data | Geist Mono | 13/20 | 500 | 0 | Tabelas (tabular-nums) |
| data-sm | Geist Mono | 11/16 | 500 | 0 | Marcas de compasso |

## 4. Forma, espaço, profundidade, movimento

- Espaço (grade 4px): 2 · 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64.
- Raio: pill 999 (todo botão) · 20 (cards, bolhas, composer) · 12 (linhas, inputs, menus) · 6 (chips) · 4 (segmentos).
- Sombra só em flutuante: `0 16px 40px rgba(0,0,0,.55)` (dark). Cards planos com `line` 1px.
- Movimento: 120ms hover · 200ms abrir · 400ms reordenar; `cubic-bezier(0.4,0,0.2,1)`. Pressed = scale(0.97). Respeitar `prefers-reduced-motion`.
- Única animação contínua: o orb de pensamento (4.1). Fora dele, nada gira, quica ou brilha.

### 4.1 Pensamento (orbs)

O estado "o agente está trabalhando" usa **thinking-orbs** (`npm install thinking-orbs`, MIT, Jakub Antalik, https://libraries.dev/orbs). Esfera de pontos em canvas 2D, tinta monocromática, segue `data-theme` sozinha, quadro estático com `prefers-reduced-motion`, pausa fora da tela.

Envolver em `AgentOrb` (`apps/web/src/components/playme/AgentOrb.tsx`) com o mapa abaixo. O `ToolCall` escolhe a atividade pelo nome da ferramenta.

| Atividade | Estado do orb | Ferramentas / momento |
|---|---|---|
| idle | breathing | Tela vazia; gate aguardando aprovação |
| reading | searching | `spotify_get_playlist_tracks`, `spotify_search_tracks`, busca de BPM |
| matching | connecting | `library_match_*` |
| listening | listening | `analysis_*` (Beat This!, extratores) |
| scoring | solving | `dj_score_transition`, `dj_evaluate_order`, Jev |
| planning | weaving | `transition_plan` |
| composing | composing | `dj_build_set`, `set_build_deep`, Claude escrevendo |
| shipping | shaping | `spotify_create_playlist_from_order`, `export_*` |
| working | working | Qualquer outra |

- Tamanhos: 64 só na tela vazia · 32 no cabeçalho do painel do set recalculando · 20 no `ThinkingStatus`, no `ToolCall` rodando e na sidebar.
- `ThinkingStatus`: orb 20 + verbo no gerúndio (`ink-muted`) + progresso real em mono (`ink-subtle`): "Analisando o áudio · 12/42 faixas". Abre a resposta e some quando o texto começa a chegar.
- Sem `color`, sem `gravity`, `speed` 1. Um orb animado por região. Terminou: sai o orb, entra o ícone de estado.
- Proibido: spinner, barra indeterminada, "Pensando…" genérico.

## 5. Layout do app

```
┌──────────────┬──────────────────────────────┬──────────────────┐
│ Sidebar 264  │ Chat (coluna 720, centrada)  │ Painel do set 400│
│ Play.Me      │                              │ label + title-1  │
│ + Novo set   │ mensagens                    │ SetArc (energia) │
│ Playlists    │   ToolCall                   │ TrackRow × N     │
│ Sets salvos  │   TransitionCard             │   por seção      │
│              │   ApprovalGate               │ Pendências       │
│ status MCP   │ Composer fixo (rodapé)       │                  │
└──────────────┴──────────────────────────────┴──────────────────┘
```

- < 1100px: painel do set vira gaveta à direita. < 720px: sidebar também vira gaveta; gutter 16px.
- Tela vazia: `AgentOrb` 64 em `idle` + `display` "Pista cheia." + body-sm "Escolha uma playlist e diga o clima do set." + 3 sugestões em botão outline.

## 6. Componentes

| Componente | Essência |
|---|---|
| Button | Pílula 40px (sm 32). primary = fill ink; signal = só aprovar; outline = borda line-strong; ghost = sem borda |
| KeyBadge | Chip 22px, raio 6, fill key-*, texto mono key-ink. Sem dado: "—" em surface-sunken |
| EnergyMeter | 10 segmentos 4×14px, gap 2; acesos em energy-N; número "E7" em mono; estimado = "*" |
| StatusTag | Chip 22px, ícone + palavra, fill *-soft, texto do estado |
| TrackRow | Grid: índice · título/artista · BPM · tom · energia · tag. 48px. selected = surface-sunken; playing = signal-soft + ícone play |
| PhraseBar | Barra 28px de segmentos por seção, largura proporcional a compassos; marcas "sai c.N" (deck-a) e "entra c.N" (deck-b) |
| TransitionCard | Card raio 20: eyebrow "TRANSIÇÃO 3 → 4" + StatusTag; A → B com BPM e tom; grade ΔBPM, ΔEnergia, Tipo, Duração; duas PhraseBar; motivo em uma frase |
| SetArc | Linha neutra da energia por faixa, área signal-soft, grade em 3/5/7/9, faixa atual em signal |
| CamelotWheel | Dois anéis (B fora, A dentro), 12 no topo; ativo com contorno ink, vizinhos compatíveis cheios, resto 18% |
| ChatMessage | Usuário: bolha surface-overlay à direita. Play.Me: sem bolha, label "PLAY.ME" |
| ToolCall | Pílula com ícone de estado, nome mono, detalhe, estado (rodando · concluído · falhou · aguardando você). Rodando = `AgentOrb` 20 da atividade da ferramenta |
| AgentOrb | `ThinkingOrb` do thinking-orbs com o mapa atividade → estado; 64/32/20; monocromático |
| ThinkingStatus | Orb 20 + verbo + progresso em mono; `role="status"` |
| Composer | Card raio 20 surface-overlay, textarea, pílula de contexto da playlist, botão enviar primary sm |
| ApprovalGate | Card com borda signal, label signal "APROVAÇÃO NECESSÁRIA", texto que diz que a original não muda, botões "Aprovar e criar" (signal) e "Revisar ordem" (ghost) |

Ícones: Lucide, traço 1.75, 14–18px, `currentColor`.

## 7. Voz

Português brasileiro, direto, vocabulário de cabine. Resultado primeiro. Números sempre com unidade (`124 BPM`, `8A`, `E7`, `c.17–32`, `16 c.`). Dado faltando é dito, nunca inventado. Sem emoji, sem exclamação.

## 8. Não fazer

- `signal` em área grande ou em mais de um botão por tela.
- Tom só por cor; energia sem número; estrutura em segundos.
- `#000` ou `#FFF` puros como fundo principal.
- Gradiente roxo-azul, glass, neon, glow, fotografia de palco.

## 9. Critérios de aceite da UI

1. Todos os valores de cor, raio, espaço e tipo vêm de `playme-tokens.css`; `grep -E '#[0-9a-fA-F]{6}' src/**/*.tsx` retorna zero.
2. Alternar `data-theme` entre `dark` e `light` muda todas as superfícies sem texto ilegível (axe sem erro de contraste nos dois temas).
3. Nenhum número musical fora de `font-mono` com `tabular-nums`.
4. `signal` aparece em no máximo um botão por tela e só no `ApprovalGate`.
5. Nenhuma chamada a `spotify_create_playlist_from_order` acontece sem clique em "Aprovar e criar".
6. A 390px de largura, nada rola na horizontal e o composer continua visível.
7. Toda ferramenta em execução mostra `AgentOrb` com a atividade de `activityForTool`; nenhum spinner no código (`grep -ri spinner apps/web/src` vazio).
8. Com `prefers-reduced-motion: reduce`, nenhum orb anima.
