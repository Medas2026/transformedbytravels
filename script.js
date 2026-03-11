// Contact form submission handler
document.getElementById('planningForm').addEventListener('submit', function(e) {
  e.preventDefault();
  const success = document.getElementById('formSuccess');
  success.style.display = 'block';
  this.reset();
  setTimeout(() => { success.style.display = 'none'; }, 5000);
});
