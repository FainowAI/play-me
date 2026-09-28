# Prompt 02 — Fase 0: protótipo da grade (Beat This!)

Cole no Claude Code aberto em `C:\Users\Antônio\Desktop\Play.me`, depois que o prompt 01 estiver concluído e aceito.

```
Leia CLAUDE.md, docs/decisoes.md, docs/decisions/0001-ambiente.md e docs/pesquisa-tecnica.md (seção 4) antes de começar.

Objetivo: Fase 0 — validar o Beat This! como fonte única da grade de tempo.

Contexto do ambiente:
- Windows com WSL2 (Ubuntu). O analisador roda no WSL2.
- Tenho [GPU NVIDIA: sim/não — preencher].
- Pasta com as 10 faixas de teste: [caminho — preencher]. São faixas da playlist Eletro com BPM e Camelot conhecidos pelo Mixar do Spotify.

Tarefas:
1. Use o esqueleto de services/analyzer criado no prompt 01. Adicione PyTorch (CPU ou CUDA conforme 0001-ambiente.md) e as dependências do Beat This!.
2. Implemente analyzer/decode.py: ffmpeg → PCM 44,1 kHz mono, sha256 do arquivo e duração.
3. Implemente analyzer/grid.py com Beat This! (checkpoint final0, sem DBN):
   - beats, downbeats, compassos (índice, início, fim)
   - BPM = mediana dos intervalos entre beats
   - tempo_drift = desvio padrão relativo dos intervalos
   - exporte .beats para o Sonic Visualiser
4. Crie um CLI: `python -m analyzer.grid <pasta> --out data/phase0/` que gera um JSON por faixa e um relatório CSV com: arquivo, BPM, tempo_drift, nº de compassos, primeiro downbeat.
5. Teste com fixture sintética: gere um clique de metrônomo a 124 BPM com acento no tempo 1 (30 s) e verifique BPM ±0,5 e downbeats nos acentos. Nenhuma música comercial no repositório.
6. Compare o BPM do relatório com os valores de referência que vou colar abaixo e mostre a diferença por faixa.

Critério de aceite:
- BPM a ±1 do Mixar em pelo menos 9 das 10 faixas.
- Eu confiro os downbeats de 3 faixas no Sonic Visualiser com os arquivos .beats.

Não implemente nada das fases seguintes. Ao terminar, registre em docs/decisions/0002-grade-beat-this.md o resultado e qualquer ajuste necessário, acrescente a decisão em docs/decisoes.md e termine com a linha "Sincronizar o quadro do projeto: <lista do que mudou em docs/>".

Referência (faixa — BPM — Camelot do Mixar):
- Adored — J. Worra — 126 — 9A
- Lonesome — Charlotte de Witte — 124 — 5A
- Like I Like It — Mau P — 128 — 4B
- Moon Rocks — Enrico Sangiuliano — 125 — 2A
- Deceiver (VIP) — Chris Lake, Green Velvet — 124 — 2A
- Level One — Boris Brejcha — 125 — 4A
- Freak — GENESI, MEDUZA — 128 — 1B
- Paranoia — JUNTARO — 130 — 12A
- You Were Right — RÜFÜS DU SOL — 122 — 4B
- Science Fiction — Brunello — 127 — 10B
```

Troque a lista de referência se as 10 faixas que você tiver em arquivo forem outras. Os valores de todas as faixas da Eletro estão salvos no MCP (`dj_evaluate_order` ou `spotify_get_playlist_tracks` mostram).
