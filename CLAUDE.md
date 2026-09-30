# Play.Me (DJ Mix Builder)

Sistema local que transforma playlists do Spotify em sets de DJ. O usuário conversa com o sistema numa interface estilo chat (como o ChatGPT, adaptada para DJ). Por trás, o Claude opera via Claude Agent SDK na máquina do usuário, lê a playlist, usa a análise de áudio (Beat This! + extratores) e as decisões rápidas do Jev (TypeSafe) para propor a ordem e as transições. O usuário aprova no chat e só então a playlist nova é criada no Spotify.

Uso pessoal, single-user, roda na máquina do usuário (Windows + WSL2). Pasta local: `C:\Users\Antônio\Desktop\Play.me`.

**Destino do set (D14):** no MVP, o set termina numa playlist nova e privada no Spotify, com um guia de transições para aplicar no Mix do app do Spotify. Depois do MVP, o set passa a tocar dentro do próprio Play.Me, com as transições renderizadas.

## Fluxo do produto

```
1. Usuário pede no chat: "monta um set da Eletro, warm up até peak time"
2. Spotify API  → lê a playlist (IDs, ISRC, nomes)
3. Metadados    → BPM e tom: Mixar salvo > ReccoBeats (por ID do Spotify); tom da web vira [A VALIDAR]
4. Casamento    → (opcional, só com arquivo) cada faixa ↔ arquivo local (ISRC, fingerprint, fuzzy)
5. Beat This!   → (opcional, só com arquivo) grade: beats, downbeats, compassos
6. Extratores   → (opcional, só com arquivo) tom, energia por banda, vocal, seções, frases, cues
7. Jev          → (opcional) decisões tipadas e rápidas sobre as features: tipo de transição,
                  nota de compatibilidade por par, pontos de entrada/saída, vetos
8. Claude       → monta a ordem e a narrativa do set, explica cada transição no chat
9. Usuário      → revisa no chat (ordem, cards de transição) e aprova
10. Spotify API → cria playlist nova e privada "[DJ MIX] <nome>" (só após aprovação)
```

MVP por metadados (D22, ADR 0002): as etapas 4–7 são a trilha de áudio, opcional e fora do caminho crítico. Faixa sem arquivo usa só metadados e é marcada como "sem análise de áudio" no chat. Nenhum áudio de fora, nem prévia de 30 s (D04).

**Quadro do projeto (fonte central):** https://claude.ai/artifact/JEd8bN1irubJJigj5nKziX
Toda documentação, planejamento, decisão e set gerado vive no quadro. O Claude Code não publica no quadro: ao criar ou mudar qualquer documento do repositório (`CLAUDE.md`, `docs/*`), registre a mudança em `docs/decisoes.md` e avise ao final da tarefa que o quadro precisa ser sincronizado. A sincronização é feita no projeto "DJ Mix Builder" do Claude.

Pesquisa completa, com fontes: `docs/pesquisa-tecnica.md`. Registro de decisões: `docs/decisoes.md`. Leia antes de decisões de arquitetura.

---

## Regras invioláveis

1. **Nenhum áudio vem do Spotify.** Não escrever código que baixe, grave, capture, decodifique ou "ripe" áudio do Spotify, nem que contorne DRM. O áudio vem só de arquivos locais que o usuário possui (Beatport, Bandcamp, Traxsource, CD etc.). O Spotify serve apenas como catálogo (IDs, ISRC, playlists) e como destino de playlists novas.
2. **Nunca alterar playlists existentes do Spotify.** Só criar playlists novas e privadas. Nenhuma ferramenta reordena, edita ou apaga playlist existente.
3. **O Beat This! é a única fonte da grade de tempo.** Nenhum outro componente define beats ou downbeats. Seções e cues de outras ferramentas são encaixadas no downbeat mais próximo da grade do Beat This!.
4. **Tudo é indexado por compasso.** Energia, vocal, seção, candidatos a cue e automação de transição usam índice de compasso, não segundos soltos.
5. **Nunca inventar dado.** BPM, tom e seções saem da análise ou de override manual. Campo sem dado fica nulo e o planejador trata como incerteza.
6. **Segredos fora do código.** Tokens em `~/.spotify-dj-mcp/`, config em `.env` (fora do git). Fluxo OAuth PKCE, sem Client Secret.
7. **Aprovação explícita antes do Spotify.** A ferramenta que cria playlist passa por um gate de permissão do Agent SDK que só libera com clique de aprovação na UI.
8. **Jev recebe só features.** Nada de áudio e, de preferência, nada de metadado do Spotify (nome, artista): só IDs internos e números da análise. Reduz exposição aos termos do Spotify sobre IA e o volume enviado para fora da máquina.
9. **Toda decisão do Jev tem fallback determinístico.** Se o Jev estiver indisponível, sem acesso ou com confiança baixa, o planejador de regras decide.
10. **Análise idempotente e versionada.** Chave de cache = sha256 do arquivo + versão do analisador. Mudou modelo ou parâmetro, sobe a versão e reanalisa só o que precisa.

