# Prompt 06 — Fase C: interface do chat

Sprint 3 da EAP (`docs/eap_play-me_fainow.md`), work packages 5.1, 5.2, 6.1.2, 6.2 e 3.3. Rode depois do prompt 05 aceito.

```
Use o /feature-builder.

Leia antes: design/telas-referencia.md (guia de construção, tela por tela, com as divergências canvas × decisões), design/DESIGN.md (inteiro; a seção 9 traz os critérios de aceite da UI), design/playme-tokens.css, design/telas-mvp.md, design/telas/*.dc.html (layout), design/ds/components (bundle.js, bundle.css, index.d.ts: os componentes reais), CLAUDE.md (Interface) e os endpoints de apps/server.

Contexto:
- As telas são as do canvas "Play.Me · Telas do MVP" (D21, D23). A cópia em design/telas/ é a referência de layout; o DESIGN.md é a fonte dos tokens. A UI não inventa cor, fonte nem espaçamento.
- O orb de pensamento (thinking-orbs, MIT) é o único movimento contínuo, encapsulado no AgentOrb (DESIGN.md 4.1).

Tarefas:
1. apps/web: Vite + React + TS strict + Tailwind, com os tokens de playme-tokens.css. Tema Cabine (dark) padrão e Dia (light) opcional.
   Componentes: porte os 15 do design system (design/ds/components/bundle.js) para TSX em apps/web/src/components/playme/, com as props de index.d.ts e as classes de bundle.css. Não redesenhe nem crie look-alikes. Construa cada tela pelo canvas (design/telas/*.dc.html). Onde o texto diverge das decisões, siga a tabela "Divergências" de telas-referencia.md.
2. Shell: Sidebar (264 px), coluna do chat (720 px), SetPanel (400 px, só quando existe set). Abaixo de 1100 px o painel vira gaveta; abaixo de 720 px, a sidebar também.
3. Telas da D21, na ordem do fluxo:
   - Início.
   - Conversa, com ThinkingStatus e ToolCall; o nome da ferramenta escolhe o estado do orb.
   - Set proposto + SetPanel (abas Ordem · Transições · Guia do Mix; curva de energia).
   - Transição expandida (janela de 820 px).
   - Faixa (gaveta de 520 px), mostrando a fonte de cada dado: Mixar, ReccoBeats ou estimativa; tom da web com StatusTag "A validar".
   - Configurações.
4. Aprovação: card ApprovalGate quando o SSE emitir a approval pendente. Aprovar e rejeitar chamam POST /api/approvals/:id. Depois do envio: tela Enviado com o link da playlist e a aba Guia do Mix.
5. Versões: o SetPanel mostra a versão atual e permite voltar a ver as anteriores (só leitura).
6. Critérios de aceite da UI (DESIGN.md §9), medidos e não a olho: contraste com a opacidade dos ancestrais, sem overflow em 1100 e 720 px, prefers-reduced-motion respeitado, título e metadados do documento corretos.
7. Commit "feat(web): DJ chat UI with set panel and approval gate (phase C)".

Critério de aceite:
- Fluxo ponta a ponta no navegador: pedir um set da Eletro, ajustar ("mais energia no meio"), aprovar, ver a playlist [DJ MIX] criada e o guia do Mix.
- Rejeitar volta o set para rascunho, sem criar playlist.
- Nenhuma cor, fonte ou espaçamento fora do DESIGN.md.

Não faça:
- Spinner, barra indeterminada ou "Pensando…" genérico (DESIGN.md 4.1).
- Prévia de áudio, player ou forma de onda (pós-MVP).
- Emojis na interface.
```
