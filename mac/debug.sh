#!/bin/sh
# Run the host straight from the project folder; errors print to this terminal.
# Quit the installed app first (menu → 退出), then: sh mac/debug.sh   (Ctrl-C to stop)
cd "$(dirname "$0")/.."
osascript -l JavaScript mac/host.js "$PWD/scene"
