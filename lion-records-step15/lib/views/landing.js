const { esc, publicPage } = require('../render');

function initials(name) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// Iconos de la sección "El sello" — trazos finos en vez del rombo genérico
// que había antes, para que se sientan parte del mismo sistema visual que
// el resto de la app (mismo estilo que los íconos del formulario).
const SELLO_ICONS = {
  contenido: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z"/></svg>',
  calendario: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/><circle cx="8.5" cy="14.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.5" cy="14.5" r="1.2" fill="currentColor" stroke="none"/></svg>',
  distribucion: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M2 12h4M18 12h4M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8"/></svg>'
};

function landingPage({ user, artists }) {
  const artistCards = artists.map(a => `
    <div class="artist-card">
      ${a.avatarUrl
        ? `<img class="avatar-photo" src="${esc(a.avatarUrl)}${a.avatarVersion ? `?v=${a.avatarVersion}` : ''}" alt="${esc(a.name)}">`
        : `<div class="avatar">${esc(initials(a.name))}</div>`}
      <h3>${esc(a.name)}</h3>
      <div class="meta">${esc(a.genre)}</div>
      <p>${esc(a.bio)}</p>
      <a href="/artistas/${esc(a.slug)}" class="btn btn-ghost btn-sm">Ver perfil</a>
    </div>`).join('\n');

  const body = `
  <header class="hero">
    <div class="container">
      <span class="eyebrow">Lion Records Mx</span>
      <h1>El sonido del regional mexicano,<br>hecho con precisión.</h1>
      <p class="lead">Sello discográfico independiente. Lanzamientos, contenido y distribución para los artistas que están definiendo el corrido moderno.</p>
      <div class="hero-actions">
        <a href="#artistas" class="btn btn-gold">Conocer artistas</a>
        <a href="/login" class="btn btn-ghost">Acceso artistas</a>
      </div>
    </div>
  </header>

  <hr class="divider">

  <section id="artistas">
    <div class="container">
      <div class="section-header">
        <h2>Nuestros artistas</h2>
        <p>Talento firmado con Lion Records, con herramientas propias de contenido y distribución.</p>
      </div>
      <div class="artist-grid">
        ${artistCards}
      </div>
    </div>
  </section>

  <section id="sello">
    <div class="container">
      <div class="section-header">
        <h2>Una plataforma, todo el sello</h2>
        <p>Detrás de cada lanzamiento hay un mismo sistema: contenido, aprobación y distribución conectados.</p>
      </div>
      <div class="feature-grid">
        <div class="feature">
          <div class="icon">${SELLO_ICONS.contenido}</div>
          <h4>Contenido automatizado</h4>
          <p>Cada artista tiene su propio flujo de generación y aprobación de contenido para redes sociales.</p>
        </div>
        <div class="feature">
          <div class="icon">${SELLO_ICONS.calendario}</div>
          <h4>Calendario de lanzamientos</h4>
          <p>Registro centralizado de sencillos, álbumes y su fecha de salida, con toda la ficha técnica.</p>
        </div>
        <div class="feature">
          <div class="icon">${SELLO_ICONS.distribucion}</div>
          <h4>Distribución</h4>
          <p>Cada lanzamiento genera el paquete de datos listo para distribuirse en las plataformas digitales.</p>
        </div>
      </div>
    </div>
  </section>

  <section>
    <div class="container">
      <div class="cta">
        <h2>¿Eres artista de Lion Records?</h2>
        <p>Entra a tu panel para gestionar contenido y lanzamientos.</p>
        <a href="/login" class="btn btn-gold">Iniciar sesión</a>
      </div>
    </div>
  </section>

  <footer id="contacto">
    <div class="container">
      <div>© ${new Date().getFullYear()} Lion Records Mx</div>
      <div>Instagram · lionrecords.mx</div>
    </div>
  </footer>`;

  return publicPage('Lion Records', user, body);
}

function artistPublicPage({ user, artist }) {
  const socials = [];
  if (artist.socials.instagram) socials.push(`<li>Instagram <span>${esc(artist.socials.instagram)}</span></li>`);
  if (artist.socials.tiktok) socials.push(`<li>TikTok <span>${esc(artist.socials.tiktok)}</span></li>`);
  if (artist.socials.facebook) socials.push(`<li>Facebook <span>${esc(artist.socials.facebook)}</span></li>`);

  const body = `
  <header class="hero">
    <div class="container">
      ${artist.avatarUrl ? `<img class="artist-hero-photo" src="${esc(artist.avatarUrl)}${artist.avatarVersion ? `?v=${artist.avatarVersion}` : ''}" alt="${esc(artist.name)}">` : ''}
      <span class="eyebrow">${esc(artist.genre)}</span>
      <h1>${esc(artist.name)}</h1>
      <p class="lead">${esc(artist.bio)}</p>
      <div class="hero-actions">
        <a href="/" class="btn btn-ghost">&larr; Volver</a>
      </div>
    </div>
  </header>

  <section>
    <div class="container">
      <div class="grid-2">
        <div class="card">
          <h3>Región</h3>
          <p style="margin-bottom:0;color:var(--text)">${esc(artist.region)}</p>
        </div>
        <div class="card">
          <h3>Redes</h3>
          <ul class="list">
            ${socials.join('\n') || '<li>Próximamente</li>'}
          </ul>
        </div>
      </div>
    </div>
  </section>

  <footer>
    <div class="container">
      <div>© ${new Date().getFullYear()} Lion Records Mx</div>
    </div>
  </footer>`;

  return publicPage(artist.name, user, body);
}

module.exports = { landingPage, artistPublicPage };
