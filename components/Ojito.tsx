import type { TherapistView } from '@/lib/types';

/**
 * El ojito de la matriz mensual (components/DashboardTable.tsx), para usar al
 * lado del nombre del psicólogo/a en En vivo (pedido de Talent, 2026-11-16).
 * Aparece si tiene una intervención activa o notas del equipo; al pasar el
 * mouse dice cuál de las dos. Mismo dibujo y mismo criterio que la matriz.
 */
export function Ojito({ t }: { t?: Pick<TherapistView, 'intervencion' | 'hasNotas'> | null }) {
  if (!t || (!t.intervencion && !t.hasNotas)) return null;
  const title = [t.intervencion ? 'Intervención activa' : '', t.hasNotas ? 'Tiene notas' : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <span
      title={title}
      aria-label={title}
      style={{ display: 'inline-block', marginLeft: 5, verticalAlign: 'middle', color: 'var(--t2)', opacity: 0.55, lineHeight: 1 }}
    >
      <svg width="11" height="11" viewBox="0 0 20 20" fill="none" style={{ display: 'block' }}>
        <path d="M1 10s3.5-7 9-7 9 7 9 7-3.5 7-9 7-9-7-9-7z" stroke="currentColor" strokeWidth="1.8" fill="none" />
        <circle cx="10" cy="10" r="3" stroke="currentColor" strokeWidth="1.8" fill="none" />
      </svg>
    </span>
  );
}
