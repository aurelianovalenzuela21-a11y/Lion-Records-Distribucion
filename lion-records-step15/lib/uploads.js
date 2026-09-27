// Manejo de portadas, audio y (opcional) Dolby Atmos subidos por los
// artistas. Los archivos se guardan fuera de /public, en su propia carpeta a
// nivel raíz (igual que data/db.json), para que un redeploy del sitio no los
// borre.
//
// Se implementa un parser de multipart/form-data sin dependencias externas
// (en vez de una librería como busboy) para no depender de que el build de
// Hostinger tenga acceso al registro de npm en el momento del despliegue.
//
// También se valida aquí, sin dependencias externas, que:
//  - la portada sea PNG o JPEG de EXACTAMENTE 3000x3000 píxeles
//    (requisito real de Varlian/DSPs para portadas).
//  - el audio (y el archivo de Dolby Atmos, si se sube) sea WAV.
const fs = require('fs');
const path = require('path');

const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');
const COVERS_DIR = path.join(UPLOADS_DIR, 'portadas');
const AUDIO_DIR = path.join(UPLOADS_DIR, 'audio');
const ATMOS_DIR = path.join(UPLOADS_DIR, 'atmos');
const VIDEO_DIR = path.join(UPLOADS_DIR, 'video');
const AVATARS_DIR = path.join(UPLOADS_DIR, 'avatars');

const MAX_MULTIPART_BYTES = 200 * 1024 * 1024; // 200MB por request (WAV pesa bastante más que MP3)

const UPLOAD_MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime'
};

const VIDEO_EXTS = ['.mp4', '.mov'];
function validateVideoFile(buf, filename) {
  const ext = extFromFilename(filename);
  if (!VIDEO_EXTS.includes(ext)) {
    throw new Error(`El archivo de video (${filename || 'archivo'}) debe ser .mp4 o .mov.`);
  }
}

// Campos de archivo soportados y sus reglas. Cada uno define en qué carpeta
// se guarda y una función de validación que revisa el Buffer del archivo
// completo antes de aceptarlo (además de la extensión/mimetype declarados,
// que no son de fiar por sí solos).
const FILE_FIELDS = {
  portada: { dir: COVERS_DIR, urlPrefix: 'portadas', validate: validateCoverImage },
  audio: { dir: AUDIO_DIR, urlPrefix: 'audio', validate: validateWav },
  atmos: { dir: ATMOS_DIR, urlPrefix: 'atmos', validate: validateWav },
  video: { dir: VIDEO_DIR, urlPrefix: 'video', validate: validateVideoFile }
};

function ensureUploadDirs() {
  fs.mkdirSync(COVERS_DIR, { recursive: true });
  fs.mkdirSync(AUDIO_DIR, { recursive: true });
  fs.mkdirSync(ATMOS_DIR, { recursive: true });
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  fs.mkdirSync(AVATARS_DIR, { recursive: true });
}

function extFromFilename(name) {
  const ext = path.extname(name || '').toLowerCase();
  return /^\.[a-z0-9]{1,5}$/.test(ext) ? ext : '';
}

// --- Validación de imágenes (PNG/JPEG), leyendo el ancho/alto directo de
// los headers del archivo, sin librerías externas. ---
function getImageDimensions(buf) {
  // PNG: firma de 8 bytes, luego el chunk IHDR trae ancho/alto en los
  // bytes 16-23 (big-endian, 4 bytes cada uno).
  if (buf.length >= 24 && buf.readUInt32BE(0) === 0x89504e47 && buf.readUInt32BE(4) === 0x0d0a1a0a) {
    return { format: 'png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: recorre los marcadores (0xFFxx) buscando un SOFn (Start Of Frame)
  // que trae alto/ancho justo después del tamaño del segmento.
  if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buf.length) {
      if (buf[offset] !== 0xff) { offset++; continue; }
      const marker = buf[offset + 1];
      // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 = frames válidos
      // (se excluyen 0xC4/0xC8/0xCC que no son SOF).
      const isSOF = (marker >= 0xc0 && marker <= 0xcf) && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) { offset += 2; continue; }
      const segLen = buf.readUInt16BE(offset + 2);
      if (isSOF) {
        const height = buf.readUInt16BE(offset + 5);
        const width = buf.readUInt16BE(offset + 7);
        return { format: 'jpeg', width, height };
      }
      offset += 2 + segLen;
    }
  }
  return null;
}

function validateCoverImage(buf, filename) {
  const dims = getImageDimensions(buf);
  if (!dims || (dims.format !== 'png' && dims.format !== 'jpeg')) {
    throw new Error(`La foto de portada (${filename || 'archivo'}) debe ser PNG o JPEG. Ese archivo no se pudo leer como una imagen válida en ese formato.`);
  }
  if (dims.width !== 3000 || dims.height !== 3000) {
    throw new Error(`La foto de portada debe medir exactamente 3000x3000 píxeles. La imagen subida mide ${dims.width}x${dims.height}.`);
  }
}