---

## Estrutura do repositório

```
Play.me/
├─ CLAUDE.md
├─ docs/
│  ├─ pesquisa-tecnica.md
│  ├─ decisoes.md             # registro de decisões (espelhado no quadro)
│  ├─ prompts/                # prompts para o Claude Code, em ordem (01-fundacao, 02-fase-0-grade…)
│  ├─ sets/                   # sets gerados (ordem, notas, pontos fracos)
│  └─ decisions/              # ADRs curtos, um por decisão
├─ apps/
│  ├─ web/                    # UI estilo chat para DJ — telas em design/telas/ (D23)
│  └─ server/                 # backend local Node/TS: Claude Agent SDK + SSE para a UI + gate de aprovação
├─ packages/
│  └─ mcp-server/             # spotify-dj-mcp-server (TypeScript) — já existe, será ampliado
├─ services/
│  └─ analyzer/               # Python 3.11+, FastAPI, roda no WSL2 ou Docker
│     ├─ analyzer/
│     │  ├─ api.py            # FastAPI local em 127.0.0.1:8765
│     │  ├─ decode.py         # ffmpeg → PCM, hash do arquivo
│     │  ├─ grid.py           # Beat This! → beats, downbeats, compassos, BPM, drift
│     │  ├─ loudness.py       # EBU R128 integrado + por compasso
│     │  ├─ bands.py          # energia low/mid/high por compasso + peaks para a UI
│     │  ├─ key.py            # Essentia KeyExtractor (bgate, edma) + CNN do madmom → voto + confiança
│     │  ├─ tonal.py          # clareza tonal por compasso (força do HPCP)
│     │  ├─ stems.py          # Demucs → atividade de vocal/baixo/bateria por compasso
│     │  ├─ structure.py      # allin1 (opcional) ou novidade por autossimilaridade → seções → frases
│     │  ├─ cues.py           # candidatos a entrada e saída (regras de switch point)
│     │  ├─ embeddings.py     # Discogs-EffNet → estilo, similaridade (licença NC, ver abaixo)
│     │  ├─ energy.py         # nota de energia 1–10 por compasso e por faixa
│     │  ├─ jev/              # cliente TypeSafe: monta state + questions, lê confiança, fallback
│     │  ├─ planner/          # planejador de transição (regras + decisões do Jev)
│     │  ├─ render.py         # prévia renderizada da transição
│     │  └─ export/           # rekordbox_xml.py, m3u.py, mix_guide.py
│     └─ tests/
├─ design/
│  ├─ DESIGN.md               # design system Play.Me (fonte da UI)
│  ├─ playme-tokens.css       # tokens: cor, tipo, espaço, raio, movimento (dark e light)
│  ├─ telas/                  # cópia do canvas "Play.Me · Telas do MVP" (.dc.html + canvas.json)
│  └─ ds/                     # componentes do design system (referência para o React)
└─ data/                      # gitignored: dj.sqlite, cache de análise, stems, prévias
```

---

## Stack

