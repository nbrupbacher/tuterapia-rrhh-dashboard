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
  spAvgMes: number | null;
}

interface Props {
  data: TherapistView[];
  prevStats: PrevStats;
}

export function KpiDeltas({ data, prevStats }: Props) {
  if (!data.length) return null;

  const scoreAvg = data.reduce((s, t) => s + t.score, 0) / data.length;
  const ganTotal = data.reduce((s, t) => s + (t.ganMes || 0), 0);
  
  // Prom. sesiones/paciente MENSUAL = total sesiones del mes / total pacientes del mes
  // (no promedio de promedios, evita sesgo por terapeutas con 1 paciente)
  const totSes = data.reduce((s, t) => s + (t.sesMes ?? 0), 0);
  const totPac = data.reduce((s, t) => s + (t.pacMes ?? 0), 0);
  const spMensual = totPac > 0 ? totSes / totPac : 0;

  const scoreDelta = formatDeltaAbs(scoreAvg, prevStats.scoreAvg, (n) => `${n > 0 ? '+' : ''}${n.toFixed(0)} pts`);
  const ganDelta = formatDeltaMoney(ganTotal, prevStats.ganTotal);
  const spDelta = formatDeltaAbs(spMensual, prevStats.spAvgMes, (n) => n.toFixed(2));

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
          label="Prom. ses/paciente"
          value={spMensual.toFixed(2)}
          valueColor={colorSesPaciente(spMensual)}
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
