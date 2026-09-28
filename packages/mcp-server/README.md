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

1. `spotify_list_my_playlists` para achar a playlist.
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
| `dj_build_set` | Ordem otimizada por busca em feixe | Não |
| `dj_evaluate_order` | Relatório de uma ordem fixa | Não |
| `dj_convert_key` | Tom musical ↔ Camelot | Não |

## Como a ordem é calculada

Cada transição recebe uma nota: 35% Camelot, 25% BPM, 25% energia, 10% estilo, 5% progressão. Os pesos podem ser ajustados por chamada.

- **Harmonia:** mesmo tom, ±1 e relativa são seguras. Diagonal, +2 e semitom acima são criativas. O resto é arriscado.
- **BPM:** até 2 de diferença é excelente, até 5 é aceitável, acima disso precisa de motivo. Half/double time é reconhecido.
- **Energia:** compara a variação real com a variação que a curva escolhida pede naquele ponto do set.
- **Busca em feixe:** mantém várias sequências candidatas em paralelo, então a escolha de agora considera o que ela deixa possível depois.
- **Tensão e alívio:** três ou mais faixas seguidas com energia 9+ são penalizadas.

Curvas: `classic` (warm up, construção, pico, clímax, encerramento), `peak_time`, `warm_up` e `sunrise`.

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
```
