(() => {
  const form = document.querySelector('#loginForm');
  const errorBox = document.querySelector('#loginError');
  const button = document.querySelector('#loginBtn');

  form.addEventListener('submit', async event => {
    event.preventDefault();
    errorBox.textContent = '';
    button.disabled = true;
    button.textContent = 'Signing in…';
    try {
      const response = await fetch('/api/auth/sign-in/email', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: document.querySelector('#email').value.trim().toLowerCase(),
          password: document.querySelector('#password').value,
          rememberMe: true
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || payload?.error?.message || 'Incorrect email or password.');
      window.location.replace('/');
    } catch (error) {
      errorBox.textContent = error.message || 'Could not sign in.';
      button.disabled = false;
      button.textContent = 'Sign in';
    }
  });
})();
