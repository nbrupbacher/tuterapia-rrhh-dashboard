/**
 * Planilla "Proceso y Contratos" (solapas ARG y URU) → dashboard de RRHH
 * (solapa Reclutamiento: en qué etapa está cada persona).
 *
 * Copia de lo que corre allá. Vive como un archivo aparte (Procesos.gs) en el
 * mismo proyecto de Apps Script que apps-script/postulaciones ("Dashboard RRHH
 * - Postulaciones", en la planilla de Requisitos): así usa la misma
 * autorización con el dashboard. Todo va con prefijo PROC_ para no pisar nada
 * de ese proyecto. Si se cambia allá, actualizar acá, y al revés.
 *
 * Solo LEE la planilla de Procesos: no escribe nada ahí (de esa planilla salen
 * los mails automáticos de cada etapa).
 *
 * Manda la foto entera de las dos solapas cada vez que alguien edita la
 * planilla de Procesos y una vez por hora. Una vez: correr procActivarAutomatico
 * desde el editor.
 */

var PROC_API = 'https://tuterapia-rrhh-dashboard.vercel.app/api/talent/procesos';
var PROC_PLANILLA = '1gKqKCqpkr5pCwlHTZyF4OSdnScdMz7konIIhvfOUtdA';
var PROC_SOLAPAS = { ARG: 'AR', URU: 'UY' };

// Comienzo del título de cada columna.
var PROC_TITULOS = {
  mes: 'Mes',
  nombre: 'Nombre',
  email: 'Email',
  recruiter: 'Recruiter',
  estado: 'Status',
  fecha_ingreso: 'Fecha de ingreso',
};

function procActivarAutomatico() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'procSincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('procSincronizar').forSpreadsheet(PROC_PLANILLA).onEdit().create();
  ScriptApp.newTrigger('procSincronizar').timeBased().everyHours(1).create();
  Logger.log(procSincronizar());
}

// El trigger llama con un evento como argumento: no se usa.
function procSincronizar() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return 'Ya hay un envío corriendo.';
  try {
    Session.getActiveUser().getEmail();
    var filas = procLeer();
    var r = UrlFetchApp.fetch(PROC_API, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ filas: filas }),
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      muteHttpExceptions: true,
    });
    var json = {};
    try { json = JSON.parse(r.getContentText()); } catch (e) {}
    if (r.getResponseCode() >= 300) throw new Error(json.error || ('HTTP ' + r.getResponseCode()));
    return 'Procesos: ' + json.guardadas + ' filas en el dashboard' +
      (json.borradas && Object.keys(json.borradas).length ? ' · borradas: ' + JSON.stringify(json.borradas) : '');
  } catch (err) {
    return 'No se pudo mandar Procesos al dashboard: ' + err.message;
  } finally {
    lock.releaseLock();
  }
}

function procLeer() {
  var ss = SpreadsheetApp.openById(PROC_PLANILLA);
  var filas = [];
  Object.keys(PROC_SOLAPAS).forEach(function (solapa) {
    var hoja = ss.getSheetByName(solapa);
    if (!hoja) throw new Error('No encuentro la solapa ' + solapa);
    var datos = hoja.getDataRange().getDisplayValues();
    var titulos = datos[0].map(function (t) { return String(t).trim(); });
    var col = {};
    Object.keys(PROC_TITULOS).forEach(function (k) {
      col[k] = titulos.findIndex(function (t) { return t.indexOf(PROC_TITULOS[k]) === 0; });
      if (col[k] < 0) throw new Error('No encuentro la columna "' + PROC_TITULOS[k] + '…" en ' + solapa);
    });
    for (var i = 1; i < datos.length; i++) {
      var f = datos[i];
      var nombre = String(f[col.nombre]).trim();
      if (!nombre) continue;
      filas.push({
        pais: PROC_SOLAPAS[solapa],
        fila: i + 1,
        mes: String(f[col.mes]).trim(),
        nombre: nombre,
        email: String(f[col.email]),
        recruiter: String(f[col.recruiter]).trim(),
        estado: String(f[col.estado]).trim(),
        fecha_ingreso: String(f[col.fecha_ingreso]).trim(),
      });
    }
  });
  return filas;
}
