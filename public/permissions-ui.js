const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

async function post(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res.ok;
}

export function permissionCard(p, sessionTitle) {
  return `
    <div class="perm-card" data-perm="${esc(p.id)}">
      <div class="perm-head" data-focus="${esc(p.sessionId)}">
        <b>${esc(p.project)}</b> · ${esc(sessionTitle ?? '')}
      </div>
      <div class="perm-tool">${esc(p.tool)}${p.detail ? ` · ${esc(p.detail)}` : ''}</div>
      <pre>${esc(p.preview)}</pre>
      <div class="perm-actions">
        <button data-decision="allow" class="allow">允許</button>
        ${p.canRemember ? '<button data-decision="allowAlways" title="套用 Claude Code 建議的永久規則">允許並記住</button>' : ''}
        <button data-decision="deny" class="deny">拒絕</button>
        <button data-decision="release" class="ghost" title="不在這裡決定，交回終端機的權限對話框">交回終端</button>
      </div>
    </div>`;
}

// One delegated handler for cards wherever they are rendered (HUD list or side panel).
export function bindPermissionActions(root, onFocus) {
  root.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-decision]');
    if (btn) {
      const card = btn.closest('[data-perm]');
      card.querySelectorAll('button').forEach((b) => (b.disabled = true));
      const ok = await post('/api/permission', { id: card.dataset.perm, decision: btn.dataset.decision });
      if (!ok) card.querySelector('.perm-actions').insertAdjacentHTML('beforeend', '<span class="perm-gone">已失效</span>');
      return;
    }
    const head = e.target.closest('[data-focus]');
    if (head) onFocus(head.dataset.focus);
  });
}

export function bindRemoteToggle(input) {
  input.addEventListener('change', () => post('/api/remote-approval', { enabled: input.checked }));
}
