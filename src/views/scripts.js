// Theme Switcher
function toggleTheme() {
  const body = document.body;
  const btn = document.querySelector('.theme-toggle');
  const currentTheme = body.getAttribute('data-theme');
  
  if (currentTheme === 'dark') {
    body.removeAttribute('data-theme');
    localStorage.setItem('theme', 'light');
    btn.textContent = '🌙';
  } else {
    body.setAttribute('data-theme', 'dark');
    localStorage.setItem('theme', 'dark');
    btn.textContent = '☀️';
  }
}

// Load saved theme on page load
document.addEventListener('DOMContentLoaded', () => {
  const savedTheme = localStorage.getItem('theme');
  const btn = document.querySelector('.theme-toggle');
  if (savedTheme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    btn.textContent = '☀️';
  } else {
    btn.textContent = '🌙';
  }
});

// Modal & confirm functions
function confirmAction(msg, url) {
  if (confirm(msg)) window.location.href = url;
}
function showModal(id) {
  document.getElementById(id)?.classList.add('active');
}
function hideModal(id) {
  document.getElementById(id)?.classList.remove('active');
}
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
  }
});
