#!/bin/bash
# usage: shotw.sh name route width height
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
DIR="$(cd "$(dirname "$0")" && pwd -W)"
timeout 150 "$CH" --headless=new --disable-gpu --hide-scrollbars --enable-logging=stderr --v=0 --window-size=$3,$4 --virtual-time-budget=45000 "--screenshot=$DIR/s/$1.png" "http://localhost:5199/#/$2" 2> "$DIR/s/$1.log" >/dev/null
grep -i "CONSOLE" "$DIR/s/$1.log" | grep -iv "gcm\|registration\|PHONE\|vite\|Native\|Defender\|dlp" | head -3
