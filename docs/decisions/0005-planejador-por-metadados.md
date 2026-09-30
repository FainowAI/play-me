# 0005 — Planejador de transições por metadados (Fase P)

Data: 29/09/2026 · Decisões D30 e D29 · Sprint 1 da EAP

## Contexto

Sem arquivos de áudio (D22), não há estrutura por compasso: o planejador decide só por BPM, tom e energia. O Mix do app do Spotify não tem API; as transições são aplicadas à mão, seguindo um guia (D14). A página de suporte do Mix confirma três controles por transição: Volume, EQ (grave, médio, agudo) e Efeitos (filtros passa-baixa e passa-alta). Os presets confirmados publicamente são só Fade e Rise.

## Decisão

Planejador em TypeScript dentro do MCP (`services/planner.ts`, versão `meta-1`), com as regras v1 validadas pelo usuário em 29/09, aplicadas nesta ordem (ΔBPM já considera metade/dobro):

| # | Condição | Tipo | Compassos | Troca de grave |
|---|---|---|---|---|
| 1 | ΔBPM > 6 ou choque forte (nota harmônica ≤ 0,18) | echo out | 4 | não |
| 2 | harmonia segura e ΔBPM ≤ 1 | blend | 32 | compasso 17 |
| 3 | harmonia segura e ΔBPM ≤ 3 | blend | 16 | compasso 9 |
| 4 | criativa com ΔBPM ≤ 3, ou segura com ΔBPM ≤ 6 | troca de grave | 8 | compasso 5 |
| 5 | o resto | filtro (passa-alta na saída de A) | 8 | não |

- Rampa de tempo quando a diferença fica entre 3 % e 8 % do BPM menor.
- Tom [A VALIDAR] em A ou B: o tipo não muda, a confiança cai 0,2 e entra o alerta "confirme o tom no Mixar".
- Montador de set: par que só aceita echo out perde 0,10 na nota (`ECHO_ONLY_PENALTY`).
- Guia do Mix (`export_mix_guide`): preset Rise quando a energia sobe 2 ou mais em blend ou troca de grave; Fade nos outros casos. Cada passagem diz Volume, EQ e Efeitos nos termos do app. Outros nomes de preset só entram em `mix-presets.ts` depois de confirmados no app.

## Resultados

Validação em 29/09/2026 no set atual, a playlist `[DJ MIX] Eletro` (23 itens, 21 com BPM e tom no store):

| Medida | Resultado |
|---|---|
| Passagens com plano válido | 20 de 20 |
| Blend 32 compassos | 7 |
| Blend 16 compassos | 5 |
| Troca de grave 8 compassos | 6 |
| Filtro 8 compassos | 1 (Talkin' Too Much → Deceiver: 3B → 2A, criativa, −4 BPM, com rampa) |
| Echo out 4 compassos | 1 (Let It Go → You Were Right: 7B → 4B, choque harmônico) |
| Rampas de tempo | 2 (a outra: Paranoia → The Sun Can't Compare, −6 BPM) |
| Nota média do set | 0,83 (igual à de antes da penalidade) |

- Todas as faixas desse set têm tom do Mixar, então nenhum plano levou o alerta de tom a validar.
- Duas faixas da playlist não têm BPM nem tom no store (Beg You e Guessing Game): os pares com elas foram pulados e avisados.
- Nenhum preset Rise apareceu, porque nenhuma passagem em blend ou troca de grave sobe 2 ou mais de energia.
- `analysis.json` intacto e nenhuma escrita no Spotify.

## Consequências

- `dj_build_set` e `dj_evaluate_order` trazem o plano de cada passagem. `transition_plan` mostra o plano de um par e `export_mix_guide` gera o guia do set. O MCP passa a ter 15 ferramentas.
- Sem estrutura, não há drop swap nem veto de vocal ou grave. Cada plano avisa "vocal e grave: sem dado". A trilha de áudio (opcional) é que traria isso.
- As regras e a penalidade são v1: a Sprint 4 (Fase K) recalibra com as suas notas por transição.
