# 0003 — Telas no canvas, no lugar do Google Stitch

Data: 29/09/2026 · Decisão D23 · Revisa a D09

## Contexto

A D09 previa desenhar as telas no Google Stitch e levá-las ao Claude Code pelo Stitch MCP. As telas do MVP acabaram feitas no canvas do Claude ("Play.Me · Telas do MVP", https://claude.ai/artifact/52ejbuCbMrXoM7fyfs8ayK), já com os componentes reais do design system Play.Me.

## Decisão

- O canvas é a fonte das telas. Cópia dos arquivos em `design/telas/` (`.dc.html` + `canvas.json`); componentes em `design/ds/`.
- O Google Stitch sai do projeto.

## Consequências

- Sem Stitch MCP. O Claude Code lê `design/telas/*.dc.html` como referência de layout e `design/ds/` como referência de componentes, e implementa em React com os tokens do `DESIGN.md` (que segue como fonte dos tokens).
- `design/stitch/` é removido.