| Camada | Tecnologia |
|---|---|
| Orquestração | Claude Agent SDK (TypeScript) rodando local em `apps/server`, autenticado por API key da Anthropic |
| Decisões rápidas | Jev (TypeSafe AI, System One model) via API na nuvem — early access |
| MCP | TypeScript, `@modelcontextprotocol/sdk`, zod, stdio |
| Analisador | Python 3.11+, FastAPI, uvicorn, SQLite (via SQLAlchemy ou sqlite3), fila simples em processo |
| Grade | Beat This! (CPJKU, MIT) |
| Estrutura | allin1 (MIT) — opcional; fallback librosa/novidade |
| Tom | Essentia KeyExtractor (AGPLv3) + madmom CNN key |
| Stems | Demucs (htdemucs) |
| Loudness | pyloudnorm ou Essentia LoudnessEBUR128 |
| Embeddings | Essentia Discogs-EffNet (modelos CC BY-NC, só uso não comercial) |
| Matching | mutagen (tags/ISRC), Chromaprint `fpcalc` + AcoustID, fuzzy título/artista/duração |
| Render | pedalboard (GPLv3) + Rubber Band para time-stretch |
| Export | pyrekordbox ou ElementTree para Rekordbox XML |
| Metadados (MVP) | ReccoBeats (BPM e tom pelo ID do Spotify, em lote), com o Mixar como verdade (ADR 0004, D29); cache em `~/.spotify-dj-mcp/metadata-cache.json` |
| Design da UI | Canvas do Claude → `design/telas/` + DESIGN.md → Claude Code |
| UI | React, Vite, TypeScript, Tailwind; chat com streaming (SSE); canvas próprio para forma de onda em 3 bandas |

### Licenças que importam

- Essentia é AGPLv3 e vários modelos pré-treinados são CC BY-NC (não comercial). pedalboard e Rubber Band são GPL. Para uso pessoal, sem problema. **Se um dia virar produto, trocar esses componentes ou licenciar antes.** Beat This!, allin1 e Demucs são MIT.

---

## Ambiente (Windows)

- Analisador roda no **WSL2 (hoje Ubuntu 22.04 + Python 3.12 via uv; ver `docs/decisions/0001-ambiente.md`)** ou em **Docker**. O essentia-tensorflow não publica wheel para Windows; o allin1 exige compilar o NATTEN no Windows.
- GPU NVIDIA com CUDA acelera muito Demucs e allin1. Sem GPU, funciona, mas a análise de centenas de faixas leva horas: processar em fila, em segundo plano.
- MCP e UI podem rodar no Windows nativo e falar com o analisador em `http://127.0.0.1:<porta>`.
- Caminhos de arquivo: guardar o caminho Windows original e o caminho WSL (`/mnt/c/...`) na tabela de arquivos.

---

## Modelo de dados (SQLite)

```
spotify_tracks(spotify_id PK, isrc, name, artists_json, duration_ms, fetched_at)
local_files(id PK, sha256 UNIQUE, path_win, path_wsl, format, duration_s, isrc_tag, title_tag, artist_tag, added_at)
track_matches(spotify_id, local_file_id, method[isrc|fingerprint|fuzzy|manual], confidence, confirmed BOOL)
analyses(local_file_id, analyzer_version, status, error, created_at)            -- uma linha por versão
grid(local_file_id, bpm, bpm_confidence, tempo_drift, first_downbeat_s, beats_blob, downbeats_blob)
bars(local_file_id, bar_index, start_s, end_s, lufs, e_low, e_mid, e_high, tonal_clarity,
     vocal_activity, bass_activity, drums_activity, energy_score, section_id)
key_estimates(local_file_id, method, camelot, confidence)                        -- uma por estimador
track_key(local_file_id, camelot, confidence, source[vote|mixar|manual])
sections(id PK, local_file_id, start_bar, end_bar, label, source)
phrases(local_file_id, start_bar, length_bars)                                   -- 8/16/32
cue_candidates(local_file_id, kind[in|out], bar_index, score, reasons_json)
style_tags(local_file_id, tag, score)
transition_plans(id PK, from_file_id, to_file_id, plan_json, planner_version, score, created_at)
transition_feedback(plan_id, rating 1-5, notes, created_at)                       -- calibração futura
sets(id PK, name, curve, created_at)
set_items(set_id, position, local_file_id, spotify_id, transition_plan_id)
overrides(local_file_id, field, value_json, created_at)                           -- Mixar, ouvido, correção manual
jev_calls(id PK, purpose, state_hash, questions_json, answers_json, min_confidence, latency_ms, created_at)
decisions(id PK, subject_type, subject_id, decision, value_json, source[jev|rules|claude|user], confidence, jev_call_id)
chat_sessions(id PK, agent_session_id, title, created_at, updated_at)
approvals(id PK, chat_session_id, action, payload_json, status[pending|approved|rejected], decided_at)
```

