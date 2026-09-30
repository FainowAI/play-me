# 0004 — ReccoBeats como fonte principal de BPM

Data: 29/09/2026 · Decisão D24 · Revê as fontes do ADR 0002 (a rota por metadados continua)

## Contexto

- A validação da Fase M (ADR 0002, Resultados) mostrou que GetSongBPM + Deezer cobrem 1 de 50 faixas da Eletro. O Deezer trouxe BPM em 1 de 71 faixas encontradas.
- O Spotify não tem saída oficial: `audio-features` e `audio-analysis` respondem 403 para o app (restrição de 27/11/2024). O modo estendido só aceita empresas com pelo menos 250 mil usuários ativos por mês.
- A ReccoBeats (https://reccobeats.com/docs) oferece `GET /v1/audio-features?ids=` pelo ID do Spotify: gratuita, sem chave, uso pessoal e comercial permitido, até 40 IDs por chamada. Devolve `tempo`, `key`/`mode` (formato Spotify) e `energy`.
- Teste de 29/09/2026:

| Medida | Resultado |
|---|---|
| Cobertura, 22 faixas com Mixar | 11 de 22 |
| Cobertura, 50 primeiras da Eletro | 43 de 50 (BPM e tom) |
| BPM contra o Mixar | 11 de 11 (diferença máxima 0,03) |
| Tom contra o Mixar | 2 exatos, 1 relativo, 8 divergentes (de 11) |

## Decisão

- ReccoBeats é a fonte principal: lote por ID do Spotify, antes de qualquer outra fonte.
- BPM só da ReccoBeats é salvo como conferido (`source: web`, sem [A VALIDAR]). Se o GetSongBPM também tiver e divergir, vira [A VALIDAR] com o valor da ReccoBeats.
- Tom da web é sempre [A VALIDAR]. O Mixar continua a verdade do tom.
- GetSongBPM fica como reserva: só é consultado quando a ReccoBeats não tem BPM e tom da faixa. BPM só do GetSongBPM é [A VALIDAR].
- Deezer sai.
- `energy` da ReccoBeats e `danceability` do GetSongBPM entram só em `notes`, como apoio. A energia 1–10 continua estimativa do Claude.
- O endpoint de análise de arquivo da ReccoBeats (`POST /v1/analysis/audio-features`) não é usado: recebe áudio (D04).

## Consequências

- Resultado com a ferramenta, em dry run: 43 de 50 faixas com BPM conferido e tom [A VALIDAR], 7 pendentes; nas 22 com Mixar, BPM confere em 11 de 11. `analysis.json` intacto.
- O lookup ficou rápido: a ReccoBeats responde em lotes de 40, e o GetSongBPM só roda para cerca de 14 % das faixas. O limite padrão do `metadata_lookup` subiu de 15 para 50 faixas.
- Só os IDs do Spotify saem da máquina para a ReccoBeats. Nome e artista só vão ao GetSongBPM, nas faixas de reserva.
- Riscos:
  - A ReccoBeats pode sair do ar sem aviso e não publica limite de uso; um 429 interrompe o lote.
  - Os termos dela dizem que os dados vêm do Spotify e que cumprir as regras de terceiros é responsabilidade de quem usa.
  - Como o tom da web não é confiável, a mixagem harmônica depende de conferir o tom no Mixar para as faixas que entram no set.
