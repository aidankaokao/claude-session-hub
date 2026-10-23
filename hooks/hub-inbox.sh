#!/bin/sh
# Stop hook, run with asyncRewake: after each turn, wait in the background for a message
# from the local Session Hub. A message is printed on stderr with exit 2, which wakes Claude
# and shows it the text. No message, hub down, or cancelled: exit 0 silently.
msg=$(curl -s -m 43100 -X POST -H 'Content-Type: application/json' --data-binary @- \
  "http://127.0.0.1:${CLAUDE_HUB_PORT:-4317}/inbox" 2>/dev/null)
if [ -n "$msg" ]; then
  printf '%s\n' "$msg" >&2
  exit 2
fi
exit 0
