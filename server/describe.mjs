import path from 'node:path';

const MAX = 80;

function clip(s) {
  if (!s) return '';
  const one = String(s).replace(/\s+/g, ' ').trim();
  return one.length > MAX ? one.slice(0, MAX - 1) + '…' : one;
}

// One-line human summary of a tool call, shared by transcript parsing and hook events.
export function describeTool(name, input = {}) {
  switch (name) {
    case 'Bash':
      return clip(input.description || input.command);
    case 'Read':
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return clip(input.file_path && path.basename(input.file_path));
    case 'Grep':
    case 'Glob':
      return clip(input.pattern);
    case 'Agent':
    case 'Task':
      return clip(input.description);
    case 'WebFetch':
      return clip(input.url);
    case 'WebSearch':
      return clip(input.query);
    case 'Skill':
      return clip(input.skill);
    default:
      return '';
  }
}
