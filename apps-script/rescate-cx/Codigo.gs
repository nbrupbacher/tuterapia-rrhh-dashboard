/**
 * Planilla "Rescate CX" ↔ dashboard de RRHH (En vivo → Alertas).
 *
 * Copia de lo que corre en la planilla (Extensiones → Apps Script). Si se
 * cambia allá, actualizar acá, y al revés.
 *
 * Cada hora (o con el menú Tu Terapia → Sincronizar ahora):
 *  1. Manda al dashboard las respuestas de CX que todavía no se guardaron.
 *  2. Trae las alertas derivadas a CX: agrega las nuevas y actualiza días y
 *     situación (si el paciente ya agendó, se ve acá y no hace falta llamar).
 *     También trae el teléfono y, si tiene código de país, un link de WhatsApp.
 *
 * El dashboard valida el token de Google de quien sincroniza: tiene que ser
 * una cuenta @tuterapia.com.uy y este script tiene que estar habilitado en la
 * tabla cx_planilla_clientes. No hay contraseñas ni claves guardadas acá.
 */

var API = 'https://tuterapia-rrhh-dashboard.vercel.app/api/cx/planilla';
var HOJA = 'CX';
// Celda donde queda la última sincronización (o el error).
var ESTADO = 'R1';

var COLS = [
  'Paciente', 'Teléfono', 'WhatsApp', 'N° paciente', 'Psicólogo/a', 'País',
  'Regla', 'Motivo', 'Días', 'Fecha (registro o sesión)', 'Derivada el',
  'Situación', 'Respuesta CX', 'Comentario CX', 'Guardado', 'alerta_id',
];
// Posiciones (1 = columna A).
var C = {
  paciente: 1, telefono: 2, whatsapp: 3, nro: 4, psicologo: 5, pais: 6,
  regla: 7, motivo: 8, dias: 9, fecha: 10, derivada: 11, situacion: 12,
  respuesta: 13, comentario: 14, guardado: 15, id: 16,
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Tu Terapia')
    .addItem('Sincronizar ahora', 'sincronizarDesdeMenu')
    .addItem('Activar sincronización cada hora', 'activarAutomatico')
    .addToUi();
}

// Si CX cambia la respuesta o el comentario de una fila ya guardada, se borra
// la marca de "Guardado" para que la próxima sincronización la mande de nuevo.
function onEdit(e) {
  var r = e.range;
  if (r.getSheet().getName() !== HOJA || r.getRow() < 2) return;
  var desde = r.getColumn();
  var hasta = desde + r.getNumColumns() - 1;
  if (hasta < C.respuesta || desde > C.comentario) return;
  r.getSheet().getRange(r.getRow(), C.guardado, r.getNumRows(), 1).clearContent();
}

function activarAutomatico() {
  pedirPermisos();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizar').timeBased().everyHours(1).create();
  sincronizarDesdeMenu();
}

function sincronizarDesdeMenu() {
  pedirPermisos();
  var res = sincronizar();
  SpreadsheetApp.getActive().toast(res, 'Rescate CX', 8);
}

// Si al aceptar los permisos de Google quedó alguno sin tildar (Google deja
// elegir uno por uno), esto vuelve a mostrar el cartel. Sin el de "servicio
// externo" la planilla no puede hablar con el dashboard.
function pedirPermisos() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
}

function sincronizar() {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return 'Ya hay una sincronización corriendo.';
  try {
    // Pide el permiso de email (el dashboard lo necesita para saber quién es).
    Session.getActiveUser().getEmail();
    var hoja = prepararHoja();
    var enviadas = enviarRespuestas(hoja);
    var traidas = traerAlertas(hoja);
    var msg = 'Respuestas guardadas: ' + enviadas.ok +
      (enviadas.error ? ' · con error: ' + enviadas.error : '') +
      ' · alertas nuevas: ' + traidas.nuevas;
    hoja.getRange(ESTADO).setValue('Última sincronización: ' + ahora() + (traidas.aviso ? ' · ' + traidas.aviso : ''));
    return msg;
  } catch (err) {
    // Queda escrito en la planilla: la sincronización de cada hora no muestra
    // carteles, y así CX ve que algo falló.
    var error = 'No se pudo sincronizar: ' + err.message;
    var h = SpreadsheetApp.getActive().getSheetByName(HOJA);
    if (h) h.getRange(ESTADO).setValue(ahora() + ' · ' + error);
    return error;
  } finally {
    lock.releaseLock();
  }
}

