#!/bin/bash
# Stop the Session Hub.
exec bash "$(dirname "$0")/scripts/hub.sh" stop
