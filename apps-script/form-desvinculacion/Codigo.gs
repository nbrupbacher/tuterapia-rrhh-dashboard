/**
 * Planilla de respuestas del form de desvinculación ("Desvi post 2024") →
 * dashboard de RRHH (En vivo → Fantasmeos y salidas).
 *
 * Copia de lo que corre en la planilla (Extensiones → Apps Script). Si se
 * cambia allá, actualizar acá, y al revés.
 *
 * Cada vez que entra una respuesta, y una vez por hora por las dudas, manda las
 * filas al dashboard (app/api/talent/form-desvinculacion). El dashboard decide
 * qué hacer con cada una y no duplica: mandar la misma fila dos veces no pasa
 * nada. Lo que pasó con cada fila queda en la pestaña "Dashboard".
 *
 * No escribe en la pestaña de respuestas: el form agrega columnas ahí cuando
 * se le suman preguntas.
 */

var API = 'https://tuterapia-rrhh-dashboard.vercel.app/api/talent/form-desvinculacion';
var HOJA_RESPUESTAS = 'Respuestas de formulario 1';
var HOJA_ESTADO = 'Dashboard';
var ZONA = 'America/Montevideo';
// Las anteriores ya se cargaron a mano en el dashboard.
var DESDE = new Date(2026, 10, 1); // 1 de noviembre de 2026

// Comienzo del título de cada columna (las preguntas son largas).
var TITULOS = {
  marca: 'Marca temporal',
  email: 'Dirección de correo',
  nombre: 'Nombre y Apellido',
  pais: '¿En qué plataforma',
  aviso: 'Fecha de aviso',
  pedido: '¿De quién es el pedido',
  motivo: '¿Cuál es el motivo',
};

var TEXTO = {
  ya_estaba: 'Ya estaba en el dashboard',
  agregada: 'Agregado a una salida que ya existía',
  creada: 'Salida nueva en el dashboard',
  sin_psicologo: 'No se encontró al psicólogo/a: revisar el nombre',
  varios_psicologos: 'Hay más de un psicólogo/a con ese nombre: cargar a mano',
  anterior: 'Anterior a noviembre 2026 (ya importado)',
  error: 'Error',
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tu Terapia')
    .addItem('Mandar al dashboard ahora', 'sincronizarDesdeMenu')
    .addItem('Activar envío automático', 'activarAutomatico')
    .addToUi();
}

function activarAutomatico() {
  pedirPermisos();
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizar').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(1).create();
  sincronizarDesdeMenu();
}

function sincronizarDesdeMenu() {
  pedirPermisos();
  SpreadsheetApp.getActive().toast(sincronizar(), 'Dashboard', 8);
}

// Si al aceptar los permisos de Google quedó alguno sin tildar, vuelve a
// mostrar el cartel. Sin el de "servicio externo" no puede hablar con el
// dashboard.
function pedirPermisos() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
}

function sincronizar() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return 'Ya hay un envío corriendo.';
  var estado = hojaEstado();
  try {
    Session.getActiveUser().getEmail();
    var filas = leerFilas();
    if (filas.length === 0) {
      estado.getRange('A1').setValue('Último envío: ' + ahora() + ' · no hay respuestas desde noviembre 2026');
      return 'No hay respuestas nuevas para mandar.';
    }
    var res = llamar({ filas: filas });
    escribirEstado(estado, filas, res.resultados || {});
    var r = res.resumen || {};
    var msg = 'Nuevas: ' + (r.creada || 0) + ' · agregadas: ' + (r.agregada || 0) +
      ((r.sin_psicologo || 0) + (r.varios_psicologos || 0) + (r.error || 0) ? ' · a revisar: ' +
        ((r.sin_psicologo || 0) + (r.varios_psicologos || 0) + (r.error || 0)) : '');
    return msg;
  } catch (err) {
    var error = 'No se pudo mandar al dashboard: ' + err.message;
    estado.getRange('A1').setValue(ahora() + ' · ' + error);
    return error;
  } finally {
    lock.releaseLock();
  }
}

function leerFilas() {
  var hoja = SpreadsheetApp.getActive().getSheetByName(HOJA_RESPUESTAS);
  var datos = hoja.getDataRange().getValues();
  var titulos = datos[0].map(function (t) { return String(t).trim(); });
  var col = {};
  Object.keys(TITULOS).forEach(function (k) {
    col[k] = titulos.findIndex(function (t) { return t.indexOf(TITULOS[k]) === 0; });
    if (col[k] < 0) throw new Error('No encuentro la columna "' + TITULOS[k] + '…"');
  });

  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    var f = datos[i];
    var marca = f[col.marca];
    if (!(marca instanceof Date) || marca < DESDE) continue;
    var email = String(f[col.email]).trim().toLowerCase();
    var marcaTxt = Utilities.formatDate(marca, ZONA, 'yyyy-MM-dd HH:mm:ss');
    var aviso = f[col.aviso];
    filas.push({
      clave: marcaTxt + '|' + email,
      marca: marcaTxt,
      email: email,
      nombre: String(f[col.nombre]).trim(),
      pais: String(f[col.pais]).trim(),
      aviso: aviso instanceof Date ? Utilities.formatDate(aviso, ZONA, 'yyyy-MM-dd') : null,
      pedido: String(f[col.pedido]).trim(),
      motivo: String(f[col.motivo]).trim(),
    });
  }
  return filas;
}

function llamar(cuerpo) {
  var r = UrlFetchApp.fetch(API, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(cuerpo),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  });
  var json = {};
  try { json = JSON.parse(r.getContentText()); } catch (e) {}
  if (r.getResponseCode() >= 300) throw new Error(json.error || ('HTTP ' + r.getResponseCode()));
  return json;
}

function hojaEstado() {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(HOJA_ESTADO) || ss.insertSheet(HOJA_ESTADO);
}

// Lo más nuevo arriba, para ver enseguida si la última respuesta entró.
function escribirEstado(hoja, filas, resultados) {
  var filasOut = filas.slice().reverse().map(function (f) {
    var r = resultados[f.clave] || { resultado: 'error', detalle: 'Sin respuesta del dashboard' };
    return [f.marca, f.nombre, f.email, TEXTO[r.resultado] || r.resultado, r.detalle || ''];
  });
  hoja.clearContents();
  hoja.getRange('A1').setValue('Último envío: ' + ahora());
  hoja.getRange(2, 1, 1, 5).setValues([['Respuesta del', 'Nombre', 'Completado por', 'En el dashboard', 'Detalle']]).setFontWeight('bold');
  if (filasOut.length) hoja.getRange(3, 1, filasOut.length, 5).setValues(filasOut);
}

function ahora() {
  return Utilities.formatDate(new Date(), ZONA, 'dd/MM HH:mm');
}
