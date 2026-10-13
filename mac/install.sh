#!/bin/sh
# Install (or update) Stardew Desk in ~/Applications and start it.
# Usage: double-click「安装或更新.command」, or from the project folder: sh mac/install.sh
set -e
cd "$(dirname "$0")/.."
APP="$HOME/Applications/Stardew Desk.app"

echo "› 打包…"
pkill -f "Stardew Desk.app/Contents/MacOS" 2>/dev/null || true
sleep 0.5
sh mac/build.sh "$APP" local.stardewdesk.app "$PWD"

echo "› 启动"
open "$APP"
echo "完成。菜单栏右上角的叶子图标就是 Stardew Desk。"
echo "第一次运行会弹出设置窗口，从你的星露谷里读取画面。"
echo "出问题时可以看日志：open ~/Library/Logs/StardewDesk.log"
