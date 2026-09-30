# 0002 — MVP por metadados

Data: 28/09/2026 · Decisão D22 · Suspende a Fase 0 (prompt 02) · Fontes revistas no ADR 0004 (D24: ReccoBeats no lugar do Deezer)

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

Validação de 29/09/2026 (`metadata_lookup` em dry run, playlist Eletro `1RWDWS3EyRn8vsGzLLjczl`, 557 faixas). Nada foi gravado: `analysis.json` idêntico ao backup (sha256 `f76f68fa…`). Nenhum áudio baixado; o Deezer só recebeu chamadas `/track/isrc:`.

### Faixas com Mixar (22)

| Medida | Resultado |
|---|---|
| GetSongBPM achou (título + artista) | 1 de 22 |
| Deezer achou pelo ISRC | 22 de 22, mas com BPM > 0 em só 1 |
| Faixas com algum BPM da web | 2 de 22 |
| BPM confere com o Mixar (±1 ou metade/dobro) | 2 de 2 (You Were Right: 122 × 122; Lonesome: 124,16 × 124) |
| Tom exato | 0 de 1 |
| Tom relativo / ±1 | 1 de 1 relativo (GetSongBPM Fm = 4A × Mixar 4B) |

O critério "BPM confere em ≥ 90 % das encontradas" passa (2 de 2), mas com n = 2 o número não diz nada sobre a precisão.

### 50 primeiras faixas da Eletro (nenhuma tem Mixar)

| Medida | Resultado |
|---|---|
| GetSongBPM achou | 1 de 50 (com BPM e tom) |
| Deezer achou pelo ISRC | 49 de 50, BPM > 0 em 0 |
| Seria salvo | 1 (com [A VALIDAR]: BPM de fonte única) |
| Salvo como "web" conferido | 0 |
| Pendente (sem BPM em nenhuma fonte) | 49 |

A única faixa que seria salva (Innerbloom - Radio Edit, 137 BPM, Gm, só do GetSongBPM) não foi conferida com nenhuma outra fonte.

### Leitura

- Cobertura gravável (BPM **e** tom, que o store exige): 1 de 22 nas faixas com Mixar e 1 de 50 nas primeiras da Eletro, ou seja, 2 % a 5 %. Faixas com algum BPM da web, mesmo sem tom: 2 de 22 e 1 de 50. O MVP por metadados, como está definido aqui, não cobre a playlist.
- `metadata_coverage` na Eletro hoje: 557 faixas, 22 com Mixar, 0 web, 0 [A VALIDAR], 535 pendentes.
- O Deezer quase nunca preenche o `bpm` neste catálogo (1 de 71 faixas encontradas pelo ISRC, em 72 consultadas). Na prática, o GetSongBPM é a única fonte, e cobre pouco música eletrônica recente.
- Esse é o dado para decidir o P03. Não foi feita nenhuma escolha aqui.
- Ajuste feito durante a validação: quando a busca por título + artista volta vazia, o cliente do GetSongBPM tenta a busca só pelo título e confere o artista no casamento. Motivo: a base grava "RÜFÜS" em vez de "RÜFÜS DU SOL". Os números acima já usam essa versão. O casamento por "contém" exige pelo menos 4 letras, para um artista curto não casar por acaso.
