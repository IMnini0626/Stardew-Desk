#!/bin/sh
# Remove Stardew Desk. Your wallpaper was never changed.
# Tip: turn off「登录时启动」in its menu first, so the login item goes away cleanly.
APP="$HOME/Applications/Stardew Desk.app"
pkill -f "Stardew Desk.app/Contents/MacOS" 2>/dev/null || true
rm -rf "$APP"
echo "已卸载 Stardew Desk。"
echo "读取出来的画面、配乐和设置在 ~/Library/Application Support/Stardew Desk，不要的话可以一起删掉。"
