// ============================================================
// MATRIX TU TERAPIA — CATÁLOGO CENTRAL
// ============================================================
// Define las situaciones, las acciones, sus colores,
// y los mapeos entre situaciones y acciones.
//
// Cualquier cambio de nombres, colores, prioridades o triggers
// se hace en ESTE archivo, no en otro.
// ============================================================

// ===== TIPOS =====

export type SituacionId =
  // Verdes (sin intervención)
  | 'top_performer'
  | 'arrancando_bien'
  | 'recien_ingresado'
  | 'estable'
  // Azules (ventana 45-55)
  | 'ventana_45_55_viene_bien'
  | 'ventana_45_55_poca_actividad'
  | 'ventana_45_55_sin_actividad'
  // Amarillas (alertas tempranas)
  | 'baja_retencion'
  | 'conversion_baja'
  | 'sin_horarios_cargados'
  | 'cancelaciones'
  // Naranjas (operativas)
  | 'alerta_arranque'
  | 'sin_conversion'
  | 'pierde_pacientes_netos'
  // Rojas (críticas)
  | 'en_abandono'
  | 'sin_actividad_sostenida'
  // Grises (sin datos suficientes para evaluar)
  | 'sin_datos_suficientes';

export type AccionId =
  | 'destacado'
  | 'meet'
  | 'retencion'
  | 'whatsapp'
  | 'fantasmear'
  | 'evaluar_continuidad'
  | 'continua'
  | 'mail_horarios';

export type ColorSituacion = 'verde' | 'azul' | 'amarillo' | 'naranja' | 'rojo';

// ===== CATÁLOGO DE SITUACIONES =====

export interface SituacionDef {
  id: SituacionId;
  label: string;       // El nombre visible en la UI (badge)
  color: ColorSituacion;
  prioridad: number;   // 1 = más grave, 5 = menos grave
}

export const SITUACIONES: Record<SituacionId, SituacionDef> = {
  // ROJAS — prioridad 1 (más grave)
  en_abandono:           { id: 'en_abandono',           label: 'En abandono',                       color: 'rojo',     prioridad: 1 },
  sin_actividad_sostenida: { id: 'sin_actividad_sostenida', label: 'Sin actividad sostenida',     color: 'rojo',     prioridad: 1 },
  // GRISES — prioridad 5 (sin datos suficientes)
  sin_datos_suficientes: { id: 'sin_datos_suficientes', label: 'Sin datos suficientes',             color: 'verde',    prioridad: 5 },
  // NARANJAS — prioridad 2
  pierde_pacientes_netos: { id: 'pierde_pacientes_netos', label: 'Pierde pacientes netos',          color: 'naranja',  prioridad: 2 },
  sin_conversion:        { id: 'sin_conversion',        label: 'Sin conversión',                    color: 'naranja',  prioridad: 2 },
  alerta_arranque:       { id: 'alerta_arranque',       label: 'Crecimiento estancado',             color: 'naranja',  prioridad: 2 },
  // AMARILLAS — prioridad 3
  cancelaciones:         { id: 'cancelaciones',         label: 'Cancelaciones',                     color: 'amarillo', prioridad: 3 },
  baja_retencion:        { id: 'baja_retencion',        label: 'Baja retención',                    color: 'amarillo', prioridad: 3 },
  conversion_baja:       { id: 'conversion_baja',       label: 'Conversión baja',                   color: 'amarillo', prioridad: 3 },
  sin_horarios_cargados: { id: 'sin_horarios_cargados', label: 'Sin horarios cargados',             color: 'amarillo', prioridad: 3 },
  // AZULES — prioridad 4 (ventana 45-55)
  ventana_45_55_sin_actividad: { id: 'ventana_45_55_sin_actividad', label: 'Ventana 45-55 · sin actividad', color: 'azul', prioridad: 4 },
  ventana_45_55_poca_actividad: { id: 'ventana_45_55_poca_actividad', label: 'Ventana 45-55 · poca actividad', color: 'azul', prioridad: 4 },
  ventana_45_55_viene_bien: { id: 'ventana_45_55_viene_bien', label: 'Ventana 45-55 · viene bien', color: 'azul', prioridad: 4 },
  // VERDES — prioridad 5 (sin intervención)
  top_performer:    { id: 'top_performer',    label: 'Top performer',     color: 'verde', prioridad: 5 },
  arrancando_bien:  { id: 'arrancando_bien',  label: 'Arrancando bien',   color: 'verde', prioridad: 5 },
  estable:          { id: 'estable',          label: 'Estable',           color: 'verde', prioridad: 5 },
  recien_ingresado: { id: 'recien_ingresado', label: 'Recién ingresado',  color: 'verde', prioridad: 5 },
};

// ===== CATÁLOGO DE ACCIONES =====

export interface AccionDef {
  id: AccionId;
  label: string;
  icon: string;
  prioridad: number;  // 1 = más grave/urgente
}

