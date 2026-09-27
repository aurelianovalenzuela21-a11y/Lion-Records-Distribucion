const { esc, dashPage } = require('../render');

function initials(name) {
  return String(name || '').split(' ').map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
}

function accessesPage({ user, artists, users, error, success }) {
  const artistUsers = users.filter(u => u.role === 'artist');

  const rows = artistUsers.length
    ? artistUsers.map(u => {
        const artist = artists.find(a => a.slug === u.artistSlug);
        const photoSrc = artist && artist.avatarUrl ? `${esc(artist.avatarUrl)}${artist.avatarVersion ? `?v=${artist.avatarVersion}` : ''}` : '';
        return `
      <tr>
        <td>
          ${photoSrc
            ? `<img src="${photoSrc}" alt="${esc(u.name)}" class="avatar-thumb">`
            : `<div class="avatar-thumb avatar-thumb-empty">${esc(initials(u.name))}</div>`}
        </td>
        <td>${esc(u.name)}</td>
        <td>${esc(u.email)}</td>
        <td><code>${esc(u.artistSlug)}</code></td>
        <td>${artist ? (artist.active ? '<span class="pill pill-ok">Activo</span>' : '<span class="pill pill-neutral">Inactivo</span>') : '<span class="pill pill-error">Sin artista</span>'}</td>
        <td>
          <form method="POST" action="/dashboard/admin/accesos/${esc(u.artistSlug)}/restablecer" style="display:inline" onsubmit="return confirm('¿Generar una contraseña nueva para ${esc(u.name)}? La anterior dejará de funcionar.');">
            <button type="submit" class="btn btn-ghost btn-sm">Restablecer contraseña</button>
          </form>
        </td>
        <td>
          <form method="POST" action="/dashboard/admin/artistas/${esc(u.artistSlug)}/foto" class="avatar-url-form">
            <input type="url" name="imageUrl" placeholder="URL de la foto (Spotify, etc.)">
            <button type="submit" class="btn btn-ghost btn-sm">Guardar foto</button>
          </form>
        </td>
        <td>
          <form method="POST" action="/dashboard/admin/artistas/${esc(u.artistSlug)}/eliminar" style="display:inline" onsubmit="return confirm('¿Eliminar por completo a ${esc(u.name)}? Se borrará su acceso y su ficha de artista. Esto no se puede deshacer.');">
            <button type="submit" class="btn btn-ghost btn-sm btn-danger">Eliminar</button>
          </form>
        </td>
      </tr>`;
      }).join('\n')
    : '';

  const body = `
    <div class="dash-header">
      <h1>Accesos de artistas</h1>
      <p>Crea el acceso a la plataforma para un nuevo artista (usuario y contraseña) o restablece la contraseña de uno existente.</p>
    </div>

    ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
    ${success ? `<div class="alert alert-success">${esc(success)}</div>` : ''}

    <div class="card form-card" style="margin-bottom:34px;">
      <h3 class="form-section-title" style="margin-top:0">Generar nuevo acceso</h3>
      <form method="POST" action="/dashboard/admin/accesos/nuevo">
        <div class="field-row">
          <div class="field">
            <label for="name">Nombre del artista</label>
            <input type="text" id="name" name="name" required placeholder="Ej. Los del Palapo">
          </div>
          <div class="field">
            <label for="email">Correo de acceso (opcional)</label>
            <input type="email" id="email" name="email" placeholder="se genera automáticamente si lo dejas vacío">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="genre">Género (opcional)</label>
            <input type="text" id="genre" name="genre" placeholder="Ej. Regional Mexicano">
          </div>
          <div class="field">
            <label for="region">Región (opcional)</label>
            <input type="text" id="region" name="region" placeholder="Ej. Sinaloa">
          </div>
        </div>
        <div class="field">
          <label for="password">Contraseña (opcional)</label>
          <input type="text" id="password" name="password" placeholder="déjalo vacío para generar una automáticamente">
        </div>
        <div class="actions-row">
          <button type="submit" class="btn btn-gold">Generar acceso</button>
        </div>
      </form>
    </div>

    <div class="card" style="margin-bottom:60px;">
      <h3>Artistas con acceso</h3>
      <p class="card-sub">Cuentas activas en la plataforma</p>
      ${artistUsers.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Foto</th><th>Nombre</th><th>Correo</th><th>Slug</th><th>Estado</th><th></th><th>Foto de perfil</th><th></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>` : `<div class="empty-state">Todavía no hay artistas con acceso. Crea el primero arriba.</div>`}
    </div>`;

  return dashPage('Accesos de artistas', user, body);
}

function accessCreatedPage({ user, name, email, password, slug, isReset }) {
  const body = `
    <div class="dash-header">
      <h1>${isReset ? 'Contraseña restablecida' : 'Acceso creado'}</h1>
      <p>${isReset ? `Nueva contraseña generada para ${esc(name)}.` : `El acceso para <b>${esc(name)}</b> se creó correctamente.`} Guarda o comparte estos datos ahora: por seguridad, la contraseña no se volverá a mostrar.</p>
    </div>
    <div class="card" style="max-width:520px; margin-bottom:40px;">
      <div class="field">
        <label>Correo</label>
        <input type="text" readonly value="${esc(email)}" onclick="this.select()">
      </div>
      <div class="field">
        <label>Contraseña</label>
        <input type="text" readonly value="${esc(password)}" onclick="this.select()">
      </div>
      ${!isReset ? `<div class="field"><label>Slug del artista</label><input type="text" readonly value="${esc(slug)}" onclick="this.select()"></div>` : ''}
      <div class="actions-row">
        <a href="/dashboard/admin/accesos" class="btn btn-gold">Volver a accesos</a>
        <a href="/dashboard/artistas/${esc(slug)}" class="btn btn-ghost">Ver panel del artista</a>
      </div>
    </div>`;
  return dashPage(isReset ? 'Contraseña restablecida' : 'Acceso creado', user, body);
}

module.exports = { accessesPage, accessCreatedPage };
