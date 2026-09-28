# Pesquisa técnica — Play.Me

Levantamento feito em setembro de 2026 para orientar a construção do sistema. Cada seção traz o achado, o impacto no projeto e as fontes. Links e limites de API mudam: confira a fonte antes de depender de um número.

---

## 1. Spotify: o que a API permite hoje

**Achados**
- Desde novembro de 2024 e fevereiro de 2026, saíram da API para apps em modo de desenvolvimento: audio features e audio analysis (BPM, tom, energia), recomendações, artistas relacionados, top tracks, lançamentos, playlists editoriais, playlists de outros usuários e os endpoints em lote. `/playlists/{id}/tracks` virou `/playlists/{id}/items`, e os itens só vêm para playlists próprias ou colaborativas. Playlists são criadas por `POST /me/playlists`.
- A busca caiu de 50 para 10 resultados por chamada. O campo `popularity` saiu do objeto de faixa.
- O `external_ids` (que carrega o ISRC) foi mantido depois de protesto da comunidade e reintroduzido nos apps novos em modo de desenvolvimento (changelog de março de 2026).
- Modo de desenvolvimento exige Premium do dono do app e tem limite de 5 usuários.
- Refresh tokens expiram 6 meses após a autorização. Renovar o access token não estende esse prazo. Expirado, o endpoint de token devolve `invalid_grant` e o app precisa refazer o login.

**Impacto**
- BPM, tom e energia vêm da análise local, não da API.
- O ISRC é a chave de casamento entre a faixa do Spotify e o arquivo local.
- O MCP atual já trata `invalid_grant` pedindo `npm run auth`.

**Fontes**
- https://developer.spotify.com/documentation/web-api/references/changes/february-2026
- https://developer.spotify.com/documentation/web-api/references/changes/march-2026
- https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
- https://developer.spotify.com/blog/2026-06-18-refresh-token-expiration
- https://community.spotify.com/t5/Spotify-for-Developers/February-2026-Spotify-for-Developers-update-thread/td-p/7330564
- https://github.com/jantijn/spotify-cli (resumo prático das mudanças de fev/2026)

---

## 2. Spotify Mix (a tela de referência)

**Achados**
- Recurso para Premium que adiciona transições entre faixas de playlists próprias. Mostra BPM e tom de cada faixa, forma de onda e dados de beat.
- Presets: Fade, Rise, Blend, Wave, Melt e Slam, além de Auto. Controles manuais de volume, EQ (graves, médios, agudos) e efeitos (filtros passa-baixa e passa-alta). Comprimento da transição em compassos. As ondas podem ser arrastadas para alinhar.
- O processamento acontece em tempo real na reprodução, sem gravar ou alterar as faixas.
- Não há endpoint na Web API para criar ou editar transições. Existe pedido aberto na comunidade de desenvolvedores.

**Impacto**
- O editor do Mix é o modelo de UI do editor de transição.
- As transições planejadas não podem ser aplicadas por API no Spotify: o sistema gera um guia para o usuário aplicar à mão, ou executa com arquivos locais.

**Fontes**
- https://support.spotify.com/us/article/mixed-playlists/
- https://newsroom.spotify.com/2025-08-19/mix-your-favorite-playlists-seamlessly-by-adding-your-own-transitions/
- https://routenote.com/blog/spotify-mix-customizable-transitions/
- https://www.askdavetaylor.com/how-to-create-custom-mix-transitions-in-spotify-playlists/
- https://community.spotify.com/t5/Spotify-for-Developers/Create-a-Mix-playlist-via-API-call/td-p/7393633

---

## 3. Limites legais e de termos

**Achados**
- As diretrizes de usuário do Spotify proíbem copiar, reproduzir, "ripar", gravar e transferir conteúdo, e contornar tecnologias do Spotify ou de licenciadores.
- Os termos de desenvolvedor proíbem o app de facilitar "stream ripping".
- Os termos de desenvolvedor também vedam treinar modelos de IA com conteúdo do Spotify ou ingerir esse conteúdo em modelo de IA. O MCP envia nome e artista das faixas ao Claude: risco a avaliar se o uso passar de teste pessoal.
- No Brasil, contornar medida técnica de proteção é vedado pela Lei 9.610/98.

