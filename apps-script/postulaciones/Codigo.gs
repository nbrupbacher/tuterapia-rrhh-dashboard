/**
 * Planilla de respuestas del form "Requisitos Psicos Tu Terapia" →
 * dashboard de RRHH (solapa Reclutamiento).
 *
 * Copia de lo que corre en la planilla (Extensiones → Apps Script). Si se
 * cambia allá, actualizar acá, y al revés.
 *
 * Esa planilla ya tiene otras automatizaciones de reclutamiento (mail de
 * requisitos, propuesta, etc.). Por eso todo acá va con prefijo POST_ y en un
 * archivo aparte (Postulaciones.gs): dos funciones o variables con el mismo
 * nombre en el mismo proyecto se pisan sin avisar. Si el proyecto ya tiene un
 * onOpen, NO pegar el de abajo: agregar adentro del que hay la línea
 * `postAgregarMenu();`.
 *
 * Cada vez que entra una respuesta, y una vez por hora por las dudas, manda al
 * dashboard las respuestas de los últimos días (app/api/talent/postulaciones).
 * El dashboard no duplica: mandar la misma fila dos veces no pasa nada. La
 * primera vez, "Mandar todo" carga el histórico.
 *
 * No escribe en la pestaña de respuestas: las otras automatizaciones la usan.
 * Lo que pasó con cada envío queda en la pestaña "Dashboard RRHH".
 */

var POST_API = 'https://tuterapia-rrhh-dashboard.vercel.app/api/talent/postulaciones';
var POST_HOJA_RESPUESTAS = 'Respuestas de formulario 1';
var POST_HOJA_ESTADO = 'Dashboard RRHH';
var POST_ZONA = 'America/Montevideo';
// Cuántos días para atrás se re-mandan en cada envío automático. Cubre que el
// trigger horario haya fallado un fin de semana.
var POST_DIAS_ATRAS = 7;
// El endpoint acepta hasta 1000; 400 deja margen para respuestas largas.
var POST_TANDA = 400;

// Comienzo del título de cada columna (las preguntas son largas y a veces se
// retocan; el comienzo cambia menos). Sin estas no se puede mandar.
var POST_OBLIGATORIAS = {
  marca: 'Marca temporal',
  pais: '¿En que plataforma',
  nombre: 'Nombre y Apellido',
  email: 'Dirección de correo',
};
// Si falta alguna (porque cambió la pregunta) se manda vacía y se avisa.
var POST_OPCIONALES = {
  estado: 'ESTADO',
  titulo: '¿Tienes el Título',
  cuit: 'Requisito excluyente',
  proceso_personal: '¿Has realizado un Proceso',
  experiencia_clinica: '¿Tienes experiencia',
  supervision: '¿Has realizado Supervisión',
  diez_horas: '¿Contás con 10 horas',
};
// Van todas juntas a `respuestas` (jsonb).
var POST_RESPUESTAS = {
  disponibilidad: 'Detalla a continuación',
  modalidad: 'Contanos tu modalidad',
  zona: '¿Dónde atiendes',
  formacion: '¿Realizas Formación',
  cv: 'Adjunta aquí tu Cv',
  video: 'Grabá un video',
  consultorio: '¿Tienes consultorio',
  como_se_entero: '¿Cómo te enteraste',
  linkedin: 'Ingresá el link',
  comentarios: 'Comentarios',
};

var POST_TEXTO = {
  nueva: 'Nueva en el dashboard',
  ya_estaba: 'Ya estaba',
  error: 'Error',
};

// Solo si el proyecto NO tiene ya un onOpen (ver arriba).
function onOpen() {
  postAgregarMenu();
}

function postAgregarMenu() {
  SpreadsheetApp.getUi()
    .createMenu('Dashboard RRHH')
    .addItem('Mandar lo nuevo ahora', 'postSincronizarDesdeMenu')
    .addItem('Mandar todo (histórico)', 'postMandarTodo')
    .addItem('Activar envío automático', 'postActivarAutomatico')
    .addToUi();
}

function postActivarAutomatico() {
  postPedirPermisos();
  var ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'postSincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('postSincronizar').forSpreadsheet(ss).onFormSubmit().create();
  ScriptApp.newTrigger('postSincronizar').timeBased().everyHours(1).create();
  postSincronizarDesdeMenu();
}

function postSincronizarDesdeMenu() {
  postPedirPermisos();
  SpreadsheetApp.getActive().toast(postSincronizar(), 'Dashboard', 8);
}

function postMandarTodo() {
  postPedirPermisos();
  SpreadsheetApp.getActive().toast(postEnviar(null), 'Dashboard', 10);
}

// Si al aceptar los permisos de Google quedó alguno sin tildar, vuelve a
// mostrar el cartel. Sin el de "servicio externo" no puede hablar con el
// dashboard.
function postPedirPermisos() {
  ScriptApp.requireAllScopes(ScriptApp.AuthMode.FULL);
}

// El trigger llama con un evento como argumento: por eso no recibe la fecha.
function postSincronizar() {
  var desde = new Date();
  desde.setDate(desde.getDate() - POST_DIAS_ATRAS);
  return postEnviar(desde);
}