export const ACCIONES: Record<AccionId, AccionDef> = {
  evaluar_continuidad: { id: 'evaluar_continuidad', label: 'Evaluar continuidad', icon: '🚨', prioridad: 1 },
  whatsapp:           { id: 'whatsapp',             label: 'WhatsApp',             icon: '📱', prioridad: 2 },
  meet:               { id: 'meet',                 label: 'Meet',                 icon: '📞', prioridad: 3 },
  retencion:          { id: 'retencion',            label: 'Retención',            icon: '✉️', prioridad: 4 },
  fantasmear:         { id: 'fantasmear',           label: 'Fantasmear',           icon: '👻', prioridad: 5 },
  destacado:          { id: 'destacado',            label: 'Destacado',            icon: '⭐', prioridad: 6 },
  continua:           { id: 'continua',             label: 'Continúa',             icon: '✓',  prioridad: 7 },
  mail_horarios:      { id: 'mail_horarios',        label: 'Mail horarios (auto)', icon: '📅', prioridad: 8 },
};

// ===== MAPEO SITUACIÓN → ACCIÓN PRINCIPAL =====
// Cuál es la primera acción que dispara cada situación.

export const ACCION_INMEDIATA: Record<SituacionId, AccionId> = {
  // Grises
  sin_datos_suficientes:        'continua',
  // Verdes
  top_performer:                'destacado',
  arrancando_bien:              'destacado',
  recien_ingresado:             'continua',
  estable:                      'continua',
  // Azules
  ventana_45_55_viene_bien:     'destacado',
  ventana_45_55_poca_actividad: 'meet',
  ventana_45_55_sin_actividad:  'meet',
  // Amarillas
  baja_retencion:               'retencion',
  conversion_baja:              'whatsapp',       // Mejora 6
  sin_horarios_cargados:        'mail_horarios',  // Mejora 2 (era 'whatsapp')
  cancelaciones:                'whatsapp',
  // Naranjas
  alerta_arranque:              'whatsapp',
  sin_conversion:               'meet',           // Mejora 6 (era 'recibe_no_convierte')
  pierde_pacientes_netos:       'retencion',
  // Rojas
  en_abandono:                  'whatsapp',
  sin_actividad_sostenida:      'whatsapp',
};

// ===== MAPEO SITUACIÓN → ACCIÓN TEMPORAL =====
// Acciones que se ACTIVAN después de N meses consecutivos en la situación.
// Si no aparece la situación en este mapeo, no tiene escalada temporal.

export interface EscaladaTemporal {
  accion: AccionId;
  mesesParaActivar: number;
}

export const ACCION_TEMPORAL: Partial<Record<SituacionId, EscaladaTemporal>> = {
  pierde_pacientes_netos:  { accion: 'fantasmear',          mesesParaActivar: 2 },
  en_abandono:             { accion: 'evaluar_continuidad', mesesParaActivar: 3 },
  sin_actividad_sostenida: { accion: 'evaluar_continuidad', mesesParaActivar: 3 },
};

// ===== UMBRALES DE NEGOCIO =====
// Centralizados acá para que sean fácil de ajustar.

export const UMBRALES = {
  // Baja retención: promedio de sesiones por paciente 3m
  BAJA_RETENCION_SES_PACIENTE: 2.0,
  // Mejora 4: no medir retención antes de N días en plataforma
  RETENCION_MIN_DIAS: 90,
  // Cancelaciones: tasa de canceladas / creadas
  CANCELACIONES_TASA: 0.20,
  // Sin actividad sostenida: días sin sesión
  SIN_ACTIVIDAD_DIAS: 30,
  // Recién ingresado: días en plataforma
  RECIEN_INGRESADO_DIAS: 30,
  // Terapeuta "nuevo" para alerta de arranque y arrancando bien
  NUEVO_MAX_DIAS: 180,
  // Ventana 45-55
  VENTANA_INICIO_DIAS: 45,
  VENTANA_FIN_DIAS: 55,
  // Alerta de arranque: sesiones máximas para considerar "alerta"
  ALERTA_ARRANQUE_MAX_SES: 3,
  // Mínimo de registros históricos para poder evaluar (y potencialmente asignar meet)
  MIN_REGISTROS_TOTAL: 20,
  MIN_REGISTROS_AR: 30,
};

// ===== COLOR → CLASE CSS =====
// Para el badge visual en la UI

export const COLOR_CLS: Record<ColorSituacion, string> = {
  verde:    'sit-g',
  azul:     'sit-b',
  amarillo: 'sit-y',
  naranja:  'sit-o',
  rojo:     'sit-r',
};

// ===== HELPER: ordenar situaciones por prioridad =====
// Filtra ids que no existan en el catálogo (datos viejos con situaciones
// ya eliminadas, ej: 'recibe_no_convierte') para no romper el dashboard.

export function ordenarSituacionesPorGravedad(ids: SituacionId[]): SituacionId[] {
  return [...ids]
    .filter((id) => SITUACIONES[id] != null)
    .sort((a, b) => SITUACIONES[a].prioridad - SITUACIONES[b].prioridad);
}

// ===== HELPER: obtener la acción más grave de un set =====
// También filtra acciones desconocidas por seguridad.

export function accionMasGrave(acciones: AccionId[]): AccionId {
  const validas = acciones.filter((a) => ACCIONES[a] != null);
  if (validas.length === 0) return 'continua';
  return validas.reduce((min, a) =>
    ACCIONES[a].prioridad < ACCIONES[min].prioridad ? a : min
  , validas[0]);
}
