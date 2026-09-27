// Almacenamiento simple basado en un archivo JSON.
// Suficiente para el volumen de datos de Lion Records (pocos artistas,
// pocos lanzamientos) y no requiere dependencias externas.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('./crypto-auth');

const DATA_FILE = path.join(__dirname, '..', 'data', 'db.json');

function seedData() {
  return {
    users: [
      {
        id: 'admin-lion',
        role: 'admin',
        name: 'Lion Records',
        email: 'admin@lionrecords.mx',
        passwordHash: hashPassword('LionRecords2026!'),
        artistSlug: null
      },
      {
        id: 'artist-chevy-dls',
        role: 'artist',
        name: 'Chevy DLS',
        email: 'chevydls@lionrecords.mx',
        passwordHash: hashPassword('ChevyDLS2026!'),
        artistSlug: 'chevy-dls'
      }
    ],
    artists: [
      {
        slug: 'chevy-dls',
        name: 'Chevy DLS',
        genre: 'Corridos bélicos · Regional Mexicano',
        region: 'Chihuahua / Sonora / Sinaloa',
        bio: 'Voz representativa del corrido bélico moderno, con un sonido crudo y directo que retrata la región de Chihuahua, Sonora y Sinaloa.',
        socials: {
          instagram: null,
          tiktok: '@chevy_dls',
          facebook: 'facebook.com/profile.php?id=61585256773387'
        },
        n8nWorkflow: {
          workflowName: 'Chevy DLS contenido',
          description: 'Community manager automatizado: detecta contenido nuevo en Drive (Carrusel/Post/Video), genera copy, aprueba por Telegram y publica en Metricool.',
          // URL de un webhook "manual trigger" en n8n. Se deja vacío hasta
          // que se agregue el nodo correspondiente en el workflow.
          manualTriggerUrl: process.env.CHEVY_DLS_N8N_MANUAL_TRIGGER_URL || '',
          approvalTelegramGroup: 'Artistas'
        },
        active: true,
        featured: true
      }
    ],
    launches: [],
    runLog: [],
    // Configuración editable desde el panel de Admin > Integraciones, para
    // no depender de que alguien entre a Hostinger a tocar variables de
    // entorno cada vez que se necesite un token o una URL nueva. Una
    // variable de entorno del mismo nombre (ver getSetting en server.js)
    // siempre gana sobre esto, por si se prefiere configurarlo así.
    settings: {
      telegramBotToken: '',
      telegramChatId: '',
      // Secreto único para la URL del webhook de Telegram
      // (/api/telegram/webhook/<secreto>), para que nadie más pueda
      // mandarle "aprobaciones" falsas a la app. Se genera solo la primera
      // vez que se lee la base de datos.
      telegramWebhookSecret: crypto.randomBytes(24).toString('hex'),
      varlianPushWebhookUrl: ''
    }
  };
}

// Agrega settings/telegramWebhookSecret a bases de datos creadas antes de
// que existiera este campo, y asegura que el objeto settings siempre exista
// con todas sus llaves (por si se agregan más adelante).
function ensureSettings(db) {
  let changed = false;
  if (!db.settings || typeof db.settings !== 'object') {
    db.settings = { telegramBotToken: '', telegramChatId: '', telegramWebhookSecret: '', varlianPushWebhookUrl: '' };
    changed = true;
  }
  for (const key of ['telegramBotToken', 'telegramChatId', 'telegramWebhookSecret', 'varlianPushWebhookUrl']) {
    if (typeof db.settings[key] !== 'string') { db.settings[key] = ''; changed = true; }
  }
  if (!db.settings.telegramWebhookSecret) {
    db.settings.telegramWebhookSecret = crypto.randomBytes(24).toString('hex');
    changed = true;
  }
  return changed;
}

function ensureDataFile() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(seedData(), null, 2));
  }
}

// Sincroniza valores que vienen de variables de entorno (p. ej. la URL del
// webhook de disparo manual en n8n) hacia el archivo de datos ya existente,
// por si el archivo se creó antes de que la variable de entorno existiera.
function syncEnvOverrides(db) {
  let changed = false;
  const chevy = db.artists.find(a => a.slug === 'chevy-dls');
  const envUrl = process.env.CHEVY_DLS_N8N_MANUAL_TRIGGER_URL || '';
  if (chevy && chevy.n8nWorkflow && envUrl && chevy.n8nWorkflow.manualTriggerUrl !== envUrl) {
    chevy.n8nWorkflow.manualTriggerUrl = envUrl;
    changed = true;
  }
  return changed;
}

function readDb() {
  ensureDataFile();
  const raw = fs.readFileSync(DATA_FILE, 'utf-8');
  const db = JSON.parse(raw);
  const envChanged = syncEnvOverrides(db);
  const settingsChanged = ensureSettings(db);
  if (envChanged || settingsChanged) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
  }
  return db;
}

function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

module.exports = { readDb, writeDb, DATA_FILE };
