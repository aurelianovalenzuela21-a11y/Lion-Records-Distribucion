const { esc, dashPage } = require('../render');

// Panel de Admin > Integraciones: aquí se configura el bot de Telegram que
// manda los avisos de "lanzamiento listo para aprobar" y la URL del webhook
// de n8n que realmente empuja el lanzamiento a Varlian. Pensado para que el
// admin (que no programa) pueda configurar y probar todo esto sin tocar
// Hostinger ni pedirle a nadie que suba código.
function integracionesPage({ user, settings, webhookUrl, message, error }) {
  const body = `
    <div class="dash-header">
      <h1>Integraciones</h1>
      <p>Configura el bot de Telegram que te avisa cuando un artista manda un lanzamiento, y la automatización que lo empuja a Varlian.</p>
    </div>
    ${message ? `<div class="alert alert-success">${esc(message)}</div>` : ''}
    ${error ? `<div class="alert alert-error">${esc(error)}</div>` : ''}
    <div class="card" style="margin-bottom:22px;">
      <h3>Telegram (aprobación de lanzamientos)</h3>
      <p class="card-sub">Cuando un artista pulsa "Enviar lanzamiento", se manda un aviso a este chat de Telegram con los datos del lanzamiento y dos botones: aprobar o rechazar. Solo al aprobar se envía de verdad a Varlian.</p>
      <form method="POST" action="/admin/integraciones">
        <div class="field">
          <label for="telegramBotToken">Token del bot (te lo da @BotFather)</label>
          <input type="text" id="telegramBotToken" name="telegramBotToken" placeholder="123456789:AA..." value="${esc(settings.telegramBotToken)}">
        </div>
        <div class="field">
          <label for="telegramChatId">Chat ID donde te llegan los avisos</label>
          <input type="text" id="telegramChatId" name="telegramChatId" placeholder="Ej. 123456789" value="${esc(settings.telegramChatId)}">
        </div>
        <div class="actions-row">
          <button type="submit" class="btn btn-gold btn-sm">Guardar</button>
        </div>
      </form>
      <div class="actions-row" style="margin-top:14px;">
        <form method="POST" action="/admin/integraciones/detectar-chat-id" style="display:inline;">
          <button type="submit" class="btn btn-outline btn-sm">Detectar Chat ID automáticamente</button>
        </form>
        <form method="POST" action="/admin/integraciones/registrar-webhook" style="display:inline;">
          <button type="submit" class="btn btn-outline btn-sm">Registrar webhook de Telegram</button>
        </form>
      </div>
      <p class="helper-text" style="margin-top:14px;">
        Cómo conectarlo (una sola vez):<br>
        1) En Telegram, habla con <b>@BotFather</b>, crea un bot con <code>/newbot</code> y copia el token que te da.<br>
        2) Pega ese token arriba y guarda.<br>
        3) Abre un chat con tu bot y mándale cualquier mensaje (ej. "hola").<br>
        4) Pulsa "Detectar Chat ID automáticamente" — va a tomar tu chat_id de ese mensaje y lo va a guardar solo.<br>
        5) Pulsa "Registrar webhook de Telegram" para que los botones de Aprobar/Rechazar funcionen.
      </p>
      <p class="helper-text">URL del webhook (informativo, no hace falta copiarla a ningún lado): <code>${esc(webhookUrl)}</code></p>
    </div>
    <div class="card" style="margin-bottom:22px;">
      <h3>Envío automático a Varlian</h3>
      <p class="card-sub">URL del webhook de n8n que recibe la ficha aprobada y la crea en Varlian. Se deja vacío hasta que ese flujo de n8n exista.</p>
      <form method="POST" action="/admin/integraciones">
        <input type="hidden" name="telegramBotToken" value="${esc(settings.telegramBotToken)}">
        <input type="hidden" name="telegramChatId" value="${esc(settings.telegramChatId)}">
        <div class="field">
          <label for="varlianPushWebhookUrl">URL del webhook de n8n</label>
          <input type="text" id="varlianPushWebhookUrl" name="varlianPushWebhookUrl" placeholder="https://...n8n.../webhook/..." value="${esc(settings.varlianPushWebhookUrl)}">
        </div>
        <div class="actions-row">
          <button type="submit" class="btn btn-gold btn-sm">Guardar</button>
        </div>
      </form>
    </div>`;
  return dashPage('Integraciones', user, body);
}

module.exports = { integracionesPage };
