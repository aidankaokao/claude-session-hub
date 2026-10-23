// Adds (or with --uninstall removes) a snippet in your status line script that shares the account's
// 5-hour / weekly rate limits with the hub. The snippet goes right after the line that reads stdin.
// A timestamped backup of the script is written before every change.
import fs from 'node:fs/promises';
import os from 'node:os';
import { CONTEXT_DIR, HUB_DIR, SETTINGS_FILE, USAGE_FILE } from '../server/paths.mjs';

const BEGIN = '# >>> claude-session-hub usage >>>';
const END = '# <<< claude-session-hub usage <<<';
const SNIPPET = `${BEGIN}
# Shares the account's 5-hour / weekly rate limits and this session's exact context usage
# with Claude Session Hub. Files are written atomically (temp file + mv); fields that are
# absent (API-key users, before the first response) are skipped.
hub_now=$(date +%s)
hub_usage=$(echo "$input" | jq -c --argjson now "$hub_now" 'select(.rate_limits) | {rate_limits, updatedAt: $now}' 2>/dev/null)
if [ -n "$hub_usage" ]; then
  mkdir -p "${HUB_DIR}" && echo "$hub_usage" > "${USAGE_FILE}.$$" && mv "${USAGE_FILE}.$$" "${USAGE_FILE}"
fi
hub_sid=$(echo "$input" | jq -r '.session_id // empty' 2>/dev/null)
hub_ctx=$(echo "$input" | jq -c --argjson now "$hub_now" 'select(.context_window.used_percentage != null) | {pct: .context_window.used_percentage, size: .context_window.context_window_size, updatedAt: $now}' 2>/dev/null)
case "$hub_sid" in
  ''|*[!A-Za-z0-9-]*) ;; # missing or unexpected characters: never build a path from it
  *)
    if [ -n "$hub_ctx" ]; then
      mkdir -p "${CONTEXT_DIR}" && echo "$hub_ctx" > "${CONTEXT_DIR}/$hub_sid.json.$$" && mv "${CONTEXT_DIR}/$hub_sid.json.$$" "${CONTEXT_DIR}/$hub_sid.json"
    fi
    ;;
esac
${END}`;

const uninstall = process.argv.includes('--uninstall');

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const settings = JSON.parse(await fs.readFile(SETTINGS_FILE, 'utf8'));
const command = settings.statusLine?.command;
if (!command) fail('No statusLine command in settings.json; add the snippet to your status line script by hand.');

// Commands look like "bash /path/to/script.sh" or "/path/to/script.sh"; find the script file in it.
const scriptPath = command
  .split(/\s+/)
  .map((p) => p.replace(/^~(?=\/)/, os.homedir()))
  .find((p) => p.startsWith('/') && p.endsWith('.sh'));
if (!scriptPath) fail(`Could not find a .sh script in statusLine command: ${command}`);

const original = await fs.readFile(scriptPath, 'utf8');
// Insert and strip must be exact inverses so uninstall restores the script byte for byte.
const stripped = original.replace(new RegExp(`${BEGIN}[\\s\\S]*?${END}\\n`), '');

let next;
if (uninstall) {
  next = stripped;
} else {
  // The snippet needs the JSON in $input, so it goes right after `input=$(cat)`.
  const lines = stripped.split('\n');
  const at = lines.findIndex((l) => /^\s*input=\$\(cat\)\s*$/.test(l));
  if (at === -1) fail(`${scriptPath} has no "input=$(cat)" line; add the snippet by hand:\n\n${SNIPPET}`);
  lines.splice(at + 1, 0, SNIPPET);
  next = lines.join('\n');
}

if (next === original) {
  console.log('Nothing to change.');
  process.exit(0);
}
const backup = `${scriptPath}.bak-hub-${Date.now()}`;
await fs.writeFile(backup, original);
await fs.writeFile(scriptPath, next);
console.log(`${uninstall ? 'Removed' : 'Installed'} usage snippet in ${scriptPath}`);
console.log(`Backup: ${backup}`);
