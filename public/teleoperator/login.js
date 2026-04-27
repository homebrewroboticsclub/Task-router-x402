function initTeleopLogin() {
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('form-error');
  if (!form || !errorEl) {
    return;
  }

  const loginInput = form.querySelector('input[name="login"]');
  const passwordInput = form.querySelector('input[name="password"]');
  if (!loginInput || !passwordInput) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const rawNext = params.get('next') || '/teleoperator/cabinet';
  const nextUrl =
    rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/teleoperator/cabinet';

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    const body = {
      login: loginInput.value.trim(),
      password: passwordInput.value,
    };

    let response;
    try {
      response = await fetch('/api/teleoperator/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
    } catch {
      errorEl.textContent = 'Network error or server unreachable';
      errorEl.classList.remove('hidden');
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      errorEl.textContent = data.error || 'Invalid login or password';
      errorEl.classList.remove('hidden');
      return;
    }

    if (data.accessToken) {
      try {
        sessionStorage.setItem('teleop_access_token', data.accessToken);
      } catch {
        /* ignore */
      }
    }

    window.location.assign(nextUrl);
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTeleopLogin);
} else {
  initTeleopLogin();
}
