// Lógica de scoring portada de Python. Calcula state para un mes
// dado los datos actuales y los 2 meses anteriores.
//
// MODIFICADO PR2: en lugar de calcular `accionable` (modelo viejo)
// ahora calcula `situaciones` (array) + `accion` (string) + lógica temporal.

import type { Pais, Cuadrante, Tendencia } from './types';
import type { SituacionId, AccionId } from './constants-matrix';
import { detectarSituaciones } from './situations';
import { calcularAcciones, type AccionPendiente } from './actions';

const TARIFAS: Record<Pais, { s: number; r: number }> = {
  AR: { s: 5.5, r: 1.5 },
  UY: { s: 10.0, r: 2.0 },
};
const MED: Record<Pais, number> = { AR: 16, UY: 124 };
const TSA: Record<Pais, number> = { AR: 0.094, UY: 0.161 };

export interface MonthData {
  sm: number; pm: number; rm: number;
  hs?: number; ses_canc?: number; ses_creadas?: number;
}

export interface ScoreResult {
  // Capa Predicción (sin cambios)
  score: number;
  zona: 'Verde' | 'Amarillo' | 'Rojo';
  cuadrante: Cuadrante;
  tendencia: Tendencia;

  // Capa Matrix (NUEVO)
  situaciones: SituacionId[];
  accion: AccionId;
  acciones_pendientes: AccionPendiente[];
  meses_en_situacion: Record<string, number>;

  // Métricas calculadas (sin cambios)
  ses_paciente_3m: number;
  gan_mes: number;
  reg_3m: number;
  tasa_cancel: number;
  videollamada: boolean;
  dias_sin_sesion: number | null;
}

export function calcScore(
  pais: Pais,
  diasPlat: number,
  cur: MonthData,
  prev: MonthData | null,
  prev2: MonthData | null,
  // NUEVO: contador del mes anterior por terapeuta (para lógica temporal)
  mesesEnSituacionPrevio: Record<string, number> = {},
  diasSinSesion: number | null = null,
  // Mejora 1 (capa 2): mes del período procesado (1-12) para filtro estacional.
  // OJO reprocesos: el llamador DEBE pasar el mes del período, no el del sistema.
  mesActual: number = new Date().getMonth() + 1,
): ScoreResult {
  const cv = TARIFAS[pais];
  const { sm, pm, rm } = cur;
  const hs = cur.hs ?? 0;

  // ============ Ventana 3m ============
  const sT = sm + (prev?.sm ?? 0) + (prev2?.sm ?? 0);
  const pT = pm + (prev?.pm ?? 0) + (prev2?.pm ?? 0);
  const rT = rm + (prev?.rm ?? 0) + (prev2?.rm ?? 0);
  const sp3 = pT > 0 ? Math.round((sT / pT) * 100) / 100 : 0;
  const gm = Math.round((sm * cv.s - rm * cv.r) * 100) / 100;

  // ============ Tendencia ============
  const sE = prev2?.sm ?? prev?.sm ?? null;
  let tend: Tendencia;
  if (sE === null) tend = sm > 0 ? 'arrancando' : 'sin actividad';
  else if (sE === 0 && sm === 0) tend = 'sin actividad';
  else if (sE === 0) tend = 'arrancando';
  else if (sm >= sE * 1.2) tend = 'subiendo';
  else if (sm <= sE * 0.8) tend = 'bajando';
  else tend = 'estable';

  // ============ Cuadrante ============
  let cuad: Cuadrante = 'D';
  if (sm > 0 && pm > 0) {
    const alt = gm >= MED[pais];
    const cal = sp3 >= 2.0;
    cuad = alt && cal ? 'A' : (alt ? 'B' : (cal ? 'C' : 'D'));
  }

  const esRecien = diasPlat < 30;

  // ============ Tasa cancel ============
  const cr = cur.ses_creadas ?? 0;
  const ca = cur.ses_canc ?? 0;
  const tc = cr > 0 ? Math.min(ca / cr, 1) : 0;

  // ============ Score ============
  let score: number;
  if (esRecien) {
    let penal = 0;
    if (hs === 0) penal += 10;
    if (tc > 0.3) penal += 5;
    score = Math.max(40, 65 - penal);
  } else {
    let penal = 0;
    if (sm === 0) penal += 35;
    else if (sm <= 2) penal += 20;
    else if (sm <= 7) penal += 10;
    if (pm === 0) penal += 25;
    else if (pm <= 2) penal += 12;
    if (cuad === 'D') penal += 10;
    else if (cuad === 'B' || cuad === 'C') penal += 5;
    if (sp3 > 0 && sp3 < 2.0) penal += 8;
    if (tend === 'bajando') penal += 5;
    if (tc > 0.3) penal += 10;
    else if (tc > 0.2) penal += 5;
    if (hs === 0) penal += 8;
    score = Math.max(0, 100 - Math.min(penal, 100));
  }

  // ============ Zona ============
  const zona: 'Verde' | 'Amarillo' | 'Rojo' =
    esRecien ? (score >= 70 ? 'Verde' : 'Amarillo') :
    (score >= 70 ? 'Verde' : score >= 45 ? 'Amarillo' : 'Rojo');

  // ============ MATRIX ============
  const situaciones = detectarSituaciones({
    diasPlataforma: diasPlat,
    pais,
    score,
    cuadrante: cuad,
    tendencia: tend,
    sesPaciente3m: sp3,
    tasaCancel: tc,
    diasSinSesion,
    sesMes: sm,
    pacMes: pm,
    regMes: rm,
    hsDisponibles: hs,
    pacAnt: prev?.pm ?? null,
    regAnt: prev?.rm ?? null,
    sesAnt: prev?.sm ?? null,
    benchmarkConversionPais: TSA[pais],
    mesActual,
  });

  const resultadoAcciones = calcularAcciones(situaciones, mesesEnSituacionPrevio);

  // ============ Videollamada ============
  const videollamada = (diasPlat >= 45 && diasPlat <= 55) &&
                        (zona === 'Rojo' || zona === 'Amarillo');

  return {
    score, zona, cuadrante: cuad, tendencia: tend,
    situaciones,
    accion: resultadoAcciones.accion,
    acciones_pendientes: resultadoAcciones.accionesPendientes,
    meses_en_situacion: resultadoAcciones.mesesEnSituacionActualizado,
    ses_paciente_3m: sp3,
    gan_mes: gm,
    reg_3m: rT,
    tasa_cancel: Math.round(tc * 10000) / 10000,
    videollamada,
    dias_sin_sesion: diasSinSesion,
  };
}