// --- Validación de WAV, leyendo el header RIFF/WAVE. ---
function validateWav(buf, filename) {
  const looksLikeWav = buf.length >= 12
    && buf.toString('ascii', 0, 4) === 'RIFF'
    && buf.toString('ascii', 8, 12) === 'WAVE';
  if (!looksLikeWav) {
    throw new Error(`El archivo de audio (${filename || 'archivo'}) debe estar en formato WAV. Ese archivo no es un WAV válido.`);
  }
}

function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error(`El formulario (incluyendo archivos) excede el tamaño máximo permitido (${Math.round(maxBytes / 1024 / 1024)}MB).`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Parsea los headers de una parte multipart (texto plano tipo
// "Content-Disposition: form-data; name=\"foo\"; filename=\"bar.jpg\"").
function parsePartHeaders(headerText) {
  const headers = {};
  headerText.split('\r\n').forEach(line => {
    const idx = line.indexOf(':');
    if (idx === -1) return;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  });
  const disposition = headers['content-disposition'] || '';
  const nameMatch = disposition.match(/name="([^"]*)"/);
  const filenameMatch = disposition.match(/filename="([^"]*)"/);
  return {
    name: nameMatch ? nameMatch[1] : '',
    filename: filenameMatch ? filenameMatch[1] : '',
    contentType: headers['content-type'] || ''
  };
}

// Parsea un POST multipart/form-data leyendo el body completo a memoria.
// Guarda el archivo de los campos "portada", "audio" y/o "atmos" (si vienen)
// directo a disco con el id del lanzamiento como nombre, validando cada uno
// según sus reglas (ver FILE_FIELDS) antes de guardarlo. Regresa los campos
// de texto normales más las URLs públicas de los archivos guardados (o null
// si no se subió nada en ese campo, para poder conservar el archivo anterior
// al editar).
async function parseMultipartForm(req, { id, maxBytes = MAX_MULTIPART_BYTES } = {}) {
  ensureUploadDirs();
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw new Error('Content-Type multipart inválido (sin boundary).');
  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const boundaryBuf = Buffer.from(`--${boundary}`);

  const body = await readRawBody(req, maxBytes);

  const fields = {};
  const urls = { portada: null, audio: null, atmos: null, video: null };

  // Encuentra cada ocurrencia del boundary y procesa el segmento entre dos
  // boundaries consecutivos como una "parte" del formulario.
  const positions = [];
  let searchFrom = 0;
  while (true) {
    const idx = body.indexOf(boundaryBuf, searchFrom);
    if (idx === -1) break;
    positions.push(idx);
    searchFrom = idx + boundaryBuf.length;
  }

  for (let i = 0; i < positions.length - 1; i++) {
    let start = positions[i] + boundaryBuf.length;
    const end = positions[i + 1];
    // La parte final antes del boundary de cierre ("--boundary--") no se procesa como dato.
    if (body.slice(start, start + 2).toString() === '--') continue;
    // Salta el CRLF que sigue al boundary.
    if (body.slice(start, start + 2).toString() === '\r\n') start += 2;

    let segment = body.slice(start, end);
    // Quita el CRLF final que precede al siguiente boundary.
    if (segment.slice(-2).toString() === '\r\n') segment = segment.slice(0, -2);

    const headerEnd = segment.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    const headerText = segment.slice(0, headerEnd).toString('utf-8');
    const partBody = segment.slice(headerEnd + 4);
    const { name, filename, contentType: partContentType } = parsePartHeaders(headerText);
    if (!name) continue;

    if (filename) {
      if (!filename.trim()) continue;
      const fieldDef = FILE_FIELDS[name];
      if (!fieldDef) continue;

      // Valida el contenido real del archivo (no solo su nombre/mimetype
      // declarado) antes de guardarlo. Si falla, se aborta todo el envío
      // con un mensaje claro de qué está mal — así el formulario nunca
      // termina con un archivo a medias o con formato incorrecto.
      fieldDef.validate(partBody, filename);

      const ext = extFromFilename(filename) || (Object.keys(UPLOAD_MIME).find(e => UPLOAD_MIME[e] === partContentType)) || '.bin';
      const dest = path.join(fieldDef.dir, `${id}${ext}`);
      fs.writeFileSync(dest, partBody);
      urls[name] = `/uploads/${fieldDef.urlPrefix}/${id}${ext}`;
    } else {
      fields[name] = partBody.toString('utf-8');
    }
  }

  return { fields, portadaUrl: urls.portada, audioUrl: urls.audio, atmosUrl: urls.atmos, videoUrl: urls.video };
}

module.exports = {
  UPLOADS_DIR, COVERS_DIR, AUDIO_DIR, ATMOS_DIR, VIDEO_DIR, AVATARS_DIR, UPLOAD_MIME,
  ensureUploadDirs, extFromFilename, parseMultipartForm, getImageDimensions
};
