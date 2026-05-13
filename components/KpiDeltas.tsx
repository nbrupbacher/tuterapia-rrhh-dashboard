'use client';

import type { TherapistView } from '@/lib/types';
import {
  formatDeltaAbs, formatDeltaMoney, usd,
  colorScore, colorSesPaciente,
  type Delta,
} from '@/lib/helpers';

interface PrevStats {
  scoreAvg: number | null;
  ganTotal: number | null;
  spAvg: number | null;
}

interface Props {
  data: TherapistView[];
  prevStats: PrevStats;
}

export function KpiDeltas({ data, prevStats }: Props) {
  if (!data.length) return null;

  const scoreAvg = data.reduce((s, t) => s + t.score, 0) / data.length;
  const ganTotal = data.reduce((s, t) => s + (t.ganMes || 0), 0);
  const spValid = data.filter(t => t.sesPaciente3m > 0);
  const spAvg = spValid.length ? spValid.reduce((s, t) => s + t.sesPaciente3m, 0) / spValid.length : 0;

  // Score: delta absoluto en puntos
  const scoreDelta = formatDeltaAbs(scoreAvg, prevStats.scoreAvg, (n) => `${n > 0 ? '+' : ''}${n.toFixed(0)} pts`);
  // Ganancia: delta en plata (USD)
  const ganDelta = formatDeltaMoney(ganTotal, prevStats.ganTotal);
  // Prom.ses: delta absoluto en valor
  const spDelta = formatDeltaAbs(spAvg, prevStats.spAvg, (n) => n.toFixed(2));

  return (
    <>
      <div className="ks-lbl">Resumen del mes</div>
      <div className="ks">
        <DeltaCard
          label="Score promedio"
          value={scoreAvg.toFixed(0)}
          valueColor={colorScore(scoreAvg)}
          delta={scoreDelta}
        />
        <DeltaCard
          label="Ganancia total"
          value={usd(ganTotal).replace('+', '')}
          valueColor={ganTotal >= 0 ? 'var(--v)' : 'var(--r)'}
          delta={ganDelta}
        />
        <DeltaCard
          label="Prom. ses/paciente 3m"
          value={spAvg.toFixed(2)}
          valueColor={colorSesPaciente(spAvg)}
          delta={spDelta}
        />
      </div>
      <div className="div" />
    </>
  );
}

interface DeltaCardProps {
  label: string;
  value: string;
  valueColor: string;
  delta: Delta | null;
}

function DeltaCard({ label, value, valueColor, delta }: DeltaCardProps) {
  return (
    <div className="k" style={{ cursor: 'default' }}>
      <div className="kv" style={{ color: valueColor }}>{value}</div>
      <div className="kl">{label}</div>
      {delta ? (
        <div className="kd" style={{ color: delta.color }}>
          {delta.icon} {delta.label} <span style={{ color: 'var(--t3)' }}>vs mes ant.</span>
        </div>
      ) : (
        <div className="kd kd-e">— sin comparativa</div>
      )}
    </div>
  );
}
