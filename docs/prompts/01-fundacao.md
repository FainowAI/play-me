# Prompt 01 — Fundação do repositório

Cole no Claude Code aberto em `C:\Users\Antônio\Desktop\Play.me`.

```
Você está no repositório do Play.Me. Antes de qualquer ação, leia nesta ordem:
CLAUDE.md, docs/decisoes.md, design/DESIGN.md (só as seções 1, 5 e 9) e packages/README.md.

Objetivo deste prompt: deixar a fundação pronta para a Fase 0. Nada de análise de áudio, UI ou backend ainda.

Contexto:
- Windows com WSL2 (Ubuntu). O analisador Python roda no WSL2; o resto roda no Windows.
- O MCP spotify-dj está em funcionamento no Claude Desktop a partir de
  C:\Users\Antônio\Desktop\mcps\spotify-dj-mcp-server\spotify-dj-mcp-server.
  Uma cópia do código (sem node_modules, dist e .env) já está em packages/mcp-server.
  NÃO mova nem altere a pasta original em Desktop\mcps: o Claude Desktop depende dela.
- MVP (decisão D14): o set termina numa playlist nova e privada no Spotify. Render no app é pós-MVP.

Tarefas, na ordem:

1. Git
   - git init, confira o .gitignore (segredos, data/, áudio e caches fora do git).
   - Commit inicial "chore: initial Play.Me repository base" com o que já existe (mensagens de commit em inglês, conforme o CLAUDE.md).

2. Workspace Node
   - package.json na raiz com npm workspaces: ["packages/*", "apps/*"], "private": true, engines node >= 20.12.
   - tsconfig.base.json na raiz (strict, noUncheckedIndexedAccess, module Node16). packages/mcp-server/tsconfig.json passa a estender a base sem mudar o comportamento.
   - Scripts na raiz: "build", "test" (roda os testes do mcp-server), "typecheck".

3. packages/mcp-server
   - npm install e npm run build a partir da raiz.
   - Rode test:engine e test:server. Os dois precisam passar sem alterar a lógica.
   - Se precisar ajustar algo para funcionar dentro do workspace, faça o mínimo e registre.

4. services/analyzer (esqueleto, no WSL2)
   - pyproject.toml (Python 3.11+), dependências só de base: fastapi, uvicorn, pydantic, pytest, ruff, mypy.
   - O ambiente virtual fica no home do WSL (ex.: ~/.venvs/playme-analyzer), não em /mnt/c, por desempenho. Documente o comando de ativação no README do analisador.
   - analyzer/api.py com GET /health devolvendo {"status":"ok","version":"0.0.1"}, escutando só em 127.0.0.1.
   - tests/test_health.py. pytest, ruff e mypy precisam passar.
   - NÃO instale Beat This!, PyTorch, Essentia ou Demucs ainda: isso é do prompt 02 em diante.

5. Registro do ambiente
   - Crie docs/decisions/0001-ambiente.md com o que você encontrou: versão do Windows, distro e versão do WSL, Python no WSL, Node no Windows, ffmpeg (instalado ou não), GPU NVIDIA (saída de nvidia-smi no WSL, se houver).
   - Se faltar ffmpeg no WSL, mostre o comando de instalação e peça minha confirmação antes de rodar.

6. Fechamento
   - Commit "chore: workspace foundation and analyzer skeleton".
   - Acrescente em docs/decisoes.md qualquer decisão tomada neste prompt (com data e motivo).
   - Termine com um resumo curto: o que foi feito, o que falhou, e a linha "Sincronizar o quadro do projeto: <lista do que mudou em docs/>".

Não faça:
- Criar código em apps/web ou apps/server (só existem os READMEs).
- Alterar playlists ou chamar ferramentas que escrevem no Spotify.
- Commitar .env, tokens ou qualquer arquivo de áudio.

Critério de aceite:
- git log com os dois commits.
- `npm run build` e `npm test` na raiz passam (test:engine e test:server verdes).
- No WSL2: `pytest`, `ruff check` e `mypy` passam em services/analyzer; `curl http://127.0.0.1:<porta>/health` responde ok.
- docs/decisions/0001-ambiente.md preenchido.
- Pasta original do MCP em Desktop\mcps intocada.
```
