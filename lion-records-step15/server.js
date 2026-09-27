const http = require('http');
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const url = require('url');
const querystring = require('querystring');

const { readDb, writeDb } = require('./lib/store');
const {
  hashPassword, verifyPassword, signSession, verifySession, parseCookies, sessionCookieHeader, COOKIE_NAME
} = require('./lib/crypto-auth');
const { errorPage } = require('./lib/render');
const { landingPage, artistPublicPage } = require('./lib/views/landing');
const { loginPage } = require('./lib/views/auth');
const { adminDashboardPage, artistDashboardPage } = require('./lib/views/dashboard');
const { launchNewPage, launchDetailPage, TIPO_A_FORMATO, COPYRIGHT_DEFAULTS } = require('./lib/views/launches');
const { accessesPage, accessCreatedPage } = require('./lib/views/accesos');
const { UPLOADS_DIR, AVATARS_DIR, UPLOAD_MIME, ensureUploadDirs, parseMultipartForm } = require('./lib/uploads');
const { pushFilesToVault } = require('./lib/varlian-vault');
const telegram = require('./lib/telegram');
const { integracionesPage } = require('./lib/views/settings');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const SITE_BASE_URL = (process.env.SITE_BASE_URL || 'https://lionrecords.mx').replace(/\/+$/, '');
const VARLIAN_EMAIL = process.env.VARLIAN_EMAIL || '';
const VARLIAN_PASSWORD = process.env.VARLIAN_PASSWORD || '';

ensureUploadDirs();

// Config de integraciones: una variable de entorno del mismo nombre siempre
// gana (por si se prefiere fijarla así en Hostinger); si no existe, se usa
// lo guardado en db.settings desde el panel de Admin > Integraciones.
function getSetting(db, key, envVarName) {
  const envVal = envVarName ? process.env[envVarName] : '';
  if (envVal) return envVal;
  return (db.settings && db.settings[key]) || '';
}

function telegramWebhookPath(db) {
  const secret = db.settings && db.settings.telegramWebhookSecret;
  return `/api/telegram/webhook/${secret}`;
}

// Intenta subir los archivos de un lanzamiento (portada, audio, atmos,
// video) directo al vault de Varlian, si hay credenciales configuradas
// (VARLIAN_EMAIL / VARLIAN_PASSWORD). Si algo falla, o no hay credenciales
// configuradas todavía, regresa null y el llamador sigue con el método de
// respaldo (mandar solo el enlace hacia lionrecords.mx) — un lanzamiento
// nunca se debe quedar atorado por esto.
async function tryUploadLaunchFilesToVault(launch) {
  if (!VARLIAN_EMAIL || !VARLIAN_PASSWORD) return null;
  const files = {};
  const fileFieldToMime = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
  function loadFile(publicUrl) {
    if (!publicUrl) return null;
    const rel = publicUrl.replace(/^\/uploads\//, '');
    const abs = path.join(UPLOADS_DIR, rel);
    if (!abs.startsWith(UPLOADS_DIR) || !fs.existsSync(abs)) return null;
    const ext = path.extname(abs).toLowerCase();
    return { buffer: fs.readFileSync(abs), filename: path.basename(abs), mimeType: fileFieldToMime[ext] || 'application/octet-stream' };
  }
  const portada = loadFile(launch.portadaUrl);
  const audio = loadFile(launch.audioUrl);
  const atmos = loadFile(launch.atmosUrl);
  const video = loadFile(launch.videoUrl);
  if (portada) files.portada = portada;
  if (audio) files.audio = audio;
  if (atmos) files.atmos = atmos;
  if (video) files.video = video;
  if (!Object.keys(files).length) return null;
  return pushFilesToVault({ email: VARLIAN_EMAIL, password: VARLIAN_PASSWORD, files });
}

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function getUser(req) {
  const cookies = parseCookies(req.headers.cookie);
  const token = cookies[COOKIE_NAME];
  return verifySession(token);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', ...headers });
  res.end(body);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) { // 2MB máximo
        reject(new Error('Cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

async function parseBody(req) {
  const raw = await readBody(req);
  const contentType = req.headers['content-type'] || '';
  if (contentType.includes('application/json')) {
    try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
  }
  return querystring.parse(raw);
}

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!safePath.startsWith(PUBLIC_DIR)) {
    send(res, 403, 'Prohibido');
    return true;
  }
  if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) return false;
  const ext = path.extname(safePath);
  const contentType = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(safePath).pipe(res);
  return true;
}

// Sirve las portadas y audios subidos por los artistas, guardados fuera de
// /public (en /uploads) para que un redeploy del sitio no los borre.
function serveUpload(req, res, pathname) {
  const rel = pathname.replace(/^\/uploads\//, '');
  const safePath = path.normalize(path.join(UPLOADS_DIR, rel));
  if (!safePath.startsWith(UPLOADS_DIR)) {
    send(res, 403, 'Prohibido');
    return true;
  }
  if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) return false;
  const ext = path.extname(safePath).toLowerCase();
  const contentType = UPLOAD_MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(safePath).pipe(res);
  return true;
}

function postJson(targetUrl) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new url.URL(targetUrl); } catch (e) { return reject(e); }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.request(parsed, { method: 'POST' }, res => {
      res.on('data', () => {});
      res.on('end', () => resolve({ status: res.statusCode }));
    });
    req.on('error', reject);
    req.end();
  });
}