Regra: `overrides` sempre vence a análise automática na leitura.

---

## Pipeline do analisador (por arquivo)

1. **decode**: ffmpeg → PCM 44,1 kHz; sha256; duração. Se `sha256 + analyzer_version` já existe, pula.
2. **grid**: Beat This! → beats e downbeats. BPM = mediana dos intervalos entre beats. `tempo_drift` = variação dos intervalos (alto = bateria ao vivo/rock; o planejador prefere transições curtas nesses casos).
3. **bars**: compassos a partir dos downbeats.
4. **loudness**: LUFS integrado e por compasso.
5. **bands**: energia por compasso em três bandas (grave < 150 Hz, médio 150 Hz–2,5 kHz, agudo > 2,5 kHz) e peaks por banda para a forma de onda da UI.
6. **key**: KeyExtractor (bgate e edma) + CNN do madmom → voto com confiança; tom por seção para detectar modulação.
7. **tonal**: clareza tonal por compasso. Compassos só de percussão têm clareza baixa e permitem mixar tons incompatíveis.
8. **stems**: Demucs → atividade de vocal, baixo e bateria por compasso.
9. **structure**: seções (allin1 ou novidade) encaixadas na grade → frases de 8/16/32 compassos.
10. **cues**: candidatos a entrada (fim da intro/primeira frase com bateria) e saída (início do outro ou breakdown), pontuados pelas regras de switch point: fronteira de seção, alta novidade, seção seguinte que se sustenta sozinha.
11. **embeddings**: estilo e vetor de similaridade.
12. **energy**: nota 1–10 por compasso e por faixa, combinando LUFS, energia de grave, densidade de onsets e presença de bateria; calibrada por percentil da biblioteca do usuário.

Cada etapa grava seu resultado e pode falhar isoladamente sem derrubar as outras.

---

## Planejador de transição

### Entrada
Análise completa de A e de B, direção do set (energia subindo, estável, descendo) e preferência de estilo de transição.

### Saída (`TransitionPlan`)

```json
{
  "from": "local_file_id_A",
  "to": "local_file_id_B",
  "type": "blend | bass_swap | filter | echo_out | cut | drop_swap",
  "length_bars": 16,
  "out": { "start_bar": 97, "section": "outro" },
  "in":  { "start_bar": 1,  "section": "intro" },
  "tempo": { "from_bpm": 124.0, "to_bpm": 125.0, "strategy": "match_incoming | match_outgoing | ramp" },
  "harmonic": { "from": "8A", "to": "9A", "relation": "adjacente +1", "class": "segura" },
  "automation": {
    "volume_out": [[0, 1.0], [12, 1.0], [16, 0.0]],
    "volume_in":  [[0, 0.0], [4, 1.0], [16, 1.0]],
    "low_out":    [[0, 1.0], [8, 1.0], [8, 0.0]],
    "low_in":     [[0, 0.0], [8, 0.0], [8, 1.0]],
    "mid_out": [], "mid_in": [], "high_out": [], "high_in": [],
    "filter_out": [], "filter_in": []
  },
  "checks": { "vocal_overlap": false, "double_bass": false, "phrase_aligned": true, "fits_outro": true },
  "confidence": 0.82,
  "reason": "texto curto em português"
}
```

Pontos de automação: `[compasso relativo ao início da transição, ganho 0..1]`. Filtro: `[compasso, frequência de corte normalizada 0..1]`.

### Regras (v1, explícitas; calibrar depois com `transition_feedback`)