function llamar(metodo, cuerpo) {
  var opciones = {
    method: metodo,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
  };
  if (cuerpo) {
    opciones.contentType = 'application/json';
    opciones.payload = JSON.stringify(cuerpo);
  }
  var r = UrlFetchApp.fetch(API, opciones);
  var json = {};
  try { json = JSON.parse(r.getContentText()); } catch (e) {}
  if (r.getResponseCode() >= 300) throw new Error(json.error || ('HTTP ' + r.getResponseCode()));
  return json;
}

function prepararHoja() {
  var ss = SpreadsheetApp.getActive();
  var hoja = ss.getSheetByName(HOJA);
  if (!hoja) {
    hoja = ss.getSheets()[0];
    hoja.setName(HOJA);
  }
  // Planilla armada antes de que existieran Teléfono y WhatsApp: se insertan
  // las dos columnas después de Paciente y todo lo demás se corre solo
  // (datos, lista de respuestas, colores y la celda de estado).
  if (hoja.getRange(1, 2).getValue() === 'N° paciente') {
    hoja.insertColumnsAfter(C.paciente, 2);
    hoja.getRange(1, C.telefono, 1, 2).setValues([[COLS[C.telefono - 1], COLS[C.whatsapp - 1]]]);
    hoja.setColumnWidth(C.telefono, 130);
    hoja.setColumnWidth(C.whatsapp, 90);
  }
  if (hoja.getRange(1, 1).getValue() !== COLS[0]) {
    hoja.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#e8f0fe');
    hoja.setFrozenRows(1);
    hoja.hideColumns(C.id);
    hoja.setColumnWidth(C.paciente, 200);
    hoja.setColumnWidth(C.telefono, 130);
    hoja.setColumnWidth(C.whatsapp, 90);
    hoja.setColumnWidth(C.psicologo, 200);
    hoja.setColumnWidth(C.motivo, 240);
    hoja.setColumnWidth(C.situacion, 140);
    hoja.setColumnWidth(C.respuesta, 160);
    hoja.setColumnWidth(C.comentario, 260);
    hoja.getRange(1, C.respuesta, 1, 2).setBackground('#fff3c4');
  }
  return hoja;
}

function enviarRespuestas(hoja) {
  var n = hoja.getLastRow() - 1;
  if (n < 1) return { ok: 0, error: 0 };
  var datos = hoja.getRange(2, 1, n, COLS.length).getValues();
  var pendientes = [];
  var filaDe = {};
  datos.forEach(function (f, i) {
    var resp = String(f[C.respuesta - 1]).trim();
    var marca = String(f[C.guardado - 1]);
    if (!resp || marca.indexOf('✓') === 0) return;
    var id = String(f[C.id - 1]);
    if (!id) return;
    pendientes.push({ alerta_id: id, respuesta: resp, comentario: String(f[C.comentario - 1]) });
    filaDe[id] = i + 2;
  });
  if (pendientes.length === 0) return { ok: 0, error: 0 };

  var res = llamar('post', { respuestas: pendientes });
  var cuando = ahora();
  (res.guardadas || []).forEach(function (id) {
    hoja.getRange(filaDe[id], C.guardado).setValue('✓ ' + cuando);
  });
  var errores = res.errores || {};
  Object.keys(errores).forEach(function (id) {
    if (filaDe[id]) hoja.getRange(filaDe[id], C.guardado).setValue('⚠ ' + errores[id]);
  });
  return { ok: (res.guardadas || []).length, error: Object.keys(errores).length };
}

