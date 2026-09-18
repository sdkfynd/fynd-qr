const scanning = location.hash.startsWith('#r/');
if (scanning) void import('./scan');
else void import('./main');
// A pasted scan link can be a same-document hash change on GitHub Pages.
window.addEventListener('hashchange', () => {
  if (scanning || location.hash.startsWith('#r/')) location.reload();
});
