'use client';

import type { TherapistView } from '@/lib/types';
import {
  formatDeltaAbs, formatDeltaMoney, usd,
  colorScore, colorSesPaciente, pctCaida1ra, colorPctCaida1ra,
  type Delta,
} from '@/lib/helpers';

interface PrevStats {
  scoreAvg: number | null;
  ganTotal: number | null;
  spAvgMes: number | null;
  pacAvg: number | null;
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

  const pacAvg = data.length > 0 ? totPac / data.length : 0;

  // Promedio de % de caída en 1ra sesión: solo sobre terapeutas con muestra
  // suficiente (mismo criterio que la Matrix), para no diluir el promedio
  // con "sin datos" tratado como 0%.
  const pctValues = data.map((t) => pctCaida1ra(t).value).filter((v): v is number => v != null);
  const pctAvg = pctValues.length > 0 ? pctValues.reduce((s, v) => s + v, 0) / pctValues.length : null;

  const scoreDelta = formatDeltaAbs(scoreAvg, prevStats.scoreAvg, (n) => `${n > 0 ? '+' : ''}${n.toFixed(0)} pts`);
  const ganDelta = formatDeltaMoney(ganTotal, prevStats.ganTotal);
  const spDelta = formatDeltaAbs(spMensual, prevStats.spAvgMes, (n) => n.toFixed(2));
  const pacDelta = formatDeltaAbs(pacAvg, prevStats.pacAvg, (n) => `${n > 0 ? '+' : ''}${n.toFixed(1)}`);

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
        <DeltaCard
          label="Prom. pac. activos/psic."
          value={pacAvg.toFixed(1)}
          valueColor="var(--ac)"
          delta={pacDelta}
        />
        <DeltaCard
          label="Prom. caída 1ra ses."
          value={pctAvg != null ? `${pctAvg.toFixed(1)}%` : '—'}
          valueColor={pctAvg != null ? colorPctCaida1ra(pctAvg) : 'var(--t3)'}
          delta={null}
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
