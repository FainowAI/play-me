# Telas do MVP — Play.Me

Canvas com as telas: artifact "Play.Me · Telas do MVP" (https://claude.ai/artifact/52ejbuCbMrXoM7fyfs8ayK). É a fonte das telas (D23): substitui o Google Stitch. Cópia dos arquivos em `design/telas/` (`.dc.html` + `canvas.json`) e dos componentes em `design/ds/`, para o Claude Code ler. Construídas com o design system Play.Me (componentes reais do bundle `PlayMe`). Cada tela tem o tweak Tema (Cabine · Dia). Ajustadas à rota por metadados (D22) em 29/09/2026.

Construção: `design/telas-referencia.md` traz, por tela, componentes, dados, ferramentas, pacote da EAP e as divergências entre o canvas e as decisões vigentes (D31).

## Princípio

Uma tela principal só: o chat. O set vive num painel lateral com versões. Todo o resto é estado do chat, gaveta ou janela por cima. Botões viram mensagem no composer, então o chat é sempre o registro do que aconteceu.

## Estrutura fixa

Sidebar (264 px) · chat (coluna de 720 px) · painel do set (400 px, só quando existe set). Abaixo de 1100 px o painel vira gaveta; abaixo de 720 px a sidebar também.

## Telas

| # | Tela | Tipo | Componentes | O que mostra |
|---|---|---|---|---|
| 1 | Início | tela | AgentOrb 64 (idle), Composer, Button | "Pista cheia.", composer com a playlist em contexto, 3 pedidos prontos, aviso do Jev sem acesso |
| 2 | Conversa · buscando BPM e tom | estado do chat | ThinkingStatus, ToolCall, StatusTag | Orb "Buscando BPM e tom · ReccoBeats + GetSongBPM", `metadata_lookup` rodando em dry run, cobertura (Mixar, web conferido, A validar, pendentes) |
| 3 | Set proposto + painel | estado do chat + painel | TransitionCard, ToolCall, SetPanel (SetArc, TrackRow) | Resultado primeiro, a passagem mais arriscada em card, atalhos de ajuste; painel com a curva de energia e a ordem por seção |
| 4 | Aprovação | estado do chat | ApprovalGate, ToolCall (aguardando) | Gate "Criar [DJ MIX] Eletro", painel em "Aguardando aprovação" |
| 5 | Enviado + guia do Mix | estado do chat + painel | ToolCall, Button, SetPanel (aba Guia do Mix) | Playlist criada, original intacta, guia passagem por passagem |
| 6 | Transição expandida | janela lateral (820 px) | PhraseBar, KeyBadge, EnergyMeter, StatusTag, CamelotWheel | A e B com BPM, tom e energia; tipo, duração, harmonia, ΔBPM e ΔEnergia; guia do Mix; alertas por metadados; nota 1–5; trocar B. Estrutura por compasso só na trilha de áudio (opcional); prévia pós-MVP |
| 7 | Faixa | gaveta (520 px) | KeyBadge lg, EnergyMeter, CamelotWheel, StatusTag | BPM, tom e energia com a fonte de cada dado (Mixar, ReccoBeats, GetSongBPM, estimativa); arquivo opcional; tons compatíveis; correção manual |
| 8 | Configurações | janela | StatusTag, Button | Conexões (Spotify, ReccoBeats, GetSongBPM, trilha de áudio opcional, Jev, API da Anthropic), tema, pesos da nota do par |

Peças reutilizadas: `Sidebar` e `SetPanel` (abas Ordem · Transições · Guia do Mix; estados rascunho, aguardando aprovação, enviado).

Pós-MVP: Biblioteca (cobertura e fila em lote), busca e comandos (⌘K), player do set.

## Dados

Reais: ordem, BPM, Camelot e energia do set [DJ MIX] Eletro (27/09). BPM e tom vêm do Mixar; energia é estimativa do Claude (marcada com *).
Ilustrativos: a cobertura da tela 2 (até a Fase M); tipo e duração da transição e o guia do Mix (até a Fase P). Estrutura por compasso, pontos de entrada e saída e vetos de vocal e grave só existem na trilha de áudio (opcional, D22).

## Achado de set

O painel já aponta um problema real do set Eletro: as faixas 12, 13 e 14 (Moon Rocks, Freak, Paranoia) seguem com energia 9 ou mais, sem respiro. Vale ajustar antes do próximo envio.
