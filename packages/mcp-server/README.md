# spotify-dj-mcp-server

Servidor MCP que lê suas playlists do Spotify, monta a ordem de um set com lógica de DJ (Camelot, BPM, curva de energia, estilo e progressão) e cria uma playlist nova `[DJ MIX] <original>` na ordem aprovada. A playlist original nunca é alterada.

## Limites da API (revisão de fevereiro de 2026)

- **Sem BPM, tom ou energia pela API.** Os endpoints `audio-features` e `audio-analysis` não estão disponíveis para apps novos. Esses dados entram pelo usuário (modo Mixar do app do Spotify, Rekordbox, Serato, Traktor) e ficam salvos localmente com `dj_set_track_analysis`.
- **Só playlists próprias ou colaborativas.** A API devolve 403 para os itens de playlists de terceiros.
- **Development mode:** o dono do app precisa ter Premium ativo, há limite de 5 usuários autorizados, e a busca devolve no máximo 10 resultados.
- **Termos do Spotify:** os termos de desenvolvedor proíbem treinar modelos de IA com conteúdo do Spotify ou "ingerir" esse conteúdo em um modelo de IA. Este servidor envia nome e artista das faixas para o assistente que o usa. Avalie esse ponto antes de usar além de teste pessoal.

## Instalação

Requer Node.js 20.12 ou superior.

```bash
npm install
npm run build
cp .env.example .env   # no Windows: copy .env.example .env
```

O `.env` já vem com o Client ID do app "DJ Mix Builder". Não é preciso Client Secret: o fluxo é Authorization Code com PKCE.

## Autorização (uma vez)

```bash
npm run auth
```

O navegador abre o login do Spotify. Depois de aceitar, os tokens ficam em `~/.spotify-dj-mcp/tokens.json`. O refresh é automático. O refresh token vale 180 dias; depois disso, rode `npm run auth` de novo.

A porta 3000 precisa estar livre durante a autorização, e o redirect URI do `.env` tem que ser idêntico ao cadastrado no dashboard (`http://127.0.0.1:3000/callback`).

## Conectar ao Claude Desktop

Edite `%APPDATA%\Claude\claude_desktop_config.json` (Windows) ou `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "spotify-dj": {
      "command": "node",
      "args": ["C:/caminho/para/spotify-dj-mcp-server/dist/index.js"],
      "env": {
        "SPOTIFY_CLIENT_ID": "af28a5cf9c9d415e89402d0c342e6022",
        "SPOTIFY_REDIRECT_URI": "http://127.0.0.1:3000/callback"
      }
    }
  }
}
```

Reinicie o Claude Desktop depois de salvar.

## Conectar ao Claude Code

```bash
claude mcp add spotify-dj -e SPOTIFY_CLIENT_ID=af28a5cf9c9d415e89402d0c342e6022 -- node /caminho/para/spotify-dj-mcp-server/dist/index.js
```

## Fluxo de uso

1. `spotify_list_my_playlists` para achar a playlist (as ferramentas com `playlist` também aceitam o nome dela, ver "Playlist pelo nome").
2. `spotify_get_playlist_tracks` para ler as faixas e ver quais estão sem análise.
3. `dj_set_track_analysis` com BPM, tom e, se houver, energia e estilo de cada faixa.
4. `dj_build_set` para calcular a ordem, com relatório de transições, pontos fracos e perfil de faixa-ponte.
5. Revisar a ordem com o usuário. `dj_evaluate_order` avalia ajustes feitos à mão.
6. `spotify_create_playlist_from_order` para criar a `[DJ MIX]`, privada.

## Ferramentas

| Ferramenta | O que faz | Escreve? |
| --- | --- | --- |
| `spotify_auth_status` | Conta conectada e escopos | Não |
| `spotify_list_my_playlists` | Lista playlists com paginação | Não |
| `spotify_get_playlist_tracks` | Faixas na ordem atual, cruzadas com as análises | Não |
| `spotify_search_tracks` | Busca faixas no catálogo (até 10) | Não |
| `spotify_create_playlist_from_order` | Cria playlist nova e privada na ordem dada | Cria playlist nova |
| `dj_set_track_analysis` | Salva BPM, tom, energia e estilo | Só local |
| `dj_delete_track_analysis` | Apaga análises salvas | Só local |
| `dj_score_transition` | Nota de uma passagem A → B | Não |
| `dj_build_set` | Ordem otimizada por busca em feixe; com `duration_minutes` ou `max_tracks`, escolhe as melhores faixas para o tamanho pedido; com `use_jev` (padrão: chave presente) o Jev escolhe a ordem passo a passo e decide as passagens | Só local (chama o Jev, log em `jev-calls.jsonl`) |
| `dj_evaluate_order` | Relatório de uma ordem fixa | Não |
| `dj_convert_key` | Tom musical ↔ Camelot | Não |
| `transition_plan` | Plano de uma passagem A → B (tipo, compassos, troca de grave); com `use_jev` o Jev escolhe o tipo | Só local (chama o Jev com `use_jev`) |
| `jev_compare` | Compara o Jev com o planejador de regras em pares consecutivos (concordância e correlação) | Só local (chama o Jev, log em `jev-calls.jsonl`) |

