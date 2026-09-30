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
| D24 | 29/09/2026 | ReccoBeats é a fonte principal de BPM e tom (por ID do Spotify, em lote); GetSongBPM vira reserva; Deezer sai. BPM da ReccoBeats é conferido; tom da web é sempre [A VALIDAR]; Mixar segue como verdade (ADR 0004). | Teste: BPM confere com o Mixar em 11 de 11 e cobre 43 de 50 faixas; o tom divergiu em 8 de 11. Spotify `audio-features` dá 403 para o app. |
| D25 | 29/09/2026 | Escopo do v1 (fecha P03): chat + BPM e tom por metadados (ReccoBeats) + set + transições por metadados com guia do Mix + aprovação → playlist no Spotify. Fora do v1: trilha de áudio, prévia renderizada, export Rekordbox, editor de curvas, motor em tempo real, set tocando no app. | A Fase M cobriu 436 de 557 faixas da Eletro sem arquivo de áudio. |
| D26 | 29/09/2026 | Prazo (fecha P04): Sprint 0 de 3 dias e 4 sprints de 1 semana, de 30/09 a 30/10/2026, com validação no fim de cada sprint (EAP). | Cada sprint entrega algo testável; as telas já estão prontas (D21). |
| D27 | 29/09/2026 | Uso pessoal, single-user (fecha P05). Estados do set: rascunho → aguardando aprovação → enviado; enviado é final, e ajuste depois do envio vira nova versão e nova playlist. | Licenças NC/GPL seguem aceitáveis (D10); nunca editar playlist existente (D01). |
| D28 | 29/09/2026 | Jev numa sprint própria (Sprint 4), sempre com fallback de regras (fecha P02). A chave TYPESAFE_API_KEY já está no `.env`; acesso e SDK oficial são validados na sprint. | Acesso de terceiro não trava o MVP. |
| D29 | 29/09/2026 | GetSongBPM sai do projeto (fecha P09): a ReccoBeats é a única fonte web de BPM e tom. A remoção do código é o item 1 do prompt 04. | Na gravação da Eletro, o GetSongBPM não achou nenhuma das 121 faixas pendentes; sem ele, o backlink deixa de ser exigido. |
| D30 | 29/09/2026 | Planejador de transições por metadados e guia do Mix em TypeScript, dentro do MCP (`transition_plan`, `export_mix_guide`), reusando `camelot.ts` e `dj-engine.ts`. O analisador Python fica só para a trilha de áudio. | Sem áudio não há trabalho para o Python; o motor de harmonia e BPM já existe no MCP. |
| D31 | 29/09/2026 | As telas do canvas "Play.Me · Telas do MVP" são a especificação de construção da `apps/web`: layout do canvas, componentes reais do design system portados para TSX. Onde o texto do canvas diverge das decisões (fontes de dados, Jev, contagens), valem as decisões. Guia: `design/telas-referencia.md`. | Pedido do usuário: construir seguindo o canvas; o canvas é anterior às D24 a D30. |

EAP e roadmap: `docs/eap_play-me_fainow.md` (29/09/2026).

## Pendentes

| # | Pergunta | Recomendação |
|---|---|---|
| — | Nenhuma em aberto. P02, P03, P04, P05 e P09 fechadas pelas D25 a D29. | Novas pendências entram aqui. |

## Próximo passo (29/09/2026)

1. Prompt 04 (`docs/prompts/04-fase-p-planejador.md`): Sprint 0 e 1, Fase P. Ter à mão a lista de presets do Mix do app do Spotify.
2. Prompt 05 (Sprint 2): servidor local. Prompt 06 (Sprint 3): interface.
3. Sprint 4 (Fase K) com o `feature-builder`, depois da Sprint 3.
