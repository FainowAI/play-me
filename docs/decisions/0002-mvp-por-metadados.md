# 0002 — MVP por metadados

Data: 28/09/2026 · Decisão D22 · Suspende a Fase 0 (prompt 02)

## Contexto

- A rota original (Fases 0 a 3) depende de arquivos de áudio próprios: sem arquivo, não há Beat This!, extratores nem estrutura por compasso.
- Comprar os arquivos é inviável: cerca de R$ 8 por faixa, e a playlist Eletro tem 527 faixas (≈ R$ 4.200).
- A Fase 0 parou no meio: `decode.py` e `grid.py` existem e estão testados na parte pura, mas o Beat This! nunca rodou com arquivos reais.

## Decisão

- O MVP funciona só com metadados. BPM e tom de todas as faixas vêm da API do GetSongBPM e da API pública do Deezer, cruzados com o Mixar já salvo no store do MCP.
- A análise de áudio (Beat This! e extratores) vira trilha opcional, só para faixas com arquivo, fora do caminho crítico.
- Continuam valendo: D01; D03 (nunca inventar, divergência vira [A VALIDAR]); D04 (nenhum áudio de fora); D05 quando houver áudio.

## Alternativas descartadas

| Alternativa | Por que não |
|---|---|
| Comprar as faixas | Custo (≈ R$ 4.200 só para a Eletro). |
| Prévias de 30 s do Deezer/iTunes; dataset GiantSteps | Áudio de terceiros, fora da D04. O campo `preview` do Deezer é ignorado; nenhuma chamada baixa ou toca áudio. |
| Conversores de streaming (ripar do Spotify/YouTube) | Viola os termos e a D04. |

## Consequências

- Sem estrutura por compasso no MVP: as transições são planejadas por BPM, tom e energia, e o Mix do Spotify faz o alinhamento na hora. Vetos de vocal e grave e pontos de entrada/saída só existem na trilha de áudio.
- Nome e artista das faixas saem da máquina para o GetSongBPM (busca) e o ISRC para o Deezer. O cache local guarda só os números (BPM, tom, danceability), nunca nome nem artista.
- O GetSongBPM exige backlink público para `getsongbpm.com` (P09: onde fica).
- O tom tem uma fonte só (GetSongBPM): toda entrada com tom vindo da web leva nota "tom de fonte única (GetSongBPM)".
- Faixa sem BPM ou sem tom em nenhuma fonte fica pendente; nunca é preenchida por estimativa.

## Resultados

_(preenchido na Parte D do prompt 03)_
