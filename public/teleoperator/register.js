function initTeleopRegister() {
  const form = document.getElementById('register-form');
  const errorEl = document.getElementById('form-error');
  if (!form || !errorEl) {
    return;
  }

  const loginInput = form.querySelector('input[name="login"]');
  const passwordInput = form.querySelector('input[name="password"]');
  const walletInput = form.querySelector('input[name="walletPublicKey"]');
  if (!loginInput || !passwordInput || !walletInput) {
    return;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorEl.classList.add('hidden');
    errorEl.textContent = '';

    const body = {
      login: loginInput.value.trim(),
      password: passwordInput.value,
      walletPublicKey: walletInput.value.trim(),
    };

    let response;
    try {
      response = await fetch('/api/teleoperator/register', {
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
      errorEl.textContent = data.error || 'Registration failed';
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

    window.location.assign('/teleoperator/cabinet');
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initTeleopRegister);
} else {
  initTeleopRegister();
}
