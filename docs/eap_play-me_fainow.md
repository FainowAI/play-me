# EAP e roadmap — Play.Me (DJ Mix Builder)

| | |
|---|---|
| Tipo | MVP de Produto (ferramenta local de uso pessoal com agente) |
| Prazo | Sprint 0 curto + 4 sprints de 1 semana: 30/09/2026 a 30/10/2026 |
| Stack | Node/TS (MCP `spotify-dj`, `apps/server` com Claude Agent SDK), React + Vite + TS + Tailwind (`apps/web`), SQLite local, ReccoBeats + Spotify Web API. Analisador Python só na trilha de áudio (opcional). |
| Data | 29/09/2026 |
| Gerado por | `eap-project-planner`, com o briefing fechado pelas recomendações aceitas em 29/09 ("siga com todas as recomendações") |

## Resumo executivo

Play.Me é um chat local de DJ: você pede um set de uma playlist do Spotify, o Claude monta a ordem com BPM, tom e energia, explica cada passagem e entrega um guia para o Mix do app do Spotify. Nada vai ao Spotify sem o seu clique: só então a playlist nova e privada `[DJ MIX] …` é criada. O diferencial é planejar o set como um DJ (harmonia, BPM, curva de energia) sem precisar dos arquivos de áudio. BPM e tom vêm de metadados (ReccoBeats, D24), e o Mixar continua a verdade do tom.

Estado de partida: Fase M concluída. O store tem 436 de 557 faixas da Eletro com BPM e tom (22 do Mixar, 414 da ReccoBeats). O MCP tem 13 ferramentas. `apps/server` e `apps/web` ainda estão vazios.

## Briefing consolidado (Fase 0)

Discovery formal não foi feito. A pesquisa técnica (`docs/pesquisa-tecnica.md`) e o registro de decisões fizeram esse papel. Por isso o escopo se apoia em briefing verbal, com risco de retrabalho um pouco maior.

| Bloco | Fechado como | Fonte |
|---|---|---|
| A · Identidade | Play.Me (DJ Mix Builder), sistema local com agente | D12 |
| B · Problema e usuário | Montar sets com fluidez de DJ a partir do Spotify. Usuário único: você. Hoje: Mixar à mão, prints e busca de BPM. | Quadro |
| C · Escopo do v1 | Chat + BPM e tom por metadados + set + transições por metadados com guia do Mix + aprovação → playlist no Spotify. Fora do v1: trilha de áudio, prévia renderizada, export Rekordbox, editor de curvas, motor em tempo real, set tocando no app. | D25 (fecha P03) |
| D · Regras | Harmonia, BPM, energia, aprovação antes do Spotify. Estados do set: rascunho → aguardando aprovação → enviado. | D27 (fecha P05) |
| E · Integrações | Spotify (app criado, PKCE). ReccoBeats (sem chave). Claude API (chave no `.env`). Jev: chave no `.env`, acesso validado na Sprint 4. GetSongBPM sai. Volume: Eletro 557 faixas, 2026 137. | D24, D28, D29 |
| F · Visual e UX | Chat estilo ChatGPT para DJ, telas no canvas (D21, D23), DESIGN.md (Cabine dark, acento signal, Geist), português, desktop com gavetas abaixo de 1100 px | D13, D20, D21, D23 |
| G · Prazo e equipe | Você + Claude Code. Sprint 0 de 3 dias e 4 sprints de 1 semana, validação no fim de cada sprint. | D26 (fecha P04) |
| H · Pós-entrega | Uso pessoal, single-user. As licenças NC/GPL (Essentia, pedalboard) ficam aceitáveis. Pós-MVP: set tocando no app, render das transições, export Rekordbox. | D27, D10, D14 |

## Classificação (Fase 1)

MVP de Produto, 4 a 5 semanas. Estratégia MVP-first: o planejador por metadados (Fase P) roda primeiro dentro do MCP e já é usável no Claude Desktop. Depois vêm o servidor local e a UI (Fase C), e por fim a calibração com as suas notas e o Jev (Fase K). Riscos críticos: tom da web pouco confiável, dependência da ReccoBeats, Mix do Spotify sem API.

## EAP em 3 níveis (Fase 2)

Legenda: ✅ feito · ⬜ a fazer.

