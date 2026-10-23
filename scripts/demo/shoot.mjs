// Drives headless Chrome over CDP and saves README screenshots.
// Usage: node shoot.mjs <cdpPort> <hubPort> <outDir> <permissionSessionId>
import fs from 'node:fs';
import path from 'node:path';

const [cdpPort, hubPort, outDir, permSid] = process.argv.slice(2);
const HUB = `http://127.0.0.1:${hubPort}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const target = await (await fetch(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
ws.addEventListener('message', (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (d.method === 'Runtime.exceptionThrown') console.error('page error:', JSON.stringify(d.params.exceptionDetails).slice(0, 400));
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') console.error('console:', JSON.stringify(d.params.args).slice(0, 300));
});
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) console.error('eval failed:', expression, JSON.stringify(r.result.exceptionDetails).slice(0, 300));
  return r.result?.result?.value;
};
async function shot(name, clip) {
  const r = await send('Page.captureScreenshot', { format: 'png', ...(clip && { clip: { x: 0, y: 0, width: 1440, ...clip, scale: 1 } }) });
  fs.writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(r.result.data, 'base64'));
  console.log('saved', name);
}

await send('Runtime.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false });
await send('Page.navigate', { url: HUB });
await sleep(4000);

// a pending web approval card for one session
await evaluate(`fetch('/api/remote-approval', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"enabled":true}' }).then(r => r.status)`);
fetch(`${HUB}/permission`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    hook_event_name: 'PermissionRequest',
    session_id: permSid,
    cwd: '/Users/demo/api-server',
    tool_name: 'Bash',
    tool_input: { command: 'npm test -- --grep "rate limit"', description: 'Run rate limit tests' },
    permission_suggestions: [],
  }),
}).catch(() => {});
await sleep(9000); // let characters walk to their spots
await shot('overview');

// hero angle: lower the camera toward the horizon, rotate a bit, zoom out
const [dx, dy, zoom] = (process.env.HERO ?? '-160,-150,40').split(',').map(Number);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900, y: 700 });
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: 900, y: 700, button: 'left', buttons: 1, clickCount: 1 });
for (let i = 1; i <= 20; i++)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 900 + (dx * i) / 20, y: 700 + (dy * i) / 20, button: 'left', buttons: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 900 + dx, y: 700 + dy, button: 'left', buttons: 0, clickCount: 1 });
for (let i = 0; i < 4; i++)
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 900, y: 600, deltaX: 0, deltaY: zoom / 4, modifiers: 2 });
await sleep(1500);
await shot('hero', { height: 640 });

await evaluate(`document.querySelector('#ctx-list li[data-id]:nth-child(3)')?.click()`);
await sleep(4000);
await shot('panel');

await evaluate(`document.getElementById('panel-close').click(); document.getElementById('open-tokens').click()`);
await sleep(2000);
await shot('tokens');

ws.close();
process.exit(0);
