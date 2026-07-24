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

// Modal & typed confirmation for destructive actions
function submitDestructiveAction(url, confirmation) {
  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  form.hidden = true;
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'confirmation';
  input.value = confirmation;
  form.appendChild(input);
  document.body.appendChild(form);
  form.submit();
}
document.addEventListener('click', (event) => {
  if (!(event.target instanceof Element)) return;
  const button = event.target.closest('.destructive-action');
  if (!button) return;
  const expected = button.dataset.confirmation || '';
  const action = button.dataset.action || 'Continue';
  const url = button.dataset.url;
  if (!expected || !url) return;
  const entered = prompt(`${action}?\n\nType "${expected}" exactly to continue:`);
  if (entered === expected) submitDestructiveAction(url, expected);
});
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
