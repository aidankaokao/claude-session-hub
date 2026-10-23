#!/bin/bash
# Start the Session Hub in the background (no-op if it is already running).
exec bash "$(dirname "$0")/scripts/hub.sh" start
