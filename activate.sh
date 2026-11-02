#!/usr/bin/env bash
# OJ Local Environment Activator (Bash / Zsh)
# 使い方: source ./activate.sh

if [ -d "$HOME/.bun/bin" ]; then
  case ":$PATH:" in
    *":$HOME/.bun/bin:"*) ;;
    *) export PATH="$HOME/.bun/bin:$PATH" ;;
  esac
fi

oj() {
  local curr="$PWD"
  while [ -n "$curr" ] && [ "$curr" != "/" ]; do
    if [ -f "$curr/bin/oj.ts" ]; then
      bun "$curr/bin/oj.ts" "$@"
      return $?
    fi
    curr="$(dirname "$curr")"
  done
  echo -e "\033[31m✗ エラー: 'oj' コマンドはこのプロジェクトのディレクトリ内でのみ実行可能です。\033[0m" >&2
  return 1
}

echo -e "\033[36m⚡ OJ 環境を有効化しました (プロジェクトディレクトリ内限定)\033[0m"
echo -e "   コマンド例: \033[32moj ac abc350\033[0m / \033[32moj cf 1131\033[0m / \033[32moj t\033[0m / \033[32moj b\033[0m / \033[32moj\033[0m (対話シェル)"
