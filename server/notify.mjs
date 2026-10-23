import { execFile } from 'node:child_process';

const enabled = process.platform === 'darwin' && process.env.CLAUDE_HUB_NOTIFY !== '0';

// Text is passed via argv, never interpolated into AppleScript source.
export function notify(title, message) {
  if (!enabled) return;
  execFile(
    'osascript',
    [
      '-e', 'on run argv',
      '-e', 'display notification (item 2 of argv) with title (item 1 of argv)',
      '-e', 'end run',
      title,
      message,
    ],
    () => {},
  );
}
