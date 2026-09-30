# Prompt 07 — Fase K: calibração, tamanho do set e Jev

Sprint 4 da EAP (`docs/eap_play-me_fainow.md`), work packages 7.1, 7.2 e 7.3, mais as pendências P10 e P12 de `docs/decisoes.md`. Rode depois do prompt 06 aceito (ADR 0007).

Status: entregue em 30/09/2026 (ADR 0008). Critérios: 1h30 → 21 faixas (não 137); nota gravada e relida; Jev comparado em 20 pares (95% no tipo, Pearson 0,78). Pendências P11, P13 e P14 em `docs/decisoes.md`.

```
Use o /feature-builder.

Leia antes: docs/decisoes.md (D30 a D36, P10 a P12), docs/decisions/0005, 0006 e 0007, packages/mcp-server/src/services/{dj-engine,planner}.ts, apps/server/src/{agent,repo,server}.ts, apps/web/src/{types,state,setview}.ts e apps/web/src/panel/TransitionWindow.tsx. Não suponha: o código existe.

Tarefas:
1. P10 — tamanho do set. `dj_build_set` e `dj_evaluate_order` ganham `max_tracks` (ou `duration_minutes`, com 4,5 min por faixa): seleciona as faixas pela curva antes de ordenar, sem inventar dado. O agente traduz "1h30" para o parâmetro. Teste com a Eletro (557 faixas → ~20).
2. P12 — energia da web. A `energy` da ReccoBeats (já nas notas do store) vira estimativa 1–10 marcada como estimada; a interface já mostra "*". Faixa sem energia continua "—".
3. 7.1.1 — notas 1–5 por transição: `POST /api/plans/:id/feedback` grava em `transition_feedback`; os botões da Transição expandida (hoje desabilitados) passam a gravar e mostrar a nota dada.
4. 7.2 — Jev: validar acesso e SDK oficial (só typesafe.ai e docs.typesafe.ai); cliente em services/analyzer/analyzer/jev/ com fallback de regras e registro em jev_calls; concordância Jev × regras em 20 pares conhecidos. Se o acesso não confirmar, registre e siga sem ele (D28).
5. 7.3 — recalibrar pesos e regras com as notas gravadas; documentar o antes e depois.
6. P11 — se o Haiku continuar repetindo ferramentas por causa de resultado grande, reduzir a saída de dj_build_set (P10 já ajuda) ou trocar o modelo padrão; registrar a decisão.
7. Commit "feat: set size, web energy, transition feedback and Jev client (phase K)".

Critério de aceite:
- "Monte um set da Eletro, 1h30" devolve ~20 faixas em vez de 137.
- Uma nota dada na Transição expandida aparece de novo ao reabrir a conversa.
- Jev comparado em 20 pares (ou a razão documentada de por que não).

Não faça:
- Nenhum áudio, nenhuma prévia (D04).
- Nada de nome ou artista das faixas para o Jev (regra 8).
- Não mexer no layout das telas do canvas.
```