**Impacto**
- Áudio só de arquivos locais legítimos. Nenhum módulo de captura do Spotify.

**Fontes**
- https://www.spotify.com/us/legal/user-guidelines/
- https://developer.spotify.com/terms

---

## 4. Grade de tempo: Beat This!

**Achados**
- Tracker de beats e downbeats do CPJKU apresentado no ISMIR 2024. Obtém recordes de F1 sem pós-processamento por DBN, com um transformer rotativo sobre espectrograma.
- Código e pesos sob MIT. Parte dos dados de treino tem licenças restritas; não afeta o uso do modelo treinado.
- Requer PyTorch 2.0+ e pacotes pip (tqdm, einops, soxr, rotary-embedding-torch). Pode ser embutido copiando `beat_tracker.py` e `roformer.py`.
- Exporta arquivo `.beats` que abre no Sonic Visualiser para conferência visual.
- Entrega apenas beats e downbeats. BPM sai do intervalo entre beats.

**Impacto**
- É a base do sistema e a única fonte da grade.

**Fontes**
- https://github.com/CPJKU/beat_this
- https://arxiv.org/abs/2407.21658

---

## 5. Estrutura e seções: All-In-One (allin1)

**Achados**
- Um modelo entrega BPM, beats, downbeats, fronteiras de seção e rótulos (intro, verse, chorus, bridge, outro). Usa separação de fontes internamente. Licença MIT.
- No Windows, exige compilar o NATTEN a partir do código-fonte. Há ports para Apple Silicon (MPS e MLX).
- Os rótulos seguem o vocabulário do pop; em música eletrônica, as fronteiras são mais úteis que os nomes.

**Impacto**
- Usar só para seções, encaixadas na grade do Beat This!. Rodar no WSL2/Docker. Ter fallback por novidade (autossimilaridade) se a instalação travar.

**Fontes**
- https://github.com/mir-aidj/all-in-one
- https://pypi.org/project/allin1/
- https://github.com/ssmall256/all-in-one-mlx

---

## 6. Tom (o elo mais fraco)

**Achados**
- O KeyExtractor do Essentia tem perfis para música eletrônica: `edma` (extraído de corpus de EDM), `edmm` (ajustado à mão, reporta modos maiores como menores) e `bgate` (padrão atual, derivado de dados do Beatport).
- Resultados variam: um teste com 40 faixas do GiantSteps teve bgate acertando 20 e edma acertando 16; outro projeto relata cerca de 75 % de acerto exato com edmm contra tags de DJ. Confundir relativa maior/menor é o erro mais comum.
- madmom tem um reconhecedor de tom por CNN, útil como segundo voto (validar no protótipo).

**Impacto**
- Dois estimadores, voto com confiança, tom por seção. Valor do Mixar ou manual sempre vence. Esperar revisão manual.

**Fontes**
- https://essentia.upf.edu/reference/std_KeyExtractor.html
- https://github.com/MTG/essentia/blob/master/src/algorithms/tonal/key.cpp
- https://dev.to/dipak8080/bpm-detection-from-42-to-85-accuracy-with-a-pretrained-model-20al
- https://github.com/felixvor/selecta

---

## 7. BPM global, energia, estilo e similaridade (Essentia)

**Achados**
- TempoCNN (pré-treinado no essentia-tensorflow) elevou o acerto exato de BPM de 65 % para 85 % em um teste independente. RhythmExtractor2013 teve erro médio de cerca de 0,1 BPM contra referências do Rekordbox em outro projeto.
- Modelos sobre Discogs-EffNet: 400 estilos, voz ou instrumental, danceability, arousal-valence, embeddings de similaridade.
- Loudness EBU R128 disponível.
- **Licenças**: Essentia é AGPLv3. Os modelos Discogs e MTG-Jamendo são CC BY-NC-SA 4.0 (não comercial).
- **Plataformas**: o essentia-tensorflow publica wheels para Linux e macOS (builds recentes cobrem até Python 3.14), sem Windows.

