import type { Tendencia, TherapistView } from './types';

export function colorScore(score: number): string {
  if (score >= 70) return 'var(--v)';
  if (score >= 40) return 'var(--am)';
  return 'var(--r)';
}

export function colorSesPaciente(sp: number): string {
  if (sp >= 2.0) return 'var(--v)';
  if (sp >= 1.5) return 'var(--am)';
  return 'var(--r)';
}

export function segmento(dias: number): string {
  if (dias < 90) return 'Nuevo';
  if (dias < 365) return 'Junior';
  if (dias < 730) return 'Semi Sr';
  return 'Senior';
}

export function usd(value: number | null | undefined): string {
  if (value == null) return '—';
  const abs = Math.abs(value);
  if (abs >= 1000) return `${value < 0 ? '-' : ''}$${(abs / 1000).toFixed(1)}k`;
  return `${value < 0 ? '-' : ''}$${Math.round(abs)}`;
}

export function tendenciaBadge(t: Tendencia): { cls: string; icon: string; label: string } {
  switch (t) {
    case 'subiendo':       return { cls: 'ts-u', icon: '↑', label: 'Subiendo' };
    case 'bajando':        return { cls: 'ts-d', icon: '↓', label: 'Bajando' };
    case 'estable':        return { cls: 'ts-e', icon: '→', label: 'Estable' };
    case 'arrancando':     return { cls: 'ts-a', icon: '◐', label: 'Arrancando' };
    case 'sin actividad':  return { cls: 'ts-s', icon: '∅', label: 'Sin actividad' };
  }
}

export function cuadranteBadge(c: 'A' | 'B' | 'C' | 'D'): { cls: string; label: string } {
  return { cls: `pr-${c.toLowerCase()}`, label: `Cuad. ${c}` };
}

export function accionableBadge(a: string): { cls: string; label: string } {
  const map: Record<string, { cls: string; label: string }> = {
    irrecuperable:    { cls: 'ai',  label: '⛔ Irrecuperable' },
    revisar_urgente:  { cls: 'ar2', label: 'Revisar urgente' },
    dejar_mostrar:    { cls: 'ac2', label: '👻 Fantasmear' },
    potenciar:        { cls: 'ap',  label: 'Potenciar' },
    retencion:        { cls: 'at',  label: 'Retención' },
    cancelaciones:    { cls: 'ar2', label: 'Cancelaciones' },
    disponibilidad:   { cls: 'am2', label: 'Disponibilidad' },
    monitorear:       { cls: 'amo', label: 'Monitorear' },
    arrancando:       { cls: 'am2', label: 'Arrancando' },
  };
  return map[a] || { cls: 'amo', label: a };
}

export function rowClass(t: TherapistView): string {
  if (t.irrecuperable) return 'ri';
  if (t.accionable === 'dejar_mostrar') return 'ro';
  return '';
}