## Como a ordem é calculada

Cada transição recebe uma nota: 35% Camelot, 25% BPM, 25% energia, 10% estilo, 5% progressão. Os pesos podem ser ajustados por chamada.

- **Harmonia:** mesmo tom, ±1 e relativa são seguras. Diagonal, +2 e semitom acima são criativas. O resto é arriscado.
- **BPM:** até 2 de diferença é excelente, até 5 é aceitável, acima disso precisa de motivo. Half/double time é reconhecido.
- **Energia:** compara a variação real com a variação que a curva escolhida pede naquele ponto do set.
- **Busca em feixe:** mantém várias sequências candidatas em paralelo, então a escolha de agora considera o que ela deixa possível depois.
- **Tensão e alívio:** três ou mais faixas seguidas com energia 9+ são penalizadas.

Curvas: `classic` (warm up, construção, pico, clímax, encerramento), `peak_time`, `warm_up` e `sunrise`.

## Tamanho do set

`dj_build_set` aceita `duration_minutes` (10 a 600) ou `max_tracks` (2 a 150), nunca os dois. Com um deles, lê a playlist inteira (até 600 itens) e o feixe escolhe, entre todas as faixas analisadas, as N que melhor seguem a curva. Com `duration_minutes`, N = duração pedida ÷ duração média das faixas (duração real do Spotify, por isso exige `playlist`; `track_ids` só com `max_tracks`). O resultado traz `pool_size` e `duration_ms`, e um aviso "Selecionadas N de M faixas analisadas (~X min)". Sem nenhum dos dois, nada muda: até 150 itens, todos ordenados.

Custo: cresce com N × largura do feixe × faixas do pool. Um set de 90 min sobre 436 faixas leva menos de 1 s; 150 faixas escolhidas entre 600 levam cerca de 13 s.

**Duração aproximada (P13).** O N por duração sai da média do pool, e as faixas escolhidas costumam ser mais longas (alvo de 90 min deu 103). Depois da seleção, enquanto a soma das durações passar do alvo + meia faixa (a duração média da ordem escolhida), a última faixa sai, nunca abaixo de 2, e o relatório é recalculado; o aviso diz "Ajustado para X min (alvo Y)" e "Selecionadas N de M" já traz o N final. Só vale com `duration_minutes`: `max_tracks` e o modo sem parâmetros nunca cortam. Também não corta com `end_track` (tiraria o fechamento pedido) nem quando falta a duração de alguma faixa da ordem (sem soma).

## Playlist pelo nome

Toda ferramenta que lê uma playlist aceita o ID, a URI, o link ou o NOME de uma playlist sua: `playlist` em `dj_build_set`, `dj_evaluate_order`, `jev_compare`, `export_mix_guide`, `metadata_lookup`, `metadata_coverage` e `spotify_get_playlist_tracks`, e `source_playlist` em `spotify_create_playlist_from_order`. Tudo passa por `resolvePlaylistId` (`services/spotify-client.ts`). ID, URI e link valem primeiro; o que não for nenhum deles é procurado entre as suas playlists (as 200 primeiras, em páginas de 50), por igualdade do nome inteiro sem acento, sem caixa e sem espaços nas pontas ("Eletro" não casa "[DJ MIX] Eletro"). Uma achada: usa o ID. Duas ou mais com o mesmo nome: erro que lista nome, itens e ID de cada uma. Nenhuma: "Playlist ... não encontrada". Link ou URI quebrado segue como identificador inválido.

## Energia estimada

Faixa sem energia do Mixar ou do usuário e com `energy 0.62 (ReccoBeats)` nas notas ganha, na leitura, `energy = clamp(round(1 + x × 9), 1, 10)` e `energy_estimated: true` (o markdown marca com `*`). O valor derivado nunca é gravado em `analysis.json`; a energia do Mixar ou do usuário sempre vence. O aviso de "faixas sem energia" fica só para quem não tem nem a estimativa.

## Jev (TypeSafe)

Chave e limiar vêm do ambiente: `TYPESAFE_API_KEY` e `JEV_MIN_CONFIDENCE` (padrão 0,7). O cliente usa `fetch` puro (`POST https://api.typesafe.ai/v1/systemone`, modelo `jev-latest`) e recebe só números (BPM, Camelot, energia, ΔBPM): nunca nome, artista nem ID do Spotify.

