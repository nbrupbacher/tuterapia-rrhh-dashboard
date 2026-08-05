'use client';

import type { TherapistView, PaisFilter } from '@/lib/types';
import { colorScore, usd } from '@/lib/helpers';
import { ACCIONES } from '@/lib/constants-matrix';
import type { AccionId } from '@/lib/constants-matrix';

interface KpiSectionsProps {
  data: TherapistView[];
  pais: PaisFilter;
  // Cuando se clickea un KPI: filtrar por acción o por tab
  onKpiClick: (filter: { accion?: AccionId; tab?: string }) => void;
}

// Definición visual de cada tarjeta de "Acciones del mes"
const KPI_ACCIONES: {
  id: AccionId;
  label: string;
  icon: string;
  color: string;       // color del número
  borderColor: string; // color del borde
}[] = [
  { id: 'evaluar_continuidad', label: 'Evaluar continuidad', icon: '🚨', color: '#ff7676', borderColor: 'rgba(240,82,82,.35)' },
  { id: 'whatsapp',            label: 'WhatsApp',             icon: '📱', color: '#ffa872', borderColor: 'rgba(255,140,80,.3)' },
  { id: 'meet',                label: 'Meet',                 icon: '📞', color: '#38bdf8', borderColor: 'rgba(56,189,248,.3)' },
  { id: 'retencion',           label: 'Retención',            icon: '✉️', color: 'var(--am)', borderColor: 'rgba(245,166,35,.28)' },
  { id: 'fantasmear',          label: 'Fantasmear',           icon: '👻', color: 'var(--ar)', borderColor: 'rgba(167,139,250,.28)' },
  { id: 'destacado',           label: 'Destacado',            icon: '⭐', color: 'var(--v)',  borderColor: 'rgba(52,211,153,.25)' },
];

export function KpiSections({ data, pais, onKpiClick }: KpiSectionsProps) {
  const filtered = data.filter((r) => pais === 'T' || r.pais === pais);

  // Contar terapeutas por acción
  const contarPorAccion = (accion: AccionId) =>
    filtered.filter((r) => r.accion === accion).length;

  // Estado del mes (sin cambios respecto al modelo viejo)
  const nSubiendo = filtered.filter((r) => r.tendencia === 'subiendo').length;
  const nBajando = filtered.filter((r) => r.tendencia === 'bajando').length;
  const totalGan = filtered.reduce((s, r) => s + (r.ganMes || 0), 0);
  const totalPac = filtered.reduce((s, r) => s + (r.pacMes || 0), 0);
  const scores = filtered.map((r) => r.score || 0).sort((a, b) => a - b);
  const med = scores.length > 0 ? scores[Math.floor(scores.length / 2)] || 0 : 0;

  return (
    <>
      <div className="ks-lbl">Acciones del mes</div>
      <div className="ks">
        {KPI_ACCIONES.map((k) => {
          const count = contarPorAccion(k.id);
          return (
            <div
              key={k.id}
              className="k"
              style={{ borderColor: k.borderColor }}
              onClick={() => onKpiClick({ accion: k.id })}
            >
              <div className="kv" style={{ color: k.color }}>{count}</div>
              <div className="kl" style={{ color: k.color }}>{k.icon} {k.label}</div>
            </div>
          );
        })}
      </div>

      <div className="div" />

      <div className="ks-lbl">Estado del mes</div>
      <div className="ks">
        <div className="k" onClick={() => onKpiClick({ tab: 'T' })}>
          <div className="kv" style={{ color: 'var(--ac)' }}>{filtered.length}</div>
          <div className="kl">Terapeutas</div>
        </div>
        <div className="k">
          <div className="kv" style={{ color: 'var(--v)' }}>{nSubiendo}</div>
          <div className="kl">Subiendo</div>
        </div>
        <div className="k">
          <div className="kv" style={{ color: 'var(--r)' }}>{nBajando}</div>
          <div className="kl">Bajando</div>
        </div>
        <div className="k">
          <div className="kv" style={{ color: colorScore(med) }}>{med}</div>
          <div className="kl">Score mediana</div>
        </div>
        <div className="k">
          <div className="kv" style={{ color: 'var(--v)', fontSize: 15 }}>{usd(totalGan)}</div>
          <div className="kl">Ganancia mes</div>
        </div>
        <div className="k">
          <div className="kv" style={{ color: 'var(--ac)' }}>{totalPac}</div>
          <div className="kl">Pacientes totales</div>
        </div>
      </div>
    </>
  );
}