function traerAlertas(hoja) {
  var res = llamar('get');
  var filas = res.filas || [];

  var porId = {};
  filas.forEach(function (f) { porId[f.alerta_id] = f; });

  // Filas que ya estaban: se actualizan días, situación y teléfono de una vez
  // por columna (fila por fila es muy lento con cientos de alertas).
  var n = hoja.getLastRow() - 1;
  var yaEstan = {};
  if (n > 0) {
    var ids = hoja.getRange(2, C.id, n, 1).getValues();
    var dias = hoja.getRange(2, C.dias, n, 1).getValues();
    var sit = hoja.getRange(2, C.situacion, n, 1).getValues();
    var tel = hoja.getRange(2, C.telefono, n, 1).getValues();
    var wa = hoja.getRange(2, C.whatsapp, n, 1).getRichTextValues();
    ids.forEach(function (v, i) {
      var id = String(v[0]);
      if (!id) return;
      yaEstan[id] = true;
      var f = porId[id];
      if (!f) return;
      dias[i][0] = f.dias;
      sit[i][0] = f.situacion;
      tel[i][0] = f.telefono || '';
      wa[i][0] = linkWhatsapp(f.whatsapp);
    });
    hoja.getRange(2, C.dias, n, 1).setValues(dias);
    hoja.getRange(2, C.situacion, n, 1).setValues(sit);
    hoja.getRange(2, C.telefono, n, 1).setNumberFormat('@').setValues(tel);
    hoja.getRange(2, C.whatsapp, n, 1).setRichTextValues(wa);
  }

  var nuevas = [];
  var linksNuevos = [];
  filas.forEach(function (f) {
    if (yaEstan[f.alerta_id]) return;
    // Solo se agregan las que todavía hay que llamar.
    if (f.situacion !== 'Esperando' || f.respuesta) return;
    var v = [];
    v[C.paciente - 1] = f.paciente || ('Paciente #' + f.paciente_id);
    v[C.telefono - 1] = f.telefono || '';
    v[C.whatsapp - 1] = '';
    v[C.nro - 1] = f.paciente_id;
    v[C.psicologo - 1] = f.psicologo;
    v[C.pais - 1] = f.pais;
    v[C.regla - 1] = f.regla;
    v[C.motivo - 1] = f.motivo;
    v[C.dias - 1] = f.dias;
    v[C.fecha - 1] = f.fecha_referencia;
    v[C.derivada - 1] = f.derivada_el;
    v[C.situacion - 1] = f.situacion;
    v[C.respuesta - 1] = '';
    v[C.comentario - 1] = '';
    v[C.guardado - 1] = '';
    v[C.id - 1] = f.alerta_id;
    nuevas.push(v);
    linksNuevos.push([linkWhatsapp(f.whatsapp)]);
  });

  if (nuevas.length) {
    var desde = hoja.getLastRow() + 1;
    // Texto plano: si no, Sheets convierte "05/11" en fecha.
    hoja.getRange(desde, 1, nuevas.length, COLS.length).setNumberFormat('@').setValues(nuevas);
    hoja.getRange(desde, C.whatsapp, nuevas.length, 1).setRichTextValues(linksNuevos);
  }

  var total = hoja.getLastRow() - 1;
  if (total > 0) {
    var regla = SpreadsheetApp.newDataValidation()
      .requireValueInList(res.opciones || [], true)
      .setAllowInvalid(false)
      .build();
    hoja.getRange(2, C.respuesta, total, 1).setDataValidation(regla);
    colorearSituacion(hoja, total);
  }
  return { nuevas: nuevas.length, aviso: res.aviso };
}

// Celda con link "Escribir" que abre el chat de WhatsApp (vacía si no hay link).
function linkWhatsapp(url) {
  var t = SpreadsheetApp.newRichTextValue();
  return url ? t.setText('Escribir').setLinkUrl(url).build() : t.setText('').build();
}

function colorearSituacion(hoja, total) {
  var rango = hoja.getRange(2, C.situacion, total, 1);
  var verde = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Agendó').setBackground('#d9f2e3').setRanges([rango]).build();
  var gris = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo('Venció sin agendar').setFontColor('#999999').setRanges([rango]).build();
  hoja.setConditionalFormatRules([verde, gris]);
}

function ahora() {
  return Utilities.formatDate(new Date(), 'America/Montevideo', 'dd/MM HH:mm');
}
