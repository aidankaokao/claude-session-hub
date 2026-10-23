// Token usage / API-equivalent cost modal (data from transcripts via /api/tokens).
// Sequential single-hue ramp (light → dark blue); zero recedes to the surface.
const ZERO = '#ebe7df';
const RAMP = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function fmtTokens(n) {
  if (!n) return '0';
  for (const [d, u] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]) if (n >= d) return `${(n / d).toFixed(n >= d * 100 ? 0 : 1)}${u}`;
  return String(n);
}
export const fmtUsd = (n) => (n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`);
const totalTokens = (t) => t.input + t.output + t.read + t.write;

function colorFor(n, max) {
  if (!n) return ZERO;
  const i = Math.min(RAMP.length - 1, Math.floor((n / max) * RAMP.length));
  return RAMP[i];
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// columns = weeks (Sunday first), rows = weekdays; leading blanks align the first column
function calendar(data) {
  const start = new Date(`${data.from}T00:00:00`);
  const end = new Date(`${data.to}T00:00:00`);
  const max = Math.max(1e-9, ...Object.values(data.days).map((t) => t.cost));
  const cells = [];
  for (let i = 0; i < start.getDay(); i++) cells.push('<i class="blank"></i>');
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const k = dayKey(d);
    const t = data.days[k];
    const tip = t ? `${fmtUsd(t.cost)} · output ${fmtTokens(t.output)} · 共 ${fmtTokens(totalTokens(t))} tokens` : '沒有資料';
    cells.push(`<i style="background:${colorFor(t?.cost ?? 0, max)}" data-tip="${esc(`${k}（週${WEEKDAYS[d.getDay()]}）· ${tip}`)}"></i>`);
  }
  return `<div class="cal">${cells.join('')}</div>`;
}

function sumDays(days, to, n) {
  const end = new Date(`${to}T00:00:00`);
  const out = { input: 0, output: 0, read: 0, write: 0, cost: 0, unpriced: 0 };
  for (let i = 0; i < n; i++) {
    const d = new Date(end);
    d.setDate(end.getDate() - i);
    const t = days[dayKey(d)];
    if (t) for (const k of Object.keys(out)) out[k] += t[k];
  }
  return out;
}

const legend = () =>
  `<div class="act-legend">少 <i style="background:${ZERO}"></i>${RAMP.map((c) => `<i style="background:${c}"></i>`).join('')} 多</div>`;

const costCell = (t) => (t.unpriced && !t.cost ? '<span class="muted">未計價</span>' : fmtUsd(t.cost));

function usageTable(rows, label) {
  if (!rows.length) return '<p class="muted">—</p>';
  return `<div class="tok-table-wrap"><table class="tok-table">
    <thead><tr><th>${label}</th><th>input</th><th>output</th><th>cache 讀取</th><th>cache 寫入</th><th>等效金額</th></tr></thead>
    <tbody>${rows
      .map(
        (r) => `<tr><td title="${esc(r.name)}">${esc(r.name)}</td><td>${fmtTokens(r.input)}</td><td>${fmtTokens(r.output)}</td>
          <td>${fmtTokens(r.read)}</td><td>${fmtTokens(r.write)}</td><td>${costCell(r)}</td></tr>`,
      )
      .join('')}</tbody></table></div>`;
}

function report(data) {
  const today = sumDays(data.days, data.to, 1);
  const week = sumDays(data.days, data.to, 7);
  const month = sumDays(data.days, data.to, 30);
  const promptTokens = month.input + month.read + month.write;
  const hitRate = promptTokens ? `${Math.round((month.read / promptTokens) * 100)}%` : '—';
  const unpriced = data.byModel.filter((m) => m.unpriced);
  const gap =
    data.transcriptsSince && data.transcriptsSince > data.from
      ? `<p class="muted">Claude Code 預設只保留約 30 天的 transcript（目前最早是 ${esc(data.transcriptsSince)}）。hub 會把每日總計存在 ~/.claude/session-hub/tokens.json，從現在起的歷史會一直累積，更早的日子則沒有資料。</p>`
      : '';
  return `
    <div class="act-stats">
      <div><b>${fmtUsd(today.cost)}</b><span>今日 · output ${fmtTokens(today.output)}</span></div>
      <div><b>${fmtUsd(week.cost)}</b><span>近 7 天</span></div>
      <div><b>${fmtUsd(month.cost)}</b><span>近 30 天</span></div>
      <div><b>${hitRate}</b><span>近 30 天 cache 命中率</span></div>
    </div>
    <h3>每日等效金額（近 12 週）</h3>
    ${calendar(data)}
    ${legend()}
    ${gap}
    <h3>依模型（近 ${data.breakdownDays} 天）</h3>${usageTable(data.byModel, '模型')}
    <h3>依專案（近 ${data.breakdownDays} 天，前 ${data.byProject.length} 名）</h3>${usageTable(data.byProject, '專案')}
    <p class="muted">等效金額是用 API 牌價計算的費用，不是訂閱制的實際帳單；訂閱的限制請看左上角的額度條。
    cache 讀取通常數量最多，但每個 token 只要 input 價格的 2.5%–10%。${
      unpriced.length ? `${unpriced.map((m) => esc(m.name)).join('、')} 沒有價格資料，只計 token。` : ''
    }</p>`;
}

export async function openTokens(root) {
  root.hidden = false;
  const body = root.querySelector('.act-body');
  body.innerHTML = '<p class="muted">載入中…</p>';
  const res = await fetch('/api/tokens').catch(() => null);
  const data = res?.ok ? await res.json() : null;
  if (!data) {
    // 404 also comes from a hub still running code from before this route existed
    body.innerHTML = !res
      ? '<p class="muted">連不上 hub</p>'
      : res.status === 404
        ? '<p class="muted">hub 還在跑舊版程式，執行 <code>npm run hub:restart</code></p>'
        : '<p class="muted">讀取失敗，請看 hub 的 log</p>';
    return;
  }
  body.innerHTML = report(data);
}

export function bindTokens(root, tooltip) {
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