**Impacto**
- No Windows, rodar no WSL2/Docker.
- Uso pessoal: ok. Produto: trocar ou licenciar.
- BPM principal continua vindo do Beat This!; TempoCNN serve como verificação cruzada.

**Fontes**
- https://essentia.upf.edu/
- https://github.com/MTG/essentia
- https://pypi.org/project/essentia-tensorflow/
- https://pypi.org/project/essentia-autotagger/
- https://github.com/dhunstack/essentia-playlists-generation
- https://transactions.ismir.net/articles/10.5334/tismir.111

---

## 8. Pesquisa acadêmica sobre DJ automático

**Achados**
- Zehren, Alunno e Bientinesi entrevistaram DJs e formalizaram o "switch point": ponto de alta novidade (densidade rítmica, loudness, timbre, harmonia), sempre em fronteira de seção, seguido de uma seção que se sustenta sozinha na mixagem. Em faixas desconhecidas, cerca de 90 % dos pontos gerados foram utilizáveis num DJ mix (Computer Music Journal, 2022).
- Abordagem mais recente trata a detecção de cues como detecção de objetos com transformer pré-treinado (2024).
- DJtransGAN (ICASSP 2022) gera transições com EQ e fader diferenciáveis. O pipeline de dados usa fronteiras de estrutura do MSAF, beats e tom do madmom, e pareia segmentos com diferença de BPM até 5 e de tom até 2.
- Outras referências: Vande Veire e De Bie (DJ automático de drum and bass, 2018); Bittner et al. (sequenciamento e transições de playlists, ISMIR 2017); Cliff (Hang the DJ, 2000).

**Impacto**
- As regras do planejador v1 seguem os critérios de switch point. Modelos aprendidos ficam para depois da calibração com feedback.

**Fontes**
- https://arxiv.org/abs/2007.08411
- https://direct.mit.edu/comj/article/46/3/67/117159/Automatic-Detection-of-Cue-Points-for-the
- https://arxiv.org/abs/2407.06823
- https://arxiv.org/abs/2110.06525
- https://github.com/ChenPaulYu/DJtransGAN

---

## 9. Separação de fontes

**Achados**
- Demucs (htdemucs) separa voz, bateria, baixo e resto. Licença MIT. Pesado em CPU; GPU recomendada.

**Impacto**
- Base do mapa de vocal e de grave por compasso, que alimenta os vetos do planejador.

**Fontes**
- https://github.com/facebookresearch/demucs

---

## 10. Exportação para software de DJ

**Achados**
- pyrekordbox lê o banco criptografado do Rekordbox 6 e 7, importa e exporta XML e interpreta arquivos de análise (beatgrid, cues, estrutura, forma de onda).
- Import de XML no Rekordbox só adiciona e atualiza faixas; não remove.
- Cues no XML ficam em `POSITION_MARK`; beatgrid em `TEMPO`.

**Fontes**
- https://github.com/dylanljones/pyrekordbox
- https://pyrekordbox.readthedocs.io/
- https://github.com/koraysels/rekordbox-library-fixer
- https://github.com/diracdeltas/rekordbox-scripts

---

## 11. Render da prévia

**Achados**
- pedalboard (Spotify, GPLv3): EQ, filtros, ganho e time-stretch sobre arquivos locais.
- Rubber Band: time-stretch de qualidade; GPL com licença comercial disponível.

**Impacto**
- Prévia fiel das transições planejadas, só para audição local.

**Fontes**
- https://github.com/spotify/pedalboard
- https://breakfastquay.com/rubberband/

---

## 12. Jev (TypeSafe AI) — modelo "System One"

