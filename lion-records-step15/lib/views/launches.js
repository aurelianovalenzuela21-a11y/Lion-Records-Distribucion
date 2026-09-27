const { esc, dashPage } = require('../render');
const { CONTRIBUTOR_ROLES } = require('../contributor-roles');

const TIPO_A_FORMATO = {
  'Sencillo': 'SINGLE',
  'EP': 'EP',
  'Álbum': 'ALBUM',
  'Colaboración': 'SINGLE'
};

// Los datos de copyright son los mismos para todo el catálogo de Lion
// Records — no varían por lanzamiento, así que se fijan aquí en vez de
// dejar que se escriban a mano en cada ficha.
const COPYRIGHT_DEFAULTS = {
  ano: new Date().getFullYear(),
  texto: `${new Date().getFullYear()} Lion Records Mx`,
  courtesy: 'Lion Records Mx'
};

function parseCredits(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(c => ({ role: String((c && c.role) || '').trim(), name: String((c && c.name) || '').trim() }))
      .filter(c => c.role && c.name);
  } catch (e) {
    return [];
  }
}

// Convierte el texto plano del tracklist ("Título ; ISRC ; Duración ;
// Artista(s)" una pista por línea) en filas estructuradas, para precargar
// las filas dinámicas del formulario cuando se edita un lanzamiento.
function tracklistTextToRows(raw) {
  if (!raw) return [];
  return String(raw).split('\n').map(l => l.trim()).filter(Boolean).map(line => {
    const parts = line.split(';').map(p => (p || '').trim());
    return { titulo: parts[0] || '', isrc: parts[1] || '', duracion: parts[2] || '', artistas: parts[3] || '' };
  });
}

// Pequeño set de iconos SVG (trazo, sin dependencias externas) usados en los
// botones de subida de archivos y en el reproductor fijo.
const ICONS = {
  cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.6 4.6 0 0 1-.6-9.16 5.5 5.5 0 0 1 10.6-2.06A4.5 4.5 0 0 1 17.5 18H7z"/><path d="M12 12v7"/><path d="M9 15l3-3 3 3"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.7"/><path d="M21 15l-5-5L5 21"/></svg>',
  music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
  atmos: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>',
  video: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="14" height="14" rx="2.5"/><path d="M16 10l6-3.2v10.4L16 14"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
  chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>'
};

// Barra de reproducción fija al fondo del navegador, compartida por el
// formulario de lanzamiento: se activa en cuanto hay un audio (nuevo o ya
// subido) y se usa tanto para escuchar como para capturar el "segundo
// actual" en el tracklist y el inicio del promocional de TikTok.
function playerBarHtml() {
  return `
    <div class="player-bar" id="player-bar">
      <div class="player-bar-inner">
        <button type="button" class="player-play" id="player-play">${ICONS.play}</button>
        <div class="player-meta">
          <div class="player-title" id="player-title">Audio</div>
          <div class="player-sub">Reproductor</div>
        </div>
        <div class="player-seek-wrap">
          <span class="player-time" id="player-current">0:00</span>
          <input type="range" class="player-seek" id="player-seek" min="0" max="1000" value="0">
          <span class="player-time" id="player-duration">0:00</span>
        </div>
      </div>
    </div>
    <div class="player-spacer" id="player-spacer" hidden></div>`;
}

function playerBarScript() {
  return `
  var ICON_PLAY = ${JSON.stringify(ICONS.play)};
  var ICON_PAUSE = ${JSON.stringify(ICONS.pause)};
  var player = {
    audio: new Audio(),
    bar: document.getElementById('player-bar'),
    spacer: document.getElementById('player-spacer'),
    playBtn: document.getElementById('player-play'),
    seek: document.getElementById('player-seek'),
    curEl: document.getElementById('player-current'),
    durEl: document.getElementById('player-duration'),
    titleEl: document.getElementById('player-title'),
    objectUrl: null,
    ready: false,
    seeking: false
  };
  player.audio.preload = 'metadata';

  function padTime(n) { return String(n).padStart(2, '0'); }
  function formatTime(s) {
    s = Math.max(0, Math.floor(s || 0));
    return Math.floor(s / 60) + ':' + padTime(s % 60);
  }
  window.lrFormatTime = formatTime;

  function playerSetSource(url, title, isBlob) {
    if (player.objectUrl) { URL.revokeObjectURL(player.objectUrl); player.objectUrl = null; }
    if (isBlob !== false) player.objectUrl = url;
    player.ready = false;
    player.audio.src = url;
    if (player.titleEl) player.titleEl.textContent = title || 'Audio';
    if (player.bar) player.bar.classList.add('is-active');
    if (player.spacer) player.spacer.hidden = false;
  }
  window.lrPlayerSetSource = playerSetSource;
  window.lrGetCurrentSecond = function () { return player.ready ? Math.floor(player.audio.currentTime) : null; };

  player.audio.addEventListener('loadedmetadata', function () {
    player.ready = true;
    if (player.durEl) player.durEl.textContent = formatTime(player.audio.duration);
    document.querySelectorAll('.seek-btn').forEach(function (b) { b.disabled = false; });
  });
  player.audio.addEventListener('timeupdate', function () {
    if (player.curEl) player.curEl.textContent = formatTime(player.audio.currentTime);
    if (!player.seeking && player.audio.duration && player.seek) {
      player.seek.value = Math.round((player.audio.currentTime / player.audio.duration) * 1000);
    }
  });
  player.audio.addEventListener('play', function () { if (player.playBtn) player.playBtn.innerHTML = ICON_PAUSE; });
  player.audio.addEventListener('pause', function () { if (player.playBtn) player.playBtn.innerHTML = ICON_PLAY; });
  if (player.playBtn) {
    player.playBtn.addEventListener('click', function () {
      if (!player.audio.src) return;
      if (player.audio.paused) player.audio.play(); else player.audio.pause();
    });
  }
  if (player.seek) {
    player.seek.addEventListener('input', function () { player.seeking = true; });
    player.seek.addEventListener('change', function () {
      if (player.audio.duration) player.audio.currentTime = (player.seek.value / 1000) * player.audio.duration;
      player.seeking = false;
    });
  }

  // Botones genéricos "usar segundo actual" (clase .seek-btn con
  // data-target="idDelCampo") — llenan el campo con el segundo actual del
  // reproductor. Deshabilitados hasta que haya audio cargado.
  document.addEventListener('click', function (evt) {
    var btn = evt.target.closest && evt.target.closest('.seek-btn[data-target]');
    if (!btn || btn.disabled) return;
    var sec = window.lrGetCurrentSecond();
    if (sec === null) return;
    var target = document.getElementById(btn.getAttribute('data-target'));
    if (target) target.value = sec;
  });`;
}

