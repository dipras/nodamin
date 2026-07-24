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

// Searchable sidebars
document.querySelectorAll('[data-sidebar-search]').forEach((input) => {
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase();
    const sidebar = input.closest('.sidebar');
    const items = [...sidebar.querySelectorAll('[data-sidebar-item]')];
    let visible = 0;
    items.forEach((item) => {
      const matches = item.dataset.label.includes(query);
      item.hidden = !matches;
      if (matches) visible++;
    });
    const empty = sidebar.querySelector('[data-sidebar-empty]');
    if (empty) empty.hidden = visible !== 0;
  });
});

// Database dashboard filtering and sorting
(function () {
  const grid = document.getElementById('database-grid');
  const search = document.getElementById('database-search');
  const sort = document.getElementById('database-sort');
  const empty = document.getElementById('database-empty');
  if (!grid || !search || !sort || !empty) return;

  const recentKey = 'nodamin-recent-databases';
  const cards = [...grid.querySelectorAll('[data-database-card]')];
  const getRecent = () => {
    try {
      const value = JSON.parse(localStorage.getItem(recentKey) || '[]');
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  };

  function refresh() {
    const query = search.value.trim().toLocaleLowerCase();
    const recent = getRecent();
    const recentIndex = new Map(recent.map((name, index) => [name, index]));
    const mode = sort.value;
    cards.sort((a, b) => {
      const aName = a.dataset.database || '';
      const bName = b.dataset.database || '';
      if (mode === 'recent') {
        const aIndex = recentIndex.get(aName) ?? Number.MAX_SAFE_INTEGER;
        const bIndex = recentIndex.get(bName) ?? Number.MAX_SAFE_INTEGER;
        if (aIndex !== bIndex) return aIndex - bIndex;
      }
      const direction = mode === 'name-desc' ? -1 : 1;
      return direction * aName.localeCompare(bName, undefined, { sensitivity: 'base' });
    });

    let visible = 0;
    cards.forEach((card) => {
      const matches = card.dataset.name.includes(query);
      card.hidden = !matches;
      grid.appendChild(card);
      if (matches) visible++;
    });
    empty.hidden = visible !== 0 || cards.length === 0;
  }

  grid.addEventListener('click', (event) => {
    const link = event.target.closest('[data-database-link]');
    if (!link) return;
    const name = link.dataset.databaseLink;
    const recent = getRecent().filter((item) => item !== name);
    recent.unshift(name);
    localStorage.setItem(recentKey, JSON.stringify(recent.slice(0, 20)));
  });
  search.addEventListener('input', refresh);
  sort.addEventListener('change', refresh);
  refresh();
})();

// Keep overflow menus tidy.
document.addEventListener('click', (event) => {
  document.querySelectorAll('.action-menu[open]').forEach((menu) => {
    if (!menu.contains(event.target)) menu.removeAttribute('open');
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    document.querySelectorAll('.action-menu[open]').forEach((menu) => menu.removeAttribute('open'));
  }
});
