# apps/web — chat de DJ

React 19 + Vite 8 + TypeScript strict + Tailwind 4 (Sprint 3, Fase C, D31). Construída tela por tela a partir do canvas "Play.Me · Telas do MVP" (`design/telas/*.dc.html`, guia em `design/telas-referencia.md`), com os componentes reais do design system portados para TSX em `src/components/playme/` e todos os valores de cor, tipo, espaço e raio vindos de `design/playme-tokens.css` (critérios de aceite na seção 9 do `design/DESIGN.md`).

- Fala só com o `apps/server` em `http://127.0.0.1:8787` (SSE no chat; nenhuma chave passa pelo navegador).
- Vite serve em `http://127.0.0.1:5173` (porta fixa: é a única origem que o servidor aceita).
- Tema Cabine (dark) padrão; Dia (light) em Configurações, persistido no navegador.
- Movimento: só o orb de pensamento (`thinking-orbs`, MIT) é contínuo; hover 120 ms, abrir 200 ms, reordenar 400 ms (View Transitions nas faixas do set); `prefers-reduced-motion` desliga tudo.

```
npm run build                      # MCP + server + web
npm run start -w @playme/server    # servidor local (precisa de ANTHROPIC_API_KEY no .env)
npm run dev -w @playme/web         # http://127.0.0.1:5173
```

Estrutura: `src/types.ts` (API v2), `src/api.ts` (fetch + SSE), `src/state.ts` (reducer), `src/setview.ts` (leituras do set), `src/shell/` (sidebar, chat, Início, camadas), `src/panel/` (painel do set, Transição expandida, Faixa, Configurações), `src/components/playme/` (design system). Check da lógica pura: `npm run test:ui -w @playme/web`.
