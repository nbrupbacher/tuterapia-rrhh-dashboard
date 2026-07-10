// ============================================================
// MATRIX — DETECTOR DE SITUACIONES
// ============================================================
// Recibe los datos calculados del terapeuta (score, cuadrante,
// tendencia, etc.) y devuelve todas las situaciones que aplican.
//
// IMPORTANTE: una situación puede activarse o no según los datos.
// Un terapeuta puede tener varias situaciones simultáneas
// (ej: "Baja retención" + "Cancelaciones").
//
// Las situaciones VERDES son mutuamente excluyentes con las otras.
// ============================================================

import type { SituacionId } from './constants-matrix';
import { UMBRALES } from './constants-matrix';
import type { Cuadrante, Tendencia } from './types';

// Mejora 1 (capa 2): meses de vacaciones donde "pierde pacientes netos"
// genera falsos positivos por altas/pausas estacionales. Ajustable.
const MESES_ESTACIONALES = [1, 7, 12]; // enero, julio, diciembre

// ===== DATOS DE ENTRADA =====

export interface DetectarInput {
  // Datos básicos
  diasPlataforma: number;
  pais: 'AR' | 'UY';

  // De scoring (mes actual)
  score: number;
  cuadrante: Cuadrante;
  tendencia: Tendencia;
  sesPaciente3m: number;
  tasaCancel: number;
  diasSinSesion: number | null;

  // Métricas crudas del mes actual
  sesMes: number;
  pacMes: number;
  regMes: number;
  hsDisponibles: number;

  // Del mes anterior (para deltas)
  pacAnt: number | null;
  regAnt: number | null;
  sesAnt: number | null;

  // Registros últimos 3 meses (mes actual + 2 anteriores)
  reg3m: number;

  // Para benchmark de conversión (Mejora 6)
  // Es el promedio del país de conversión (pacientes nuevos / registros)
  benchmarkConversionPais: number; // ej 0.094 para AR, 0.161 para UY

  // Mejora 1 (capa 2): mes del período procesado (1-12) para filtro estacional
  mesActual: number;
}

// ===== DETECTOR PRINCIPAL =====

export function detectarSituaciones(d: DetectarInput): SituacionId[] {
  const situaciones: SituacionId[] = [];

  // sin_conversion solo dispara meet si el terapeuta recibe suficientes registros en 3m.
  // La ventana 45-55 no tiene este requisito.
  const minReg3m = d.pais === 'AR' ? UMBRALES.MIN_REG_3M_MEET_AR : UMBRALES.MIN_REG_3M_MEET_UY;
  const puedeRecibirMeet = d.reg3m >= minReg3m;

  // === 1. RECIÉN INGRESADO === (<30 días)
  if (d.diasPlataforma < UMBRALES.RECIEN_INGRESADO_DIAS) {
    situaciones.push('recien_ingresado');
    if (esArrancandoBien(d)) situaciones.push('arrancando_bien');
    return situaciones;
  }

  // === 2. SIN ACTIVIDAD SOSTENIDA === (>30 días sin sesión, consolidado)
  if (esSinActividadSostenida(d)) {
    situaciones.push('sin_actividad_sostenida');
    return situaciones;
  }

  // === 3. EN ABANDONO === (<6m + 0 sesiones + tendencia sin act/bajando)
  if (esEnAbandono(d)) {
    situaciones.push('en_abandono');
    return situaciones;
  }

  // === 4. VENTANA 45-55 días ===
  if (d.diasPlataforma >= UMBRALES.VENTANA_INICIO_DIAS &&
      d.diasPlataforma <= UMBRALES.VENTANA_FIN_DIAS) {
    if (d.sesMes === 0) {
      situaciones.push('ventana_45_55_sin_actividad');
    } else if (esVentanaPocaActividad(d)) {
      situaciones.push('ventana_45_55_poca_actividad');
    } else if (esVentanaVieneBien(d)) {
      situaciones.push('ventana_45_55_viene_bien');
    }
  }

  // === 5. ALERTA DE ARRANQUE === (<6m + pocas ses + arrancando/bajando)
  if (esAlertaArranque(d)) {
    situaciones.push('alerta_arranque');
  }

  // === 6. PIERDE PACIENTES NETOS ===
  if (esPierdePacientesNetos(d)) {
    situaciones.push('pierde_pacientes_netos');
  }

  // === 7. CONVERSIÓN (Mejora 6: dividido en dos) ===
  // sin_conversion (dp <= 0) → Meet · conversion_baja (dp > 0 pero < benchmark) → WhatsApp
  // sin_conversion solo se asigna si tiene registros suficientes para poder hacer meet.
  const conv = clasificarConversion(d);
  if (conv === 'sin_conversion' && puedeRecibirMeet) {
    situaciones.push('sin_conversion');
  } else if (conv === 'conversion_baja') {
    situaciones.push('conversion_baja');
  }

  // === 8. BAJA RETENCIÓN === (promedio ses por paciente < 2.0)
  if (esBajaRetencion(d)) {
    situaciones.push('baja_retencion');
  }

  // === 9. SIN HORARIOS CARGADOS === (hs = 0)
  if (esSinHorariosCargados(d)) {
    situaciones.push('sin_horarios_cargados');
  }

  // === 10. CANCELACIONES === (tasa > umbral)
  if (esCancelaciones(d)) {
    situaciones.push('cancelaciones');
  }

  // === 11. TOP PERFORMER ===
  if (esTopPerformer(d) && situaciones.length === 0) {
    situaciones.push('top_performer');
    return situaciones;
  }

  // === 12. ARRANCANDO BIEN === (<6m, viene fuerte)
  if (esArrancandoBien(d) && situaciones.length === 0) {
    situaciones.push('arrancando_bien');
    return situaciones;
  }

  // === 13. ESTABLE === fallback si no se detectó nada
  if (situaciones.length === 0) {
    situaciones.push('estable');
  }

  return situaciones;
}

