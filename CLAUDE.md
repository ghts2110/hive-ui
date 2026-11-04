# hive-ui

Sidebar de conversas para o Claude Code no terminal. Visão geral no `README.md`.

## Arquitetura

- **tmux** monta o layout: um pane estreito à esquerda (sidebar) e o pane principal com o `claude`.
- Cada conversa é um processo `claude` em seu próprio pane; trocar de conversa = trocar qual pane ocupa a área principal (`swap-pane`/`join-pane`), sem matar processos.
- O sidebar é um app Node + Ink que conversa com o tmux via CLI (`tmux list-panes`, `tmux swap-pane`, ...).
- Sessão do tmux é efêmera: morre quando o terminal fecha (`destroy-unattached`). Nada é salvo em disco pelo projeto, exceto os modelos baixados para `~/.cache/hive-ui`: a voz da leitura em voz alta e o reconhecimento do ditado.

## Convenções

- Tudo em pt-br: commits, issues, PRs, README e mensagens da interface.
- Commits curtos, uma linha, imperativo, prefixados pela zona quando ajudar (`sidebar: ...`, `launcher: ...`).
- Não mexer no `~/.tmux.conf` do usuário: a config do projeto vive no repo e é carregada com `tmux -f`.
- A interface abre pelo comando `hive` (link para `bin/hive`, criado pelo `npm link`); o `claude` não é interceptado e abre sempre o Claude Code puro.
- O launcher deve chamar o binário original via `command -v claude`, sem entrar em recursão com a função antiga `claude()` que alguns ainda têm no `~/.zshrc`.

## Ambiente

- macOS, zsh, Terminal.app
- tmux 3.x (Homebrew), Node 20 (nvm)