- **Blend longo (16–32 compassos) com bass swap**: tom seguro (mesmo, ±1, relativa), diferença de BPM ≤ 3, mesmo estilo, sem vocal nas duas pontas.
- **Bass swap curto (8–16)**: compatível, mas com vocal em uma das pontas. A troca de grave cai na fronteira de frase.
- **Filtro (passa-alta na saída, 4–8)**: tom arriscado, mas a entrada de B tem clareza tonal baixa (só percussão).
- **Echo out ou corte seco (1–4)**: choque harmônico com conteúdo tonal nas duas pontas, BPM com diferença > 6, ou `tempo_drift` alto.
- **Drop swap**: B entra no drop enquanto A está no breakdown; só com tom seguro e energia subindo.
- **Rampa de tempo**: diferença entre 3 e 8 % de BPM, distribuída ao longo de 16–32 compassos.

### Vetos (a transição é recusada ou encurtada)

- Vocal ativo nas duas faixas no mesmo compasso por mais de 1 compasso.
- Grave cheio nas duas faixas no mesmo compasso (`low` > 0,5 nas duas).
- Início de entrada ou saída fora de fronteira de frase.
- Transição maior que o outro de A ou a intro de B.

### Nota do par (reaproveita o motor atual do MCP)
35 % Camelot, 25 % BPM, 25 % energia, 10 % estilo, 5 % progressão, mais um termo novo de **viabilidade estrutural** (existe par de cues compatível sem veto). Par sem transição viável recebe penalidade forte no montador de set.

---

## Jev (TypeSafe AI) — camada de decisão

**O que é:** modelo "System One" da TypeSafe AI, lançado em 15/09/2026 em early access. Não gera texto: recebe um `state` (texto/JSON) e `questions` tipadas, e devolve respostas tipadas com probabilidade e confiança, todas avaliadas em paralelo numa chamada (70–500 ms). Três primitivas: **Choice** (escolhe uma opção de uma lista, até 255), **Score** (nota numa rubrica) e **Noul** (probabilidade de uma afirmação ser verdadeira). Roda na nuvem da TypeSafe; custo por token de entrada, saída gratuita. Docs: https://docs.typesafe.ai

**O que ele NÃO faz:** não ouve áudio. Não substitui Beat This!, Essentia ou Demucs. A própria TypeSafe indica que ele não é bom em tarefas de raciocínio longo, domínios muito especializados ou geração. Por isso: perguntas atômicas, features numéricas bem descritas no `state`, e validação contra o planejador de regras.

**Onde entra no fluxo:** entre os extratores e o Claude, para as decisões repetitivas e em volume:

| Decisão | Primitiva | Exemplo de pergunta |
|---|---|---|
| Tipo de transição A → B | Choice | "Qual transição: blend, bass_swap, filter, echo_out, cut, drop_swap?" |
| Compatibilidade do par | Score | "Nota 1–5 para mixar A em B dado BPM, Camelot, energia e estilo" |
| Ponto de entrada em B | Choice | "Em qual destas frases candidatas B deve entrar?" |
| Veto | Noul | "Há sobreposição de vocal no trecho proposto?" |
| Seção | Choice | "Este bloco de compassos é intro, build, drop, breakdown ou outro?" |

Com 137 faixas são ~18 mil pares ordenados: Jev pontua em lote; Claude trabalha só sobre os melhores candidatos.

**Contrato no código (`services/analyzer/analyzer/jev/`):**
- Monta `state` só com IDs internos e features numéricas (BPM, Camelot, energia por compasso, vocal por compasso, seções, clareza tonal).
- Cada resposta é gravada com `confidence`. Abaixo do limiar configurado (`JEV_MIN_CONFIDENCE`), usa a decisão do planejador de regras e marca `source = rules`.
- Chave `TYPESAFE_API_KEY` só no `.env` do backend. Nunca no front, nunca no git.
- Registrar cada chamada (questions, answers, confidence, latência) em `jev_calls` para calibração.

**Validar na primeira sprint de Jev:** acesso liberado (early access), endpoint e SDK oficiais (usar só `typesafe.ai` / `docs.typesafe.ai`; ignorar domínios não oficiais que aparecem em guias), concordância com o planejador de regras em 20 pares conhecidos.

---

## Orquestração e interface

