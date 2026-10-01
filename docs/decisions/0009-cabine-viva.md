# 0009 — Cabine viva: pensamento ao vivo, movimento, status real e sets sem repetir faixas (Sprint 5)

Data: 30/09/2026 · Decisões D41, D42, D43, D44

## Contexto

QA no Chrome depois da Sprint 4, a pedido do usuário: o Jev aparecia amarelo mesmo com a API respondendo (a tela só sabia se a chave existia); o agente trabalhava em silêncio (nenhum pensamento, texto só no fim do turno); os sets levavam o título cru da conversa; "1h30" dava 103 min (P13); o agente passava o nome da playlist a ferramentas que pediam id (P14); a cobertura de metadados nunca aparecia. O usuário pediu também mais movimento (orbs da biblioteca thinking-orbs, modais, saídas dos agentes) e identidade visual. No fechamento, apontou que os sets "sempre vêm com as mesmas músicas".

## Decisão

- **Movimento (D41):** vocabulário único em `apps/web/src/motion.css` (uma linha por animação no topo do arquivo; resumo no DESIGN.md §4.2): entrada escalonada dos itens do chat e do painel, pílulas de ferramenta, crossfade do orb ao trocar de atividade (com `speed` por atividade e 64 px com anel no Início), camadas com entrada e saída (gaveta desliza, janela faz fade + scale; `Overlay.closeRef` para os botões Fechar/Cancelar), arco do set desenhado com gradiente de energia, indicadores deslizantes (anchor positioning), ponto do wordmark e tag "Aguardando aprovação" pulsando. Contínuo só enquanto o agente trabalha ou algo espera o DJ; `prefers-reduced-motion` desliga tudo. Revisa a regra "única animação contínua" do DESIGN.md §4.
- **Pensamento ao vivo (D42):** extended thinking do Haiku 4.5 com orçamento `PLAYME_THINKING_TOKENS` (padrão 1024, piso 1024) e `display: "summarized"` — sem ele o bloco vem vazio e sem erro; `includePartialMessages` para os deltas. Eventos novos `thinking_delta`, `text_delta` (só ao vivo, não gravados) e `thinking` (bloco final, gravado no turno). Na tela: bloco "Pensamento" aberto enquanto chega e fechado depois, rascunho da resposta com cursor, `ThinkingStatus` de 32 px no topo da resposta até o fim do turno, desvanecendo 200 ms ao terminar. Se a API recusar o pensamento antes de qualquer evento, o turno é refeito sem ele.
- **Status real e nome (D43):** `jev-status.ts` faz `ping()` no start e a cada 30 min (verde só quando a API responde; `Status.jev = { key, connected, model }`); o set que ainda leva o título cru da conversa passa a "<playlist> · <curva>" ao montar (curva em português no cabeçalho e no painel); P13 fechada (corte da última faixa enquanto a soma passa do alvo + meia faixa); P14 fechada (`resolvePlaylistId` aceita id, URI, link ou nome nas 8 ferramentas que leem playlist); o prompt pede `metadata_coverage` antes do primeiro `dj_build_set` da playlist.
- **Sets sem repetir faixas (D44, P17):** com `duration_minutes` ou `max_tracks`, o servidor preenche `avoid` no `canUseTool` com as faixas da última versão dos 3 últimos sets do DJ (`Repo.recentTrackIds`; o set atual da conversa não conta, a menos que já tenha sido enviado; `avoid` vindo do agente, inclusive `[]`, vale como veio). O MCP (`avoidRecent`) só tira as faixas se sobrarem pelo menos metade das analisadas e 10 faixas; o resultado traz `avoided` e um aviso. Sem tamanho pedido o set é a playlist inteira ordenada e nada sai.

## Resultados

Verificação em 30/09/2026:

