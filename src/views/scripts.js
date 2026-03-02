// Theme Switcher with event listener
(function() {
  const btn = document.getElementById('theme-toggle');
  
  function toggleTheme() {
    const body = document.body;
    const currentTheme = body.getAttribute('data-theme');
    
    if (currentTheme === 'dark') {
      body.removeAttribute('data-theme');
      localStorage.setItem('theme', 'light');
      if (btn) btn.textContent = '🌙';
    } else {
      body.setAttribute('data-theme', 'dark');
      localStorage.setItem('theme', 'dark');
      if (btn) btn.textContent = '☀️';
    }
  }
  
  // Attach event listener
  if (btn) {
    btn.addEventListener('click', toggleTheme);
  }
  
  // Load saved theme on page load
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.setAttribute('data-theme', 'dark');
    if (btn) btn.textContent = '☀️';
  } else {
    if (btn) btn.textContent = '🌙';
  }
})();

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
