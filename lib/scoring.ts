// Lógica de scoring portada de Python. Calcula state para un mes
// dado los datos actuales y los 2 meses anteriores.

import type { Pais, Cuadrante, Tendencia } from './types';

const TARIFAS: Record<Pais, { s: number; r: number }> = {
  AR: { s: 5.5, r: 1.5 },
  UY: { s: 10.0, r: 2.0 },
};
const MED: Record<Pais, number> = { AR: 16, UY: 124 };
const TSA: Record<Pais, number> = { AR: 0.094, UY: 0.161 };
const UBR: Record<Pais, number> = { AR: 32, UY: 19 };

export interface MonthData {
  sm: number; pm: number; rm: number;
  hs?: number; ses_canc?: number; ses_creadas?: number;
}

export interface ScoreResult {
  score: number;
  zona: 'Verde' | 'Amarillo' | 'Rojo';
  cuadrante: Cuadrante;
  tendencia: Tendencia;
  irrecuperable: boolean;
  senal: string | null;
  accionable: string;
  ses_paciente_3m: number;
  gan_mes: number;
  reg_3m: number;
  tasa_cancel: number;
  videollamada: boolean;
}

export function calcScore(
  pais: Pais,
  diasPlat: number,
  cur: MonthData,
  prev: MonthData | null,
  prev2: MonthData | null,
): ScoreResult {
  const cv = TARIFAS[pais];
  const { sm, pm, rm } = cur;
  const hs = cur.hs ?? 0;
  
  // Window 3m
  const sT = sm + (prev?.sm ?? 0) + (prev2?.sm ?? 0);
  const pT = pm + (prev?.pm ?? 0) + (prev2?.pm ?? 0);
  const rT = rm + (prev?.rm ?? 0) + (prev2?.rm ?? 0);
  const sp3 = pT > 0 ? Math.round((sT / pT) * 100) / 100 : 0;
  const gm = Math.round((sm * cv.s - rm * cv.r) * 100) / 100;
  
  // Tendencia
  const sE = prev2?.sm ?? prev?.sm ?? null;
  let tend: Tendencia;
  if (sE === null) tend = sm > 0 ? 'arrancando' : 'sin actividad';
  else if (sE === 0 && sm === 0) tend = 'sin actividad';
  else if (sE === 0) tend = 'arrancando';
  else if (sm >= sE * 1.2) tend = 'subiendo';
  else if (sm <= sE * 0.8) tend = 'bajando';
  else tend = 'estable';
  
  // Cuadrante
  let cuad: Cuadrante = 'D';
  if (sm > 0 && pm > 0) {
    const alt = gm >= MED[pais];
    const cal = sp3 >= 2.0;
    cuad = alt && cal ? 'A' : (alt ? 'B' : (cal ? 'C' : 'D'));
  }
  
  // Diferencial <30 días
  const esRecien = diasPlat < 30;
  const irr = esRecien ? false : (
    (sm === 0 && tend === 'sin actividad') ||
    (sm === 0 && pm === 0 && tend === 'bajando')
  );
  
  // Tasa cancel
  const cr = cur.ses_creadas ?? 0;
  const ca = cur.ses_canc ?? 0;
  const tc = cr > 0 ? Math.min(ca / cr, 1) : 0;
  
  // Accionable
  const bn = TSA[pais];
  const ub = UBR[pais];
  const pE = prev?.pm ?? 0;
  const dp = pm - pE;
  const tr2 = rT >= ub ? dp / rT : null;
  
  let acc: string;
  if (esRecien) acc = 'monitorear';
  else if (irr) acc = 'irrecuperable';
  else if (rT >= ub && dp < 0) acc = 'revisar_urgente';
  else if (tr2 !== null && tr2 < bn * 0.5) acc = 'dejar_mostrar';
  else if (cuad === 'A' && tend === 'subiendo') acc = 'potenciar';
  else if (sp3 > 0 && sp3 < 2.0) acc = 'retencion';
  else if (tc > 0.2) acc = 'cancelaciones';
  else if (!hs) acc = 'disponibilidad';
  else acc = 'monitorear';
  
  // Score
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
  
  const zona: 'Verde' | 'Amarillo' | 'Rojo' = 
    esRecien ? (score >= 70 ? 'Verde' : 'Amarillo') :
    (score >= 70 ? 'Verde' : score >= 45 ? 'Amarillo' : 'Rojo');
  
  // Señal
  let senal: string | null = null;
  if (esRecien) senal = 'recien_ingresado';
  else if (diasPlat <= 180) {
    if (sm === 0 && (tend === 'sin actividad' || tend === 'bajando')) senal = 'abandono';
    else if (tend === 'subiendo' && sm >= 3) senal = 'arrancando_bien';
    else if (sm <= 3 && (tend === 'arrancando' || tend === 'bajando')) senal = 'alerta_arranque';
  }
  
  const videollamada = (diasPlat >= 45 && diasPlat <= 55) && (zona === 'Rojo' || zona === 'Amarillo');
  
  return {
    score, zona, cuadrante: cuad, tendencia: tend,
    irrecuperable: irr, senal, accionable: acc,
    ses_paciente_3m: sp3, gan_mes: gm, reg_3m: rT,
    tasa_cancel: Math.round(tc * 10000) / 10000,
    videollamada,
  };
}