// ============================================================
// REGLAS INDIVIDUALES
// ============================================================
// Cada función es una pregunta sí/no sobre el terapeuta.
// Si Talent quiere cambiar un criterio, se cambia ACÁ.

function esSinActividadSostenida(d: DetectarInput): boolean {
  const dias = d.diasSinSesion ?? 0;
  return d.diasPlataforma >= 30 && (
    (d.sesMes === 0 && d.tendencia === 'sin actividad') ||
    (d.sesMes === 0 && d.pacMes === 0 && d.tendencia === 'bajando') ||
    dias > UMBRALES.SIN_ACTIVIDAD_DIAS
  );
}

function esEnAbandono(d: DetectarInput): boolean {
  return d.diasPlataforma <= UMBRALES.NUEVO_MAX_DIAS &&
         d.sesMes === 0 &&
         (d.tendencia === 'sin actividad' || d.tendencia === 'bajando');
}

function esVentanaPocaActividad(d: DetectarInput): boolean {
  return d.sesMes > 0 && d.sesMes <= 5;
}

function esVentanaVieneBien(d: DetectarInput): boolean {
  return d.sesMes > 5 && (d.tendencia === 'subiendo' || d.tendencia === 'estable');
}

function esAlertaArranque(d: DetectarInput): boolean {
  return d.diasPlataforma < UMBRALES.NUEVO_MAX_DIAS &&
         d.sesMes <= UMBRALES.ALERTA_ARRANQUE_MAX_SES &&
         (d.tendencia === 'arrancando' || d.tendencia === 'bajando');
}

function esPierdePacientesNetos(d: DetectarInput): boolean {
  // Mejora 1 (capa 2): en meses de vacaciones no marcamos esta situación.
  if (MESES_ESTACIONALES.includes(d.mesActual)) return false;

  const recibioRegistros = d.regMes > 0;
  const tieneMenosPacientes = d.pacAnt !== null && d.pacMes < d.pacAnt;

  // Mejora 1 (capa 1): solo es problema real si además retiene mal.
  // Si retiene bien (sp3 >= 2.5), la baja es probable alta clínica, no abandono.
  const retieneMal = d.sesPaciente3m < 2.5;

  return recibioRegistros && tieneMenosPacientes && retieneMal;
}

// Mejora 6: reemplaza a esRecibeNoConvierte.
// Devuelve cuál de las dos situaciones aplica, o null si ninguna.
function clasificarConversion(d: DetectarInput): 'sin_conversion' | 'conversion_baja' | null {
  // Necesitamos historial del mes anterior para juzgar conversión.
  if (d.regAnt == null || d.pacAnt == null) return null;
  // Sin registros este mes: no hay nada que convertir.
  if (d.regMes === 0) return null;

  // dp = pacientes nuevos netos del mes
  const nuevosMes = Math.max(0, d.pacMes - d.pacAnt);

  // Sin conversión: recibió registros y no sumó ningún paciente neto.
  if (nuevosMes === 0) return 'sin_conversion';

  // Conversión baja: convirtió, pero por debajo del benchmark del país.
  // (Mejora 6: umbral = benchmark a secas, sin el /2 ni el ×0.7 anterior.)
  const conversionMes = nuevosMes / d.regMes;
  if (conversionMes < d.benchmarkConversionPais) return 'conversion_baja';

  return null;
}

function esBajaRetencion(d: DetectarInput): boolean {
  // Mejora 4: no medir retención antes de tener recorrido (< 90 días).
  if (d.diasPlataforma < UMBRALES.RETENCION_MIN_DIAS) return false;
  return d.sesPaciente3m > 0 && d.sesPaciente3m < UMBRALES.BAJA_RETENCION_SES_PACIENTE;
}

function esSinHorariosCargados(d: DetectarInput): boolean {
  return d.hsDisponibles === 0;
}

function esCancelaciones(d: DetectarInput): boolean {
  return d.tasaCancel > UMBRALES.CANCELACIONES_TASA;
}

function esTopPerformer(d: DetectarInput): boolean {
  return d.diasPlataforma >= UMBRALES.NUEVO_MAX_DIAS &&
         d.cuadrante === 'A' &&
         (d.tendencia === 'subiendo' || d.tendencia === 'estable');
}

function esArrancandoBien(d: DetectarInput): boolean {
  return d.diasPlataforma < UMBRALES.NUEVO_MAX_DIAS &&
         d.tendencia === 'subiendo' &&
         d.sesMes >= 3;
}
