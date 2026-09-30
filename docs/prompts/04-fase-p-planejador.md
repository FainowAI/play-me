# Prompt 04 — Fase P: planejador de transições por metadados

Sprint 0 e Sprint 1 da EAP (`docs/eap_play-me_fainow.md`), work packages 1.2, 1.3, 2.1, 2.2 e 2.3. Cole no Claude Code aberto em `C:\Users\Antônio\Desktop\Play.me`.

```
Use o /feature-builder.

Leia antes: CLAUDE.md, docs/decisoes.md (D24 a D30), docs/eap_play-me_fainow.md (seções "Regras de negócio consolidadas" e "EAP"), docs/decisions/0004-reccobeats-como-fonte-de-bpm.md, packages/mcp-server/src/services/{camelot.ts,dj-engine.ts,metadata/*} e packages/mcp-server/src/tools/dj-tools.ts.

Contexto:
- Fase M concluída: o store (~/.spotify-dj-mcp/analysis.json) tem 436 de 557 faixas da Eletro. 22 são do Mixar; 414 vieram da ReccoBeats, com BPM conferido e tom [A VALIDAR] nas notas.
- O Mix do app do Spotify não tem API: o usuário aplica as transições à mão, seguindo o guia.
- Sem áudio não há estrutura por compasso: nada de drop swap, veto de vocal ou veto de grave neste prompt.

PARTE A — Sprint 0
1. Remova o GetSongBPM (D29): o cliente, o fallback em lookup.ts, o parâmetro no merge, a GETSONGBPM_API_KEY do .env.example e as menções em README e CLAUDE.md. HttpDeps e RateLimitError, que moram em getsongbpm.ts, vão para um lugar que a ReccoBeats use. Testes sem rede continuam verdes.
2. Aviso de tom: dj_build_set e dj_evaluate_order passam a listar, nos avisos, as faixas do set com "[A VALIDAR] tom" nas notas ("N faixas com tom a confirmar no Mixar: …").
3. Me peça a lista de presets do Mix do app do Spotify (eu leio no app e colo aqui). Grave em packages/mcp-server/src/services/mix-presets.ts, com nome e uma linha do que cada um faz. Não invente preset: sem a minha lista, o guia usa só a descrição genérica (tipo, comprimento, quando trocar o grave).
4. Commit "refactor(mcp): single metadata source, key-review warnings (D29)".

PARTE B — Sprint 1
5. services/planner.ts, funções puras, planner_version "meta-1". Entrada: TrackAnalysis de A e de B e a direção do set (sobe, estável, desce). Saída: TransitionPlan sem estrutura, no formato do CLAUDE.md, com out/in/automation vazios ou omitidos e com os campos type, length_bars, tempo, harmonic, confidence, alerts e reason (em português). Regras v1 (seção 5 das regras de negócio da EAP). Antes de codar, rode o gate de regras de negócio do feature-builder comigo: são regras v1 e quero confirmar os limites.
6. Ferramenta transition_plan(from_track, to_track, direction?): mostra o plano e a explicação.
7. Ferramenta export_mix_guide(track_ids | set em JSON): texto por passagem. Cada passagem traz o preset do Mix mais próximo (da lista do item 3), o comprimento em compassos, quando trocar o grave e os alertas (tom a confirmar, BPM distante).
8. dj_build_set e dj_evaluate_order passam a trazer o plano de cada passagem. Um par que só aceita cut ou echo recebe penalidade na nota; o peso é uma constante nomeada em constants.ts.
9. Testes: planner.ts com os casos de cada regra (tabela de A → B esperado), guia com e sem lista de presets, penalidade no montador. npm test verde.
10. Rode no set atual da Eletro (docs/sets/dj-mix-eletro.md): plano válido para todos os pares consecutivos. Registre o resultado num ADR 0005 curto.
11. Commit "feat(mcp): metadata transition planner and Mix guide (phase P)".

Critério de aceite:
- git log com os 2 commits; npm test verde.
- transition_plan e export_mix_guide funcionando no Claude Desktop, depois de rebuildar o MCP.
- Plano para todos os pares consecutivos do set da Eletro, cada um com tipo, comprimento e motivo.
- Nenhuma escrita em playlist do Spotify; analysis.json intacto.

Não faça:
- Criar código em apps/web ou apps/server.
- Inventar nome de preset do Mix.
- Chamar o Jev.

Termine com um resumo curto e a linha "Sincronizar o quadro do projeto: <lista do que mudou em docs/>".
```
