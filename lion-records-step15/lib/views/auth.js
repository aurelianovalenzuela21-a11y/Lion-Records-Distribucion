const { esc, authPage } = require('../render');

function loginPage({ error }) {
  const body = `
    <h1>Acceso artistas</h1>
    <p class="sub">Entra con tu correo y contraseña</p>
    ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
    <form method="POST" action="/login">
      <div class="field">
        <label for="email">Correo</label>
        <input type="email" id="email" name="email" required autofocus placeholder="tucorreo@lionrecords.mx">
      </div>
      <div class="field">
        <label for="password">Contraseña</label>
        <input type="password" id="password" name="password" required placeholder="••••••••">
      </div>
      <button type="submit" class="btn btn-gold btn-block">Iniciar sesión</button>
    </form>`;
  return authPage('Iniciar sesión', body);
}

module.exports = { loginPage };
