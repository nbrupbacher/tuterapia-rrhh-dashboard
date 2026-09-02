import type { Tendencia, TherapistView } from './types';
import type { SituacionId, AccionId, ColorSituacion } from './constants-matrix';
import { SITUACIONES, ACCIONES, COLOR_CLS, ordenarSituacionesPorGravedad } from './constants-matrix';
import { MIN_PACIENTES_1RA_SESION } from './csvParser';

// ============================================================
// Colores
// ============================================================
export function colorScore(score: number): string {
  if (score >= 70) return 'var(--v)';
  if (score >= 45) return 'var(--am)';
  return 'var(--r)';
}

export function colorSesPaciente(sp: number): string {
  if (sp > 0 && sp < 2) return 'var(--r)';
  if (sp >= 2.5) return 'var(--v)';
  return 'var(--am)';
}

export function colorHs(h: number): string {
  if (h === 0) return 'var(--r)';
  if (h < 5) return 'var(--am)';
  if (h >= 15) return 'var(--v)';
  return 'inherit';
}

export function colorZona(zona: 'Verde' | 'Amarillo' | 'Rojo'): string {
  if (zona === 'Verde') return 'var(--v)';
  if (zona === 'Amarillo') return 'var(--am)';
  return 'var(--r)';
}

// % de caída en 1ra sesión: cuanto más bajo, mejor (menos pacientes se van
// después de la primera sesión). Devuelve null cuando no hay muestra
// suficiente, para poder distinguir "sin datos" de un 0% real (excelente).
export function pctCaida1ra(t: TherapistView): { value: number | null; color: string; n: number | null } {
  const n = t.pacientes1raSesion;
  const v = t.pctCaida1ra;
  if (v == null || n == null || n < MIN_PACIENTES_1RA_SESION) {
    return { value: null, color: 'var(--t3)', n };
  }
  const color = v >= 50 ? 'var(--r)' : v >= 30 ? 'var(--am)' : 'var(--v)';
  return { value: v, color, n };
}

export function colorDias(d: number | null): string {
  if (d == null) return 'var(--t2)';
  if (d > 30) return 'var(--r)';
  if (d > 14) return 'var(--am)';
  return 'var(--t2)';
}