**Backend local (`apps/server`, Node/TS):**
- Claude Agent SDK: o mesmo loop, ferramentas, MCP, permissões e sessões do Claude Code, como biblioteca. Autenticação por **API key da Anthropic** (a documentação não permite login do claude.ai em apps de terceiros sem aprovação). Custo por uso da API.
- MCPs carregados: `spotify-dj` (existente) + ferramentas do analisador (HTTP local).
- Gate de aprovação: `spotify_create_playlist_from_order` exige permissão. O pedido de permissão vira um card "Enviar ao Spotify?" na UI; só o clique libera.
- Streaming das respostas para a UI via SSE. Sessões persistidas para retomar conversas.

**Interface (`apps/web`) — chat de DJ:**
- Layout estilo ChatGPT: histórico de conversas à esquerda, chat no centro, painel do set à direita.
- Mensagens do Claude com componentes ricos: card de faixa (BPM, Camelot, energia, status de análise), card de transição (duas ondas em 3 bandas alinhadas por compasso, comprimento, tipo, curvas de volume/EQ/filtro, botão de prévia), curva de energia do set.
- Ações rápidas: "reordenar", "trocar faixa", "mais energia aqui", "enviar ao Spotify".
- Card de aprovação antes de criar a playlist.

**Design no canvas (D23, ADR 0003):**
- O design system existe em `design/DESIGN.md` e `design/playme-tokens.css`. As telas vêm do canvas "Play.Me · Telas do MVP", com cópia em `design/telas/`; os componentes, em `design/ds/`. Lista e fluxo das telas: `design/telas-mvp.md` (D21).
- Canvas: https://claude.ai/artifact/52ejbuCbMrXoM7fyfs8ayK. Design system: https://claude.ai/artifact/MNHQn2dmZhJa4XCUwPWbxn.
- **As telas do canvas são a especificação da `apps/web` (D31).** O React implementa lendo `design/telas/*.dc.html` como referência de layout. Os componentes são os reais do design system (`design/ds/components`, React, tipos em `index.d.ts`), portados para TSX, não redesenhados. O `DESIGN.md` segue como fonte dos tokens; a UI não inventa cor, fonte ou espaçamento fora dele.
- `design/telas-referencia.md` é o guia de construção: componentes, dados, ferramentas e pacote da EAP por tela, mais as divergências entre o canvas e as decisões (nelas, valem as decisões).

---

## Execução das transições

**MVP:** playlist `[DJ MIX]` no Spotify + guia de transições por passagem (compassos, preset do Mix mais próximo, quando trocar o grave), mostrado no card de transição do chat.
**Pós-MVP (ordem prevista):** 1 → render do set tocando no app; 2 → export Rekordbox; 3 → motor em tempo real.

1. **Prévia renderizada** (`render.py`): trecho de A e B com time-stretch (Rubber Band) e EQ/filtro/volume (pedalboard) seguindo o plano. Gera WAV local para ouvir na UI. Nunca distribuir.
2. **Export Rekordbox XML**: beatgrid (`TEMPO`) e cues de entrada/saída (`POSITION_MARK`) + playlist na ordem do set. Import de XML só adiciona e atualiza; não remove.
3. **Guia para o Mix do Spotify**: texto por transição (compassos, preset mais próximo, quando trocar o grave). A API não aplica transições; o usuário ajusta no app. O beatgrid do Spotify pode divergir.

---

## MCP: ferramentas novas

Manter as 11 atuais. Adicionar (as de metadados chamam as APIs direto; as demais leem do analisador via HTTP local e pertencem à trilha de áudio):

| Ferramenta | Função |
|---|---|
| `metadata_lookup` | (Fase M) Busca BPM e tom na ReccoBeats; mostra o que ela trouxe e o que seria salvo; só grava com `dry_run=false` |
| `metadata_coverage` | (Fase M) Cobertura de uma playlist por origem: Mixar, web, [A VALIDAR], pendente |
| `library_match_status` | Quantas faixas de uma playlist têm arquivo local casado e análise pronta |
| `library_match_confirm` | Confirma ou corrige um casamento Spotify ↔ arquivo |
| `analysis_request` | Enfileira análise de faixas com arquivo local |
| `analysis_get_track` | Resumo da análise: BPM, tom + confiança, seções, frases, cues, mapa de vocal, energia |
| `transition_plan` | Gera `TransitionPlan` para A → B |
| `transition_render_preview` | Renderiza a prévia e devolve o caminho local |
| `set_build_deep` | Monta o set usando a viabilidade estrutural das transições |
| `export_rekordbox_xml` | Exporta set, beatgrid e cues |
| `export_mix_guide` | Gera o guia de transições para o Mix do Spotify |

