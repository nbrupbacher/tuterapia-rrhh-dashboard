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
// Las situaciones VERDES son mutuamente excluyentes con las otras
// (un terapeuta en estado "Top performer" no debería tener
//  ninguna situación de problemas activa).
// ============================================================

import type { SituacionId } from './constants-matrix';
import { UMBRALES } from './constants-matrix';
import type { Cuadrante, Tendencia } from './types';

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

  // Para benchmark de "Recibe pero no convierte"
  // Es el promedio del país de conversión (pacientes nuevos / registros)
  benchmarkConversionPais: number; // ej 0.094 para AR, 0.161 para UY
}

// ===== DETECTOR PRINCIPAL =====

export function detectarSituaciones(d: DetectarInput): SituacionId[] {
  const situaciones: SituacionId[] = [];

  // === 1. RECIÉN INGRESADO === (<30 días)
  // Cuando es recién ingresado, NO se aplican otras reglas operativas.
  // Solo este flag y eventualmente "Arrancando bien" si viene fuerte.
  if (d.diasPlataforma < UMBRALES.RECIEN_INGRESADO_DIAS) {
    situaciones.push('recien_ingresado');
    if (esArrancandoBien(d)) situaciones.push('arrancando_bien');
    return situaciones;
  }

  // === 2. SIN ACTIVIDAD SOSTENIDA === (>30 días sin sesión, consolidado)
  // Equivale al "irrecuperable" del modelo viejo.
  if (esSinActividadSostenida(d)) {
    situaciones.push('sin_actividad_sostenida');
    // Si está acá, no agregamos otras situaciones (ya está en lo más grave)
    return situaciones;
  }

  // === 3. EN ABANDONO === (<6m + 0 sesiones + tendencia sin act/bajando)
  if (esEnAbandono(d)) {
    situaciones.push('en_abandono');
    // Si está acá, no agregamos otras (también es muy grave)
    return situaciones;
  }

  // === 4. VENTANA 45-55 días ===
  // Es un estado especial por su momento temporal.
  // Se activa una variante según rendimiento.
  if (d.diasPlataforma >= UMBRALES.VENTANA_INICIO_DIAS &&
      d.diasPlataforma <= UMBRALES.VENTANA_FIN_DIAS) {
    if (d.sesMes === 0) {
      situaciones.push('ventana_45_55_sin_actividad');
    } else if (esVentanaPocaActividad(d)) {
      situaciones.push('ventana_45_55_poca_actividad');
    } else if (esVentanaVieneBien(d)) {
      situaciones.push('ventana_45_55_viene_bien');
    }
    // No retornamos: pueden coexistir con otras (ej: cancelaciones)
  }

  // === 5. ALERTA DE ARRANQUE === (<6m + pocas ses + arrancando/bajando)
  if (esAlertaArranque(d)) {
    situaciones.push('alerta_arranque');
  }

  // === 6. PIERDE PACIENTES NETOS ===
  // Recibió registros este mes pero tiene menos pacientes que el mes anterior
  if (esPierdePacientesNetos(d)) {
    situaciones.push('pierde_pacientes_netos');
  }

  // === 7. RECIBE PERO NO CONVIERTE ===
  // Recibe registros pero la conversión está abajo del 50% del benchmark
  if (esRecibeNoConvierte(d)) {
    situaciones.push('recibe_no_convierte');
  }

  // === 8. BAJA RETENCIÓN === (promedio ses por paciente < 2.0)
  if (esBajaRetencion(d)) {
    situaciones.push('baja_retencion');
  }

  // === 9. SIN HORARIOS CARGADOS === (hs = 0)
  if (esSinHorariosCargados(d)) {
    situaciones.push('sin_horarios_cargados');
  }

  // === 10. CANCELACIONES === (tasa > 20%)
  if (esCancelaciones(d)) {
    situaciones.push('cancelaciones');
  }

  // === 11. TOP PERFORMER ===
  // Cuadrante A subiendo o estable, SIN otras alertas
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
  // Equivale a irrecuperable del modelo viejo: >30 días sin sesión consolidado
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
  // En ventana, con poca actividad relativa
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
  // Recibió registros este mes Y tiene menos pacientes que el mes anterior
  const recibioRegistros = d.regMes > 0;
  const tienemenosPacientes = d.pacAnt !== null && d.pacMes < d.pacAnt;
  return recibioRegistros && tienemenosPacientes;
}

function esRecibeNoConvierte(d: DetectarInput): boolean {
  // Necesitamos historial del mes anterior para juzgar conversión.
  // Si es nuevo (sin mes anterior), no aplica esta situación.
  if (d.regAnt == null || d.pacAnt == null) return false;

  // Necesitamos registros en ambos meses para que el ratio sea significativo
  if (d.regMes === 0 || d.regAnt === 0) return false;

  // Conversión del mes actual: pacientes nuevos / registros del mes
  const nuevosMesActual = Math.max(0, d.pacMes - d.pacAnt);
  const conversionMesActual = nuevosMesActual / d.regMes;

  // Conversión del mes anterior: aproximada como pacAnt / regAnt
  const conversionMesAnt = d.pacAnt / d.regAnt;

  // Promedio simple de las dos conversiones
  const conversionPromedio = (conversionMesActual + conversionMesAnt) / 2;

  // Threshold: 70% del benchmark del país
  // AR: 0.094 × 0.7 = 0.0658 (6.58%)
  // UY: 0.161 × 0.7 = 0.1127 (11.27%)
  return conversionPromedio < (d.benchmarkConversionPais * 0.7);
}


function esBajaRetencion(d: DetectarInput): boolean {
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
