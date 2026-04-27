function getAccessToken() {
  try {
    return sessionStorage.getItem('teleop_access_token') || '';
  } catch {
    return '';
  }
}

function wsBaseUrl() {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}`;
}

async function apiJson(path, options = {}) {
  const token = getAccessToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(path, {
    ...options,
    credentials: 'include',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || response.statusText);
    err.status = response.status;
    throw err;
  }
  return data;
}

function renderHelpList(container, items) {
  if (!items.length) {
    container.innerHTML = '<p class="hint">No open help requests.</p>';
    return;
  }
  container.innerHTML = items
    .map(
      (h) => `
    <article class="help-card" data-id="${h.id}">
      <div><strong>Robot</strong> <code>${h.robotId}</code></div>
      <div><strong>Created</strong> ${new Date(h.createdAt).toLocaleString()}</div>
      ${h.payload?.message ? `<div>${escapeHtml(String(h.payload.message))}</div>` : ''}
      <button type="button" class="btn-accept" data-id="${h.id}">Accept</button>
    </article>`,
    )
    .join('');

  container.querySelectorAll('.btn-accept').forEach((btn) => {
    btn.addEventListener('click', () => acceptHelp(btn.getAttribute('data-id')));
  });
}

function escapeHtml(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const helpListEl = document.getElementById('help-list');
const sessionBoxEl = document.getElementById('session-box');
const sessionHintEl = document.getElementById('session-hint');
const helpErrorEl = document.getElementById('help-error');

async function loadHelpRequests() {
  if (!helpListEl) {
    return;
  }
  try {
    const data = await apiJson('/api/teleoperator/help-requests');
    renderHelpList(helpListEl, data.helpRequests || []);
    if (helpErrorEl) {
      helpErrorEl.textContent = '';
      helpErrorEl.classList.add('hidden');
    }
  } catch (e) {
    if (helpErrorEl) {
      helpErrorEl.textContent = e.message || 'Failed to load help requests';
      helpErrorEl.classList.remove('hidden');
    }
  }
}

async function acceptHelp(id) {
  if (!id) {
    return;
  }
  try {
    const data = await apiJson(`/api/teleoperator/help-requests/${id}/accept`, {
      method: 'POST',
    });
    const token = getAccessToken();
    const sessionId = data.session?.id;
    const wsProxy = sessionId && token
      ? `${wsBaseUrl()}/ws/teleop/session/${sessionId}?token=${encodeURIComponent(token)}`
      : '';
    if (sessionBoxEl) {
      sessionBoxEl.innerHTML = `
        <p><strong>sessionId</strong> (for VR / ROSBridge proxy):</p>
        <p><code id="copy-session-id">${sessionId || ''}</code></p>
        <p><strong>WebSocket URL</strong> (use instead of direct ws://robot:9090):</p>
        <p class="ws-url"><code id="copy-ws-url">${escapeHtml(wsProxy)}</code></p>
        <button type="button" id="copy-ws-btn" class="btn-secondary">Copy WebSocket URL</button>
      `;
      const copyBtn = document.getElementById('copy-ws-btn');
      const wsUrlText = document.getElementById('copy-ws-url');
      if (copyBtn && wsUrlText && wsProxy) {
        copyBtn.addEventListener('click', async () => {
          try {
            await navigator.clipboard.writeText(wsProxy);
            copyBtn.textContent = 'Copied';
          } catch {
            copyBtn.textContent = 'Copy failed';
          }
        });
      }
    }
    if (sessionHintEl) {
      sessionHintEl.textContent = 'Point your VR client at the URL above; the protocol matches ROSBridge.';
    }
    await loadHelpRequests();
  } catch (e) {
    if (helpErrorEl) {
      helpErrorEl.textContent = e.message || 'Failed to accept help request';
      helpErrorEl.classList.remove('hidden');
    }
  }
}

function connectEventsSocket() {
  const token = getAccessToken();
  if (!token) {
    if (sessionHintEl) {
      sessionHintEl.textContent = 'Sign in again to obtain a WebSocket token.';
    }
    return;
  }
  const url = `${wsBaseUrl()}/ws/teleoperator?token=${encodeURIComponent(token)}`;
  let socket;
  try {
    socket = new WebSocket(url);
  } catch {
    return;
  }
  socket.addEventListener('message', (ev) => {
    try {
      const msg = JSON.parse(ev.data);
      if (msg.type === 'help_request') {
        loadHelpRequests();
      }
    } catch {
      /* ignore */
    }
  });
  socket.addEventListener('open', () => {
    loadHelpRequests();
  });
  socket.addEventListener('close', () => {
    /* optional reconnect omitted */
  });
}

document.getElementById('logout-btn')?.addEventListener('click', async () => {
  try {
    sessionStorage.removeItem('teleop_access_token');
  } catch {
    /* ignore */
  }
  await fetch('/api/teleoperator/logout', {
    method: 'POST',
    credentials: 'include',
  });
  window.location.href = '/teleoperator/login.html';
});

if (helpListEl) {
  connectEventsSocket();
  loadHelpRequests();
}
