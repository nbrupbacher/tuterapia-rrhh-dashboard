import type { Tendencia, TherapistView } from './types';

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

export function accionableBadge(a: string): { cls: string; label: string } {
  const map: Record<string, { cls: string; label: string }> = {
    irrecuperable:    { cls: 'ai',  label: '⛔ Irrecuperable' },
    revisar_urgente:  { cls: 'ar2', label: '🔴 Revisar urgente' },
    dejar_mostrar:    { cls: 'am2', label: '👻 Fantasmear' },
    potenciar:        { cls: 'ap',  label: '↑ Potenciar' },
    retencion:        { cls: 'at',  label: '⚑ Retención' },
    cancelaciones:    { cls: 'ac2', label: '⚠ Cancelaciones' },
    disponibilidad:   { cls: 'ad',  label: '△ Disponibilidad' },
    monitorear:       { cls: 'amo', label: '○ Monitorear' },
  };
  return map[a] || { cls: 'amo', label: '○ Monitorear' };
}

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

export function rowClass(t: TherapistView): string {
  if (t.irrecuperable) return 'ri';
  if (t.score >= 70 && t.tendencia === 'bajando') return 'ro';
  return '';
}

export function ganHist(t: TherapistView): number {
  const ses = t.sesionesHist || 0;
  const reg = t.regTotalHist || 0;
  if (t.pais === 'AR') return Math.round(ses * 5.5 - reg * 1.5);
  return Math.round(ses * 10 - reg * 2);
}

// ============================================================
// Deltas (variación vs período anterior)
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
