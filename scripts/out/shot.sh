#!/bin/bash
# usage: shot.sh name route height   -> screenshot + console errors
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
DIR="$(cd "$(dirname "$0")" && pwd -W)"
timeout 150 "$CH" --headless=new --disable-gpu --hide-scrollbars --enable-logging=stderr --v=0 --window-size=1600,${3:-1000} --virtual-time-budget=45000 "--screenshot=$DIR/s/$1.png" "http://localhost:5199/#/$2" 2> "$DIR/s/$1.log" >/dev/null
grep -i "CONSOLE" "$DIR/s/$1.log" | grep -iv "gcm\|registration\|PHONE" | head -5
