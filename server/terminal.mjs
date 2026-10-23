import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// Brings the Terminal.app tab running `pid` to the front. The tty is passed via argv, never
// interpolated into AppleScript. The first call triggers macOS's Automation permission prompt.
const SCRIPT = `
on run argv
  set target to item 1 of argv
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        if tty of t is target then
          set selected tab of w to t
          set index of w to 1
          activate
          return "ok"
        end if
      end repeat
    end repeat
  end tell
  return "notfound"
end run`;

// Returns 'ok' | 'notfound' (not a Terminal.app tab, e.g. VS Code) | 'notty' | 'denied' | 'error'.
export async function focusTerminal(pid) {
  let tty;
  try {
    tty = (await run('ps', ['-o', 'tty=', '-p', String(pid)])).stdout.trim();
  } catch {
    return 'notty';
  }
  if (!tty || tty === '??') return 'notty';
  try {
    const { stdout } = await run('osascript', ['-e', SCRIPT, `/dev/${tty}`]);
    return stdout.trim() === 'ok' ? 'ok' : 'notfound';
  } catch (err) {
    // -1743: the user has not allowed this process to control Terminal
    return String(err.stderr ?? err.message).includes('-1743') ? 'denied' : 'error';
  }
}
