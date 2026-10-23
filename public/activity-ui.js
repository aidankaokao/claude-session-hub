// Activity heatmaps from ~/.claude/history.jsonl (prompts you typed): a 12-week calendar and a
// weekday × hour grid. Sequential single-hue ramp (light → dark blue); zero recedes to the surface.
const ZERO = '#ebe7df';
const RAMP = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function colorFor(n, max) {
  if (!n) return ZERO;
  const i = Math.min(RAMP.length - 1, Math.floor((n / max) * RAMP.length));
  return RAMP[i];
}

const cell = (n, max, tip) => `<i style="background:${colorFor(n, max)}" data-tip="${esc(tip)}"></i>`;

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function calendar(data) {
  // columns = weeks (Sunday first), rows = weekdays; leading blanks align the first column
  const start = new Date(`${data.from}T00:00:00`);
  const end = new Date(`${data.to}T00:00:00`);
  const max = Math.max(1, ...Object.values(data.days));
  const cells = [];
  for (let i = 0; i < start.getDay(); i++) cells.push('<i class="blank"></i>');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    const n = data.days[k] ?? 0;
    cells.push(cell(n, max, `${k}（週${WEEKDAYS[d.getDay()]}）· ${n} 則指令`));
  }
  return `<div class="cal">${cells.join('')}</div>`;
}

function weekHourGrid(data) {
  const max = Math.max(1, ...data.weekHour.flat());
  const rows = data.weekHour
    .map(
      (row, wd) =>
        `<span class="rowlabel">${WEEKDAYS[wd]}</span>` +
        row.map((n, h) => cell(n, max, `週${WEEKDAYS[wd]} ${String(h).padStart(2, '0')}:00–${String(h + 1).padStart(2, '0')}:00 · ${n} 則`)).join(''),
    )
    .join('');
  const hours = Array.from({ length: 24 }, (_, h) => `<span class="hourlabel">${h % 3 === 0 ? h : ''}</span>`).join('');
  return `<div class="wh"><span></span>${hours}${rows}</div>`;
}

function summary(data) {
  let best = { n: 0 };
  data.weekHour.forEach((row, wd) => row.forEach((n, h) => n > best.n && (best = { n, wd, h })));
  const thisWeek = (() => {
    const today = new Date(`${data.to}T00:00:00`);
    let sum = 0;
    for (let i = 0; i <= today.getDay(); i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      sum += data.days[dayKey(d)] ?? 0;
    }
    return sum;
  })();
  const peak = best.n ? `週${WEEKDAYS[best.wd]} ${best.h}:00（${best.n} 則）` : '—';
  return `
    <div class="act-stats">
      <div><b>${data.total}</b><span>近 12 週指令</span></div>
      <div><b>${thisWeek}</b><span>本週</span></div>
      <div><b>${peak}</b><span>近 4 週最忙時段</span></div>
    </div>`;
}

const legend = () =>
  `<div class="act-legend">少 <i style="background:${ZERO}"></i>${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')} 多</div>`;

export async function openActivity(root) {
  root.hidden = false;
  const body = root.querySelector('.act-body');
  body.innerHTML = '<p class="muted">載入中…</p>';
  const res = await fetch('/api/activity').catch(() => null);
  if (!res?.ok) {
    // 404 also comes from a hub still running code from before this route existed
    body.innerHTML =
      res?.status === 404
        ? '<p class="muted">讀不到活動資料：找不到 ~/.claude/history.jsonl，或 hub 還在跑舊版程式（執行 <code>npm run hub:restart</code>）</p>'
        : '<p class="muted">連不上 hub</p>';
    return;
  }
  const data = await res.json();
  const projects = data.topProjects.length
    ? `<ol class="act-projects">${data.topProjects.map((p) => `<li><span>${esc(p.project)}</span><b>${p.count}</b></li>`).join('')}</ol>`
    : '<p class="muted">—</p>';
  body.innerHTML = `
    ${summary(data)}
    <h3>每日（近 12 週）</h3>${calendar(data)}
    <h3>星期 × 小時（近 ${data.weekHourDays} 天）</h3>${weekHourGrid(data)}
    ${legend()}
    <h3>近 4 週最常用的專案</h3>${projects}
    <p class="muted">資料來源：你在 Claude Code 輸入的指令（~/.claude/history.jsonl），不含 Claude 自己的動作。</p>`;
}

export function bindActivity(root, tooltip) {
  root.querySelector('.act-close').onclick = () => (root.hidden = true);
  root.addEventListener('click', (e) => e.target === root && (root.hidden = true));
  addEventListener('keydown', (e) => e.key === 'Escape' && (root.hidden = true));
  root.addEventListener('pointermove', (e) => {
    const tip = e.target.dataset?.tip;
    tooltip.hidden = !tip;
    if (!tip) return;
    tooltip.textContent = tip;
    tooltip.style.left = `${e.clientX + 12}px`;
    tooltip.style.top = `${e.clientY + 12}px`;
  });
  root.addEventListener('pointerleave', () => (tooltip.hidden = true));
}