```
0. Play.Me — MVP por metadados
  1. Biblioteca e metadados
    1.1 Busca e gravação de BPM e tom
      1.1.1 ✅ Cliente ReccoBeats em lote + conversão para Camelot
      1.1.2 ✅ Merge com regras D24 + cache sem dados do Spotify
      1.1.3 ✅ Ferramentas metadata_lookup e metadata_coverage
      1.1.4 ✅ Gravar a Eletro no store (436/557)
    1.2 Fonte única de metadados
      1.2.1 ✅ Remover o cliente GetSongBPM, a chave e o fallback (D29)
      1.2.2 ✅ Ajustar testes, textos das ferramentas e docs
    1.3 Tom a validar visível
      1.3.1 ✅ Aviso nas saídas de set: faixas com tom [A VALIDAR]
  2. Planejador de transições (Fase P)
    2.1 TransitionPlan por metadados
      2.1.1 ⬜ Regras puras em planner.ts (tipo, comprimento, tempo, harmonia, alertas) + testes
      2.1.2 ⬜ Ferramenta transition_plan (A → B)
    2.2 Guia do Mix
      2.2.1 ⬜ Catalogar os presets do Mix do app do Spotify (você lista no app)
      2.2.2 ⬜ Ferramenta export_mix_guide: texto por passagem
    2.3 Set com viabilidade de transição
      2.3.1 ⬜ Plano por passagem em dj_build_set e dj_evaluate_order, com penalidade para par só com cut/echo
  3. Montagem e versões do set
    3.1 Persistência local
      3.1.1 ⬜ Schema SQLite (sets, versões, planos, notas, aprovações, sessões)
      3.1.2 ⬜ Repositório de sets e versões no apps/server
    3.2 Estados do set
      3.2.1 ⬜ Máquina de estados rascunho → aguardando aprovação → enviado
    3.3 Versões
      3.3.1 ⬜ Nova versão a cada ajuste pedido no chat
  4. Chat de DJ — servidor (Fase C)
    4.1 Agente local
      4.1.1 ⬜ apps/server: Agent SDK + MCP spotify-dj
      4.1.2 ⬜ Streaming SSE para a UI
      4.1.3 ⬜ Sessões persistidas e retomáveis
  5. Chat de DJ — interface (Fase C) · especificação: canvas + design/telas-referencia.md (D31)
    5.1 Shell
      5.1.1 ⬜ Vite + React + Tailwind com tokens do DESIGN.md; componentes reais do design system portados para TSX
      5.1.2 ⬜ Sidebar, coluna do chat, composer, AgentOrb (D20)
    5.2 Telas do fluxo (D21)
      5.2.1 ⬜ Início e Conversa (ThinkingStatus, ToolCall)
      5.2.2 ⬜ Set proposto + SetPanel (ordem, curva de energia, transições)
      5.2.3 ⬜ Transição expandida e gaveta da Faixa
      5.2.4 ⬜ Configurações (conexões, tema, pesos)
  6. Aprovação e envio ao Spotify
    6.1 Gate
      6.1.1 ⬜ Permissão do Agent SDK para spotify_create_playlist_from_order
      6.1.2 ⬜ Card ApprovalGate + endpoint aprovar/rejeitar
    6.2 Envio
      6.2.1 ⬜ Tela Enviado + aba Guia do Mix; status enviado com link
  7. Calibração e Jev (Fase K)
    7.1 Notas
      7.1.1 ⬜ Nota 1–5 por transição (transition_feedback)
    7.2 Jev
      7.2.1 ⬜ Validar acesso e SDK oficial (typesafe.ai)
      7.2.2 ⬜ Cliente com fallback de regras e registro de chamadas
      7.2.3 ⬜ Concordância Jev × regras × suas notas em 20 pares
    7.3 Ajuste
      7.3.1 ⬜ Recalibrar regras e pesos com as notas
```

Fora da EAP do MVP (backlog): trilha de áudio (Fases 0 a 3 antigas: Beat This!, extratores, casamento de arquivos), prévia renderizada, export Rekordbox, set tocando no app, busca e comandos (⌘K), biblioteca em lote.

## Roadmap de sprints (Fase 3)

