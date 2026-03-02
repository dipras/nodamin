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
