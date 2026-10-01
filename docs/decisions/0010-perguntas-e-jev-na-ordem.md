# 0010 — Perguntas antes de montar e Jev na ordem (Sprint 6)

Data: 01/10/2026 · Decisões D45, D46 · Fecha P16 e P18

## Contexto

No uso real, o agente montava sets de ~10 faixas por conta própria quando o pedido não dizia o tamanho, escolhia a playlist errada ("[DJ MIX] Eletro", um set já enviado, como fonte) e só consultava o Jev quando o usuário pedia. O usuário pediu (01/10): o Jev calculando tudo em todo set, sem teto de faixas, e uma janela de perguntas como a do Claude Code quando faltar informação. Decisões dele (AskUserQuestion): tamanho pulado = playlist inteira; o Jev escolhe a ordem e as passagens; a janela pergunta tamanho, curva, abertura/fechamento e playlist de origem; em set longo o Jev decide todos os passos, sem teto.

## Decisão

- **Perguntas (D45):** ferramenta `ask_dj` num servidor MCP em processo (`playme`, criado por turno com acesso ao contexto do turno; nome completo `mcp__playme__ask_dj`). Ela emite o evento `questions` (1 a 4 perguntas, 2 a 4 opções, `allow_other`), espera a resposta do DJ e devolve ao agente `{ status: "answered" | "skipped", answers }`. Rota `POST /api/questions/:id` (200; 400 corpo inválido; 404 id fora do formato; 409 sem ninguém esperando). O evento gravado no turno sai com `status` e `answers` finais; abort do turno = `skipped`; SDK caindo com a pergunta aberta = `expired`. Na tela: janela com uma pergunta por vez, "1 de N", opções numeradas com a recomendada primeiro, "Outra opção" e "Pular"; teclado 1–4, Enter e Esc; no chat, a linha com as respostas. Gatilho (prompt): falta tamanho, curva ou playlist de origem → `ask_dj` uma vez, só com o que falta; abertura/fechamento entra só quando a janela já abriu. Tamanho pulado = playlist inteira (até 150 faixas); curva pulada = clássica. O agente nunca limita o set por conta própria nem escolhe subconjunto por `track_ids` a partir de uma playlist; "[DJ MIX]" nunca é fonte (P18).
- **Jev na ordem (D46):** `dj_build_set` usa o Jev por padrão (chave presente; `use_jev` desliga). O feixe das regras monta o set de referência; depois a ordem com o Jev sai passo a passo (`services/jev-order.ts`): em cada posição as 5 melhores candidatas das regras (energia-alvo da posição, fadiga do feixe, abertura e fechamento fixos respeitados) e o Jev escolhe uma (`next_track`), junto com o tipo e a nota da passagem anterior. Regra 8: o estado só tem números e rótulos do planejador. Regra 9: confiança < 0,7, erro ou rate limit → candidata 1 (a das regras); 3 erros seguidos → o resto pelas regras, com aviso; se o Jev não decidir nenhum passo, volta o feixe das regras. Resultado com o campo `jev` (`used`, `chosen`, `fallback`, `calls`, `errors`, `latency_ms`, `rules_average_score`) e uma linha no markdown. Supersede a parte "dj_build_set não chama o Jev" da D39.

## Resultados

Verificação em 01/10/2026:

| Teste | Resultado |
|---|---|
| Build e testes | `tsc` limpo nos três workspaces; suítes verdes: MCP (engine com os goldens intactos, jev com http falso e 10 mutações pegas, server stdio, metadata, planner), servidor (agent com a ferramenta rodando por um cliente MCP em memória, repo, http com a rota nova; 17 mutações pegas), web (3 checks, inclusive o reducer das perguntas) |
| Jev real no MCP (coder) | Set de 10 entre 24 faixas reais: 11 chamadas, 0 erros, ~0,3 s por chamada; o Jev decidiu 6 passos (3 deles fora da candidata 1) e as 9 passagens; 4 passos ficaram com as regras (confiança 0,33 a 0,61); nota das regras 0,82 com o Jev contra 0,85 do feixe |
| Ponta a ponta (servidor real, `POST /api/chat`) | "Monte um set da playlist Eletro": `ask_dj` com 3 perguntas em 10 s (tamanho, curva, abertura/fechamento; a playlist já vinha no pedido) → resposta pela rota (200) → `metadata_coverage` → `dj_build_set` 60 min peak time → 13 faixas · 59 min; o agente disse "o Jev escolheu 8 passagens e 5 ficaram com as regras"; 0 faixas repetidas dos 3 últimos sets; 39 s, US$ 0,047 |
| Caso pesado (servidor temporário, dados próprios) | Mesmo pedido, resposta só depois de 120 s (tamanho pulado, curva clássica): a espera do `ask_dj` não foi cortada; `dj_build_set` da playlist inteira em 47 s → 137 faixas (13 sem análise ficaram fora); log do Jev nos dois testes: 150 `next_track`, 0 erros, 312 ms de média (máx. 1,0 s), confiança ≥ 0,7 em 54 de 150 (as regras decidiram os outros 96); turno de US$ 0,024. Com 137 faixas o resultado foi para arquivo e o agente (sem leitura de arquivo) respondeu com resumo parcial; o set ficou completo no painel (P19) |

## Consequências

- A ordem do Jev tem nota das regras um pouco menor que a do feixe (0,82 × 0,85 no teste): é a troca que o usuário pediu (o Jev decide). A confiança do `next_track` fica abaixo de 0,7 em cerca de 40 % dos passos; o limiar não mudou.
- Set da playlist inteira faz ~150 chamadas seguidas ao Jev (~45 s a mais; medido: 47 s para 137 faixas); aceito pelo usuário. Nesse caso o Jev passou do limiar em 36 % dos passos: com o limiar de 0,7, a maior parte da ordem ainda vem das regras. Baixar o limiar do `next_track` é decisão do usuário (regra 9).
- P19: com set grande o resultado do `dj_build_set` passa do limite e vai para arquivo; o agente não lê arquivos e responde com resumo parcial. Saída prevista: resumo compacto no texto da ferramenta quando o set passa de ~40 faixas (o servidor grava o set pelo resultado estruturado, que continua completo).
- Testes reais no banco do DJ entram na janela de "não repetir" (D44): smoke de agora em diante roda num servidor temporário (`PLAYME_DATA_DIR` próprio).
- `zod` (4.x, peer do SDK) e `@modelcontextprotocol/sdk` (teste) passam a ser declarados no `package.json` do servidor.