| Teste | Resultado |
|---|---|
| Build e testes | `tsc` limpo nos três workspaces; 8 suítes verdes (MCP: engine com `avoidRecent`, jev, metadata, planner, stdio de ponta a ponta com playlist pelo nome; servidor: repo com `recentTrackIds`, agent com gate/avoid/pensamento/streaming/nome do set, http com status do Jev) e 3 checks da web (reducer com pensamento e rascunho, painel com curva em português, texto da shell com `jevState`) |
| Pensamento (smokes reais do servidor) | Três turnos reais: pensamento + texto em streaming, pensamento + ferramenta, retomada de sessão antiga — nenhum 400; `display: "summarized"` obrigatório (sem ele, blocos vazios). Custo dos smokes: US$ 0,003–0,012 por turno (~US$ 0,07 no total) |
| Jev | `GET /api/status` → `jev: { key: true, connected: true, model: "jev-1.13.0" }`; na tela, sidebar "Jev · conectado · jev-1.13.0" e card do Início "Jev conectado", ambos verdes |
| Tela (Chrome) | Início com orb de 64 px e anel; sidebar com "Eletro · peak time"; cabeçalho mono "20 faixas · 92 min · 123–128 BPM · 3A → 3B · curva peak time"; painel com arco desenhado e "curva peak time"; blocos "Pensamento" gravados no turno |
| Repetição de faixas (dados do banco) | Dois sets da Eletro (436 faixas analisadas, curvas diferentes) tinham 9 de 20 faixas em comum; com a mesma curva o resultado é idêntico (seleção determinística) |
| P17 ao vivo (servidor real, `POST /api/chat`) | "Monte um set da playlist Eletro, 1 hora, peak time": `metadata_coverage` antes (Mixar 22 · web 414 · pendentes 121), `dj_build_set` com 60 min → 14 faixas · 62 min; **0 faixas em comum** com cada um dos 3 últimos sets (antes: 9/20), aviso "41 faixa(s) de sets recentes ficaram fora (avoid)". 47 s, US$ 0,030, 272 `thinking_delta` + 314 `text_delta` no stream |
| Uso real do usuário (01/10) | "Quero montar uma playlist de techno, leia minha playlist de eletro…": o agente escolheu "[DJ MIX] Eletro" (set já enviado) como fonte, montou 11 faixas por `track_ids` sem tamanho e o set ficou "Set · clássica"; Jev consultado e playlist criada com aprovação na tela (4 turnos, US$ 0,26). Virou a P18: regra no prompt ("[DJ MIX]" é saída, não fonte); tamanho padrão e nome sem playlist ficam em aberto |

A conferir ao vivo no navegador (o Chrome só responde com a janela visível, e o usuário estava usando o app durante o QA): a saída animada das camadas pelos botões Fechar/Cancelar e o orb desvanecendo ao fim do turno (conferidos pelo coder em Chrome headless com mock, não pelo lead).

## Consequências

- Os parâmetros da D44 (3 sets, metade do pool, mínimo 10) são um primeiro corte; ajustar com uso. Repetir faixas de propósito exige o DJ pedir (o agente passa `avoid: []`). A D44 só vale com tamanho pedido: sem duração/quantidade o agente ainda escolhe por `track_ids` ou ordena a playlist inteira, e aí repete (P18, aberto: tamanho padrão).
- Dois sets podem ficar com o mesmo nome ("Eletro · peak time" duas vezes): a sidebar distingue só pela ordem. Sufixo com data ou contagem fica para quando incomodar.
- O `canUseTool` virou o lugar de completar a chamada do agente com o que só o servidor sabe (histórico); a mesma porta serve para as notas (7.3.1) quando a ferramenta de recalibrar existir.
- Sprint 6 (P15 gênero/estilo da faixa, P16 Jev escolhendo a ordem) depende de duas decisões do usuário: chave de busca web (Tavily/Serper ou Last.fm) e aprovar o modo "Jev escolhe o próximo".
- As quatro trilhas paralelas deixaram vãos de contrato (classe sem o DOM exato, `playlist` mudando de significado, saída animada sem dono em `App.tsx`): o contrato da próxima sprint lista os ganchos com o DOM e os consumidores de cada campo que muda.
