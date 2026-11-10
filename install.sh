#!/usr/bin/env sh
# 把 designing-grow-games 這個 skill 連到 Claude Code 的個人 skills 資料夾。可以重複執行（已存在的連結會被換成指向這裡）。
set -eu
cd "$(dirname "$0")"
mkdir -p ~/.claude/skills
ln -sfn "$(pwd)/skills/designing-grow-games" ~/.claude/skills/designing-grow-games
echo "已連結：~/.claude/skills/designing-grow-games -> $(pwd)/skills/designing-grow-games"