| Sprint | Datas | Work packages | Entregável | Depende de |
|---|---|---|---|---|
| Sprint 0 · Fonte única e base da Fase P | 30/09 a 02/10 | 1.2.1, 1.2.2, 1.3.1, 2.2.1 | MCP só com ReccoBeats; sets avisam tom a validar; catálogo de presets do Mix | Fase M (feita) |
| Sprint 1 · Fase P | 05/10 a 09/10 | 2.1.1, 2.1.2, 2.2.2, 2.3.1 | No Claude Desktop: set da Eletro com plano e guia do Mix por passagem | Sprint 0, catálogo de presets |
| Limpeza pós-Sprint 1 | 09/10 (0,5 dia) | `codebase-cleanup` no MCP | Só código do escopo | Sprint 1 |
| Sprint 2 · Fase C (servidor) | 12/10 a 16/10 | 3.1.1, 3.1.2, 3.2.1, 4.1.1, 4.1.2, 4.1.3, 6.1.1 | Conversa com o agente via HTTP; set salvo em rascunho; gate bloqueando a criação da playlist | Sprint 1 |
| Sprint 3 · Fase C (interface) | 19/10 a 23/10 | 5.1.1, 5.1.2, 5.2.1 a 5.2.4, 6.1.2, 6.2.1, 3.3.1 | Fluxo ponta a ponta no navegador: pedir set, ajustar, aprovar, playlist criada, guia do Mix | Sprint 2 |
| Limpeza pós-Sprint 3 | 23/10 (0,5 dia) | `codebase-cleanup` em apps/ | Sem telas ou rotas fora do escopo | Sprint 3 |
| Sprint 4 · Fase K | 26/10 a 30/10 | 7.1.1, 7.2.1 a 7.2.3, 7.3.1, critérios de aceite da UI (DESIGN.md §9) | Notas gravadas; Jev comparado em 20 pares (se o acesso confirmar); MVP fechado | Sprint 3 |

Marcos: fim do Sprint 1 = set planejado no Claude Desktop; fim do Sprint 3 = MVP usável; fim do Sprint 4 = MVP calibrado.

## Schema local (Fase 4)

O store de análises continua sendo o `analysis.json` do MCP (BPM, tom, fonte, notas). O `apps/server` guarda o resto em SQLite (`data/playme.sqlite`, fora do git). Recomendação: `node:sqlite`, embutido no Node 24, sem dependência nova. Se a API dele se mostrar instável na versão instalada, trocar por `better-sqlite3`, decisão a tomar no prompt 05. Uso local e single-user: sem RLS nem auth. IDs em `TEXT` com `crypto.randomUUID()`.