**Achados**
- Lançado em 15/09/2026 pela TypeSafe AI (São Francisco), em early access. Fundador ex-OpenAI, co-autor do trabalho que originou o RLHF.
- Não gera texto. Recebe `state` (texto/estado estruturado) e `questions` tipadas; devolve valores tipados com probabilidades e confiança calibrada. Todas as perguntas são avaliadas em paralelo, numa única chamada.
- Primitivas: Choice (escolha em lista, cardinalidade até 255), Score (nota em rubrica) e Noul (probabilidade de uma afirmação ser verdadeira).
- Resposta em 70–500 ms. Preço publicado: US$ 0,042 por milhão de tokens de entrada, saída gratuita.
- Serviço na nuvem (hoje baseado na costa oeste dos EUA). Entrada é texto/estado estruturado; imagens ainda não.
- Recomendação oficial: perguntas atômicas e decompostas; combinar os resultados no código. O próprio console aponta limites em tarefas de raciocínio longo, domínios especializados e geração.
- Integrações citadas: LangChain (TypeSafeClassifier) e um adaptador em Python.
- Um guia de terceiros cita um domínio não oficial para a API; usar só `typesafe.ai`, `docs.typesafe.ai` e `console.typesafe.ai`.

**Impacto**
- Jev não analisa áudio. Ele decide sobre as features produzidas por Beat This! e extratores.
- Bom para decisões em volume: pontuar todos os pares da playlist, escolher tipo de transição, classificar seções, checar vetos.
- Precisa de fallback de regras e de validação, porque mixagem é domínio especializado.
- Chamada vai para a nuvem: enviar só IDs internos e números, sem áudio e sem metadado do Spotify.

**Fontes**
- https://typesafe.ai/blog/introducing-system-one-models-and-jev
- https://docs.typesafe.ai/introduction
- https://www.langchain.com/blog/building-a-harness-with-jev
- https://flaviocopes.com/jev/
- https://www.mindstudio.ai/blog/jev-system-one-model-classification
- https://www.theregister.com/ai-and-ml/2026/09/16/typesafe-ai-debuts-model-for-machines-that-plays-doom/5296711

---

## 13. Google Stitch (design da interface)

**Achados**
- Ferramenta do Google Labs que gera telas a partir de texto ou imagem, com design system próprio exportável como `DESIGN.md`.
- Há um Stitch MCP e skills oficiais (`google-labs-code/stitch-skills`) que levam o design direto para o Claude Code, sem copiar HTML à mão. Autenticação por API key gerada nas configurações do Stitch.
- Exporta HTML/CSS; a conversão para React fica a cargo do agente de código.

**Impacto**
- Fluxo: desenhar as telas do chat de DJ no Stitch → exportar `DESIGN.md` → Claude Code gera os componentes React lendo o design pelo MCP.

**Fontes**
- https://github.com/google-labs-code/stitch-skills
- https://felixschmidt.software/en/blog/google-stitch-mcp-claude-code
- https://pasqualepillitteri.it/en/news/647/google-stitch-mcp-export-claude-code-design-to-code

---

## 14. Claude Agent SDK (orquestração local)

**Achados**
- Biblioteca (Python e TypeScript) que embute o agente do Claude Code na sua aplicação: mesmas ferramentas, loop, MCP, permissões, hooks, sessões e carregamento de `.claude/`.
- Autenticação por API key da Anthropic. A documentação não permite que apps de terceiros usem login do claude.ai sem aprovação prévia.

**Impacto**
- É o backend natural da interface de chat: a UI conversa com um servidor local que roda o Agent SDK com os MCPs do projeto. O controle de permissões implementa o gate "Enviar ao Spotify?".
- Custo por uso da API, separado da assinatura do Claude.

**Fontes**
- https://code.claude.com/docs/en/agent-sdk/overview

---

## Pendências a validar no protótipo

- Precisão do Beat This! em faixas com intro só de percussão e em rock com tempo variável (playlist 2026).
- Qual combinação de estimadores de tom acerta mais contra os valores do Mixar.
- Tempo de análise por faixa com e sem GPU, para dimensionar a fila.
- Se o allin1 instala limpo no WSL2 da máquina; se não, fallback por novidade.
- Acesso ao early access do Jev e concordância das decisões dele com o planejador de regras.
- Custo real de uso do Agent SDK (API) por sessão de montagem de set.