// ============================================================
// Formateo
// ============================================================
export function usd(value: number | null | undefined): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  const sign = value < 0 ? '−' : '+';
  return `${sign}USD ${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
}

export function segmento(dias: number): string {
  if (dias <= 90) return 'Nuevo';
  if (dias <= 180) return 'Junior';
  if (dias <= 365) return 'Semi Sr';
  return 'Senior';
}

// ============================================================
// Badges
// ============================================================
export function tendenciaBadge(t: Tendencia): { cls: string; label: string } {
  switch (t) {
    case 'subiendo':       return { cls: 'ts-u', label: '↑ Sube' };
    case 'bajando':        return { cls: 'ts-d', label: '↓ Baja' };
    case 'estable':        return { cls: 'ts-e', label: '→ Estable' };
    case 'sin actividad':  return { cls: 'ts-s', label: '∅ Sin act.' };
    case 'arrancando':     return { cls: 'ts-a', label: '~ Arranca' };
    default:               return { cls: 'ts-a', label: '~ Arranca' };
  }
}

export function cuadranteBadge(c: 'A' | 'B' | 'C' | 'D'): { cls: string; label: string } {
  const map = {
    A: { cls: 'pr-a', label: 'A · Alto valor' },
    B: { cls: 'pr-b', label: 'B · Riesgo oculto' },
    C: { cls: 'pr-c', label: 'C · Potencial' },
    D: { cls: 'pr-d', label: 'D · Intervención' },
  };
  return map[c] || { cls: 'pr-d', label: '—' };
}

// ============================================================
// MATRIX — badges de situación y acción (NUEVO PR3)
// ============================================================

// Dot de color al inicio del badge según color de la situación
const COLOR_DOT: Record<ColorSituacion, string> = {
  verde:    '#34d399',
  azul:     '#38bdf8',
  amarillo: '#f5a623',
  naranja:  '#ff8c50',
  rojo:     '#f05252',
};

export function situacionBadge(id: SituacionId): { cls: string; label: string; dot: string } {
  const def = SITUACIONES[id];
  return {
    cls: COLOR_CLS[def.color],
    label: def.label,
    dot: COLOR_DOT[def.color],
  };
}

// Las dos situaciones más graves (para mostrar en la tabla)
export function topSituaciones(situaciones: SituacionId[], max = 2): SituacionId[] {
  return ordenarSituacionesPorGravedad(situaciones).slice(0, max);
}

export function accionBadge(id: AccionId | string): { cls: string; label: string; icon: string } {
  if (id === 'meet_hecha') return { cls: 'acc-meet-hecha', icon: '📹', label: 'Meet hecha · esperar' };
  if (id === 'whatsapp_hecha') return { cls: 'acc-wa-hecha', icon: '📱', label: 'WhatsApp hecha · esperar' };
  const def = ACCIONES[id as AccionId];
  if (!def) return { cls: 'acc-continua', icon: '✓', label: id };
  const clsMap: Record<AccionId, string> = {
    evaluar_continuidad: 'acc-evaluar',
    whatsapp:            'acc-whatsapp',
    meet:                'acc-meet',
    retencion:           'acc-retencion',
    fantasmear:          'acc-fantasmear',
    destacado:           'acc-destacado',
    continua:            'acc-continua',
    mail_horarios:       'acc-continua',
  };
  return {
    cls: clsMap[id as AccionId],
    label: def.label,
    icon: def.icon,
  };
}

// ============================================================
// Deltas y row class
// ============================================================
export function deltaBadge(actual: number | null, anterior: number | null): { cls: string; label: string } | null {
  if (actual == null || anterior == null) return null;
  const d = actual - anterior;
  if (d > 0) return { cls: 'dp-u', label: `↑${d}` };
  if (d < 0) return { cls: 'dp-d', label: `↓${Math.abs(d)}` };
  return { cls: 'dp-e', label: '=' };
}

export function conversion(pacAct: number | null, pacAnt: number | null, regMes: number | null): { value: number | null; color: string } {
  const np = (pacAct != null && pacAnt != null) ? Math.max(0, pacAct - pacAnt) : null;
  const cv = (np !== null && regMes && regMes > 0) ? Math.round(np / regMes * 100) : null;
  let col = 'var(--t3)';
  if (cv !== null) {
    if (cv >= 20) col = 'var(--v)';
    else if (cv >= 10) col = 'var(--am)';
    else col = 'var(--r)';
  }
  return { value: cv, color: col };
}

// MODIFICADO PR3: ahora chequea situaciones rojas en lugar de irrecuperable
export function rowClass(t: TherapistView): string {
  const sits = t.situaciones || [];
  // Crítico (rojo) si tiene "sin_actividad_sostenida" o "en_abandono"
  if (sits.includes('sin_actividad_sostenida') || sits.includes('en_abandono')) return 'ri';
  // Naranja suave si tiene "pierde_pacientes_netos"
  if (sits.includes('pierde_pacientes_netos')) return 'ro';
  return '';
}

export function ganHist(t: TherapistView): number {
  const ses = t.sesionesHist || 0;
  const reg = t.regTotalHist || 0;
  if (t.pais === 'AR') return Math.round(ses * 5.5 - reg * 1.5);
  return Math.round(ses * 10 - reg * 2);
}

// ============================================================
// Deltas (variación vs período anterior) — sin cambios
// ============================================================
export interface Delta {
  label: string;
  color: string;
  icon: '↑' | '↓' | '→';
}

export function formatDelta(actual: number, anterior: number | null): Delta | null {
  if (anterior == null || anterior === 0) return null;
  const diff = actual - anterior;
  const pct = (diff / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.5) return { label: '0%', color: 'var(--t3)', icon: '→' };
  if (pct > 0) {
    return { label: `+${Math.abs(pct).toFixed(0)}%`, color: 'var(--v)', icon: '↑' };
  } else {
    return { label: `-${Math.abs(pct).toFixed(0)}%`, color: 'var(--r)', icon: '↓' };
  }
}

export function formatDeltaAbs(actual: number, anterior: number | null, formatter?: (n: number) => string): Delta | null {
  if (anterior == null) return null;
  const diff = actual - anterior;
  if (Math.abs(diff) < 0.01) return { label: '=', color: 'var(--t3)', icon: '→' };
  const fmt = formatter || ((n: number) => n.toFixed(2));
  return {
    label: `${diff > 0 ? '+' : ''}${fmt(diff)}`,
    color: diff > 0 ? 'var(--v)' : 'var(--r)',
    icon: diff > 0 ? '↑' : '↓',
  };
}

export function formatDeltaMoney(actual: number, anterior: number | null): Delta | null {
  if (anterior == null) return null;
  const diff = actual - anterior;
  if (Math.abs(diff) < 1) return { label: 'USD 0', color: 'var(--t3)', icon: '→' };
  const abs = Math.abs(diff).toLocaleString('en-US', { maximumFractionDigits: 0 });
  return {
    label: `${diff > 0 ? '+' : '−'}USD ${abs}`,
    color: diff > 0 ? 'var(--v)' : 'var(--r)',
    icon: diff > 0 ? '↑' : '↓',
  };
}

// Formatear fecha YYYY-MM-DD como DD/MM
export function formatFecha(s: string | null): string {
  if (!s) return '—';
  const parts = s.split('-');
  if (parts.length !== 3) return '—';
  return `${parts[2]}/${parts[1]}`;
}