- `dj_build_set` (padrão: chave presente; `use_jev: false` desliga), `transition_plan` com `use_jev` e `jev_compare` chamam o Jev. `dj_evaluate_order` não.
- O Jev decide o tipo da transição só com confiança ≥ `JEV_MIN_CONFIDENCE`; comprimento e troca de grave saem das regras da ADR 0005 para o tipo escolhido.
- **Ordem com o Jev (P16, `dj_build_set`).** O feixe das regras roda antes e vira a referência (`jev.rules_average_score`) e o fallback. Depois a ordem é montada posição a posição (`services/jev-order.ts`): as regras oferecem as 5 melhores candidatas (nota do par no alvo da curva menos a fadiga do feixe; na abertura, `startFit`) e o Jev escolhe uma (pergunta `next_track`, `choice` entre "1" e "k"). O tipo e a nota da passagem anterior vão na mesma chamada, e as passagens que nenhuma escolha levou saem em chamadas de par: N + 1 chamadas por set, em sequência (cerca de 0,3 s cada na medição real: 150 faixas são cerca de 150 chamadas, uns 45 s). Confiança abaixo de `JEV_MIN_CONFIDENCE`, erro ou limite de requisições = candidata 1; 3 erros seguidos e o resto segue pelas regras sem consultar, com aviso. Se o Jev não decidir nenhum passo, vale o set do feixe e o Jev ainda decide as passagens dele (até 2N - 1 chamadas). Abertura e fechamento fixos, tamanho, `avoid` e o corte da duração valem como sem o Jev. O resultado traz `jev: { used, chosen, fallback, calls, errors, latency_ms, rules_average_score }` (ou `{ used: false, reason }`) e o markdown, a linha "Jev: escolheu X de Y passos (Z pelas regras) · só regras: nota 0,84"; cada passagem com resposta do Jev passa por `decideWithJev`. A cadeia da candidata 1 é mais fraca que o feixe (nota média 0,05 a 0,13 menor em pools sintéticos de 7 faixas): compare `average_score` com `rules_average_score`.
- Sem chave, com erro (HTTP, timeout) ou com confiança baixa, o planejador de regras decide e o plano avisa. `jev_compare` sem chave falha com aviso claro e, no 429/529 ou após 3 falhas seguidas, para e devolve o que já tem.
- **Sem teto de chamadas por set (decisão do usuário, 01/10).** Set longo, com o tamanho pulado (playlist inteira, até 150 faixas), também tem o Jev em todos os passos: cerca de 151 chamadas seguidas e uns 45 s a mais. O teste de `jev.test.ts` roda 150 faixas com http falso em cerca de 1 s e confere `chosen`, `fallback` e o disjuntor. Nada no caminho corta uma ferramenta de 1 minuto, pelo que se lê no código: este servidor não tem timeout nas chamadas recebidas, e o CLI embutido do Agent SDK 0.3.285 usa 1e8 ms por chamada e 30 min de silêncio para servidor stdio. O envio para segundo plano depois de 120 s (`CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS`) vale em sessão interativa, e na do Agent SDK só com `CLAUDE_AUTO_BACKGROUND_TASKS` ligada; se algum dia ligar, defina `CLAUDE_CODE_MCP_AUTO_BACKGROUND_MS=0` no ambiente do servidor.
- Cada chamada vira uma linha em `jev-calls.jsonl` na pasta de dados (hash do state, perguntas, respostas, confiança, latência, modelo e uso de tokens); as de escolha da ordem levam `kind: "next_track"`.
- `ping()` (exportado de `services/jev.ts`; também `Jev.ping()`) é o teste de conexão do painel: uma pergunta `noul` mínima com state `{ ping: true }` e timeout de 5 s. Devolve `{ ok: true, model, latency_ms }` (HTTP 200) ou `{ ok: false, error }`, nunca lança, e sem chave responde `{ ok: false, error: "sem chave" }` sem fazer requisição. Não grava em `jev-calls.jsonl`. Sem argumentos lê `TYPESAFE_API_KEY` do ambiente; em teste, injete o `http`.
- O `score` do Jev vem na escala dos índices dos critérios (0 a 4 para 5 níveis, confirmado em chamada real); a nota 1–5 é o score + 1. A confiança do score é separada da confiança do tipo.

## Segurança

- PKCE sem Client Secret. Tokens em arquivo local com permissão 0600.
- Escopos mínimos: `playlist-read-private`, `playlist-read-collaborative` e `playlist-modify-private`.
- Nenhuma ferramenta edita, reordena ou apaga playlists existentes.
- Metadados do Spotify não são armazenados; só as análises informadas pelo usuário.
- 429 com `Retry-After` recebe backoff; `QUOTA_EXCEEDED` não é repetido.

## Testes

```bash
npm run build
npm run test:engine   # motor de set com as 22 faixas da playlist Eletro
npm run test:server   # ponta a ponta via stdio, sem tocar no Spotify
npm run test:jev      # cliente do Jev (inclui o ping) com http falso: nenhuma chamada real, mesmo com chave no ambiente
```
