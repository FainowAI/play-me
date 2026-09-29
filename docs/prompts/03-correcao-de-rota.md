# Prompt 03 — Correção de rota: MVP por metadados

Cole no Claude Code aberto em `C:\Users\Antônio\Desktop\Play.me`. `design/DESIGN.md`, `design/telas-mvp.md`, `design/telas/` (telas do canvas) e `design/ds/` (componentes do design system) já estão nas versões novas no repositório. Atualizado em 29/09/2026 com a D23.

```
Leia antes: CLAUDE.md, docs/decisoes.md, docs/decisions/0001-ambiente.md, design/DESIGN.md (seções 1 e 4.1) e design/telas-mvp.md.

Por que a rota muda:
- A Fase 0 (prompt 02) parou no meio: services/analyzer/analyzer/decode.py e grid.py existem sem commit, sem numpy no pyproject e sem testes; PyTorch e Beat This! não foram instalados; não há fixture sintética nem docs/decisions/0002; ffmpeg ainda não está no WSL.
- Comprar os arquivos é inviável (cerca de R$ 8 por faixa; a playlist tem 527 faixas). Sem arquivo não há análise de áudio.
- Nova rota (D22): o MVP funciona só com metadados. BPM e tom de todas as faixas vêm da API do GetSongBPM e da API pública do Deezer, cruzadas com o Mixar já salvo. A análise de áudio (Beat This! e extratores) vira trilha opcional, só para faixas com arquivo, fora do caminho crítico.
- Continuam valendo: D01; D03 (nunca inventar, divergência vira [A VALIDAR]); D04 (nenhum áudio de fora, e isso inclui as prévias de 30 s do Deezer e do iTunes: não baixar, não analisar); D05 quando houver áudio.
- As decisões D16 a D19 já registradas por você continuam. As novas começam em D20.
- As telas saem do Google Stitch (D23): a fonte é o canvas "Play.Me · Telas do MVP", com cópia em design/telas/. Isso contraria a D09 e o CLAUDE.md atual; o ADR 0003 registra a troca.

PARTE A — Fechar a Fase 0 sem perder trabalho
1. Adicione numpy às dependências de services/analyzer/pyproject.toml. Não instale torch nem beat_this.
2. Crie tests/test_decode.py: gera 2 s de seno com ffmpeg num arquivo temporário e confere sample rate, duração (±0,01 s) e sha256. Usa pytest.skip quando o ffmpeg não está instalado.
3. Crie tests/test_grid.py só para a parte pura de grid.py (grid_from_beats): beats sintéticos a 124 BPM com downbeat a cada 4 → BPM 124 ±0,5, tempo_drift ≈ 0 e compassos com índice começando em 1. Nada que carregue o modelo.
4. mypy strict sem torch e beat_this instalados: em pyproject, [[tool.mypy.overrides]] com module = ["torch", "beat_this.*"] e ignore_missing_imports = true. pytest, ruff e mypy passam.
5. No topo de docs/prompts/02-fase-0-grade.md, acrescente: "Status: suspenso em 28/09/2026 (D22). decode.py e grid.py prontos e testados na parte pura; falta rodar o Beat This! com 10 arquivos próprios." Não apague o resto.
6. Commit "chore(analyzer): keep decoder and grid, suspend phase 0 (D22)".

PARTE B — Documentar a nova rota
7. Crie docs/decisions/0002-mvp-por-metadados.md (ADR):
   - Contexto: custo dos arquivos; a Fase 0 depende deles.
   - Decisão: MVP por metadados; análise de áudio opcional.
   - Alternativas descartadas: comprar as faixas (custo); prévias de 30 s do Deezer/iTunes e o dataset GiantSteps (áudio de terceiros, fora da D04); conversores de streaming (termos e D04).
   - Consequências: sem estrutura por compasso no MVP, as transições são planejadas por BPM, tom e energia, e o Mix do Spotify faz o alinhamento na hora; nome e artista das faixas saem da máquina para GetSongBPM e Deezer; o GetSongBPM exige backlink público; o tom tem uma fonte só.
   - Seção "Resultados" vazia (preenchida na parte D).
   Crie também docs/decisions/0003-telas-no-canvas.md (ADR curto): contexto (D09 previa o Stitch; as telas foram feitas no canvas do Claude com os componentes reais do design system); decisão (canvas é a fonte; cópia em design/telas/, componentes em design/ds/; Stitch sai); consequências (sem Stitch MCP; o Claude Code lê os .dc.html como referência de layout e implementa em React com os tokens do DESIGN.md; design/stitch/ é removido).
8. docs/decisoes.md:
   - D20 | 28/09/2026 | Orb de pensamento da biblioteca thinking-orbs (MIT), encapsulado no AgentOrb: único movimento contínuo da UI, mapa atividade → estado (DESIGN.md 4.1). | Pedido do usuário; MIT, canvas 2D leve, segue data-theme e prefers-reduced-motion.
   - D21 | 28/09/2026 | Telas do MVP aprovadas (design/telas-mvp.md): chat único com painel do set versionado; Início, Conversa, Analisando, Set proposto, Aprovação, Enviado + guia do Mix, Transição expandida, Faixa, Configurações. | Fluxo simples e maleável como Claude e ChatGPT.
   - D22 | 28/09/2026 | MVP por metadados; análise de áudio vira trilha opcional (ADR 0002). | Comprar 527 faixas é inviável.
   - D23 | 29/09/2026 | Telas no canvas "Play.Me · Telas do MVP" (cópia em design/telas/), no lugar do Google Stitch; revisa a D09 (ADR 0003). | Decisão do usuário; o canvas já usa os componentes do design system.
   - Pendentes: mantenha P02, P04 e P05. P03 passa a "v1 = chat + BPM e tom por metadados + set + transições por metadados com guia do Mix + aprovação". Acrescente P09 "Onde fica o backlink público do GetSongBPM".
   - Próximo passo: Parte D deste prompt → Fase P.
9. CLAUDE.md, só nas seções que mudam:
   - Fluxo: o passo 2 lê também o ISRC; novo passo "Metadados: GetSongBPM + Deezer + Mixar"; os passos de casamento, Beat This!, extratores e Jev ficam marcados como opcionais (só com arquivo).
   - Fases, nesta ordem: Fase M — Metadados (agora); Fase P — Planejador por metadados (TransitionPlan sem estrutura: tipo e comprimento por BPM, tom e energia, mais o guia do Mix); Fase C — Chat (apps/server com Agent SDK e apps/web com as telas da D21); Fase K — Calibração com as notas de transição; Trilha de áudio (opcional, quando houver arquivos): antigas Fases 0 a 3.
   - MCP: ferramentas novas: acrescente metadata_lookup e metadata_coverage.
   - Interface (D23): troque "desenhado no Google Stitch" por "telas no canvas (design/telas/)"; na árvore, remova design/stitch/ e acrescente design/telas/ e design/ds/; na stack, "Design da UI" passa a "Canvas do Claude → design/telas/ + DESIGN.md → Claude Code"; a seção "Design no Google Stitch" vira "Design no canvas": o React implementa lendo design/telas/*.dc.html como referência de layout e design/ds/ como referência de componentes; o DESIGN.md segue como fonte dos tokens.
   - Estado atual: reflita a nova rota.
10. .env.example: GETSONGBPM_API_KEY= (vazio). README.md da raiz: seção "Fontes de dados" com link para https://getsongbpm.com (backlink exigido pela API).
11. Remova design/stitch/ (só tem .gitkeep) com git rm. Commit "docs: route change to metadata-first MVP (D20–D23, ADRs 0002–0003)".

PARTE C — Fase M no MCP (packages/mcp-server)
12. spotify-client: inclua o ISRC (external_ids.isrc) no resumo da faixa. Não persista metadados do Spotify (regra atual do analysis-store).
13. src/services/metadata/:
   - getsongbpm.ts: busca por artista + título. Antes de tipar, confira parâmetros e campos em https://getsongbpm.com/api com uma chamada real. Chave em GETSONGBPM_API_KEY. Limite de 3.000 requisições por hora: fila com no máximo 1 requisição a cada 1,5 s; em erro de limite, pare e informe.
   - deezer.ts: GET https://api.deezer.com/track/isrc:<ISRC> → bpm (0 = sem dado). Sem chave. Confira o formato na documentação do Deezer. O campo preview é ignorado: nenhuma chamada baixa ou toca áudio.
   - Cache em ~/.spotify-dj-mcp/metadata-cache.json, chave = id da faixa no Spotify + provedor. Não guarde nome nem artista do Spotify no cache.
   - merge.ts, funções puras:
     a) Entrada com source spotify-mixar, rekordbox, serato, traktor, ouvido ou manual nunca é sobrescrita.
     b) BPM: GetSongBPM e Deezer concordam em ±1 (ou metade/dobro) → média arredondada, source "web". Só uma fonte → salva com notes "[A VALIDAR] BPM de fonte única (<provedor>)". Divergem → salva o do GetSongBPM com notes "[A VALIDAR] BPM diverge: GetSongBPM X, Deezer Y".
     c) Tom: só o GetSongBPM traz; normalize com parseKey de camelot.ts; notes "tom de fonte única (GetSongBPM)". Sem tom, a faixa não entra no store (ele exige tom) e vai para pendências.
     d) Sem BPM em nenhuma fonte → pendência. Nunca inventar.
     e) danceability do GetSongBPM, quando vier, entra em notes como apoio à energia. Energia continua estimativa do Claude.
14. Ferramentas MCP novas:
   - metadata_lookup(playlist | track_ids, limit?, dry_run = true): mostra, por faixa, o que cada fonte trouxe e o que seria salvo. Só grava com dry_run=false.
   - metadata_coverage(playlist): contagem por origem (mixar, web, [A VALIDAR], pendente) e lista de pendências.
15. Testes sem rede: merge.ts com os casos a–e; clientes com fetch simulado. npm test passa.
16. Commit "feat(mcp): metadata lookup via GetSongBPM and Deezer (phase M)".

PARTE D — Validação
17. Me peça a GETSONGBPM_API_KEY (eu cadastro em getsongbpm.com/api) e coloque no .env. Não siga sem ela.
18. Faça uma cópia de ~/.spotify-dj-mcp/analysis.json antes de rodar qualquer coisa.
19. metadata_lookup com dry_run=true nas faixas da Eletro que já têm Mixar em analysis.json. Compare com o Mixar: BPM (±1 ou metade/dobro) e tom (exato; relativa e ±1 contados à parte).
20. metadata_lookup com dry_run=true nas primeiras 50 faixas da Eletro para medir cobertura (BPM, tom, [A VALIDAR], pendentes).
21. Registre os números na seção Resultados do ADR 0002 e faça commit "docs: phase M validation results".

Critério de aceite:
- git log com os 4 commits; npm test, pytest, ruff e mypy verdes.
- Entre as faixas com Mixar que o lookup encontrou, BPM confere em pelo menos 90%.
- Acerto de tom e cobertura das 50 faixas registrados no ADR 0002 (sem meta: são o dado para decidir o P03).
- analysis.json idêntico à cópia do passo 18 (nada gravado ainda; nenhuma entrada do Mixar alterada).
- Nenhum arquivo de áudio baixado e nenhuma chamada a endpoint de prévia.

Não faça:
- Gravar no store a playlist inteira: isso fica para depois que eu ver os números.
- Instalar PyTorch, Beat This!, Essentia ou Demucs.
- Criar código em apps/web ou apps/server.

Termine com um resumo curto e a linha "Sincronizar o quadro do projeto: <lista do que mudou em docs/>".
```
