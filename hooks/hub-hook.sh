#!/bin/sh
# Forwards a Claude Code hook payload (stdin) to the local Session Hub.
# Must never block or fail the session: short timeout, output discarded, always exit 0.
curl -s -m 1 -X POST -H 'Content-Type: application/json' --data-binary @- \
  "http://127.0.0.1:${CLAUDE_HUB_PORT:-4317}/hook" >/dev/null 2>&1
exit 0