```sql
CREATE TABLE chat_sessions (
  id TEXT PRIMARY KEY,
  agent_session_id TEXT,              -- id de sessão do Agent SDK, para retomar
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sets (
  id TEXT PRIMARY KEY,
  chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id),
  name TEXT NOT NULL,                 -- ex.: "[DJ MIX] Eletro"
  curve TEXT NOT NULL,                -- classic | peak_time | warm_up | sunrise
  status TEXT NOT NULL DEFAULT 'rascunho'
    CHECK (status IN ('rascunho', 'aguardando_aprovacao', 'enviado')),
  spotify_playlist_id TEXT,           -- só depois de enviado
  spotify_url TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE set_versions (
  id TEXT PRIMARY KEY,
  set_id TEXT NOT NULL REFERENCES sets(id),
  version INTEGER NOT NULL,
  order_json TEXT NOT NULL,           -- IDs do Spotify na ordem; nome/artista não são guardados
  note TEXT,                          -- o pedido que gerou a versão ("mais energia no meio")
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (set_id, version)
);

CREATE TABLE transition_plans (
  id TEXT PRIMARY KEY,
  set_version_id TEXT NOT NULL REFERENCES set_versions(id),
  position INTEGER NOT NULL,          -- passagem N → N+1
  from_track TEXT NOT NULL,
  to_track TEXT NOT NULL,
  plan_json TEXT NOT NULL,            -- TransitionPlan por metadados
  planner_version TEXT NOT NULL,
  score REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE transition_feedback (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES transition_plans(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  chat_session_id TEXT NOT NULL REFERENCES chat_sessions(id),
  set_id TEXT REFERENCES sets(id),
  action TEXT NOT NULL,               -- ex.: spotify_create_playlist_from_order
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`jev_calls` e `decisions` entram na Sprint 4, só se o acesso ao Jev confirmar (7.2).

## Prompts de kickstart (Fase 5)

Os prompts ficam em arquivos próprios, prontos para colar no Claude Code aberto em `Play.me`:

| Prompt | Arquivo | Sprint | EAP |
|---|---|---|---|
| 04 · Fase P: planejador por metadados | `docs/prompts/04-fase-p-planejador.md` | 0 e 1 | 1.2, 1.3, 2.1, 2.2, 2.3 |
| 05 · Servidor local com Agent SDK | `docs/prompts/05-fase-c-servidor.md` | 2 | 3.1, 3.2, 4.1, 6.1.1 |
| 06 · Interface do chat | `docs/prompts/06-fase-c-interface.md` | 3 | 5.1, 5.2, 6.1.2, 6.2, 3.3 |

A Sprint 4 (Fase K) vira prompt 07 depois da Sprint 3, com o `feature-builder`: ele lê o código que existir, em vez de supor.

## Regras de negócio consolidadas

Alimentam os gates do `feature-builder` e a seção de regras do `CLAUDE.md`.

1. **Spotify:**
   - Nunca alterar playlist existente; só criar nova e privada, depois de aprovação explícita na UI (D01, regra 7).
   - Nenhum áudio vem do Spotify nem de terceiros (D04). As prévias de 30 s também ficam fora.
2. **BPM e tom:**
   - Nunca inventar BPM, tom ou seção (D03). Faixa sem dado fica pendente.
   - O Mixar (e qualquer fonte do usuário) nunca é sobrescrito. BPM da ReccoBeats é conferido; tom da web é sempre [A VALIDAR] (D24).
3. **Estados do set** (D27):
   - `rascunho` → `aguardando_aprovacao` quando você pede o envio.
   - `aguardando_aprovacao` → `enviado` só depois do clique de aprovação e da criação da playlist.
   - `aguardando_aprovacao` → `rascunho` quando você rejeita ou pede ajuste.
   - `enviado` é final. Um ajuste depois do envio cria uma nova versão em rascunho, e um novo envio cria uma nova playlist; a enviada nunca é editada (D01).
4. **Versões:** todo ajuste pedido no chat gera uma nova versão do set, e a anterior fica guardada.
5. **Transições por metadados:** regras v1, a validar no gate do prompt 04.
   - Blend longo (16–32 compassos) quando a harmonia é segura e a diferença de BPM ≤ 3.
   - Filtro (4–8) quando a harmonia é arriscada e a diferença de BPM ≤ 6.
   - Echo out ou corte (1–4) quando há choque harmônico ou diferença de BPM > 6.
   - Rampa de tempo quando a diferença de BPM fica entre 3 % e 8 %.
   - Tom [A VALIDAR] em qualquer ponta: confiança menor e alerta "confirme o tom no Mixar".
   - Sem estrutura por compasso, não há drop swap nem veto de vocal ou grave no MVP.
6. **Jev** (D07, D28): recebe só IDs internos e números. Toda decisão tem fallback de regras; abaixo de `JEV_MIN_CONFIDENCE`, vale a regra.
7. **Segredos** só no `.env` (fora do git). Nome e artista das faixas não vão ao Jev.

## Riscos

| Risco | Mitigação |
|---|---|
| Tom da web errou em 8 de 11 faixas comparadas com o Mixar | Tom sempre [A VALIDAR]; aviso no set (1.3.1); conferir no Mixar as faixas escolhidas antes de enviar; as notas da Sprint 4 recalibram o peso do Camelot |
| ReccoBeats pode sair do ar e não publica o limite de uso | Cache local; 429 interrompe o lote sem perder o que já foi gravado; o store já tem 436 faixas |
| O Mix do Spotify não tem API: as transições são aplicadas à mão no app | Guia por passagem com o preset mais próximo e o ponto da troca (2.2); catálogo de presets feito por você no app, sem inventar nomes |
| Jev em early access | Planejador de regras entrega o MVP sozinho; Jev entra só na Sprint 4 e só se o acesso confirmar |
| Custo da Claude API no apps/server | Uso pessoal; sessões curtas; o planejador e o montador são determinísticos no MCP, e o Claude só conversa e explica |

## Próximos passos — ciclo de vida do projeto

### Sequência de execução pós-planejamento
1. ⬜ Colar `docs/prompts/04-fase-p-planejador.md` no Claude Code (Sprint 0 e 1).
2. ⬜ Rodar `codebase-cleanup` no MCP.
3. ⬜ Prompt 05 (Sprint 2), depois prompt 06 (Sprint 3).
4. ⬜ Rodar `codebase-cleanup` em `apps/`.
5. ⬜ Sprint 4 com o `feature-builder` (Fase K).

### Visão do ciclo completo
1. ✅ Discovery (pesquisa técnica + registro de decisões, no lugar do `product-discovery`)
2. ✅ Planejamento (este documento)
3. ✅ Fundação (prompt 01) e Fase M (prompt 03)
4. ⬜ Fase P (Sprint 0 e 1)
5. ⬜ Limpeza
6. ⬜ Fase C (Sprint 2 e 3)
7. ⬜ Fase K (Sprint 4)
