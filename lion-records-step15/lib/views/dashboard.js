const { esc, dashPage } = require('../render');
const { ESTADO_LABELS } = require('./launches');

function statusPill(status) {
  const cls = status === 'ejecutado' ? 'pill-ok' : (status === 'error' ? 'pill-error' : 'pill-pending');
  return `<span class="pill ${cls}">${esc(status)}</span>`;
}

function launchStatusPill(estado) {
  const cls = estado === 'enviado-a-varlian' ? 'pill-ok' : (estado === 'error-envio' ? 'pill-error' : 'pill-neutral');
  return `<span class="pill ${cls}">${esc(ESTADO_LABELS[estado] || estado)}</span>`;
}

function adminDashboardPage({ user, artists, launches, runLog }) {
  const artistRows = artists.map(a => `
    <li>
      <span><span class="badge-dot ${a.n8nWorkflow.manualTriggerUrl ? 'on' : 'off'}"></span>${esc(a.name)}</span>
      <a href="/dashboard/artistas/${esc(a.slug)}" class="btn btn-ghost btn-sm">Ver panel</a>
    </li>`).join('\n');

  const runRows = runLog.length
    ? runLog.map(r => `
      <li>
        <span>${esc(r.artistSlug)} · ${new Date(r.timestamp).toLocaleString('es-MX')}</span>
        ${statusPill(r.status)}
      </li>`).join('\n')
    : '<div class="empty-state">Sin ejecuciones todavía.</div>';

  const launchRows = launches.length
    ? launches.map(l => `
      <tr>
        <td>${esc(l.titulo)}</td>
        <td>${esc(l.artistSlug)}</td>
        <td>${esc(l.fechaLanzamiento)}</td>
        <td>${launchStatusPill(l.estadoDistribucion)}</td>
        <td><a href="/lanzamientos/${esc(l.id)}" class="btn btn-ghost btn-sm">Ver</a></td>
      </tr>`).join('\n')
    : '';

  const body = `
    <div class="dash-header">
      <h1>Panel Lion Records</h1>
      <p>Vista general de artistas, lanzamientos y actividad de flujos.</p>
      <div class="actions-row" style="margin-top:14px;">
        <a href="/dashboard/admin/accesos" class="btn btn-gold btn-sm">Gestionar accesos de artistas</a>
      </div>
    </div>

    <div class="grid-3" style="margin-bottom:22px;">
      <div class="card stat"><div class="num">${artists.length}</div><div class="label">Artistas activos</div></div>
      <div class="card stat"><div class="num">${launches.length}</div><div class="label">Lanzamientos registrados</div></div>
      <div class="card stat"><div class="num">${runLog.length}</div><div class="label">Ejecuciones de flujo recientes</div></div>
    </div>

    <div class="grid-2" style="margin-bottom:22px;">
      <div class="card">
        <h3>Artistas</h3>
        <p class="card-sub">Con acceso a la plataforma</p>
        <ul class="list">${artistRows}</ul>
      </div>
      <div class="card">
        <h3>Actividad de flujos</h3>
        <p class="card-sub">Últimas ejecuciones disparadas desde la plataforma</p>
        ${runLog.length ? `<ul class="list">${runRows}</ul>` : runRows}
      </div>
    </div>

    <div class="card" style="margin-bottom:60px;">
      <h3>Lanzamientos</h3>
      <p class="card-sub">Todos los lanzamientos registrados en el sello</p>
      ${launches.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Título</th><th>Artista</th><th>Fecha</th><th>Estado distribución</th><th></th></tr></thead>
            <tbody>${launchRows}</tbody>
          </table>
        </div>` : `<div class="empty-state">Aún no hay lanzamientos. <a href="/lanzamientos/nuevo" style="color:var(--gold-light)">Registrar el primero &rarr;</a></div>`}
    </div>`;

  return dashPage('Panel Lion Records', user, body);
}

function artistDashboardPage({ user, artist, launches, runLog, triggerConfigured }) {
  const runRows = runLog.length
    ? runLog.map(r => `
      <li>
        <span>${new Date(r.timestamp).toLocaleString('es-MX')} · ${esc(r.triggeredBy)}</span>
        ${statusPill(r.status)}
      </li>`).join('\n')
    : '<div class="empty-state">Todavía no se ha ejecutado el flujo desde aquí.</div>';

  const launchRows = launches.length
    ? launches.map(l => `
      <tr>
        <td>${esc(l.titulo)}</td>
        <td>${esc(l.tipo)}</td>
        <td>${esc(l.fechaLanzamiento)}</td>
        <td>${launchStatusPill(l.estadoDistribucion)}</td>
        <td><a href="/lanzamientos/${esc(l.id)}" class="btn btn-ghost btn-sm">Ver</a></td>
      </tr>`).join('\n')
    : '';

  const body = `
    <div class="dash-header">
      <h1>${esc(artist.name)}</h1>
      <p>${esc(artist.n8nWorkflow.description)}</p>
    </div>

    <div class="grid-2" style="margin-bottom:22px;">
      <div class="card">
        <h3>Flujo de contenido</h3>
        <p class="card-sub">${esc(artist.n8nWorkflow.workflowName)} — detecta contenido nuevo, genera copy y espera aprobación en Telegram (grupo "${esc(artist.n8nWorkflow.approvalTelegramGroup)}") antes de publicar en Metricool.</p>
        ${!triggerConfigured ? `<div class="alert alert-error">Este flujo aún corre solo por su horario automático en n8n. Para poder ejecutarlo manualmente desde aquí, hace falta agregar un webhook de disparo manual en el workflow y configurar su URL en el servidor.</div>` : ''}
        <div class="actions-row">
          <button id="run-flow-btn" class="btn btn-gold" ${triggerConfigured ? '' : 'disabled'}>Ejecutar ahora</button>
          <a href="/lanzamientos/nuevo" class="btn btn-ghost">Registrar lanzamiento</a>
        </div>
        <div id="run-flow-result" class="helper-text"></div>
      </div>
      <div class="card">
        <h3>Últimas ejecuciones</h3>
        <p class="card-sub">Disparadas desde este panel</p>
        ${runLog.length ? `<ul class="list">${runRows}</ul>` : runRows}
      </div>
    </div>

    <div class="card" style="margin-bottom:60px;">
      <h3>Lanzamientos de ${esc(artist.name)}</h3>
      <p class="card-sub">Ficha técnica y estado de distribución</p>
      ${launches.length ? `
        <div class="table-wrap">
          <table>
            <thead><tr><th>Título</th><th>Tipo</th><th>Fecha</th><th>Estado distribución</th><th></th></tr></thead>
            <tbody>${launchRows}</tbody>
          </table>
        </div>` : `<div class="empty-state">Aún no hay lanzamientos registrados. <a href="/lanzamientos/nuevo" style="color:var(--gold-light)">Registrar el primero &rarr;</a></div>`}
    </div>`;

  const script = `
  <script>
    const btn = document.getElementById('run-flow-btn');
    const result = document.getElementById('run-flow-result');
    if (btn) {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = 'Ejecutando…';
        result.textContent = '';
        try {
          const res = await fetch('/api/artistas/${esc(artist.slug)}/ejecutar-flujo', { method: 'POST' });
          const data = await res.json();
          result.textContent = data.ok ? 'Flujo ejecutado correctamente.' : ('Error: ' + (data.error || 'no se pudo ejecutar.'));
        } catch (e) {
          result.textContent = 'Error de conexión: ' + e.message;
        }
        btn.disabled = false;
        btn.textContent = 'Ejecutar ahora';
        setTimeout(() => window.location.reload(), 1200);
      });
    }
  </script>`;

  return dashPage(`Panel · ${artist.name}`, user, body, script);
}

module.exports = { adminDashboardPage, artistDashboardPage };
