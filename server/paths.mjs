import os from 'node:os';
import path from 'node:path';

export const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
export const SESSIONS_DIR = path.join(CLAUDE_DIR, 'sessions');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');
export const SETTINGS_FILE = path.join(CLAUDE_DIR, 'settings.json');
export const HUB_DIR = path.join(CLAUDE_DIR, 'session-hub');
// Written by the snippet that scripts/install-statusline.mjs adds to the user's status line script.
export const USAGE_FILE = path.join(HUB_DIR, 'usage.json');
export const CONTEXT_DIR = path.join(HUB_DIR, 'context'); // <session_id>.json, exact context %
export const TOKENS_FILE = path.join(HUB_DIR, 'tokens.json'); // persisted daily token totals (transcripts get cleaned up)

// Claude Code stores transcripts under projects/<cwd with every non-alphanumeric char replaced by "-">.
export function projectDirFor(cwd) {
  return path.join(PROJECTS_DIR, cwd.replace(/[^a-zA-Z0-9]/g, '-'));
}
