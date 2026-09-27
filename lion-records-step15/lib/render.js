// Versión del CSS para forzar que el navegador (y cualquier caché intermedio
// de Hostinger) descargue el archivo nuevo en cada despliegue, en vez de
// seguir usando una copia vieja guardada en caché con la misma URL.
const CSS_VERSION = '14';

function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function head(title) {
  return `
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)} · Lion Records</title>
<meta name="description" content="Lion Records Mx — sello discográfico independiente de regional mexicano.">
<meta property="og:title" content="${esc(title)} · Lion Records">
<meta property="og:image" content="https://lionrecords.mx/img/lion-logo.png">
<meta property="og:type" content="website">
<meta name="twitter:card" content="summary">
<meta name="twitter:image" content="https://lionrecords.mx/img/lion-logo.png">
<link rel="stylesheet" href="/css/style.css?v=${CSS_VERSION}">
<link rel="icon" type="image/png" href="/img/lion-logo.png">
<link rel="apple-touch-icon" href="/img/lion-logo.png">`;
}

function publicNav(user) {
  const rightLink = user
    ? `<a href="/dashboard" class="btn btn-gold btn-sm">Mi panel</a>`
    : `<a href="/login" class="btn btn-ghost btn-sm">Acceso artistas</a>`;
  return `
<nav class="nav">
  <div class="nav-inner">
    <a href="/" class="brand"><img class="brand-mark" src="/img/lion-logo.png" alt="Lion Records"> Lion Records</a>
    <div class="nav-links">
      <a href="/#artistas">Artistas</a>
      <a href="/#sello">El sello</a>
      <a href="/#contacto">Contacto</a>
      ${rightLink}
    </div>
  </div>
</nav>`;
}

function dashNav(user) {
  const homeLink = user.role === 'admin'
    ? `<a href="/dashboard/admin">Panel</a>`
    : `<a href="/dashboard/artistas/${esc(user.artistSlug)}">Mi panel</a>`;
  return `
<div class="topbar">
  <div class="container">
    <a href="/" class="brand"><img class="brand-mark" src="/img/lion-logo.png" alt="Lion Records"> Lion Records
      <span class="role-badge">${user.role === 'admin' ? 'Admin' : 'Artista'}</span>
    </a>
    <div class="nav-links">
      ${homeLink}
      <a href="/lanzamientos/nuevo">Nuevo lanzamiento</a>
      ${user.role === 'admin' ? '<a href="/admin/integraciones">Integraciones</a>' : ''}
      <form method="POST" action="/logout" style="display:inline">
        <button type="submit" class="btn btn-ghost btn-sm">Salir</button>
      </form>
    </div>
  </div>
</div>`;
}

function publicPage(title, user, bodyHtml) {
  return `<!doctype html>
<html lang="es">
<head>${head(title)}</head>
<body>
${publicNav(user)}
${bodyHtml}
</body>
</html>`;
}

function dashPage(title, user, bodyHtml, extraScript = '') {
  return `<!doctype html>
<html lang="es">
<head>${head(title)}</head>
<body class="app-shell">
${dashNav(user)}
<div class="container">
${bodyHtml}
</div>
${extraScript}
</body>
</html>`;
}

function authPage(title, bodyHtml) {
  return `<!doctype html>
<html lang="es">
<head>${head(title)}</head>
<body>
<div class="auth-shell">
  <div class="auth-card">
    <div class="brand" style="justify-content:center; margin-bottom:24px;">
      <img class="brand-mark" src="/img/lion-logo.png" alt="Lion Records"> Lion Records
    </div>
    ${bodyHtml}
  </div>
</div>
</body>
</html>`;
}

function errorPage(title, message) {
  return `<!doctype html>
<html lang="es">
<head>${head(title)}</head>
<body>
<div class="err-page">
  <div>
    <h1>${esc(title)}</h1>
    <p>${esc(message)}</p>
    <a href="/" class="btn btn-gold">Volver al inicio</a>
  </div>
</div>
</body>
</html>`;
}

module.exports = { esc, publicPage, dashPage, authPage, errorPage };
