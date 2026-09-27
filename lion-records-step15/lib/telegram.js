// Integración con la API de Telegram Bot para el flujo de aprobación de
// lanzamientos: cuando un artista pulsa "Enviar lanzamiento", se manda un
// resumen a un chat de Telegram (el del admin de Lion Records) con dos
// botones — Aprobar y enviar / Rechazar. Solo cuando el admin aprueba desde
// Telegram se dispara el envío real a Varlian.
//
// Igual que varlian-vault.js, cualquier función de aquí puede lanzar un
// error si Telegram no responde bien; quien llama debe capturarlo y no
// dejar que un lanzamiento se trabe por esto.
const https = require('https');

function callTelegramApi(token, method, payload) {
  return new Promise((resolve, reject) => {
    if (!token) return reject(new Error('Falta el token del bot de Telegram.'));
    const data = JSON.stringify(payload || {});
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/${method}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(data) },
      timeout: 15000
    };
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(Buffer.concat(chunks).toString('utf-8')); } catch (e) { /* no era JSON */ }
        if (!json || json.ok !== true) {
          const desc = (json && json.description) || `status ${res.statusCode}`;
          return reject(new Error(`Telegram (${method}) respondió con error: ${desc}`));
        }
        resolve(json.result);
      });
    });
    req.on('timeout', () => req.destroy(new Error('Tiempo de espera agotado contactando a Telegram.')));
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

// Arma y manda el mensaje de aprobación con el resumen del lanzamiento y los
// dos botones inline. callback_data lleva el prefijo (aprobar_envio /
// rechazar_envio) más el id del lanzamiento, que es lo único que se
// necesita para procesar la decisión cuando llegue el callback.
async function sendApprovalMessage(token, chatId, { launch, artist, launchUrl }) {
  const displayArtist = launch.displayArtist || (artist ? artist.name : launch.artistSlug);
  const lines = [
    `🎵 *Nuevo lanzamiento listo para revisar*`,
    ``,
    `*Título:* ${launch.titulo}`,
    `*Artista:* ${displayArtist}`,
    `*Tipo:* ${launch.tipo}${launch.esVideo ? ' (video)' : ''}`,
    `*Fecha de lanzamiento:* ${launch.fechaLanzamiento}`,
    `*Género:* ${launch.generoMusical || '—'}${launch.subgeneroMusical ? ' / ' + launch.subgeneroMusical : ''}`,
    `*Sello:* ${launch.label || 'Lion Records'}`,
    ``,
    `Ficha completa: ${launchUrl}`,
    ``,
    `¿Apruebas este lanzamiento para enviarlo a distribución (Varlian)?`
  ];
  const result = await callTelegramApi(token, 'sendMessage', {
    chat_id: chatId,
    text: lines.join('\n'),
    parse_mode: 'Markdown',
    disable_web_page_preview: true,
    reply_markup: {
      inline_keyboard: [[
        { text: '✅ Aprobar y enviar', callback_data: `aprobar_envio:${launch.id}` },
        { text: '❌ Rechazar', callback_data: `rechazar_envio:${launch.id}` }
      ]]
    }
  });
  return result && result.message_id;
}

function sendMessage(token, chatId, text) {
  return callTelegramApi(token, 'sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
}

function answerCallbackQuery(token, callbackQueryId, text) {
  return callTelegramApi(token, 'answerCallbackQuery', { callback_query_id: callbackQueryId, text: text || undefined });
}

// Quita los botones del mensaje original (para no dejar "Aprobar/Rechazar"
// activos sobre una decisión que ya se tomó) y le agrega una línea con el
// resultado.
async function markApprovalMessageResolved(token, chatId, messageId, resultLine) {
  if (!messageId) return;
  try {
    await callTelegramApi(token, 'editMessageReplyMarkup', {
      chat_id: chatId,
      message_id: messageId,
      reply_markup: { inline_keyboard: [] }
    });
  } catch (e) { /* si ya no se puede editar, no es grave */ }
  if (resultLine) {
    try { await sendMessage(token, chatId, resultLine); } catch (e) { /* idem */ }
  }
}

function setWebhook(token, url) {
  return callTelegramApi(token, 'setWebhook', { url, allowed_updates: ['callback_query'] });
}

// Usado por el botón "Detectar chat ID" del panel de Integraciones: el
// admin le manda /start (o cualquier mensaje) al bot y esto lee el chat_id
// del mensaje más reciente que Telegram tenga guardado. Solo sirve mientras
// no haya un webhook activo (getUpdates y webhook no se pueden usar al
// mismo tiempo), por eso se hace antes de "Registrar webhook".
async function detectLastChatId(token) {
  const updates = await callTelegramApi(token, 'getUpdates', { limit: 5, timeout: 0 });
  if (!Array.isArray(updates) || !updates.length) return null;
  const last = updates[updates.length - 1];
  const chat = (last.message && last.message.chat) || (last.callback_query && last.callback_query.message && last.callback_query.message.chat);
  return chat ? chat.id : null;
}

module.exports = {
  callTelegramApi,
  sendApprovalMessage,
  sendMessage,
  answerCallbackQuery,
  markApprovalMessageResolved,
  setWebhook,
  detectLastChatId
};
