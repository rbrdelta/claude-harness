#!/bin/bash
# Send Daniel a Telegram message from any laptop job: telegram-notify.sh "<text>"  (or text on stdin).
# Uses the Telegram plugin's bot token and Daniel's allowlisted chat id. Exit 1 if the send fails.
DIR="$HOME/.claude/channels/telegram"
TOKEN=$(grep '^TELEGRAM_BOT_TOKEN=' "$DIR/.env" | cut -d= -f2-)
CHAT=$(python3 -c "import json;print(json.load(open('$DIR/access.json'))['allowFrom'][0])")
TEXT="${1:-$(cat)}"
[ -n "$TOKEN" ] && [ -n "$CHAT" ] && [ -n "$TEXT" ] || { echo "telegram-notify: missing token, chat or text" >&2; exit 1; }
curl -s --max-time 15 "https://api.telegram.org/bot$TOKEN/sendMessage" --data-urlencode "chat_id=$CHAT" --data-urlencode "text=$TEXT" | grep -q '"ok":true' || { echo "telegram-notify: send failed" >&2; exit 1; }
