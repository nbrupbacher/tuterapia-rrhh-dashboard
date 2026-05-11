'use client';

import type { TherapistView, PaisFilter } from '@/lib/types';
import { colorScore, usd } from '@/lib/helpers';

interface KpiSectionsProps {
  data: TherapistView[];
  pais: PaisFilter;
  onKpiClick: (filter: { acc?: string; sen?: string; tab?: string; vid?: boolean }) => void;
}

export function KpiSections({ data, pais, onKpiClick }: KpiSectionsProps) {
  const filtered = data.filter((r) => pais === 'T' || r.pais === pais);

  const nIrr = filtered.filter((r) => r.irrecuperable).length;
  const nRev = filtered.filter((r) => r.accionable === 'revisar_urgente').length;
  const nOc = filtered.filter((r) => r.score >= 70 && r.tendencia === 'bajando').length;
  const nAlerta = filtered.filter((r) => r.senal === 'alerta_arranque').length;
  const nAbandono = filtered.filter((r) => r.senal === 'abandono').length;
  const nVid = filtered.filter((r) => r.videollamada).length;

  const nSubiendo = filtered.filter((r) => r.tendencia === 'subiendo').length;
  const nBajando = filtered.filter((r) => r.tendencia === 'bajando').length;
  const totalGan = filtered.reduce((s, r) => s + (r.ganMes || 0), 0);

  const scores = filtered.map((r) => r.score || 0).sort((a, b) => a - b);
  const med = scores.length > 0 ? scores[Math.floor(scores.length / 2)] || 0 : 0;

  return (
    <>
      <div className="ks-lbl">Acción urgente</div>
      <div className="ks">
        <div className="k" onClick={() => onKpiClick({ acc: 'irrecuperable' })}>
          <div className="kv" style={{ color: '#f87171' }}>{nIrr}</div>
          <div className="kl">Irrecuperables</div>
        </div>
        <div className="k" onClick={() => onKpiClick({ acc: 'revisar_urgente' })}>
          <div className="kv" style={{ color: 'var(--r)' }}>{nRev}</div>
          <div className="kl">Revisar urgente</div>
        </div>
        <div className="k" onClick={() => onKpiClick({ tab: 'OC' })}>
          <div className="kv" style={{ color: 'var(--am)' }}>{nOc}</div>
          <div className="kl">Alerta oculta</div>
        </div>
        <div className="k" onClick={() => onKpiClick({ sen: 'alerta_arranque' })}>
          <div className="kv" style={{ color: 'var(--am)' }}>{nAlerta}</div>
          <div className="kl">Alerta arranque</div>
        </div>
        <div className="k" onClick={() => onKpiClick({ sen: 'abandono' })}>
          <div className="kv" style={{ color: 'var(--r)' }}>{nAbandono}</div>
          <div className="kl">Abandono</div>
        </div>
        <div className="k" style={{ borderColor: 'rgba(56,189,248,.3)' }} onClick={() => onKpiClick({ vid: true })}>
          <div className="kv" style={{ color: '#38bdf8' }}>{nVid}</div>
          <div className="kl" style={{ color: '#38bdf8' }}>📞 Videollamada</div>
        </div>
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
      </div>
    </>
  );
}
