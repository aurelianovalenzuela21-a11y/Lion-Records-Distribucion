// Sube archivos (portada, audio, Dolby Atmos, video) directamente al vault
// de Varlian/FUGA (upload.vault.fuga.com), para que el lanzamiento no
// dependa solo de un enlace hacia lionrecords.mx.
//
// IMPORTANTE — esto usa un mecanismo NO documentado públicamente por
// Varlian/FUGA. Se descubrió observando en vivo (con autorización del
// usuario) cómo el propio portal de Varlian sube archivos: un protocolo de
// subida por partes (estilo Resumable.js) hacia
// upload.vault.fuga.com/vault/json/upload_data, seguido de una confirmación
// en /vault/json/finish_upload. La forma en que ese servicio valida quién
// está autorizado a subir no se pudo capturar completa (el navegador no
// expone los headers exactos de esas peticiones), así que aquí se reutiliza
// el mismo token JWT (Bearer) que ya usa la API pública de productos de
// Varlian (POST /ui-only/v3/login, POST /ui-only/v3/products), que es la
// suposición más razonable dado que es la única credencial disponible desde
// el backend.
//
// Si Varlian cambia este mecanismo (o el supuesto del token Bearer resulta
// incorrecto para el vault), cualquier función de aquí lanza un error. El
// que llama a este módulo (server.js) SIEMPRE debe capturar ese error y
// seguir adelante con el método de respaldo (solo mandar el enlace del
// archivo alojado en lionrecords.mx), para que un lanzamiento nunca se
// trabe por esto.
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL, URLSearchParams } = require('url');

const VARLIAN_BASE = 'https://labels.varlian.app';
const VAULT_BASE = 'https://upload.vault.fuga.com';

function request(method, targetUrl, { headers = {}, body = null, isBuffer = false, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(targetUrl); } catch (e) { return reject(e); }
    const lib = parsed.protocol === 'http:' ? http : https;
    const reqHeaders = Object.assign({}, headers);
    let dataToSend = null;
    if (body !== null) {
      if (isBuffer) {
        dataToSend = body;
        reqHeaders['Content-Length'] = body.length;
      } else {
        dataToSend = JSON.stringify(body);
        reqHeaders['Content-Type'] = reqHeaders['Content-Type'] || 'application/json';
        reqHeaders['Content-Length'] = Buffer.byteLength(dataToSend);
      }
    }
    const req = lib.request(parsed, { method, headers: reqHeaders, timeout: timeoutMs }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const raw = Buffer.concat(chunks);
        let json = null;
        try { json = JSON.parse(raw.toString('utf-8')); } catch (e) { /* no era JSON */ }
        resolve({ status: res.statusCode, headers: res.headers, raw, json });
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado contactando a Varlian.')));
    req.on('error', reject);
    if (dataToSend !== null) req.write(dataToSend);
    req.end();
  });
}

async function login(email, password) {
  const res = await request('POST', `${VARLIAN_BASE}/ui-only/v3/login`, { body: { email, password } });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`Login a Varlian falló (status ${res.status}).`);
  }
  const token = res.json && (res.json.token || res.json.access_token || res.json.jwt);
  if (!token) throw new Error('Login a Varlian no regresó un token utilizable.');
  return token;
}

function resumableUploadUrl(uuid, filename, mimeType, totalSize) {
  const params = new URLSearchParams({
    domain: 'fuga',
    resumableChunkNumber: '1',
    resumableChunkSize: String(totalSize || 1),
    resumableCurrentChunkSize: String(totalSize || 0),
    resumableTotalSize: String(totalSize || 0),
    resumableType: mimeType || 'application/octet-stream',
    resumableIdentifier: uuid,
    resumableFilename: filename,
    resumableRelativePath: filename,
    resumableTotalChunks: '1',
    partindex: '0',
    partbyteoffset: '0',
    uuid
  });
  return `${VAULT_BASE}/vault/json/upload_data?${params.toString()}`;
}

async function uploadFileToVault(token, buffer, filename, mimeType) {
  const uuid = crypto.randomUUID();
  const uploadUrl = resumableUploadUrl(uuid, filename, mimeType, buffer.length);
  const uploadRes = await request('POST', uploadUrl, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
    body: buffer,
    isBuffer: true
  });
  if (uploadRes.status < 200 || uploadRes.status >= 300) {
    throw new Error(`Varlian rechazó la subida de "${filename}" (status ${uploadRes.status}).`);
  }
  const finishUrl = `${VAULT_BASE}/vault/json/finish_upload?domain=fuga&id=${uuid}`;
  const finishRes = await request('GET', finishUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (finishRes.status < 200 || finishRes.status >= 300) {
    throw new Error(`Varlian no confirmó la subida de "${filename}" (status ${finishRes.status}).`);
  }
  const info = finishRes.json || {};
  if (info.error || info.Error) {
    throw new Error(`Varlian reportó un error subiendo "${filename}": ${info.error || info.Error}`);
  }
  return { uuid, vaultHook: info.vault_hook || info.id || uuid, raw: info };
}

// Sube el conjunto de archivos de un lanzamiento (portada, audio, atmos,
// video — los que vengan) al vault de Varlian usando las credenciales del
// label. Regresa un objeto { campo: {uuid, vaultHook} } con lo que hay que
// mandarle a n8n para asociar cada archivo al producto/track en Varlian.
// Lanza el error hacia arriba en cualquier falla (login o cualquier subida)
// — quien llame debe hacer try/catch y usar el respaldo si esto falla.
async function pushFilesToVault({ email, password, files }) {
  if (!email || !password) throw new Error('Credenciales de Varlian no configuradas.');
  const token = await login(email, password);
  const results = {};
  for (const key of Object.keys(files)) {
    const f = files[key];
    if (!f || !f.buffer || !f.buffer.length) continue;
    results[key] = await uploadFileToVault(token, f.buffer, f.filename, f.mimeType);
  }
  return results;
}

module.exports = { pushFilesToVault };