function postJsonBody(targetUrl, payload) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new url.URL(targetUrl); } catch (e) { return reject(e); }
    const lib = parsed.protocol === 'http:' ? http : https;
    const data = JSON.stringify(payload);
    const req = lib.request(parsed, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Descarga una imagen desde una URL externa (usada para poner la foto de
// perfil de un artista a partir de una URL que el admin pega, p. ej. de
// Spotify). Sigue redirecciones (hasta 5), valida que el Content-Type sea
// una imagen y limita el tamaño a 8MB. Regresa { buffer, ext } o lanza un
// error con un mensaje claro.
const IMAGE_EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
function downloadRemoteImage(imageUrl, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new url.URL(imageUrl); } catch (e) { return reject(new Error('URL de imagen no válida.')); }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return reject(new Error('URL de imagen no válida.'));
    }
    const lib = parsed.protocol === 'http:' ? http : https;
    const req = lib.get(parsed, { headers: { 'User-Agent': 'Mozilla/5.0 (LionRecordsBot)' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && redirectsLeft > 0) {
        res.resume();
        const nextUrl = new url.URL(res.headers.location, parsed).toString();
        resolve(downloadRemoteImage(nextUrl, redirectsLeft - 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        return reject(new Error(`No se pudo descargar la imagen (status ${res.statusCode}).`));
      }
      const contentType = (res.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      const ext = IMAGE_EXT_BY_MIME[contentType];
      if (!ext) {
        res.resume();
        return reject(new Error(`La URL no apunta a una imagen soportada (tipo recibido: ${contentType || 'desconocido'}).`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) {
          reject(new Error('La imagen es demasiado grande (máximo 8MB).'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), ext }));
    });
    req.on('error', () => reject(new Error('No se pudo contactar la URL de la imagen.')));
    req.setTimeout(15000, () => req.destroy(new Error('Tiempo de espera agotado descargando la imagen.')));
  });
}

// Convierte el JSON de créditos (generado por el JS del formulario, campo
// oculto "creditosJson") en la lista estructurada {role, name} que se
// guarda en el lanzamiento. Cualquier entrada sin rol o sin nombre se
// descarta.
function parseCreditsJson(raw) {
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch (e) { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map(c => ({ role: String((c && c.role) || '').trim(), name: String((c && c.name) || '').trim() }))
    .filter(c => c.role && c.name)
    .slice(0, 100);
}

// Convierte el texto del tracklist (una pista por línea, campos separados
// por ";") en la lista de pistas estructurada que espera Varlian.
function parseTracklist(raw) {
  if (!raw) return [];
  return String(raw)
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map((line, idx) => {
      const [titulo, isrc, duracion, artistas] = line.split(';').map(p => (p || '').trim());
      return {
        sequence: idx + 1,
        titulo: titulo || `Pista ${idx + 1}`,
        isrc: isrc || '',
        duracion: duracion || '',
        artistas: artistas || ''
      };
    });
}

// Los lanzamientos solo se pueden programar para un viernes, con al menos
// 14 días de anticipación (para el pitch a las plataformas) — salvo que
// quien lo registre sea un administrador, que puede elegir cualquier fecha.
// Esto se valida aquí también (no solo en el calendario del navegador)
// porque un POST directo al servidor podría saltarse la validación del
// cliente. Regresa un mensaje de error en español, o null si la fecha es
// válida.
function validateFechaLanzamiento(fechaStr, user) {
  if (user && user.role === 'admin') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(fechaStr || '').trim());
  if (!m) return 'La fecha de lanzamiento no es válida.';
  const picked = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const minAllowed = new Date(today); minAllowed.setDate(minAllowed.getDate() + 14);
  if (picked.getDay() !== 5) return 'Los lanzamientos solo se pueden programar para un viernes.';
  if (picked < minAllowed) return 'La fecha de lanzamiento debe ser con al menos 14 días de anticipación.';
  return null;
}

// Construye el payload en el formato que usa la API interna de Varlian
// (release project + producto), a partir de un lanzamiento registrado en
// Lion Records. Se usa tanto para exportar la ficha como para el envío
// automático al flujo de n8n que lo empuja a Varlian.
function buildVarlianPayload(launch, artist, vaultRefs) {
  const displayArtist = launch.displayArtist || (artist ? artist.name : launch.artistSlug);
  const refs = vaultRefs || {};
  return {
    release_project: {
      name: launch.titulo
    },
    product: {
      name: launch.titulo,
      display_artist: displayArtist,
      release_version: launch.releaseVersion || '',
      release_format_type: launch.esVideo ? 'VIDEO' : (TIPO_A_FORMATO[launch.tipo] || 'SINGLE'),
      is_video: Boolean(launch.esVideo),
      compilation: Boolean(launch.compilation),
      parental_advisory: Boolean(launch.explicitContent),
      total_volumes: Number(launch.totalVolumenes) || 1,
      consumer_release_date: launch.fechaLanzamiento,
      original_release_date: launch.fechaLanzamiento,
      preorder_date: launch.fechaPreventa || null,
      recording_year: launch.recordingYear ? Number(launch.recordingYear) : null,
      recording_location: launch.recordingLocation || null,
      c_line_year: launch.cLineAno ? Number(launch.cLineAno) : null,
      c_line_text: launch.cLineTexto || '',
      p_line_year: launch.pLineAno ? Number(launch.pLineAno) : null,
      p_line_text: launch.pLineTexto || '',
      courtesy_line: launch.courtesyLine || '',
      genre: launch.generoMusical || 'Latin',
      subgenre: launch.subgeneroMusical || '',
      language: launch.idioma || 'ES',
      catalog_tier: launch.catalogTier || 'FRONT',
      territories: (launch.territorios || 'WORLD').split(',').map(t => t.trim()).filter(Boolean),
      tags: (launch.etiquetas || '').split(',').map(t => t.trim()).filter(Boolean),
      upc: launch.upc || null,
      catalog_number: launch.catalogNumber || '',
      label: launch.label || 'Lion Records',
      album_notes: launch.notas || '',
      label_copy_info: launch.labelCopyInfo || '',
      tracks: (launch.tracks || []).map(t => ({
        sequence: t.sequence,
        name: t.titulo,
        isrc: t.isrc || null,
        duration: t.duracion || '',
        display_artist: t.artistas || displayArtist
      })),
      credits: (launch.creditos || []).map(c => ({ role: c.role, contributor_name: c.name })),
      cover_image: launch.portadaUrl ? {
        url: `${SITE_BASE_URL}${launch.portadaUrl}`,
        vault_hook: (refs.portada && refs.portada.vaultHook) || null,
        has_uploaded: Boolean(refs.portada)
      } : null,
      audio_asset: launch.audioUrl ? {
        url: `${SITE_BASE_URL}${launch.audioUrl}`,
        vault_hook: (refs.audio && refs.audio.vaultHook) || null,
        has_uploaded: Boolean(refs.audio)
      } : null,
      dolby_atmos_asset: launch.atmosUrl ? {
        url: `${SITE_BASE_URL}${launch.atmosUrl}`,
        vault_hook: (refs.atmos && refs.atmos.vaultHook) || null,
        has_uploaded: Boolean(refs.atmos)
      } : null,
      video_asset: launch.videoUrl ? {
        url: `${SITE_BASE_URL}${launch.videoUrl}`,
        vault_hook: (refs.video && refs.video.vaultHook) || null,
        has_uploaded: Boolean(refs.video)
      } : null
    },
    archivos: [
      launch.portadaUrl ? `Portada: ${SITE_BASE_URL}${launch.portadaUrl}` : '',
      launch.audioUrl ? `Audio: ${SITE_BASE_URL}${launch.audioUrl}` : '',
      launch.atmosUrl ? `Dolby Atmos: ${SITE_BASE_URL}${launch.atmosUrl}` : '',
      launch.videoUrl ? `Video: ${SITE_BASE_URL}${launch.videoUrl}` : '',
      launch.enlaceArchivos || ''
    ].filter(Boolean).join(' | ')
  };
}

// Campos que Lion Records exige tener llenos antes de poder enviar un
// lanzamiento a Varlian. Si falta alguno, no se deja enviar y se le avisa
// al artista con el detalle exacto de lo que falta. portadaUrl y audioUrl
// reflejan los mismos requisitos (cover_image, assets) que Varlian exige
// en su propia API.
const REQUIRED_FIELDS_BASE = [
  ['titulo', 'Título'],
  ['displayArtist', 'Artista(s) a mostrar'],
  ['fechaLanzamiento', 'Fecha de lanzamiento'],
  ['generoMusical', 'Género'],
  ['cLineAno', '© Año'],
  ['cLineTexto', '© Texto'],
  ['pLineAno', '℗ Año'],
  ['pLineTexto', '℗ Texto']
];
const REQUIRED_FIELDS_AUDIO = [
  ['portadaUrl', 'Foto de portada'],
  ['audioUrl', 'Archivo de audio']
];
const REQUIRED_FIELDS_VIDEO = [
  ['videoUrl', 'Archivo de video']
];

function getMissingFields(launch) {
  const missing = [];
  const required = REQUIRED_FIELDS_BASE.concat(launch.esVideo ? REQUIRED_FIELDS_VIDEO : REQUIRED_FIELDS_AUDIO);
  for (const [field, label] of required) {
    if (!String(launch[field] || '').trim()) missing.push(label);
  }
  if (!launch.esVideo && (!launch.tracks || !launch.tracks.length)) missing.push('Tracklist (al menos una pista)');
  return missing;
}

// Convierte el nombre de un artista en un slug único de URL (sin acentos,
// minúsculas, separado por guiones), evitando choques con slugs existentes.
function slugify(str) {
  const base = String(str || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'artista';
  return base;
}

function uniqueSlug(base, existingSlugs) {
  if (!existingSlugs.includes(base)) return base;
  let n = 2;
  while (existingSlugs.includes(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

// Genera una contraseña temporal legible (sin caracteres ambiguos) para
// entregársela al artista al crear o restablecer su acceso.
function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(14);
  let out = '';
  for (let i = 0; i < 14; i++) out += chars[bytes[i] % chars.length];
  return out;
}

function canManageArtist(user, artistSlug) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (user.role === 'artist' && user.artistSlug === artistSlug) return true;
  return false;
}

async function handler(req, res) {
  const parsedUrl = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsedUrl.pathname);
  const method = req.method;
  const user = getUser(req);

  // Estáticos
  if (method === 'GET' && (pathname.startsWith('/css/') || pathname.startsWith('/img/'))) {
    if (serveStatic(req, res, pathname)) return;
  }
  if (method === 'GET' && pathname.startsWith('/uploads/')) {
    if (serveUpload(req, res, pathname)) return;
  }

  try {
    // --- Público ---
    if (method === 'GET' && pathname === '/') {
      const db = readDb();
      return send(res, 200, landingPage({ user, artists: db.artists.filter(a => a.active) }));
    }

    const artistPublicMatch = pathname.match(/^\/artistas\/([a-z0-9-]+)$/);
    if (method === 'GET' && artistPublicMatch) {
      const db = readDb();
      const artist = db.artists.find(a => a.slug === artistPublicMatch[1]);
      if (!artist) return send(res, 404, errorPage('No encontrado', 'Artista no encontrado.'));
      return send(res, 200, artistPublicPage({ user, artist }));
    }

    // --- Auth ---
    if (method === 'GET' && pathname === '/login') {
      if (user) return redirect(res, '/dashboard');
      return send(res, 200, loginPage({ error: null }));
    }

    if (method === 'POST' && pathname === '/login') {
      const body = await parseBody(req);
      const db = readDb();
      const found = db.users.find(u => u.email.toLowerCase() === String(body.email || '').toLowerCase());
      if (!found || !verifyPassword(body.password || '', found.passwordHash)) {
        return send(res, 401, loginPage({ error: 'Correo o contraseña incorrectos.' }));
      }
      const token = signSession({ id: found.id, role: found.role, name: found.name, artistSlug: found.artistSlug });
      res.setHeader('Set-Cookie', sessionCookieHeader(token));
      return redirect(res, '/dashboard');
    }

    if (method === 'POST' && pathname === '/logout') {
      res.setHeader('Set-Cookie', sessionCookieHeader('', { clear: true }));
      return redirect(res, '/');
    }

    // --- Todo lo siguiente requiere sesión ---
    // (excepto el webhook de Telegram: lo llama Telegram, no un usuario con
    // sesión iniciada; se autentica con el secreto en la propia URL, ver
    // más abajo)
    const isTelegramWebhookPath = /^\/api\/telegram\/webhook\//.test(pathname);
    if (!isTelegramWebhookPath && (pathname.startsWith('/dashboard') || pathname.startsWith('/lanzamientos') || pathname.startsWith('/api/'))) {
      if (!user) {
        if (pathname.startsWith('/api/')) return sendJson(res, 401, { ok: false, error: 'No autenticado' });
        return redirect(res, '/login');
      }
    }

    if (method === 'GET' && pathname === '/dashboard') {
      if (user.role === 'admin') return redirect(res, '/dashboard/admin');
      if (user.role === 'artist') return redirect(res, `/dashboard/artistas/${user.artistSlug}`);
      return redirect(res, '/');
    }

    if (method === 'GET' && pathname === '/dashboard/admin') {
      if (user.role !== 'admin') return redirect(res, '/dashboard');
      const db = readDb();
      return send(res, 200, adminDashboardPage({
        user,
        artists: db.artists,
        launches: db.launches.slice().reverse(),
        runLog: db.runLog.slice(-20).reverse()
      }));
    }

    // --- Gestión de accesos de artistas (solo admin) ---
    if (method === 'GET' && pathname === '/dashboard/admin/accesos') {
      if (user.role !== 'admin') return redirect(res, '/dashboard');
      const db = readDb();
      return send(res, 200, accessesPage({ user, artists: db.artists, users: db.users, error: null, success: null }));
    }

    if (method === 'POST' && pathname === '/dashboard/admin/accesos/nuevo') {
      if (user.role !== 'admin') return send(res, 403, errorPage('Acceso denegado', 'Solo un administrador puede generar accesos.'));
      const body = await parseBody(req);
      const db = readDb();

      const name = (body.name || '').trim();
      if (!name) {
        return send(res, 400, accessesPage({ user, artists: db.artists, users: db.users, error: 'El nombre del artista es obligatorio.', success: null }));
      }

      const baseSlug = slugify(name);
      const slug = uniqueSlug(baseSlug, db.artists.map(a => a.slug));
      const email = (body.email || '').trim().toLowerCase() || `${slug}@lionrecords.mx`;
      if (db.users.some(u => u.email.toLowerCase() === email)) {
        return send(res, 400, accessesPage({ user, artists: db.artists, users: db.users, error: `Ya existe una cuenta con el correo ${email}.`, success: null }));
      }

      const password = (body.password || '').trim() || generatePassword();

      const artist = {
        slug,
        name,
        genre: body.genre || '',
        region: body.region || '',
        bio: body.bio || '',
        socials: { instagram: null, tiktok: null, facebook: null },
        n8nWorkflow: { workflowName: '', description: '', manualTriggerUrl: '', approvalTelegramGroup: '' },
        active: true,
        featured: false
      };
      db.artists.push(artist);

      db.users.push({
        id: `artist-${slug}`,
        role: 'artist',
        name,
        email,
        passwordHash: hashPassword(password),
        artistSlug: slug
      });

      writeDb(db);
      return send(res, 200, accessCreatedPage({ user, name, email, password, slug, isReset: false }));
    }

    const resetAccessMatch = pathname.match(/^\/dashboard\/admin\/accesos\/([a-z0-9-]+)\/restablecer$/);
    if (method === 'POST' && resetAccessMatch) {
      if (user.role !== 'admin') return send(res, 403, errorPage('Acceso denegado', 'Solo un administrador puede restablecer accesos.'));
      const slug = resetAccessMatch[1];
      const db = readDb();
      const targetUser = db.users.find(u => u.artistSlug === slug && u.role === 'artist');
      if (!targetUser) return send(res, 404, errorPage('No encontrado', 'No hay una cuenta de artista con ese slug.'));

      const password = generatePassword();
      targetUser.passwordHash = hashPassword(password);
      writeDb(db);
      return send(res, 200, accessCreatedPage({ user, name: targetUser.name, email: targetUser.email, password, slug, isReset: true }));
    }

    const artistAvatarMatch = pathname.match(/^\/dashboard\/admin\/artistas\/([a-z0-9-]+)\/foto$/);
    if (method === 'POST' && artistAvatarMatch) {
      if (user.role !== 'admin') return send(res, 403, errorPage('Acceso denegado', 'Solo un administrador puede cambiar la foto de un artista.'));
      const slug = artistAvatarMatch[1];
      const db = readDb();
      const artist = db.artists.find(a => a.slug === slug);
      if (!artist) return send(res, 404, errorPage('No encontrado', 'No hay un artista con ese slug.'));
      const body = await parseBody(req);
      const imageUrl = (body.imageUrl || '').trim();
      if (!imageUrl) {
        return send(res, 200, accessesPage({ user, artists: db.artists, users: db.users, error: 'Pega la URL de una imagen antes de guardar.', success: null }));
      }
      try {
        ensureUploadDirs();
        const { buffer, ext } = await downloadRemoteImage(imageUrl);
        const dest = path.join(AVATARS_DIR, `${slug}${ext}`);
        fs.writeFileSync(dest, buffer);
        // La URL guardada en el artista es estable (sin query); el número
        // de versión se guarda aparte y se agrega solo al mostrarla, así el
        // navegador descarga la foto nueva en vez de una vieja en caché
        // cuando se reemplaza una foto con la misma extensión.
        artist.avatarUrl = `/uploads/avatars/${slug}${ext}`;
        artist.avatarVersion = Date.now();
        writeDb(db);
        return send(res, 200, accessesPage({ user, artists: db.artists, users: db.users, error: null, success: `Foto de ${artist.name} actualizada.` }));
      } catch (e) {
        return send(res, 200, accessesPage({ user, artists: db.artists, users: db.users, error: 'No se pudo guardar la foto: ' + e.message, success: null }));
      }
    }

    const artistDeleteMatch = pathname.match(/^\/dashboard\/admin\/artistas\/([a-z0-9-]+)\/eliminar$/);
    if (method === 'POST' && artistDeleteMatch) {
      if (user.role !== 'admin') return send(res, 403, errorPage('Acceso denegado', 'Solo un administrador puede eliminar un artista.'));
      const slug = artistDeleteMatch[1];
      const db = readDb();
      const artist = db.artists.find(a => a.slug === slug);
      if (!artist) return send(res, 404, errorPage('No encontrado', 'No hay un artista con ese slug.'));
      db.artists = db.artists.filter(a => a.slug !== slug);
      db.users = db.users.filter(u => u.artistSlug !== slug);
      writeDb(db);
      return send(res, 200, accessesPage({ user, artists: db.artists, users: db.users, error: null, success: `${artist.name} se eliminó correctamente.` }));
    }

    const artistDashMatch = pathname.match(/^\/dashboard\/artistas\/([a-z0-9-]+)$/);
    if (method === 'GET' && artistDashMatch) {
      const slug = artistDashMatch[1];
      const db = readDb();
      const artist = db.artists.find(a => a.slug === slug);
      if (!artist) return send(res, 404, errorPage('No encontrado', 'Artista no encontrado.'));
      if (!canManageArtist(user, slug)) return send(res, 403, errorPage('Acceso denegado', 'No tienes acceso al panel de este artista.'));
      const launches = db.launches.filter(l => l.artistSlug === slug).reverse();
      const runLog = db.runLog.filter(r => r.artistSlug === slug).slice(-15).reverse();
      return send(res, 200, artistDashboardPage({
        user, artist, launches, runLog,
        triggerConfigured: Boolean(artist.n8nWorkflow && artist.n8nWorkflow.manualTriggerUrl)
      }));
    }

    // --- Flujos n8n ---
    const runFlowMatch = pathname.match(/^\/api\/artistas\/([a-z0-9-]+)\/ejecutar-flujo$/);
    if (method === 'POST' && runFlowMatch) {
      const slug = runFlowMatch[1];
      const db = readDb();
      const artist = db.artists.find(a => a.slug === slug);
      if (!artist) return sendJson(res, 404, { ok: false, error: 'Artista no encontrado.' });
      if (!canManageArtist(user, slug)) return sendJson(res, 403, { ok: false, error: 'No autorizado.' });

      const targetUrl = artist.n8nWorkflow && artist.n8nWorkflow.manualTriggerUrl;
      const logEntry = {
        id: `run-${Date.now()}`,
        artistSlug: slug,
        triggeredBy: user.name,
        timestamp: new Date().toISOString(),
        status: 'pendiente'
      };

      if (!targetUrl) {
        logEntry.status = 'no-configurado';
        logEntry.message = 'No hay un webhook de disparo manual configurado para este flujo en n8n.';
        db.runLog.push(logEntry);
        writeDb(db);
        return sendJson(res, 400, { ok: false, error: logEntry.message });
      }

      try {
        const result = await postJson(targetUrl);
        logEntry.status = (result.status >= 200 && result.status < 300) ? 'ejecutado' : 'error';
        logEntry.httpStatus = result.status;
        db.runLog.push(logEntry);
        writeDb(db);
        return sendJson(res, logEntry.status === 'ejecutado' ? 200 : 502, { ok: logEntry.status === 'ejecutado', status: result.status });
      } catch (err) {
        logEntry.status = 'error';
        logEntry.message = err.message;
        db.runLog.push(logEntry);
        writeDb(db);
        return sendJson(res, 502, { ok: false, error: 'No se pudo contactar a n8n: ' + err.message });
      }
    }

    // --- Lanzamientos ---
    if (method === 'GET' && pathname === '/lanzamientos/nuevo') {
      const db = readDb();
      const artists = user.role === 'admin' ? db.artists : db.artists.filter(a => a.slug === user.artistSlug);
      return send(res, 200, launchNewPage({ user, artists, error: null, values: null }));
    }

    if (method === 'POST' && pathname === '/lanzamientos/nuevo') {
      const newId = `launch-${Date.now()}`;
      const contentType = req.headers['content-type'] || '';
      let body, portadaUrl = null, audioUrl = null, atmosUrl = null, videoUrl = null;
      const db = readDb();
      const artists = user.role === 'admin' ? db.artists : db.artists.filter(a => a.slug === user.artistSlug);

      if (contentType.includes('multipart/form-data')) {
        try {
          const parsed = await parseMultipartForm(req, { id: newId });
          body = parsed.fields;
          portadaUrl = parsed.portadaUrl;
          audioUrl = parsed.audioUrl;
          atmosUrl = parsed.atmosUrl;
          videoUrl = parsed.videoUrl;
        } catch (e) {
          return send(res, 400, launchNewPage({ user, artists, error: 'No se pudo procesar el archivo subido: ' + e.message, values: null }));
        }
      } else {
        body = await parseBody(req);
      }

      if (!canManageArtist(user, body.artistSlug)) {
        return send(res, 403, errorPage('Acceso denegado', 'No puedes registrar lanzamientos para este artista.'));
      }
      if (!body.titulo || !body.fechaLanzamiento) {
        return send(res, 400, launchNewPage({ user, artists, error: 'Título y fecha de lanzamiento son obligatorios.', values: Object.assign({}, body, { portadaUrl, audioUrl, atmosUrl, videoUrl }) }));
      }
      const fechaError = validateFechaLanzamiento(body.fechaLanzamiento, user);
      if (fechaError) {
        return send(res, 400, launchNewPage({ user, artists, error: fechaError, values: Object.assign({}, body, { portadaUrl, audioUrl, atmosUrl, videoUrl }) }));
      }

      const tracks = parseTracklist(body.tracklist);

      const launch = {
        id: newId,
        artistSlug: body.artistSlug,
        esVideo: body.esVideo === '1',
        titulo: body.titulo,
        displayArtist: body.displayArtist || '',
        tipo: body.tipo || 'Sencillo',
        releaseVersion: body.releaseVersion || '',
        compilation: body.compilation === '1',
        explicitContent: body.explicitContent === '1',
        fechaLanzamiento: body.fechaLanzamiento,
        fechaPreventa: body.fechaPreventa || '',
        recordingYear: body.recordingYear || '',
        recordingLocation: body.recordingLocation || '',
        // El copyright es fijo para todo el catálogo de Lion Records — se
        // ignora cualquier valor que venga en el formulario (readonly en la
        // interfaz) para que no se pueda alterar con un envío directo.
        cLineAno: COPYRIGHT_DEFAULTS.ano,
        cLineTexto: COPYRIGHT_DEFAULTS.texto,
        pLineAno: COPYRIGHT_DEFAULTS.ano,
        pLineTexto: COPYRIGHT_DEFAULTS.texto,
        courtesyLine: COPYRIGHT_DEFAULTS.courtesy,
        generoMusical: body.generoMusical || '',
        subgeneroMusical: body.subgeneroMusical || '',
        idioma: body.idioma || 'ES',
        catalogTier: body.catalogTier || 'FRONT',
        territorios: body.territorios || 'WORLD',
        etiquetas: body.etiquetas || '',
        upc: body.upc || '',
        catalogNumber: body.catalogNumber || '',
        totalVolumenes: body.totalVolumenes || '1',
        tracks,
        portadaUrl: portadaUrl || '',
        audioUrl: audioUrl || '',
        atmosUrl: atmosUrl || '',
        videoUrl: videoUrl || '',
        creditos: parseCreditsJson(body.creditosJson),
        tiktokPromoInicioSegundos: body.tiktokPromoInicioSegundos || '',
        letra: body.letra || '',
        pitch: body.pitch || '',
        enlaceArchivos: body.enlaceArchivos || '',
        labelCopyInfo: body.labelCopyInfo || '',
        notas: body.notas || '',
        estadoDistribucion: 'registrado',
        creadoPor: user.name,
        creadoEn: new Date().toISOString()
      };
      db.launches.push(launch);
      writeDb(db);
      return redirect(res, `/lanzamientos/${launch.id}`);
    }

    const launchDetailMatch = pathname.match(/^\/lanzamientos\/([a-z0-9-]+)$/);
    if (method === 'GET' && launchDetailMatch) {
      const db = readDb();
      const launch = db.launches.find(l => l.id === launchDetailMatch[1]);
      if (!launch) return send(res, 404, errorPage('No encontrado', 'Lanzamiento no encontrado.'));
      if (!canManageArtist(user, launch.artistSlug)) return send(res, 403, errorPage('Acceso denegado', 'No tienes acceso a este lanzamiento.'));
      const artist = db.artists.find(a => a.slug === launch.artistSlug);
      const missingFields = getMissingFields(launch);
      const incompleto = parsedUrl.query && parsedUrl.query.incompleto === '1';
      return send(res, 200, launchDetailPage({ user, launch, artist, missingFields, showIncompleteModal: incompleto && missingFields.length > 0 }));
    }

    // Edición de un lanzamiento ya registrado (para completar campos que
    // falten antes de poder enviarlo a Varlian).
    const launchEditMatch = pathname.match(/^\/lanzamientos\/([a-z0-9-]+)\/editar$/);
    if (method === 'GET' && launchEditMatch) {
      const db = readDb();
      const launch = db.launches.find(l => l.id === launchEditMatch[1]);
      if (!launch) return send(res, 404, errorPage('No encontrado', 'Lanzamiento no encontrado.'));
      if (!canManageArtist(user, launch.artistSlug)) return send(res, 403, errorPage('Acceso denegado', 'No tienes acceso a este lanzamiento.'));
      const artists = user.role === 'admin' ? db.artists : db.artists.filter(a => a.slug === user.artistSlug);
      const values = Object.assign({}, launch, {
        tracklist: (launch.tracks || []).map(t => [t.titulo, t.isrc || '', t.duracion || '', t.artistas || ''].join(' ; ')).join('\n'),
        compilation: launch.compilation ? '1' : '',
        explicitContent: launch.explicitContent ? '1' : ''
      });
      return send(res, 200, launchNewPage({ user, artists, error: null, values, editId: launch.id }));
    }

    if (method === 'POST' && launchEditMatch) {
      const db = readDb();
      const launch = db.launches.find(l => l.id === launchEditMatch[1]);
      if (!launch) return send(res, 404, errorPage('No encontrado', 'Lanzamiento no encontrado.'));
      if (!canManageArtist(user, launch.artistSlug)) return send(res, 403, errorPage('Acceso denegado', 'No puedes editar este lanzamiento.'));

      const contentType = req.headers['content-type'] || '';
      let body, portadaUrl = null, audioUrl = null, atmosUrl = null, videoUrl = null;
      const artists = user.role === 'admin' ? db.artists : db.artists.filter(a => a.slug === user.artistSlug);

      if (contentType.includes('multipart/form-data')) {
        try {
          const parsed = await parseMultipartForm(req, { id: launch.id });
          body = parsed.fields;
          portadaUrl = parsed.portadaUrl;
          audioUrl = parsed.audioUrl;
          atmosUrl = parsed.atmosUrl;
          videoUrl = parsed.videoUrl;
        } catch (e) {
          return send(res, 400, launchNewPage({ user, artists, error: 'No se pudo procesar el archivo subido: ' + e.message, values: launch, editId: launch.id }));
        }
      } else {
        body = await parseBody(req);
      }

      if (!body.titulo || !body.fechaLanzamiento) {
        return send(res, 400, launchNewPage({ user, artists, error: 'Título y fecha de lanzamiento son obligatorios.', values: Object.assign({}, body, { portadaUrl: portadaUrl || launch.portadaUrl, audioUrl: audioUrl || launch.audioUrl, atmosUrl: atmosUrl || launch.atmosUrl, videoUrl: videoUrl || launch.videoUrl }), editId: launch.id }));
      }
      const fechaErrorEdit = validateFechaLanzamiento(body.fechaLanzamiento, user);
      if (fechaErrorEdit) {
        return send(res, 400, launchNewPage({ user, artists, error: fechaErrorEdit, values: Object.assign({}, body, { portadaUrl: portadaUrl || launch.portadaUrl, audioUrl: audioUrl || launch.audioUrl, atmosUrl: atmosUrl || launch.atmosUrl, videoUrl: videoUrl || launch.videoUrl }), editId: launch.id }));
      }

      Object.assign(launch, {
        titulo: body.titulo,
        displayArtist: body.displayArtist || '',
        tipo: body.tipo || 'Sencillo',
        releaseVersion: body.releaseVersion || '',
        compilation: body.compilation === '1',
        explicitContent: body.explicitContent === '1',
        fechaLanzamiento: body.fechaLanzamiento,
        fechaPreventa: body.fechaPreventa || '',
        recordingYear: body.recordingYear || '',
        recordingLocation: body.recordingLocation || '',
        // El copyright es fijo para todo el catálogo de Lion Records — se
        // ignora cualquier valor que venga en el formulario (readonly en la
        // interfaz) para que no se pueda alterar con un envío directo.
        cLineAno: COPYRIGHT_DEFAULTS.ano,
        cLineTexto: COPYRIGHT_DEFAULTS.texto,
        pLineAno: COPYRIGHT_DEFAULTS.ano,
        pLineTexto: COPYRIGHT_DEFAULTS.texto,
        courtesyLine: COPYRIGHT_DEFAULTS.courtesy,
        generoMusical: body.generoMusical || '',
        subgeneroMusical: body.subgeneroMusical || '',
        idioma: body.idioma || 'ES',
        catalogTier: body.catalogTier || 'FRONT',
        territorios: body.territorios || 'WORLD',
        etiquetas: body.etiquetas || '',
        upc: body.upc || '',
        catalogNumber: body.catalogNumber || '',
        totalVolumenes: body.totalVolumenes || '1',
        tracks: parseTracklist(body.tracklist),
        portadaUrl: portadaUrl || launch.portadaUrl || '',
        audioUrl: audioUrl || launch.audioUrl || '',
        atmosUrl: atmosUrl || launch.atmosUrl || '',
        videoUrl: videoUrl || launch.videoUrl || '',
        creditos: body.creditosJson !== undefined ? parseCreditsJson(body.creditosJson) : (launch.creditos || []),
        tiktokPromoInicioSegundos: body.tiktokPromoInicioSegundos || '',
        letra: body.letra || '',
        pitch: body.pitch || '',
        enlaceArchivos: body.enlaceArchivos || '',
        labelCopyInfo: body.labelCopyInfo || '',
        notas: body.notas || ''
      });
      writeDb(db);
      return redirect(res, `/lanzamientos/${launch.id}`);
    }

    // Crea un lanzamiento de video independiente a partir de uno de audio ya
    // existente, precargando los datos compartidos (artista, título, género,
    // copyright, etc.) para que el usuario solo tenga que subir el archivo
    // de video y ajustar lo que cambie. Es un lanzamiento totalmente nuevo,
    // con su propio envío a Varlian.
    const crearVideoMatch = pathname.match(/^\/lanzamientos\/([a-z0-9-]+)\/crear-video$/);
    if (method === 'POST' && crearVideoMatch) {
      const db = readDb();
      const original = db.launches.find(l => l.id === crearVideoMatch[1]);
      if (!original) return send(res, 404, errorPage('No encontrado', 'Lanzamiento no encontrado.'));
      if (!canManageArtist(user, original.artistSlug)) return send(res, 403, errorPage('Acceso denegado', 'No tienes acceso a este lanzamiento.'));

      const newId = `launch-${Date.now()}`;
      const videoLaunch = {
        id: newId,
        artistSlug: original.artistSlug,
        esVideo: true,
        titulo: original.titulo,
        displayArtist: original.displayArtist || '',
        tipo: original.tipo || 'Sencillo',
        releaseVersion: original.releaseVersion || '',
        compilation: false,
        explicitContent: original.explicitContent || false,
        fechaLanzamiento: '',
        fechaPreventa: '',
        recordingYear: original.recordingYear || '',
        recordingLocation: original.recordingLocation || '',
        cLineAno: COPYRIGHT_DEFAULTS.ano,
        cLineTexto: COPYRIGHT_DEFAULTS.texto,
        pLineAno: COPYRIGHT_DEFAULTS.ano,
        pLineTexto: COPYRIGHT_DEFAULTS.texto,
        courtesyLine: COPYRIGHT_DEFAULTS.courtesy,
        generoMusical: original.generoMusical || '',
        subgeneroMusical: original.subgeneroMusical || '',
        idioma: original.idioma || 'ES',
        catalogTier: original.catalogTier || 'FRONT',
        territorios: original.territorios || 'WORLD',
        etiquetas: original.etiquetas || '',
        upc: '',
        catalogNumber: '',
        totalVolumenes: '1',
        tracks: [],
        portadaUrl: '',
        audioUrl: '',
        atmosUrl: '',
        videoUrl: '',
        creditos: (original.creditos || []).slice(),
        tiktokPromoInicioSegundos: '',
        letra: '',
        pitch: original.pitch || '',
        enlaceArchivos: '',
        labelCopyInfo: original.labelCopyInfo || '',
        notas: `Versión en video de "${original.titulo}" (lanzamiento original: ${original.id}).`,
        estadoDistribucion: 'registrado',
        creadoPor: user.name,
        creadoEn: new Date().toISOString(),
        origenAudioLanzamientoId: original.id
      };
      db.launches.push(videoLaunch);
      writeDb(db);
      return redirect(res, `/lanzamientos/${videoLaunch.id}/editar`);
    }

    const launchExportMatch = pathname.match(/^\/lanzamientos\/([a-z0-9-]+)\/exportar$/);
    if (method === 'GET' && launchExportMatch) {
      const db = readDb();
      const launch = db.launches.find(l => l.id === launchExportMatch[1]);
      if (!launch) return send(res, 404, 'No encontrado');
      if (!canManageArtist(user, launch.artistSlug)) return send(res, 403, 'No autorizado');
      const artist = db.artists.find(a => a.slug === launch.artistSlug);
      const payload = buildVarlianPayload(launch, artist);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="lanzamiento-${launch.id}.json"`
      });
      return res.end(JSON.stringify(payload, null, 2));
    }

    // "Enviar lanzamiento": ya NO manda directo a Varlian. En vez de eso le
    // avisa al admin por Telegram con el resumen del lanzamiento y dos
    // botones (Aprobar / Rechazar). El envío real a Varlian solo ocurre
    // cuando el admin aprueba desde Telegram (ver /api/telegram/webhook más
    // abajo), para que nada se mande a distribución sin que él lo revise.
    const sendVarlianMatch = pathname.match(/^\/api\/lanzamientos\/([a-z0-9-]+)\/enviar-varlian$/);
    if (method === 'POST' && sendVarlianMatch) {
      const db = readDb();
      const launch = db.launches.find(l => l.id === sendVarlianMatch[1]);
      if (!launch) return sendJson(res, 404, { ok: false, error: 'Lanzamiento no encontrado.' });
      if (!canManageArtist(user, launch.artistSlug)) return sendJson(res, 403, { ok: false, error: 'No autorizado.' });
      const artist = db.artists.find(a => a.slug === launch.artistSlug);

      // No se deja enviar un lanzamiento incompleto: si falta algo se
      // regresa a la ficha con el aviso (la página muestra la ventana con
      // el detalle). El botón ya valida esto en el navegador, esto es el
      // respaldo del lado del servidor por si alguien lo salta.
      const missingFields = getMissingFields(launch);
      if (missingFields.length) {
        if ((req.headers.accept || '').includes('application/json')) {
          return sendJson(res, 400, { ok: false, error: 'Faltan datos obligatorios: ' + missingFields.join(', ') });
        }
        return redirect(res, `/lanzamientos/${launch.id}?incompleto=1`);
      }

      const botToken = getSetting(db, 'telegramBotToken', 'TELEGRAM_BOT_TOKEN');
      const chatId = getSetting(db, 'telegramChatId', 'TELEGRAM_ADMIN_CHAT_ID');
      if (!botToken || !chatId) {
        launch.estadoDistribucion = 'no-configurado';
        writeDb(db);
        if ((req.headers.accept || '').includes('application/json')) {
          return sendJson(res, 400, { ok: false, error: 'El aviso de Telegram todavía no está configurado (Admin > Integraciones).' });
        }
        return redirect(res, `/lanzamientos/${launch.id}`);
      }

      try {
        const launchUrl = `${SITE_BASE_URL}/lanzamientos/${launch.id}`;
        const messageId = await telegram.sendApprovalMessage(botToken, chatId, { launch, artist, launchUrl });
        launch.estadoDistribucion = 'pendiente-aprobacion';
        launch.telegramApprovalMessageId = messageId || null;
        launch.telegramApprovalError = '';
        writeDb(db);
      } catch (err) {
        launch.estadoDistribucion = 'no-configurado';
        launch.telegramApprovalError = err.message;
        writeDb(db);
        if ((req.headers.accept || '').includes('application/json')) {
          return sendJson(res, 502, { ok: false, error: 'No se pudo avisar por Telegram: ' + err.message });
        }
      }
      return redirect(res, `/lanzamientos/${launch.id}`);
    }

    // Recibe los callbacks de los botones "Aprobar"/"Rechazar" del mensaje
    // de Telegram. La URL lleva un secreto único (generado por lanzamientos,
    // ver store.js) para que nadie más pueda dispararla. Siempre responde
    // 200 (Telegram reintenta si no le respondemos rápido y bien), y
    // cualquier error real se le avisa al admin como mensaje de Telegram en
    // vez de como respuesta HTTP.
    const telegramWebhookMatch = pathname.match(/^\/api\/telegram\/webhook\/([a-f0-9]+)$/);
    if (method === 'POST' && telegramWebhookMatch) {
      const db = readDb();
      if (telegramWebhookMatch[1] !== db.settings.telegramWebhookSecret) {
        return sendJson(res, 404, { ok: false });
      }
      const botToken = getSetting(db, 'telegramBotToken', 'TELEGRAM_BOT_TOKEN');
      let update = {};
      try { update = await parseBody(req); } catch (e) { update = {}; }

      const cb = update.callback_query;
      if (!cb || !cb.data) return sendJson(res, 200, { ok: true });

      // Responde primero para que el botón deje de "cargar" en Telegram,
      // incluso si algo falla después.
      try { await telegram.answerCallbackQuery(botToken, cb.id, 'Procesando…'); } catch (e) { /* no crítico */ }

      const chatId = cb.message && cb.message.chat && cb.message.chat.id;
      const messageId = cb.message && cb.message.message_id;
      const [action, launchId] = String(cb.data).split(':');
      const launch = db.launches.find(l => l.id === launchId);
      if (!launch) {
        if (botToken && chatId) {
          try { await telegram.sendMessage(botToken, chatId, `No encontré ese lanzamiento (puede que ya no exista).`); } catch (e) {}
        }
        return sendJson(res, 200, { ok: true });
      }

      if (action === 'rechazar_envio') {
        launch.estadoDistribucion = 'rechazado-manual';
        writeDb(db);
        if (botToken && chatId) {
          await telegram.markApprovalMessageResolved(botToken, chatId, messageId, `❌ Rechazaste "${launch.titulo}". No se mandó a Varlian.`);
        }
        return sendJson(res, 200, { ok: true });
      }

      if (action === 'aprobar_envio') {
        const artist = db.artists.find(a => a.slug === launch.artistSlug);
        const missingFields = getMissingFields(launch);
        if (missingFields.length) {
          if (botToken && chatId) {
            try {
              await telegram.sendMessage(botToken, chatId, `⚠️ "${launch.titulo}" quedó incompleto después de aprobarlo (falta: ${missingFields.join(', ')}). Pídele al artista que lo complete y vuelve a enviarlo.`);
            } catch (e) { /* no crítico */ }
          }
          return sendJson(res, 200, { ok: true });
        }

        const targetUrl = getSetting(db, 'varlianPushWebhookUrl', 'VARLIAN_PUSH_WEBHOOK_URL');
        if (!targetUrl) {
          launch.estadoDistribucion = 'no-configurado';
          writeDb(db);
          if (botToken && chatId) {
            await telegram.markApprovalMessageResolved(botToken, chatId, messageId, `⚠️ Aprobaste "${launch.titulo}", pero la automatización hacia Varlian todavía no está configurada (Admin > Integraciones).`);
          }
          return sendJson(res, 200, { ok: true });
        }

        // Antes de armar la ficha, intenta subir los archivos directo al
        // vault de Varlian (si hay credenciales configuradas). Si esto falla
        // por cualquier motivo, se sigue adelante igual: el envío no se
        // detiene, solo se manda con el enlace de lionrecords.mx como
        // respaldo.
        let vaultRefs = null;
        try {
          vaultRefs = await tryUploadLaunchFilesToVault(launch);
          launch.vaultUploadStatus = vaultRefs ? 'subido-automaticamente' : 'no-configurado';
          launch.vaultUploadError = '';
        } catch (err) {
          vaultRefs = null;
          launch.vaultUploadStatus = 'fallback-manual';
          launch.vaultUploadError = err.message;
        }

        const payload = buildVarlianPayload(launch, artist, vaultRefs);
        try {
          const result = await postJsonBody(targetUrl, payload);
          const ok = result.status >= 200 && result.status < 300;
          launch.estadoDistribucion = ok ? 'enviado-a-varlian' : 'error-envio';
          writeDb(db);
          let motivo = '';
          if (!ok) {
            try {
              const parsed = JSON.parse(result.body || '{}');
              motivo = parsed.error || parsed.message || parsed.detail || '';
            } catch (e) { /* la respuesta no era JSON, no hay más detalle */ }
          }
          const resultLine = ok
            ? `✅ Varlian aceptó "${launch.titulo}". Se mandó a distribución correctamente.`
            : `❌ Varlian rechazó "${launch.titulo}"${motivo ? ' — ' + motivo : ' (revisa que no falten datos y vuelve a intentar)'}.`;
          if (botToken && chatId) await telegram.markApprovalMessageResolved(botToken, chatId, messageId, resultLine);
        } catch (err) {
          launch.estadoDistribucion = 'error-envio';
          writeDb(db);
          if (botToken && chatId) {
            await telegram.markApprovalMessageResolved(botToken, chatId, messageId, `❌ No se pudo contactar a Varlian para "${launch.titulo}": ${err.message}`);
          }
        }
        return sendJson(res, 200, { ok: true });
      }

      return sendJson(res, 200, { ok: true });
    }

    // --- Admin > Integraciones ---
    const integracionesMatch = pathname === '/admin/integraciones';
    if (method === 'GET' && integracionesMatch) {
      if (!user || user.role !== 'admin') return send(res, 403, errorPage('No autorizado', 'Solo el admin puede ver esta página.'));
      const db = readDb();
      return send(res, 200, integracionesPage({
        user,
        settings: db.settings,
        webhookUrl: `${SITE_BASE_URL}${telegramWebhookPath(db)}`
      }));
    }
    if (method === 'POST' && integracionesMatch) {
      if (!user || user.role !== 'admin') return send(res, 403, errorPage('No autorizado', 'Solo el admin puede hacer esto.'));
      const db = readDb();
      const body = await parseBody(req);
      db.settings.telegramBotToken = String(body.telegramBotToken || '').trim();
      db.settings.telegramChatId = String(body.telegramChatId || '').trim();
      db.settings.varlianPushWebhookUrl = String(body.varlianPushWebhookUrl || '').trim();
      writeDb(db);
      return send(res, 200, integracionesPage({
        user,
        settings: db.settings,
        webhookUrl: `${SITE_BASE_URL}${telegramWebhookPath(db)}`,
        message: 'Guardado.'
      }));
    }
    if (method === 'POST' && pathname === '/admin/integraciones/detectar-chat-id') {
      if (!user || user.role !== 'admin') return send(res, 403, errorPage('No autorizado', 'Solo el admin puede hacer esto.'));
      const db = readDb();
      const botToken = getSetting(db, 'telegramBotToken', 'TELEGRAM_BOT_TOKEN');
      let message = null, error = null;
      if (!botToken) {
        error = 'Primero guarda el token del bot.';
      } else {
        try {
          const chatId = await telegram.detectLastChatId(botToken);
          if (chatId) {
            db.settings.telegramChatId = String(chatId);
            writeDb(db);
            message = `Chat ID detectado y guardado: ${chatId}`;
          } else {
            error = 'No encontré mensajes recientes. Mándale un mensaje a tu bot en Telegram y vuelve a intentar.';
          }
        } catch (err) {
          error = 'No se pudo consultar Telegram: ' + err.message;
        }
      }
      return send(res, 200, integracionesPage({
        user, settings: db.settings, webhookUrl: `${SITE_BASE_URL}${telegramWebhookPath(db)}`, message, error
      }));
    }
    if (method === 'POST' && pathname === '/admin/integraciones/registrar-webhook') {
      if (!user || user.role !== 'admin') return send(res, 403, errorPage('No autorizado', 'Solo el admin puede hacer esto.'));
      const db = readDb();
      const botToken = getSetting(db, 'telegramBotToken', 'TELEGRAM_BOT_TOKEN');
      let message = null, error = null;
      if (!botToken) {
        error = 'Primero guarda el token del bot.';
      } else {
        try {
          await telegram.setWebhook(botToken, `${SITE_BASE_URL}${telegramWebhookPath(db)}`);
          message = 'Webhook registrado. Los botones de Aprobar/Rechazar ya deberían funcionar.';
        } catch (err) {
          error = 'No se pudo registrar el webhook: ' + err.message;
        }
      }
      return send(res, 200, integracionesPage({
        user, settings: db.settings, webhookUrl: `${SITE_BASE_URL}${telegramWebhookPath(db)}`, message, error
      }));
    }

    return send(res, 404, errorPage('Página no encontrada', 'La página que buscas no existe.'));
  } catch (err) {
    console.error(err);
    return send(res, 500, errorPage('Error del servidor', 'Ocurrió un error inesperado.'));
  }
}

http.createServer((req, res) => { handler(req, res); }).listen(PORT, () => {
  console.log(`Lion Records app escuchando en el puerto ${PORT}`);
});
