// ============================================================
// Deltas (variación vs período anterior)
// ============================================================
export interface Delta {
  label: string;
  color: string;
  icon: '↑' | '↓' | '→';
}

export function formatDelta(actual: number, anterior: number | null, isPercent = false): Delta | null {
  if (anterior == null || anterior === 0) return null;
  const diff = actual - anterior;
  const pct = (diff / Math.abs(anterior)) * 100;
  if (Math.abs(pct) < 0.5) return { label: '0%', color: 'var(--t3)', icon: '→' };
  if (pct > 0) {
    return {
      label: `+${Math.abs(pct).toFixed(0)}%`,
      color: 'var(--v)',
      icon: '↑',
    };
  } else {
    return {
      label: `-${Math.abs(pct).toFixed(0)}%`,
      color: 'var(--r)',
      icon: '↓',
    };
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
