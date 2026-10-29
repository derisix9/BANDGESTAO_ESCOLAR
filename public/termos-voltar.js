document.getElementById('back-link').addEventListener('click', function () {
  if (window.history.length > 1 && document.referrer) { window.close(); }
});
