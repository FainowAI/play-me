# Registro de decisões — Play.Me

Toda decisão nova entra aqui e no quadro do projeto: https://claude.ai/artifact/JEd8bN1irubJJigj5nKziX

## Decididas

| # | Data | Decisão | Motivo |
|---|---|---|---|
| D01 | 26/09/2026 | Nunca alterar playlist existente do Spotify. Só criar playlist nova e privada "[DJ MIX] <nome>", depois de aprovação. | Proteger a biblioteca do usuário. |
| D02 | 26/09/2026 | MCP próprio `spotify-dj` em TypeScript, OAuth PKCE sem Client Secret, escopos mínimos, análises salvas localmente. | O conector oficial não lê faixas de playlist nem cria playlist em ordem. |
| D03 | 26/09/2026 | BPM e tom nunca inventados. Fontes por confiança: análise local → Mixar → software de DJ → web cruzada, com [A VALIDAR]. | A Web API não entrega audio features para apps novos. |
| D04 | 27/09/2026 | Nenhum áudio vem do Spotify. Só arquivos que o usuário possui. | Termos do Spotify e Lei 9.610/98 (DRM). |
| D05 | 27/09/2026 | Beat This! é a única fonte da grade; tudo indexado por compasso. | Evita grades conflitantes e transições desalinhadas. |
| D06 | 27/09/2026 | Analisador em Python no WSL2/Docker; MCP e backend em TypeScript; UI em React + Vite + TS; SQLite local. | essentia-tensorflow sem wheel para Windows; allin1 exige NATTEN compilado. |
| D07 | 27/09/2026 | Jev (TypeSafe) como camada de decisão sobre features; recebe só IDs internos e números; toda decisão tem fallback de regras. | Jev não ouve áudio, roda na nuvem e está em early access. |
| D08 | 27/09/2026 | Claude opera local via Claude Agent SDK (API key da Anthropic) em `apps/server`. | Mesmo motor do Claude Code, com MCP, permissões e sessões. |
| D09 | 27/09/2026 | Interface: chat estilo ChatGPT para DJ, desenhada no Google Stitch, implementada pelo Claude Code a partir do DESIGN.md. | Pedido do usuário; Stitch MCP leva o design ao Claude Code. |
| D10 | 27/09/2026 | Essentia/modelos (AGPL, CC BY-NC) e pedalboard (GPL) só para uso pessoal; virar produto exige troca ou licença. | Licenças não comerciais. |
| D11 | 28/09/2026 | O quadro do projeto é a fonte central: toda documentação e todo direcional do projeto (decisões, planejamento, EAP, pesquisas, prompts, sets) entram nele, sempre no mesmo link. Regra gravada nas instruções do projeto. | Pedido do usuário. |
| D12 | 28/09/2026 | O software se chama **Play.Me**. | Definido pelo usuário. |
| D13 | 28/09/2026 | Design system Play.Me definido em `design/DESIGN.md` e `design/playme-tokens.css`: tema Cabine (dark) padrão, um acento só (signal), cor como informação musical, compasso como unidade de tempo, Geist/Geist Mono. É a fonte para o Stitch e o Claude Code. | Fecha o bloco F (visual) do briefing. |
| D14 | 28/09/2026 | MVP: o set termina numa playlist nova e privada no Spotify, com guia de transições para o Mix. Pós-MVP: o set toca dentro do próprio Play.Me, com render das transições. | Fecha o fluxo ponta a ponta mais rápido; o app próprio vem depois. |
| D15 | 28/09/2026 | Repositório local em `C:\Users\Antônio\Desktop\Play.me`, monorepo (apps/, packages/, services/, design/, docs/). O MCP `spotify-dj` foi copiado para `packages/mcp-server`; o original em `Desktop\mcps` segue ativo no Claude Desktop até a validação. | Base única para o Claude Code. |
| D16 | 28/09/2026 | Git na branch `main`; `.gitattributes` força LF; `.gitignore` passa a cobrir `*.log`, `*-logs.txt`, `.aif`, `.ogg`, `.opus`. | Scripts rodam no WSL (CRLF quebra); havia logs de outro MCP (WhatsApp, com chaves de pareamento) na raiz; AIFF da Beatport costuma ser `.aif`. |
| D17 | 28/09/2026 | npm workspaces na raiz (`packages/*`, `apps/*`) com lockfile único na raiz, semeado do lock antigo do MCP (SDK MCP fica em 1.30.1). `tsconfig.base.json` com as flags comuns; o tsconfig do MCP estende a base e mantém os caminhos (config efetiva idêntica, conferida com `tsc --showConfig`). Único ajuste no MCP: script `typecheck`. `npm test` compila antes (`pretest`). | Fundação sem mudar o comportamento do MCP: um lock novo subiria o SDK para 1.31.0. |
| D18 | 28/09/2026 | WSL segue em Ubuntu 22.04; Python do analisador é 3.12 via uv, venv em `~/.venvs/playme-analyzer`. Ver ADR 0001. | O 22.04 só tem Python 3.10 (e 3.11 rc); uv não precisa de sudo nem mexe no sistema. |
| D19 | 28/09/2026 | API do analisador em `services/analyzer/analyzer/api.py` (não na raiz do serviço), escutando só em `127.0.0.1:8765` (`ANALYZER_PORT`). O teste chama a função da rota direto; o `curl` cobre o HTTP. | Código num pacote só; evita `httpx` só para o TestClient. |
| D20 | 28/09/2026 | Orb de pensamento da biblioteca thinking-orbs (MIT), encapsulado no `AgentOrb`: único movimento contínuo da UI, mapa atividade → estado (DESIGN.md 4.1). | Pedido do usuário; MIT, canvas 2D leve, segue `data-theme` e `prefers-reduced-motion`. |
| D21 | 28/09/2026 | Telas do MVP aprovadas (`design/telas-mvp.md`): chat único com painel do set versionado; Início, Conversa, Analisando, Set proposto, Aprovação, Enviado + guia do Mix, Transição expandida, Faixa, Configurações. | Fluxo simples e maleável como Claude e ChatGPT. |
| D22 | 28/09/2026 | MVP por metadados; análise de áudio vira trilha opcional (ADR 0002). | Comprar 527 faixas é inviável. |
| D23 | 29/09/2026 | Telas no canvas "Play.Me · Telas do MVP" (cópia em `design/telas/`), no lugar do Google Stitch; revisa a D09 (ADR 0003). | Decisão do usuário; o canvas já usa os componentes do design system. |

## Pendentes

| # | Pergunta | Recomendação |
|---|---|---|
| P02 | Acesso ao early access do Jev e API key. | Entrar na fila já; construir com regras e plugar o Jev numa sprint própria. |
| P03 | Escopo do v1. | v1 = chat + BPM e tom por metadados + set + transições por metadados com guia do Mix + aprovação. Fora: render no app, motor em tempo real, export Rekordbox, editor de curvas, estrutura por compasso (trilha de áudio opcional). |
| P04 | Prazo e ritmo. | 4 semanas, sprints de 1 semana, telas do Stitch em paralelo na semana 1. |
| P05 | Rodada 2 do briefing: estados do set, uso pessoal ou produto. | A definir na rodada 2. |
| P09 | Onde fica o backlink público do GetSongBPM. | A definir; os termos da API exigem link público para getsongbpm.com (ADR 0002). |

## Próximo passo (29/09/2026)

1. Prompt 03, Parte D: validar a Fase M (metadata_lookup em dry run nas faixas da Eletro com Mixar e nas 50 primeiras) e registrar os números no ADR 0002.
2. Fase P: planejador por metadados.
