// ============================================================
// MATRIX — CALCULADOR DE ACCIONES
// ============================================================
// Dadas las situaciones del mes actual y el contador de meses
// que el terapeuta lleva en cada situación, calcula:
//   1. La acción inmediata (la más urgente del set actual)
//   2. Las acciones pendientes (que se activarán si la situación persiste)
//   3. El contador actualizado de meses por situación
// ============================================================

import type { SituacionId, AccionId } from './constants-matrix';
import {
  ACCION_INMEDIATA,
  ACCION_TEMPORAL,
  ACCIONES,
  accionMasGrave,
} from './constants-matrix';

// ===== TIPOS =====

export interface AccionPendiente {
  accion: AccionId;
  motivo: SituacionId;
  meses_para_activar: number;
}

export interface ResultadoAcciones {
  // Acción principal a ejecutar este mes
  accion: AccionId;
  // Acciones que también se activan ahora (por escalada temporal cumplida)
  accionesActivadasPorTiempo: AccionId[];
  // Acciones que se activarán a futuro si la situación persiste
  accionesPendientes: AccionPendiente[];
  // Contador de meses en cada situación (para guardar en DB)
  mesesEnSituacionActualizado: Record<string, number>;
}

// ===== CALCULADOR =====

export function calcularAcciones(
  situacionesActuales: SituacionId[],
  mesesEnSituacionPrevio: Record<string, number>,
): ResultadoAcciones {
  // === 1. Actualizar contador de meses en situación ===
  // Para cada situación actual: si la tenía el mes pasado, +1. Si no, =1.
  // Las situaciones que ya no aplican: se quitan del contador (reset).
  const mesesEnSituacionActualizado: Record<string, number> = {};
  for (const sit of situacionesActuales) {
    const mesesAnteriores = mesesEnSituacionPrevio[sit] ?? 0;
    mesesEnSituacionActualizado[sit] = mesesAnteriores + 1;
  }

  // === 2. Calcular acciones inmediatas (las que dispara cada situación) ===
  const accionesInmediatasSet = new Set<AccionId>();
  for (const sit of situacionesActuales) {
    accionesInmediatasSet.add(ACCION_INMEDIATA[sit]);
  }

  // === 3. Calcular escaladas temporales ===
  // Si la situación tiene escalada y cumplió los meses, su acción se activa.
  // Si todavía no cumplió, queda como pendiente.
  const accionesActivadasPorTiempo: AccionId[] = [];
  const accionesPendientes: AccionPendiente[] = [];

  for (const sit of situacionesActuales) {
    const escalada = ACCION_TEMPORAL[sit];
    if (!escalada) continue;

    const mesesActuales = mesesEnSituacionActualizado[sit];
    if (mesesActuales >= escalada.mesesParaActivar) {
      // Ya se cumplió la escalada: la acción se activa
      accionesActivadasPorTiempo.push(escalada.accion);
      accionesInmediatasSet.add(escalada.accion);
    } else {
      // Todavía no: queda pendiente
      accionesPendientes.push({
        accion: escalada.accion,
        motivo: sit,
        meses_para_activar: escalada.mesesParaActivar - mesesActuales,
      });
    }
  }

  // === 4. Determinar la acción PRINCIPAL ===
  // De todas las acciones activas (inmediatas + activadas por tiempo),
  // tomamos la más grave (prioridad más baja).
  const todasLasAcciones = Array.from(accionesInmediatasSet);
  const accionPrincipal = accionMasGrave(todasLasAcciones);

  return {
    accion: accionPrincipal,
    accionesActivadasPorTiempo,
    accionesPendientes,
    mesesEnSituacionActualizado,
  };
}

// ===== HELPER: obtener todas las acciones activas (para mostrar en UI) =====

export function todasLasAccionesActivas(
  situaciones: SituacionId[],
  mesesEnSituacion: Record<string, number>,
): AccionId[] {
  const set = new Set<AccionId>();
  for (const sit of situaciones) {
    set.add(ACCION_INMEDIATA[sit]);
    const escalada = ACCION_TEMPORAL[sit];
    if (escalada) {
      const meses = mesesEnSituacion[sit] ?? 0;
      if (meses >= escalada.mesesParaActivar) {
        set.add(escalada.accion);
      }
    }
  }
  // Ordenadas por gravedad (más grave primero)
  return Array.from(set).sort(
    (a, b) => ACCIONES[a].prioridad - ACCIONES[b].prioridad,
  );
}