function launchNewPage({ user, artists, error, values, editId }) {
  const v = values || {};
  const isEdit = Boolean(editId);
  const isVideo = Boolean(v.esVideo);
  const isAdmin = Boolean(user && user.role === 'admin');
  const options = artists.map(a => `<option value="${esc(a.slug)}" ${v.artistSlug === a.slug ? 'selected' : ''}>${esc(a.name)}</option>`).join('\n');
  const credits = Array.isArray(v.creditos) ? v.creditos : parseCredits(v.creditosJson);
  const roleOptions = CONTRIBUTOR_ROLES.map(r => `<option value="${esc(r.name)}">${esc(r.name)}</option>`).join('');

  const mediaSectionAudio = `
        <h3 class="form-section-title" style="margin-top:0">Portada y audio</h3>
        <div class="media-hero">
          <div class="cover-dropzone${v.portadaUrl ? ' has-image' : ''}" id="cover-dropzone" tabindex="0">
            <div class="dz-empty" id="cover-dropzone-empty" ${v.portadaUrl ? 'style="display:none;"' : ''}>
              <div class="dz-icon">${ICONS.image}</div>
              <div class="dz-text"><b>Arrastra tu portada aquí</b><br>o haz clic para elegir el archivo</div>
            </div>
            <img id="portada-preview" src="${esc(v.portadaUrl || '')}" alt="Portada" ${v.portadaUrl ? '' : 'style="display:none;"'}>
            <div class="dz-change">Cambiar portada</div>
            <input type="file" id="portada" name="portada" accept="image/png,image/jpeg">
          </div>
          <div class="media-side">
            <div class="dz-error" id="cover-dropzone-error" hidden></div>
            <div class="file-dropzone" id="audio-dropzone" tabindex="0">
              <div class="dz-icon">${ICONS.music}</div>
              <div class="dz-body">
                <div class="dz-title">Audio de la canción (WAV) *</div>
                <div class="dz-sub">Arrastra el archivo aquí o haz clic — obligatorio, formato WAV</div>
                <div class="dz-filename" id="audio-filename">${v.audioUrl ? 'Ya hay un archivo guardado — sube uno nuevo para reemplazarlo.' : ''}</div>
                <div class="dz-error" id="audio-dropzone-error" hidden></div>
              </div>
              <input type="file" id="audio" name="audio" accept="audio/wav,.wav">
            </div>
            <div class="file-dropzone is-optional" id="atmos-dropzone" tabindex="0">
              <div class="dz-icon">${ICONS.atmos}</div>
              <div class="dz-body">
                <div class="dz-title">Dolby Atmos (opcional)</div>
                <div class="dz-sub">WAV/ADM BWF — solo si tu mezcla tiene versión Atmos</div>
                <div class="dz-filename" id="atmos-filename">${v.atmosUrl ? 'Archivo Atmos actual guardado.' : ''}</div>
                <div class="dz-error" id="atmos-dropzone-error" hidden></div>
              </div>
              <input type="file" id="atmos" name="atmos" accept="audio/wav,.wav">
            </div>
            <div class="field-with-seek">
              <div class="field">
                <label class="field-icon-label">${ICONS.clock} Inicio del promocional de TikTok (segundos)</label>
                <input type="number" id="tiktokPromoInicioSegundos" name="tiktokPromoInicioSegundos" min="0" step="1" placeholder="Ej. 45" value="${esc(v.tiktokPromoInicioSegundos || '')}">
              </div>
              <button type="button" class="seek-btn" data-target="tiktokPromoInicioSegundos" disabled>${ICONS.clock} Usar segundo actual</button>
            </div>
          </div>
        </div>
        <small class="helper-text">Portada obligatoria: PNG o JPEG de EXACTAMENTE 3000x3000 píxeles. Debe incluir el título del tema, el/los nombre(s) del artista y el logo de contenido explícito si aplica — de lo contrario el sistema la rechaza al guardar. Reproduce el audio en el reproductor de abajo y muévelo al momento exacto para usar los botones "segundo actual".</small>`;

  const mediaSectionVideo = `
        <h3 class="form-section-title" style="margin-top:0">Video</h3>
        <div class="media-hero">
          <div class="cover-dropzone${v.portadaUrl ? ' has-image' : ''}" id="cover-dropzone" tabindex="0">
            <div class="dz-empty" id="cover-dropzone-empty" ${v.portadaUrl ? 'style="display:none;"' : ''}>
              <div class="dz-icon">${ICONS.image}</div>
              <div class="dz-text"><b>Miniatura del video</b><br>opcional, PNG/JPEG 3000x3000</div>
            </div>
            <img id="portada-preview" src="${esc(v.portadaUrl || '')}" alt="Portada" ${v.portadaUrl ? '' : 'style="display:none;"'}>
            <div class="dz-change">Cambiar</div>
            <input type="file" id="portada" name="portada" accept="image/png,image/jpeg">
          </div>
          <div class="media-side">
            <div class="dz-error" id="cover-dropzone-error" hidden></div>
            <div class="file-dropzone" id="video-dropzone" tabindex="0">
              <div class="dz-icon">${ICONS.video}</div>
              <div class="dz-body">
                <div class="dz-title">Archivo de video (MP4 o MOV) *</div>
                <div class="dz-sub">Versión en video del mismo tema, para distribución de video (YouTube/VEVO/Content ID) como lanzamiento independiente.</div>
                <div class="dz-filename" id="video-filename">${v.videoUrl ? 'Ya hay un video guardado — sube uno nuevo para reemplazarlo.' : ''}</div>
                <div class="dz-error" id="video-dropzone-error" hidden></div>
              </div>
              <input type="file" id="video" name="video" accept="video/mp4,video/quicktime,.mp4,.mov">
            </div>
            ${v.videoUrl ? `<video controls src="${esc(v.videoUrl)}" style="width:100%;border-radius:10px;"></video>` : ''}
          </div>
        </div>`;

  const body = `
    <div class="dash-header">
      <h1>${isEdit ? 'Editar lanzamiento' : (isVideo ? 'Nuevo lanzamiento de video' : 'Nuevo lanzamiento')}</h1>
      <p>Registra la ficha técnica completa para que Lion Records pueda distribuir el lanzamiento sin volver a capturar nada. Puedes guardar con lo que tengas hasta ahora y completarlo después: solo el título y la fecha son obligatorios para guardar. Eso sí, no se podrá enviar a distribución hasta que todo lo demás también esté lleno.</p>
    </div>
    <div class="card form-card form-wide" style="margin-bottom:60px;">
      ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
      <form method="POST" action="${isEdit ? `/lanzamientos/${esc(editId)}/editar` : '/lanzamientos/nuevo'}" enctype="multipart/form-data">
        <input type="hidden" name="esVideo" value="${isVideo ? '1' : ''}">
        <input type="hidden" name="creditosJson" id="creditosJson" value="${esc(JSON.stringify(credits))}">
        <input type="hidden" name="tracklist" id="tracklist">

        ${isVideo ? mediaSectionVideo : mediaSectionAudio}

        <h3 class="form-section-title">Datos generales</h3>
        <div class="field">
          <label for="artistSlug">Artista</label>
          <select id="artistSlug" name="artistSlug" required>${options}</select>
        </div>
        <div class="field">
          <label for="titulo">Título</label>
          <input type="text" id="titulo" name="titulo" required placeholder="Nombre de la canción o álbum" value="${esc(v.titulo || '')}">
        </div>
        <div class="field">
          <label for="displayArtist">Artista(s) a mostrar (necesario para distribución)</label>
          <input type="text" id="displayArtist" name="displayArtist" placeholder="Ej. Chevy DLS and Cesar Cereceres" value="${esc(v.displayArtist || '')}">
        </div>
        <div class="field">
          <label for="tipo">Tipo</label>
          <select id="tipo" name="tipo">
            ${['Sencillo', 'EP', 'Álbum', 'Colaboración'].map(t => `<option ${v.tipo === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="releaseVersion">Versión del release (opcional)</label>
          <input type="text" id="releaseVersion" name="releaseVersion" placeholder="Ej. Remix, En Vivo" value="${esc(v.releaseVersion || '')}">
        </div>
        <div class="field field-check">
          <label><input type="checkbox" name="compilation" value="1" ${v.compilation ? 'checked' : ''}> Es una compilación</label>
        </div>
        <div class="field field-check">
          <label><input type="checkbox" name="explicitContent" value="1" ${v.explicitContent ? 'checked' : ''}> Contenido explícito</label>
        </div>

        <h3 class="form-section-title">Fechas</h3>
        <div class="field">
          <label for="fechaLanzamiento-trigger">Fecha de lanzamiento</label>
          <div class="date-picker" id="fechaLanzamiento-picker" data-admin="${isAdmin ? '1' : ''}">
            <button type="button" class="date-picker-input" id="fechaLanzamiento-trigger">
              <span id="fechaLanzamiento-display" class="${v.fechaLanzamiento ? '' : 'is-placeholder'}">${v.fechaLanzamiento ? esc(v.fechaLanzamiento) : 'Selecciona una fecha'}</span>
              ${ICONS.calendar}
            </button>
            <input type="hidden" id="fechaLanzamiento" name="fechaLanzamiento" value="${esc(v.fechaLanzamiento || '')}">
            <div class="date-picker-popup" id="fechaLanzamiento-popup" hidden>
              <div class="dp-header">
                <button type="button" class="dp-nav" id="dp-prev-lanzamiento" aria-label="Mes anterior">${ICONS.chevronLeft}</button>
                <div class="dp-month-label" id="dp-month-label-lanzamiento"></div>
                <button type="button" class="dp-nav" id="dp-next-lanzamiento" aria-label="Mes siguiente">${ICONS.chevronRight}</button>
              </div>
              <div class="dp-weekdays"><span>D</span><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span></div>
              <div class="dp-days" id="dp-days-lanzamiento"></div>
              <div class="dp-footer">
                ${isAdmin
                  ? '<span class="dp-hint dp-hint-admin">Eres administrador: puedes elegir cualquier fecha, aunque lo normal es lanzar en viernes.</span>'
                  : '<span class="dp-hint">Solo se pueden elegir viernes (resaltados en dorado), con al menos 14 días de anticipación.</span>'}
              </div>
            </div>
          </div>
          <small class="helper-text">Solo se puede elegir un viernes, con al menos 14 días de anticipación (para hacer el pitch a las plataformas digitales)${isAdmin ? ' — como administrador puedes elegir otra fecha si es necesario' : ''}.</small>
        </div>
        <div class="field">
          <label for="fechaPreventa-trigger">Fecha de preventa (opcional)</label>
          <div class="date-picker" id="fechaPreventa-picker">
            <button type="button" class="date-picker-input" id="fechaPreventa-trigger">
              <span id="fechaPreventa-display" class="${v.fechaPreventa ? '' : 'is-placeholder'}">${v.fechaPreventa ? esc(v.fechaPreventa) : 'Se sugiere sola 5 días antes'}</span>
              ${ICONS.calendar}
            </button>
            <input type="hidden" id="fechaPreventa" name="fechaPreventa" value="${esc(v.fechaPreventa || '')}">
            <div class="date-picker-popup" id="fechaPreventa-popup" hidden>
              <div class="dp-header">
                <button type="button" class="dp-nav" id="dp-prev-preventa" aria-label="Mes anterior">${ICONS.chevronLeft}</button>
                <div class="dp-month-label" id="dp-month-label-preventa"></div>
                <button type="button" class="dp-nav" id="dp-next-preventa" aria-label="Mes siguiente">${ICONS.chevronRight}</button>
              </div>
              <div class="dp-weekdays"><span>D</span><span>L</span><span>M</span><span>M</span><span>J</span><span>V</span><span>S</span></div>
              <div class="dp-days" id="dp-days-preventa"></div>
              <div class="dp-footer">
                <span class="dp-hint">Se sugiere sola 5 días antes de la fecha de lanzamiento; puedes elegir otra fecha, siempre antes del lanzamiento.</span>
              </div>
            </div>
          </div>
          <small class="helper-text">Recomendado: 5 días antes de la fecha de lanzamiento. Se sugiere sola al elegir la fecha de lanzamiento, pero puedes cambiarla.</small>
        </div>
        <div class="field">
          <label for="recordingYear">Año de grabación (opcional)</label>
          <input type="number" id="recordingYear" name="recordingYear" min="1900" max="2100" value="${esc(v.recordingYear || '')}">
        </div>
        <div class="field">
          <label for="recordingLocation">Lugar de grabación (opcional)</label>
          <input type="text" id="recordingLocation" name="recordingLocation" value="${esc(v.recordingLocation || '')}">
        </div>

        <h3 class="form-section-title">Copyright</h3>
        <p class="helper-text" style="margin-top:-6px;">Estos datos son fijos para todos los lanzamientos de Lion Records y no se pueden modificar por lanzamiento.</p>
        <div class="field-row">
          <div class="field">
            <label for="cLineAno">© Año</label>
            <input type="number" id="cLineAno" name="cLineAno" value="${esc(COPYRIGHT_DEFAULTS.ano)}" readonly>
          </div>
          <div class="field">
            <label for="pLineAno">℗ Año</label>
            <input type="number" id="pLineAno" name="pLineAno" value="${esc(COPYRIGHT_DEFAULTS.ano)}" readonly>
          </div>
        </div>
        <div class="field">
          <label for="cLineTexto">© Texto</label>
          <input type="text" id="cLineTexto" name="cLineTexto" value="${esc(COPYRIGHT_DEFAULTS.texto)}" readonly>
        </div>
        <div class="field">
          <label for="pLineTexto">℗ Texto</label>
          <input type="text" id="pLineTexto" name="pLineTexto" value="${esc(COPYRIGHT_DEFAULTS.texto)}" readonly>
        </div>
        <div class="field">
          <label for="courtesyLine">Courtesy line</label>
          <input type="text" id="courtesyLine" name="courtesyLine" value="${esc(COPYRIGHT_DEFAULTS.courtesy)}" readonly>
        </div>

        <h3 class="form-section-title">Clasificación</h3>
        <div class="field">
          <label for="generoMusical">Género (necesario para distribución)</label>
          <input type="text" id="generoMusical" name="generoMusical" placeholder="Ej. Latin" value="${esc(v.generoMusical || 'Latin')}">
        </div>
        <div class="field">
          <label for="subgeneroMusical">Subgénero</label>
          <input type="text" id="subgeneroMusical" name="subgeneroMusical" placeholder="Ej. Musica Mexicana" value="${esc(v.subgeneroMusical || 'Musica Mexicana')}">
        </div>
        <div class="field">
          <label for="idioma">Idioma del metadato</label>
          <input type="text" id="idioma" name="idioma" value="${esc(v.idioma || 'ES')}">
        </div>
        <div class="field">
          <label for="catalogTier">Catalog tier</label>
          <input type="text" id="catalogTier" name="catalogTier" value="${esc(v.catalogTier || 'FRONT')}">
        </div>
        <div class="field">
          <label for="territorios">Territorios</label>
          <input type="text" id="territorios" name="territorios" placeholder="WORLD, o lista separada por comas" value="${esc(v.territorios || 'WORLD')}">
        </div>
        <div class="field">
          <label for="etiquetas">Etiquetas / tags (opcional, separadas por coma)</label>
          <input type="text" id="etiquetas" name="etiquetas" value="${esc(v.etiquetas || '')}">
        </div>

        <h3 class="form-section-title">Identificadores</h3>
        <div class="field">
          <label for="upc">Barcode / UPC (opcional, se genera automáticamente si se deja vacío)</label>
          <input type="text" id="upc" name="upc" value="${esc(v.upc || '')}">
        </div>
        <div class="field">
          <label for="catalogNumber">Catalog number (opcional)</label>
          <input type="text" id="catalogNumber" name="catalogNumber" value="${esc(v.catalogNumber || '')}">
        </div>
        <div class="field">
          <label for="totalVolumenes">Total de volúmenes</label>
          <input type="number" id="totalVolumenes" name="totalVolumenes" min="1" value="${esc(v.totalVolumenes || '1')}">
        </div>

        <h3 class="form-section-title">Tracklist</h3>
        <p class="helper-text" style="margin-top:-6px;">Reproduce el audio en el reproductor de abajo, muévelo al momento exacto y usa el botón de reloj para capturar la duración de cada pista. Al menos una pista es necesaria para enviar a distribución.</p>
        <div id="tracks-list"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="tracks-add" style="margin-bottom:18px;">+ Agregar pista</button>

        <h3 class="form-section-title">Créditos</h3>
        <p class="helper-text" style="margin-top:-6px;">Agrega cada productor, músico o colaborador con su rol exacto (lista oficial, en inglés). El artista principal no necesita agregarse aquí.</p>
        <div id="credits-list"></div>
        <button type="button" class="btn btn-ghost btn-sm" id="credits-add" style="margin-bottom:18px;">+ Agregar crédito</button>

        <h3 class="form-section-title">Contenido creativo</h3>
        <div class="field">
          <label for="letra">Letra</label>
          <textarea id="letra" name="letra" rows="8" placeholder="Letra completa de la canción">${esc(v.letra || '')}</textarea>
        </div>
        <div class="field">
          <label for="pitch">Pitch para plataformas digitales</label>
          <textarea id="pitch" name="pitch" rows="4" placeholder="Por qué esta canción debería entrar a playlists, historia detrás del lanzamiento...">${esc(v.pitch || '')}</textarea>
        </div>

        <h3 class="form-section-title">Archivos y notas</h3>
        <div class="field">
          <label for="enlaceArchivos">Enlace a archivos adicionales (Drive, WeTransfer, etc. — opcional)</label>
          <input type="text" id="enlaceArchivos" name="enlaceArchivos" placeholder="https://..." value="${esc(v.enlaceArchivos || '')}">
        </div>
        <div class="field">
          <label for="labelCopyInfo">Label copy info (opcional)</label>
          <textarea id="labelCopyInfo" name="labelCopyInfo">${esc(v.labelCopyInfo || '')}</textarea>
        </div>
        <div class="field">
          <label for="notas">Notas para distribución / álbum notes</label>
          <textarea id="notas" name="notas" placeholder="Créditos, colaboradores, instrucciones especiales...">${esc(v.notas || '')}</textarea>
        </div>

        <button type="submit" class="btn btn-gold btn-block">${isEdit ? 'Guardar cambios' : 'Guardar borrador'}</button>
        ${isEdit ? '' : '<p class="helper-text" style="text-align:center;">Puedes guardarlo aunque te falten datos y completarlo más tarde desde la ficha del lanzamiento.</p>'}
      </form>
    </div>
    ${playerBarHtml()}`;
  const script = `
<script>
(function () {
  ${playerBarScript()}

  function pad(n) { return String(n).padStart(2, '0'); }
  function toISODate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseISODate(str) {
    var parts = (str || '').split('-').map(Number);
    if (parts.length !== 3 || !parts[0]) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
  }

  var today = new Date(); today.setHours(0, 0, 0, 0);
  var minAllowed = new Date(today); minAllowed.setDate(minAllowed.getDate() + 14);
  var suggestedFriday = new Date(minAllowed);
  while (suggestedFriday.getDay() !== 5) { suggestedFriday.setDate(suggestedFriday.getDate() + 1); }

  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  function formatLong(d) {
    var dias = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    return dias[d.getDay()] + ' ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear();
  }

  // --- Fábrica de mini date-picker propio (sin librerías), reutilizada
  // tanto para la fecha de lanzamiento (solo viernes, salvo admin) como
  // para la fecha de preventa (cualquier día, antes del lanzamiento).
  // opts: { idPrefix, isSelectable(d), initialViewDate, onPick(d), requireOnSubmit }
  function createDatePicker(opts) {
    var picker = document.getElementById(opts.idPrefix + '-picker');
    if (!picker) return null;
    var trigger = document.getElementById(opts.idPrefix + '-trigger');
    var display = document.getElementById(opts.idPrefix + '-display');
    var hiddenInput = document.getElementById(opts.idPrefix);
    var popup = document.getElementById(opts.idPrefix + '-popup');
    var monthLabel = document.getElementById('dp-month-label-' + opts.domSuffix);
    var daysEl = document.getElementById('dp-days-' + opts.domSuffix);
    var prevBtn = document.getElementById('dp-prev-' + opts.domSuffix);
    var nextBtn = document.getElementById('dp-next-' + opts.domSuffix);

    var selected = parseISODate(hiddenInput.value) || null;
    var viewMonth = selected ? new Date(selected.getFullYear(), selected.getMonth(), 1) : new Date(opts.initialViewDate.getFullYear(), opts.initialViewDate.getMonth(), 1);

    function render() {
      monthLabel.textContent = MESES[viewMonth.getMonth()].replace(/^./, function (c) { return c.toUpperCase(); }) + ' ' + viewMonth.getFullYear();
      daysEl.innerHTML = '';
      var firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
      var startOffset = firstOfMonth.getDay();
      var daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
      for (var i = 0; i < startOffset; i++) daysEl.appendChild(document.createElement('span'));
      for (var day = 1; day <= daysInMonth; day++) {
        var d = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), day);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'dp-day';
        btn.textContent = String(day);
        if (d.getDay() === 5) btn.classList.add('is-friday');
        if (d.getTime() === today.getTime()) btn.classList.add('is-today');
        if (selected && d.getTime() === selected.getTime()) btn.classList.add('is-selected');
        if (!opts.isSelectable(d)) {
          btn.classList.add('is-disabled');
          btn.disabled = true;
        } else {
          btn.addEventListener('click', function (ev) {
            var picked = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), Number(ev.currentTarget.textContent));
            api.setDate(picked, true);
          });
        }
        daysEl.appendChild(btn);
      }
    }

    var api = {
      setDate: function (picked, fromUserClick) {
        selected = picked;
        hiddenInput.value = toISODate(picked);
        display.textContent = formatLong(picked);
        display.classList.remove('is-placeholder');
        if (fromUserClick) popup.hidden = true;
        render();
        if (opts.onPick) opts.onPick(picked, fromUserClick);
      },
      refresh: render
    };

    if (selected) display.textContent = formatLong(selected);

    trigger.addEventListener('click', function (ev) {
      ev.stopPropagation();
      popup.hidden = !popup.hidden;
      if (!popup.hidden) render();
    });
    prevBtn.addEventListener('click', function (ev) { ev.stopPropagation(); viewMonth.setMonth(viewMonth.getMonth() - 1); render(); });
    nextBtn.addEventListener('click', function (ev) { ev.stopPropagation(); viewMonth.setMonth(viewMonth.getMonth() + 1); render(); });
    popup.addEventListener('click', function (ev) { ev.stopPropagation(); });
    document.addEventListener('click', function () { popup.hidden = true; });

    if (opts.requireOnSubmit) {
      var formEl = picker.closest('form');
      if (formEl) {
        formEl.addEventListener('submit', function (ev) {
          if (!hiddenInput.value) {
            ev.preventDefault();
            alert('Elige la fecha de lanzamiento antes de guardar.');
            popup.hidden = false;
            render();
          }
        });
      }
    }

    return api;
  }

  var preventaPicker = createDatePicker({
    idPrefix: 'fechaPreventa',
    domSuffix: 'preventa',
    initialViewDate: suggestedFriday,
    isSelectable: function (d) {
      var lanzamientoVal = document.getElementById('fechaLanzamiento').value;
      var lanzamiento = lanzamientoVal ? parseISODate(lanzamientoVal) : null;
      return !lanzamiento || d < lanzamiento;
    }
  });

  var lanzamientoPicker = createDatePicker({
    idPrefix: 'fechaLanzamiento',
    domSuffix: 'lanzamiento',
    initialViewDate: suggestedFriday,
    requireOnSubmit: true,
    isSelectable: function (d) {
      var picker = document.getElementById('fechaLanzamiento-picker');
      var isAdminUser = picker && picker.getAttribute('data-admin') === '1';
      if (isAdminUser) return true;
      return d.getDay() === 5 && d >= minAllowed;
    },
    onPick: function (picked) {
      // Al elegir la fecha de lanzamiento, sugiere automáticamente la
      // preventa 5 días antes (si el usuario no había elegido ya una).
      if (preventaPicker) {
        var preventaHidden = document.getElementById('fechaPreventa');
        if (!preventaHidden.value) {
          var pre = new Date(picked); pre.setDate(pre.getDate() - 5);
          preventaPicker.setDate(pre, false);
        } else {
          preventaPicker.refresh();
        }
      }
    }
  });

  // --- Zonas de arrastrar-y-soltar / clic para los archivos. Cada una
  // envuelve un <input type="file"> oculto: un clic (o Enter/Espacio con
  // teclado) lo activa, y soltar un archivo arrastrado lo asigna igual que
  // si se hubiera elegido a mano.
  function wireDropzone(zoneId, inputId, onFile) {
    var zone = document.getElementById(zoneId);
    var input = document.getElementById(inputId);
    if (!zone || !input) return;
    zone.addEventListener('click', function (e) { if (e.target !== input) input.click(); });
    zone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
    });
    ['dragover', 'dragenter'].forEach(function (evtName) {
      zone.addEventListener(evtName, function (e) { e.preventDefault(); zone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(function (evtName) {
      zone.addEventListener(evtName, function () { zone.classList.remove('drag-over'); });
    });
    zone.addEventListener('drop', function (e) {
      e.preventDefault();
      var files = e.dataTransfer && e.dataTransfer.files;
      if (files && files.length) {
        input.files = files;
        input.dispatchEvent(new Event('change'));
      }
    });
    input.addEventListener('change', function () {
      var file = input.files && input.files[0];
      if (file && onFile) onFile(file);
    });
  }

  // --- Validación de archivos EN EL NAVEGADOR, antes de enviar el
  // formulario. El servidor siempre vuelve a validar todo (es la fuente de
  // verdad y no se puede engañar), pero avisar aquí de inmediato evita que
  // el artista suba un archivo incorrecto sin enterarse hasta después.
  var fileErrors = {};
  function setDropzoneError(key, msg) {
    fileErrors[key] = msg || null;
    var box = document.getElementById(key + '-dropzone-error');
    var zone = document.getElementById(key + '-dropzone');
    if (box) { box.textContent = msg || ''; box.hidden = !msg; }
    if (zone) zone.classList.toggle('has-error', Boolean(msg));
  }

  function readImageDimensions(file, cb) {
    var url = URL.createObjectURL(file);
    var img = new Image();
    img.onload = function () { cb(null, { width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(url); };
    img.onerror = function () { cb(new Error('No se pudo leer la imagen.')); URL.revokeObjectURL(url); };
    img.src = url;
  }

  function checkWavMagic(file, cb) {
    var reader = new FileReader();
    reader.onload = function () {
      var buf = new Uint8Array(reader.result);
      var text = '';
      for (var i = 0; i < buf.length; i++) text += String.fromCharCode(buf[i]);
      var ok = buf.length >= 12 && text.slice(0, 4) === 'RIFF' && text.slice(8, 12) === 'WAVE';
      cb(ok);
    };
    reader.onerror = function () { cb(false); };
    reader.slice ? reader.readAsArrayBuffer(file.slice(0, 12)) : reader.readAsArrayBuffer(file);
  }

  wireDropzone('cover-dropzone', 'portada', function (file) {
    var img = document.getElementById('portada-preview');
    var empty = document.getElementById('cover-dropzone-empty');
    var zone = document.getElementById('cover-dropzone');
    if (img) { img.src = URL.createObjectURL(file); img.style.display = 'block'; }
    if (empty) empty.style.display = 'none';
    if (zone) zone.classList.add('has-image');

    var isPngOrJpeg = file.type === 'image/png' || file.type === 'image/jpeg'
      || /\\.(png|jpe?g)$/i.test(file.name || '');
    if (!isPngOrJpeg) {
      setDropzoneError('cover', 'Formato no válido: la portada debe ser un archivo PNG o JPEG. Este archivo parece ser "' + (file.type || 'desconocido') + '".');
      return;
    }
    readImageDimensions(file, function (err, dims) {
      if (err) { setDropzoneError('cover', 'No se pudo leer esta imagen. Prueba con otro archivo PNG o JPEG.'); return; }
      if (dims.width !== 3000 || dims.height !== 3000) {
        setDropzoneError('cover', 'Medida incorrecta: la portada debe medir EXACTAMENTE 3000x3000 píxeles. Esta imagen mide ' + dims.width + 'x' + dims.height + ' píxeles — ajústala y vuelve a subirla.');
      } else {
        setDropzoneError('cover', null);
      }
    });
  });
  wireDropzone('audio-dropzone', 'audio', function (file) {
    var label = document.getElementById('audio-filename');
    if (label) label.textContent = file.name;
    window.lrPlayerSetSource(URL.createObjectURL(file), file.name);
    checkWavMagic(file, function (ok) {
      setDropzoneError('audio', ok ? null : 'Formato no válido: el audio debe ser un archivo WAV. "' + file.name + '" no parece ser un WAV real.');
    });
  });
  wireDropzone('atmos-dropzone', 'atmos', function (file) {
    var label = document.getElementById('atmos-filename');
    if (label) label.textContent = file.name;
    checkWavMagic(file, function (ok) {
      setDropzoneError('atmos', ok ? null : 'Formato no válido: el archivo Dolby Atmos debe ser un WAV/ADM BWF. "' + file.name + '" no parece ser un WAV real.');
    });
  });
  wireDropzone('video-dropzone', 'video', function (file) {
    var label = document.getElementById('video-filename');
    if (label) label.textContent = file.name;
    var isVideoFile = /\\.(mp4|mov)$/i.test(file.name || '');
    setDropzoneError('video', isVideoFile ? null : 'Formato no válido: el video debe ser .mp4 o .mov. "' + file.name + '" no tiene esa extensión.');
  });

  var mediaForm = document.getElementById('cover-dropzone') && document.getElementById('cover-dropzone').closest('form');
  if (mediaForm) {
    mediaForm.addEventListener('submit', function (e) {
      var messages = Object.keys(fileErrors).map(function (k) { return fileErrors[k]; }).filter(Boolean);
      if (messages.length) {
        e.preventDefault();
        alert('Antes de guardar, corrige lo siguiente:\\n\\n' + messages.join('\\n'));
        var firstKey = Object.keys(fileErrors).filter(function (k) { return fileErrors[k]; })[0];
        var el = document.getElementById(firstKey + '-dropzone');
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  // Si se está editando un lanzamiento que ya tiene audio guardado, precarga
  // el reproductor fijo con ese archivo para poder usarlo de una vez en el
  // tracklist / TikTok sin tener que resubirlo.
  var existingAudioUrl = ${JSON.stringify(v.audioUrl || '')};
  var existingTitle = ${JSON.stringify(v.titulo || 'Audio')};
  if (existingAudioUrl) window.lrPlayerSetSource(existingAudioUrl, existingTitle, false);

  // --- Tracklist: filas dinámicas (Título / ISRC / Duración / Artistas),
  // con un botón de reloj junto a Duración que toma el segundo actual del
  // reproductor fijo. Se serializan al mismo formato de texto que ya
  // procesa el servidor, en el input oculto #tracklist, justo antes de
  // enviar el formulario.
  var initialTracks = ${JSON.stringify(tracklistTextToRows(v.tracklist || ''))};
  var tracksList = document.getElementById('tracks-list');
  var tracksAddBtn = document.getElementById('tracks-add');
  var tracklistHidden = document.getElementById('tracklist');
  var tracksForm = tracksList ? tracksList.closest('form') : null;

  function addTrackRow(t) {
    t = t || {};
    if (!tracksList) return;
    var row = document.createElement('div');
    row.className = 'track-row';
    row.innerHTML =
      '<div class="track-row-fields">' +
        '<div class="field"><label>Título</label><input type="text" class="track-titulo" placeholder="Nombre de la pista"></div>' +
        '<div class="field"><label>ISRC (opcional)</label><input type="text" class="track-isrc"></div>' +
        '<div class="field"><label>Duración mm:ss</label><input type="text" class="track-duracion" placeholder="2:08" readonly></div>' +
        '<div class="field"><label>Artista(s)</label><input type="text" class="track-artistas"></div>' +
        '<button type="button" class="seek-btn track-use-current" disabled title="Usar tiempo actual del reproductor">' + ${JSON.stringify(ICONS.clock)} + '</button>' +
        '<button type="button" class="btn btn-ghost btn-sm track-remove">Quitar</button>' +
      '</div>';
    tracksList.appendChild(row);
    row.querySelector('.track-titulo').value = t.titulo || '';
    row.querySelector('.track-isrc').value = t.isrc || '';
    row.querySelector('.track-duracion').value = t.duracion || '';
    row.querySelector('.track-artistas').value = t.artistas || '';
    row.querySelector('.track-duracion').removeAttribute('readonly');
    row.querySelector('.track-remove').addEventListener('click', function () { row.remove(); });
    var useCurrentBtn = row.querySelector('.track-use-current');
    useCurrentBtn.disabled = !player.ready;
    useCurrentBtn.addEventListener('click', function () {
      var sec = window.lrGetCurrentSecond();
      if (sec === null) return;
      row.querySelector('.track-duracion').value = window.lrFormatTime(sec);
    });
  }

  (initialTracks.length ? initialTracks : [{}]).forEach(addTrackRow);
  if (tracksAddBtn) tracksAddBtn.addEventListener('click', function () { addTrackRow(); });

  if (tracksForm && tracklistHidden) {
    tracksForm.addEventListener('submit', function () {
      var rows = tracksList ? tracksList.querySelectorAll('.track-row') : [];
      var lines = [];
      rows.forEach(function (row) {
        var titulo = row.querySelector('.track-titulo').value.trim();
        var isrc = row.querySelector('.track-isrc').value.trim();
        var duracion = row.querySelector('.track-duracion').value.trim();
        var artistas = row.querySelector('.track-artistas').value.trim();
        if (titulo || isrc || duracion || artistas) lines.push([titulo, isrc, duracion, artistas].join(' ; '));
      });
      tracklistHidden.value = lines.join('\\n');
    });
  }

  // --- Créditos: filas dinámicas de "rol (lista oficial) + nombre",
  // guardadas como JSON en el input oculto #creditosJson justo antes de enviar
  // el formulario (para no depender de inputs con nombres indexados).
  var ROLE_OPTIONS_HTML = ${JSON.stringify(roleOptions)};
  var initialCredits = ${JSON.stringify(credits)};
  var creditsList = document.getElementById('credits-list');
  var creditsAddBtn = document.getElementById('credits-add');
  var creditsForm = creditsList ? creditsList.closest('form') : null;
  var creditsHidden = document.getElementById('creditosJson');

  function addCreditRow(role, name) {
    if (!creditsList) return;
    var row = document.createElement('div');
    row.className = 'field-row credit-row';
    row.style.alignItems = 'flex-end';
    row.innerHTML =
      '<div class="field" style="flex:1.4;">' +
        '<label>Rol</label>' +
        '<select class="credit-role">' + '<option value="">Selecciona un rol...</option>' + ROLE_OPTIONS_HTML + '</select>' +
      '</div>' +
      '<div class="field" style="flex:1;">' +
        '<label>Nombre del colaborador</label>' +
        '<input type="text" class="credit-name" placeholder="Nombre completo">' +
      '</div>' +
      '<button type="button" class="btn btn-ghost btn-sm credit-remove" style="margin-bottom:18px;">Quitar</button>';
    creditsList.appendChild(row);
    var roleSelect = row.querySelector('.credit-role');
    var nameInput = row.querySelector('.credit-name');
    if (role) roleSelect.value = role;
    if (name) nameInput.value = name;
    row.querySelector('.credit-remove').addEventListener('click', function () { row.remove(); });
  }

  (initialCredits.length ? initialCredits : []).forEach(function (c) { addCreditRow(c.role, c.name); });
  if (creditsAddBtn) creditsAddBtn.addEventListener('click', function () { addCreditRow(); });

  if (creditsForm && creditsHidden) {
    creditsForm.addEventListener('submit', function () {
      var rows = creditsList ? creditsList.querySelectorAll('.credit-row') : [];
      var out = [];
      rows.forEach(function (row) {
        var role = row.querySelector('.credit-role').value;
        var name = row.querySelector('.credit-name').value.trim();
        if (role && name) out.push({ role: role, name: name });
      });
      creditsHidden.value = JSON.stringify(out);
    });
  }
})();
</script>`;
  return dashPage(isEdit ? 'Editar lanzamiento' : (isVideo ? 'Nuevo lanzamiento de video' : 'Nuevo lanzamiento'), user, body, script);
}

const ESTADO_LABELS = {
  'registrado': 'Borrador',
  'no-configurado': 'Automatización no configurada',
  'pendiente-aprobacion': 'Esperando tu aprobación en Telegram',
  'enviado-a-varlian': 'Enviado a distribución',
  'error-envio': 'Varlian rechazó el envío (revisa los datos)',
  'rechazado-manual': 'Rechazado desde Telegram'
};

function launchDetailPage({ user, launch, artist, missingFields, showIncompleteModal }) {
  const tracks = (launch.tracks || []);
  const missing = missingFields || [];
  const estadoLabel = missing.length && launch.estadoDistribucion === 'registrado'
    ? 'Borrador incompleto'
    : (ESTADO_LABELS[launch.estadoDistribucion] || launch.estadoDistribucion);
  const estadoPillClass = launch.estadoDistribucion === 'enviado-a-varlian' ? 'pill-ok'
    : ((launch.estadoDistribucion === 'error-envio' || launch.estadoDistribucion === 'rechazado-manual') ? 'pill-error'
    : ((missing.length || launch.estadoDistribucion === 'pendiente-aprobacion') ? 'pill-pending' : 'pill-neutral'));
  const credits = Array.isArray(launch.creditos) ? launch.creditos : [];
  const body = `
    <div class="dash-header">
      <h1>${esc(launch.titulo)}${launch.esVideo ? ' <span class="pill pill-neutral">Video</span>' : ''}</h1>
      <p>${esc(artist ? artist.name : launch.artistSlug)} · ${esc(launch.tipo)} · Lanza el ${esc(launch.fechaLanzamiento)}</p>
    </div>
    ${missing.length ? `<div class="alert alert-error">
      <b>Este lanzamiento está incompleto.</b> Falta: ${missing.map(m => esc(m)).join(', ')}.
      No se puede enviar a distribución hasta completarlo.
      <a href="/lanzamientos/${esc(launch.id)}/editar" style="color:inherit; text-decoration:underline; margin-left:6px;">Completar ahora &rarr;</a>
    </div>` : ''}
    <div class="grid-2" style="margin-bottom:22px;">
      <div class="card">
        <h3>Ficha técnica</h3>
        <ul class="list">
          <li><span>Artista a mostrar</span><span>${esc(launch.displayArtist || '—')}</span></li>
          <li><span>Género</span><span>${esc(launch.generoMusical || '—')} / ${esc(launch.subgeneroMusical || '—')}</span></li>
          <li><span>Barcode / UPC</span><span>${esc(launch.upc || '—')}</span></li>
          <li><span>Catalog number</span><span>${esc(launch.catalogNumber || '—')}</span></li>
          <li><span>Territorios</span><span>${esc(launch.territorios || '—')}</span></li>
          <li><span>Registrado por</span><span>${esc(launch.creadoPor)}</span></li>
        </ul>
      </div>
      <div class="card">
        <h3>Tracklist</h3>
        ${tracks.length ? `<ul class="list">${tracks.map(t => `<li><span>${esc(t.titulo)}${t.isrc ? ' · ' + esc(t.isrc) : ''}</span><span>${esc(t.duracion || '—')}</span></li>`).join('')}</ul>` : '<p class="card-sub">Sin pistas registradas.</p>'}
      </div>
    </div>
    <div class="card" style="margin-bottom:22px;">
      <h3>${launch.esVideo ? 'Video' : 'Portada y audio'}</h3>
      ${launch.esVideo ? `
        ${launch.videoUrl ? `<video controls src="${esc(launch.videoUrl)}" style="width:100%;border-radius:10px;margin-bottom:14px;"></video>` : '<p class="card-sub">Sin video subido.</p>'}
        ${launch.portadaUrl ? `<img src="${esc(launch.portadaUrl)}" alt="Portada" style="max-width:220px;border-radius:10px;display:block;">` : ''}
      ` : `
        ${launch.portadaUrl ? `<img src="${esc(launch.portadaUrl)}" alt="Portada" style="max-width:220px;border-radius:10px;display:block;margin-bottom:14px;">` : '<p class="card-sub">Sin portada subida.</p>'}
        ${launch.audioUrl ? `<audio controls src="${esc(launch.audioUrl)}" style="width:100%;"></audio>` : '<p class="card-sub">Sin audio subido.</p>'}
        ${launch.atmosUrl ? `<p class="helper-text" style="margin-top:10px;">Archivo Dolby Atmos: <a href="${esc(launch.atmosUrl)}" target="_blank" style="color:var(--gold-light)">escuchar/descargar</a></p>` : ''}
      `}
      ${launch.tiktokPromoInicioSegundos ? `<p class="helper-text" style="margin-top:10px;">Inicio del promocional de TikTok: segundo ${esc(launch.tiktokPromoInicioSegundos)}</p>` : ''}
      ${launch.enlaceArchivos ? `<p style="margin-top:10px;"><a href="${esc(launch.enlaceArchivos)}" target="_blank" style="color:var(--gold-light)">Otro enlace de archivos &rarr;</a></p>` : ''}
    </div>
    ${credits.length ? `<div class="card" style="margin-bottom:22px;">
      <h3>Créditos</h3>
      <ul class="list">${credits.map(c => `<li><span>${esc(c.role)}</span><span>${esc(c.name)}</span></li>`).join('')}</ul>
    </div>` : ''}
    ${launch.letra ? `<div class="card" style="margin-bottom:22px;"><h3>Letra</h3><p style="white-space:pre-wrap;color:var(--text-secondary)">${esc(launch.letra)}</p></div>` : ''}
    ${launch.pitch ? `<div class="card" style="margin-bottom:22px;"><h3>Pitch</h3><p style="white-space:pre-wrap;color:var(--text-secondary)">${esc(launch.pitch)}</p></div>` : ''}
    <div class="card" style="margin-bottom:22px;">
      <h3>Distribución</h3>
      <p class="card-sub">Al enviarlo, te llega un aviso a Telegram con la ficha completa para que la revises y la apruebes. Solo se manda a Varlian cuando tú lo apruebas desde ahí.</p>
      <p><span class="pill ${estadoPillClass}">${esc(estadoLabel)}</span>${!missing.length && launch.estadoDistribucion === 'registrado' ? ' <span class="pill pill-ok">Listo para enviar</span>' : ''}</p>
      <div class="actions-row">
        <a href="/lanzamientos/${esc(launch.id)}/editar" class="btn btn-ghost btn-sm">Editar lanzamiento</a>
        <a href="/lanzamientos/${esc(launch.id)}/exportar" class="btn btn-gold btn-sm">Exportar ficha (JSON)</a>
        <form method="POST" action="/api/lanzamientos/${esc(launch.id)}/enviar-varlian" id="form-enviar-varlian" style="display:inline;" data-missing="${esc(JSON.stringify(missing))}">
          <button type="submit" class="btn btn-outline btn-sm">Enviar lanzamiento</button>
        </form>
      </div>
      <p class="helper-text">El botón "Enviar lanzamiento" te avisa a Telegram para que lo revises y lo apruebes antes de que se mande a distribución (Varlian).</p>
      ${launch.vaultUploadStatus === 'subido-automaticamente' ? '<p class="helper-text" style="color:var(--gold-light)">✓ Portada/audio se subieron automáticamente en el último envío.</p>' : ''}
      ${launch.vaultUploadStatus === 'fallback-manual' ? `<p class="helper-text" style="color:#e0a94a">La subida automática de archivos falló en el último envío (se usó el enlace de lionrecords.mx como respaldo). Detalle: ${esc(launch.vaultUploadError || '')}</p>` : ''}
    </div>
    ${!launch.esVideo ? `<div class="card" style="margin-bottom:22px;">
      <h3>Versión en video</h3>
      <p class="card-sub">¿Este tema también tiene un video? Crea un lanzamiento independiente para distribución de video (YouTube/VEVO/Content ID), con los mismos datos de artista, género y copyright ya llenados.</p>
      <form method="POST" action="/lanzamientos/${esc(launch.id)}/crear-video">
        <button type="submit" class="btn btn-outline btn-sm">Crear lanzamiento de video</button>
      </form>
    </div>` : ''}
    ${launch.notas ? `<div class="card" style="margin-bottom:60px;"><h3>Notas</h3><p style="color:var(--text-secondary)">${esc(launch.notas)}</p></div>` : ''}

    <div class="modal-overlay" id="modal-incompleto" ${showIncompleteModal ? '' : 'hidden'}>
      <div class="modal-box">
        <h3>Faltan datos antes de enviar</h3>
        <p>Para que Lion Records pueda enviar este lanzamiento a distribución, completa primero:</p>
        <ul id="modal-incompleto-list">${missing.map(m => `<li>${esc(m)}</li>`).join('')}</ul>
        <div class="actions-row">
          <a href="/lanzamientos/${esc(launch.id)}/editar" class="btn btn-gold btn-sm">Completar lanzamiento</a>
          <button type="button" class="btn btn-ghost btn-sm" id="modal-incompleto-cerrar">Cerrar</button>
        </div>
      </div>
    </div>`;
  const script = `
<script>
(function () {
  var modal = document.getElementById('modal-incompleto');
  var closeBtn = document.getElementById('modal-incompleto-cerrar');
  if (closeBtn) closeBtn.addEventListener('click', function () { modal.hidden = true; });
  var form = document.getElementById('form-enviar-varlian');
  if (form) {
    form.addEventListener('submit', function (evt) {
      var missing = [];
      try { missing = JSON.parse(form.getAttribute('data-missing') || '[]'); } catch (e) {}
      if (missing.length) {
        evt.preventDefault();
        if (modal) modal.hidden = false;
      }
    });
  }
})();
</script>`;
  return dashPage(launch.titulo, user, body, script);
}

module.exports = { launchNewPage, launchDetailPage, TIPO_A_FORMATO, ESTADO_LABELS, COPYRIGHT_DEFAULTS };
