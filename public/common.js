'use strict';

document.addEventListener('click', async (event) => {
  if (event.target && event.target.id === 'logout-btn') {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.href = '/login';
  }
});
