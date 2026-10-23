#!/bin/sh
# PermissionRequest hook: asks the local Session Hub for a decision and prints its JSON answer.
# If the hub is down, has web approval off, or gives no answer, nothing is printed and
# Claude Code shows its normal permission prompt. Always exit 0.
curl -s -m 590 -X POST -H 'Content-Type: application/json' --data-binary @- \
  "http://127.0.0.1:${CLAUDE_HUB_PORT:-4317}/permission" 2>/dev/null
exit 0