O MCP nunca roda análise pesada dentro do processo stdio.

---

## Feedback e calibração

- Notas de 1 a 5 por transição, dadas no card de transição do chat, gravadas em `transition_feedback`.
- Comparação periódica entre decisões do Jev, do planejador de regras e as notas do usuário.

---

## Fases

> EAP e roadmap oficiais: `docs/eap_play-me_fainow.md` (29/09/2026). Sprint 0 e 1 = Fase P; Sprint 2 e 3 = Fase C; Sprint 4 = Fase K.

Cada fase fecha com critério de aceite verificável. Não pular.

- **Fase M — Metadados (concluída em 29/09).** BPM e tom pela ReccoBeats, com o Mixar como verdade (`metadata_lookup`, `metadata_coverage`; ADR 0004). Eletro gravada: 436 de 557 faixas (22 Mixar, 414 web); tom da web fica [A VALIDAR].
- **Fase P — Planejador por metadados (concluída em 29/09, ADR 0005).** `TransitionPlan` sem estrutura, em TypeScript no MCP (D30): tipo e comprimento por BPM, tom e energia, mais o guia do Mix. Falta confirmar presets do Mix além de Fade e Rise.
- **Próximo: Fase C, Sprint 2 (prompt 05).**
- **Fase C — Chat.** `apps/server` com Agent SDK e `apps/web` com as telas da D21.
- **Fase K — Calibração.** Ajustar regras e pesos com as notas de `transition_feedback`.
- **Trilha de áudio (opcional, quando houver arquivos):** antigas Fases 0 a 3 — protótipo da grade (Beat This!, suspenso em 28/09, ver prompt 02), casamento, análise básica, análise profunda.

---

## Convenções

- TypeScript `strict`, sem `any`. Python com type hints, `ruff` e `mypy`, testes em `pytest`.
- Textos para o usuário em português brasileiro. Código, identificadores e commits em inglês.
- Toda análise tem teste com um arquivo curto de fixture gerado sinteticamente (clique de metrônomo em BPM conhecido), nunca música comercial no repositório.
- Uma decisão de arquitetura nova vira ADR em `docs/decisions/`, entra em `docs/decisoes.md` e no quadro do projeto.
- Antes de mexer em limites da API do Spotify, conferir a documentação atual: ela muda com frequência.

## Estado atual

- Rota por metadados (D22, D24). Fases M e P concluídas; próximo: prompt 05 (Fase C, servidor). Escopo, prazo, estados do set e Jev fechados nas D25 a D30; EAP em `docs/eap_play-me_fainow.md`.
- `packages/mcp-server`: cópia do MCP em uso (original em `Desktop\mcps\spotify-dj-mcp-server`, que segue ativo no Claude Desktop). 15 ferramentas: as 11 originais (OAuth PKCE, análise manual do Mixar, montador de set por busca em feixe, criação de playlist `[DJ MIX]` privada), `metadata_lookup` e `metadata_coverage` (Fase M), `transition_plan` e `export_mix_guide` (Fase P, ADR 0005).
- Store do MCP (`~/.spotify-dj-mcp/analysis.json`): 436 faixas da Eletro (22 do Mixar, 414 da ReccoBeats). Entrada do Mixar nunca é sobrescrita. Backup anterior à gravação: `analysis.backup-2026-09-29.json`.
- `services/analyzer`: `decode.py` e `grid.py` prontos e testados na parte pura; Beat This! e PyTorch não instalados (trilha de áudio suspensa). ffmpeg ainda não está no WSL.
- Jev: chave no `.env`; acesso e SDK validados na Sprint 4 (D28).
- UI: telas aprovadas no canvas (D21, D23), cópia em `design/telas/`. Nenhum código de front ainda (Fase C).
- Nome do software: Play.Me. Design system pronto em `design/DESIGN.md` e `design/playme-tokens.css` (critérios de aceite da UI na seção 9 do DESIGN.md).
