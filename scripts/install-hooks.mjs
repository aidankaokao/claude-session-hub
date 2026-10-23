// Adds (or with --uninstall removes) the Session Hub hooks in ~/.claude/settings.json.
// A timestamped backup of settings.json is written before every change.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SETTINGS_FILE } from '../server/paths.mjs';
import { HOOK_SCRIPT_NAME, INBOX_SCRIPT_NAME, PERMISSION_SCRIPT_NAME } from '../server/hooks.mjs';

const hooksDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
const eventScript = path.join(hooksDir, HOOK_SCRIPT_NAME);
const permissionScript = path.join(hooksDir, PERMISSION_SCRIPT_NAME);
const inboxScript = path.join(hooksDir, INBOX_SCRIPT_NAME);
const SCRIPTS = [eventScript, permissionScript, inboxScript];

// [event, hook config, matcher?]
const HOOKS = [
  ['SessionStart', { command: eventScript, timeout: 2 }],
  ['SessionEnd', { command: eventScript, timeout: 2 }],
  ['UserPromptSubmit', { command: eventScript, timeout: 2 }],
  ['PreToolUse', { command: eventScript, timeout: 2 }, '*'],
  ['PostToolUse', { command: eventScript, timeout: 2 }, '*'],
  ['Notification', { command: eventScript, timeout: 2 }],
  ['Stop', { command: eventScript, timeout: 2 }],
  // Long timeout: with web approval on, the hub holds the request until you decide in the browser.
  ['PermissionRequest', { command: permissionScript, timeout: 600 }, '*'],
  // Runs in the background after every turn and wakes the session when the hub sends it a message.
  ['Stop', { command: inboxScript, timeout: 43200, asyncRewake: true }],
];

const uninstall = process.argv.includes('--uninstall');

const raw = await fs.readFile(SETTINGS_FILE, 'utf8').catch(() => '{}');
const settings = JSON.parse(raw);
settings.hooks ??= {};

const ours = [HOOK_SCRIPT_NAME, PERMISSION_SCRIPT_NAME, INBOX_SCRIPT_NAME];
const isOurs = (group) => group.hooks?.some((h) => ours.some((name) => h.command?.includes(name)));

const events = [...new Set(HOOKS.map(([event]) => event))];
for (const event of events) {
  const groups = (settings.hooks[event] ?? []).filter((g) => !isOurs(g));
  if (!uninstall) {
    for (const [e, hook, matcher] of HOOKS) {
      if (e === event) groups.push({ ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', ...hook }] });
    }
  }
  if (groups.length) settings.hooks[event] = groups;
  else delete settings.hooks[event];
}
if (!Object.keys(settings.hooks).length) delete settings.hooks;

const backup = `${SETTINGS_FILE}.bak-hub-${Date.now()}`;
await fs.writeFile(backup, raw);
await Promise.all(SCRIPTS.map((s) => fs.chmod(s, 0o755)));
await fs.writeFile(SETTINGS_FILE, JSON.stringify(settings, null, 2) + '\n');

console.log(`${uninstall ? 'Removed' : 'Installed'} Session Hub hooks in ${SETTINGS_FILE}`);
console.log(`Backup: ${backup}`);