/** desde = null manda todo. */
function postEnviar(desde) {
  var lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return 'Ya hay un envío corriendo.';
  var estado = postHojaEstado();
  try {
    Session.getActiveUser().getEmail();
    var leido = postLeerFilas(desde);
    var filas = leido.filas;
    if (filas.length === 0) {
      estado.getRange('A1').setValue('Último envío: ' + postAhora() + ' · no hay respuestas para mandar');
      return 'No hay respuestas para mandar.';
    }
    var resultados = {};
    var total = { nueva: 0, ya_estaba: 0, error: 0 };
    for (var i = 0; i < filas.length; i += POST_TANDA) {
      var res = postLlamar({ filas: filas.slice(i, i + POST_TANDA) });
      Object.keys(res.resultados || {}).forEach(function (k) { resultados[k] = res.resultados[k]; });
      var r = res.resumen || {};
      Object.keys(total).forEach(function (k) { total[k] += r[k] || 0; });
    }
    postEscribirEstado(estado, filas, resultados, leido.faltan);
    return 'Nuevas: ' + total.nueva + ' · ya estaban: ' + total.ya_estaba +
      (total.error ? ' · con error: ' + total.error : '') +
      (leido.faltan.length ? ' · no encuentro: ' + leido.faltan.join(', ') : '');
  } catch (err) {
    var error = 'No se pudo mandar al dashboard: ' + err.message;
    estado.getRange('A1').setValue(postAhora() + ' · ' + error);
    return error;
  } finally {
    lock.releaseLock();
  }
}

function postLeerFilas(desde) {
  var hoja = SpreadsheetApp.getActive().getSheetByName(POST_HOJA_RESPUESTAS);
  var datos = hoja.getDataRange().getValues();
  var titulos = datos[0].map(function (t) { return String(t).trim(); });
  var buscar = function (prefijo) {
    return titulos.findIndex(function (t) { return t.indexOf(prefijo) === 0; });
  };
  var col = {};
  var faltan = [];
  Object.keys(POST_OBLIGATORIAS).forEach(function (k) {
    col[k] = buscar(POST_OBLIGATORIAS[k]);
    if (col[k] < 0) throw new Error('No encuentro la columna "' + POST_OBLIGATORIAS[k] + '…"');
  });
  [POST_OPCIONALES, POST_RESPUESTAS].forEach(function (grupo) {
    Object.keys(grupo).forEach(function (k) {
      col[k] = buscar(grupo[k]);
      if (col[k] < 0) faltan.push(grupo[k]);
    });
  });
  var celda = function (f, k) { return col[k] >= 0 ? String(f[col[k]]).trim() : ''; };

  var filas = [];
  for (var i = 1; i < datos.length; i++) {
    var f = datos[i];
    var marca = f[col.marca];
    if (!(marca instanceof Date)) continue;
    if (desde && marca < desde) continue;
    var email = celda(f, 'email').toLowerCase();
    if (!email) continue;
    var marcaTxt = Utilities.formatDate(marca, POST_ZONA, 'yyyy-MM-dd HH:mm:ss');
    var respuestas = {};
    Object.keys(POST_RESPUESTAS).forEach(function (k) { respuestas[k] = celda(f, k); });
    filas.push({
      clave: marcaTxt + '|' + email,
      marca: marcaTxt,
      pais: celda(f, 'pais'),
      nombre: celda(f, 'nombre'),
      email: email,
      cuit: celda(f, 'cuit'),
      titulo: celda(f, 'titulo'),
      proceso_personal: celda(f, 'proceso_personal'),
      experiencia_clinica: celda(f, 'experiencia_clinica'),
      supervision: celda(f, 'supervision'),
      diez_horas: celda(f, 'diez_horas'),
      estado: celda(f, 'estado'),
      respuestas: respuestas,
    });
  }
  return { filas: filas, faltan: faltan };
}

function postLlamar(cuerpo) {
  var r = UrlFetchApp.fetch(POST_API, {
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

function postHojaEstado() {
  var ss = SpreadsheetApp.getActive();
  return ss.getSheetByName(POST_HOJA_ESTADO) || ss.insertSheet(POST_HOJA_ESTADO);
}

// Lo más nuevo arriba, para ver enseguida si la última respuesta entró. Solo
// las últimas 300: con el histórico entero la pestaña se vuelve lenta.
function postEscribirEstado(hoja, filas, resultados, faltan) {
  var filasOut = filas.slice().reverse().slice(0, 300).map(function (f) {
    var r = resultados[f.clave] || { resultado: 'error', detalle: 'Sin respuesta del dashboard' };
    return [f.marca, f.nombre, f.email, POST_TEXTO[r.resultado] || r.resultado, r.detalle || ''];
  });
  hoja.clearContents();
  hoja.getRange('A1').setValue('Último envío: ' + postAhora() +
    (faltan.length ? ' · no encuentro las columnas: ' + faltan.join(', ') : ''));
  hoja.getRange(2, 1, 1, 5).setValues([['Respuesta del', 'Nombre', 'Mail', 'En el dashboard', 'Detalle']]).setFontWeight('bold');
  if (filasOut.length) hoja.getRange(3, 1, filasOut.length, 5).setValues(filasOut);
}

function postAhora() {
  return Utilities.formatDate(new Date(), POST_ZONA, 'dd/MM HH:mm');
}
