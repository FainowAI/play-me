# 0008 — Fase K: tamanho do set, energia da web, notas e Jev (Sprint 4)

Data: 30/09/2026 · Decisões D37, D38, D39, D40

## Contexto

Depois da Sprint 3 ficaram três pendências vistas ao vivo (P10: "1h30" virava 137 faixas; P12: faixas da web sem energia; P11: Haiku e resultado grande) e dois pacotes da EAP: notas 1–5 por passagem (7.1) e o Jev (7.2), cujo acesso nunca tinha sido validado (D28). O usuário aprovou as cinco recomendações em bloco.

## Decisão

- **Tamanho do set (D37):** `dj_build_set` ganha `duration_minutes` e `max_tracks`. Com um deles, o MCP lê a playlist inteira (até 600 itens), considera todas as faixas analisadas e roda a busca em feixe por N posições, com a duração real de cada faixa (`duration_ms` do Spotify) e N = alvo ÷ média do pool. O resultado traz `pool_size` e `duration_ms`. Sem os parâmetros nada muda (cinco goldens do motor antigo). O agente só traduz o pedido ("1h30" → 90; "20 faixas" → `max_tracks`).
- **Energia da web (D38):** na leitura do store, entrada sem `energy` mas com `energy 0.xx (ReccoBeats)` nas notas vira energia 1–10 (`round(1 + x × 9)`) marcada com `energy_estimated`; nunca é persistida. A interface diz "Estimativa da ReccoBeats" na gaveta da faixa.
- **Jev (D39):** cliente em TypeScript no MCP (`services/jev.ts`), `fetch` puro contra `POST https://api.typesafe.ai/v1/systemone` (modelo `jev-latest`), state só com números (regra 8), duas perguntas por par (tipo de transição em `choice`, encaixe em `score` de 5 níveis; a nota 1–5 é `score + 1`, porque o score vem em índice 0-based). `transition_plan` aceita `use_jev`; o Jev decide só com confiança ≥ `JEV_MIN_CONFIDENCE` (0,7), senão as regras (regra 9). `jev_compare` compara N pares (padrão 20). Log em `~/.spotify-dj-mcp/jev-calls.jsonl`. `dj_build_set` não chama o Jev.
- **Notas (D40):** `POST /api/plans/:id/feedback` (inteiro 1–5, notas ≤ 500) grava em `transition_feedback`; a última vale e volta em `plans[].feedback`. A Transição expandida grava no clique e mostra a nota. Planos de versão já gravada não são regravados (a chave estrangeira das notas quebraria o próximo ajuste com a mesma ordem).
- Modelo do agente segue Haiku 4.5; presets do Mix seguem só Fade e Rise.

## Resultados

Verificação em 30/09/2026 (testes + servidor real via `POST /api/chat`):

| Teste | Resultado |
|---|---|
| Build e testes | `tsc` limpo nos três workspaces; 10 suítes verdes (engine com 5 goldens de regressão e seleção por quantidade e duração; jev com http falso; repo, agent e http com as notas; 3 checks da web) |
| Acesso ao Jev | Chamada real com a chave do `.env`: HTTP 200 em 0,36 s, modelo `jev-1.13.0`; par 124→125 BPM, 8A→9A: `blend` (0,85), encaixe 4,6/5 |
| Jev × regras em 20 pares ([DJ MIX] Eletro) | 95% de acordo no tipo, 100% entre respostas confiantes (19 de 20), Pearson 0,78 entre a nota das regras e a do Jev; o único desacordo (Deceiver → Moon Rocks: regras `filter`, Jev `bass_swap`) veio com confiança 0,36, então as regras venceriam. Custo do turno: US$ 0,009 |
| Set por duração | "Monte um set da playlist Eletro, 1h30, warm up até peak time" → `dj_build_set` com 90 min → 21 faixas · 103 min · curva classic (antes: 137 faixas). Custo: US$ 0,039 |
| Notas | `POST` com 6 → 400; com 4 e "boa na pista" → 200 e relido em `plans[0].feedback` |
| Interface | Botões 1–5 gravam, a nota atual em destaque e no rótulo "Sua nota · 4"; painel mostra "N faixas · X min"; gaveta da faixa indica a estimativa da ReccoBeats (28 checks do coder no navegador) |

## Consequências

- P13: a duração é aproximada (alvo 90 → 103 min); corte da última faixa ou N pela mediana são uma linha no `buildSet`.
- P14: o agente passou o nome da playlist a `jev_compare` na primeira tentativa (a ferramenta pede id/link) e se recuperou listando as playlists; aceitar nome em `resolveTrackIds` resolve.
- 7.3.1 (recalibrar pesos) ainda não tem código: as notas são gravadas, mas nada as lê; a ferramenta entra na sprint de fechamento e só faz sentido com notas reais (≥ 20).
- P11 fica em observação: com sets de ~20 faixas o resultado do `dj_build_set` deixou de ir para arquivo.
