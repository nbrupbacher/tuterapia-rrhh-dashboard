'use client';

import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter } from '@/lib/types';

interface MonthSummary {
  month: string;        // YYYY-MM
  label: string;        // 'Ene 26'
  A: number; B: number; C: number; D: number;
  irr: number;
  gan: number;          // suma de ganancias del mes
  sp: number;           // promedio sesPaciente3m
  nuevos: number;
}

const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MESES_CORTOS[m-1]} ${String(y).slice(-2)}`;
}

interface Props {
  pais: PaisFilter;
}

export function ProgressView({ pais }: Props) {
  const [data, setData] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const sb = getSupabase();
      // 1. Listar todos los meses únicos en therapist_state
      const { data: months } = await sb
        .from('therapist_state')
        .select('month')
        .order('month', { ascending: true });
      if (!months || !mounted) return;
      const uniqueMonths = Array.from(new Set(months.map((m: any) => m.month))) as string[];

      // 2. Para cada mes, sacar las stats agregadas
      const results: MonthSummary[] = [];
      for (const m of uniqueMonths) {
        let q = sb.from('therapist_state').select('cuadrante, irrecuperable, gan_mes, ses_paciente_3m, therapist_id').eq('month', m);
        const { data: rows } = await q;
        if (!rows) continue;

        // Filtrar por país si corresponde
        let filtered = rows;
        if (pais !== 'T') {
          const { data: th } = await sb.from('therapists').select('id, pais').eq('pais', pais);
          const ids = new Set((th || []).map((t: any) => t.id));
          filtered = rows.filter((r: any) => ids.has(r.therapist_id));
        }

        const summary: MonthSummary = {
          month: m,
          label: monthLabel(m),
          A: filtered.filter((r: any) => r.cuadrante === 'A').length,
          B: filtered.filter((r: any) => r.cuadrante === 'B').length,
          C: filtered.filter((r: any) => r.cuadrante === 'C').length,
          D: filtered.filter((r: any) => r.cuadrante === 'D').length,
          irr: filtered.filter((r: any) => r.irrecuperable).length,
          gan: filtered.reduce((s: number, r: any) => s + (Number(r.gan_mes) || 0), 0),
          sp: (() => {
            const valid = filtered.filter((r: any) => r.ses_paciente_3m != null && r.ses_paciente_3m > 0);
            if (!valid.length) return 0;
            return valid.reduce((s: number, r: any) => s + Number(r.ses_paciente_3m), 0) / valid.length;
          })(),
          nuevos: 0,
        };
        results.push(summary);
      }
      if (mounted) {
        setData(results);
        setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [pais]);

  if (loading) return <div className="empty-wrap"><p>Cargando histórico…</p></div>;
  if (data.length === 0) return <div className="empty-wrap"><h3>📊 Sin datos históricos</h3><p>Cargá más meses para ver tendencias.</p></div>;

  return (
    <div>
      <div className="prog-grid">
        <ProgCard title="Distribución de cuadrantes" series={[
          { name: 'A', color: 'var(--v)', data: data.map(d => d.A) },
          { name: 'B', color: '#c084fc', data: data.map(d => d.B) },
          { name: 'C', color: '#38bdf8', data: data.map(d => d.C) },
          { name: 'D', color: 'var(--am)', data: data.map(d => d.D) },
        ]} labels={data.map(d => d.label)} legend />

        <ProgCard title="⛔ Irrecuperables por mes" series={[
          { name: 'Irr', color: 'var(--r)', data: data.map(d => d.irr), fill: true },
        ]} labels={data.map(d => d.label)} />

        <ProgCard title="Ganancia mensual Tu Terapia (USD)" series={[
          { name: 'Gan', color: 'var(--v)', data: data.map(d => Math.round(d.gan)), bars: true },
        ]} labels={data.map(d => d.label)} formatY={(v) => v >= 1000 ? `$${(v/1000).toFixed(0)}k` : `$${Math.round(v)}`} />

        <ProgCard title="Prom. sesiones por paciente (3m)" series={[
          { name: 'sp', color: '#a78bfa', data: data.map(d => Number(d.sp.toFixed(2))), fill: true },
        ]} labels={data.map(d => d.label)} formatY={(v) => v.toFixed(1)} note="Umbral retención: 2.0" />
      </div>
    </div>
  );
}

interface Series {
  name: string;
  color: string;
  data: number[];
  fill?: boolean;
  bars?: boolean;
}

function ProgCard({ title, series, labels, legend, formatY, note }: {
  title: string;
  series: Series[];
  labels: string[];
  legend?: boolean;
  formatY?: (v: number) => string;
  note?: string;
}) {
  const W = 440, H = 180, PL = 38, PR = 12, PT = 10, PB = 28;
  const cW = W - PL - PR, cH = H - PT - PB;
  const allVals = series.flatMap(s => s.data).filter(v => v != null && !isNaN(v));
  let yMin = allVals.length ? Math.min(...allVals) : 0;
  let yMax = allVals.length ? Math.max(...allVals) : 1;
  if (yMin > 0) yMin = 0;
  if (yMax === yMin) yMax = yMin + 1;
  const n = labels.length;
  const xP = (i: number) => PL + (n > 1 ? (i * cW) / (n - 1) : cW / 2);
  const yP = (v: number) => PT + cH - ((v - yMin) / (yMax - yMin)) * cH;

  const ticks = 4;
  const tickLines = [];
  for (let t = 0; t <= ticks; t++) {
    const yv = yMin + ((yMax - yMin) * t) / ticks;
    const yc = yP(yv);
    tickLines.push({ yc, label: formatY ? formatY(yv) : `${Math.round(yv)}` });
  }

  const barW = series.length === 1 && series[0].bars ? Math.max(4, Math.min(24, (cW / n) * 0.6)) : 0;

  return (
    <div className="prog-card">
      <div className="prog-title">{title}</div>
      <svg viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: H }}>
        {tickLines.map((t, i) => (
          <g key={i}>
            <line x1={PL} y1={t.yc} x2={W - PR} y2={t.yc} stroke="var(--bd)" strokeWidth="0.5" />
            <text x={PL - 4} y={t.yc + 4} textAnchor="end" fontSize="9" fill="var(--t3)">{t.label}</text>
          </g>
        ))}
        {labels.map((l, i) => (
          (n <= 8 || i % Math.ceil(n / 6) === 0) && (
            <text key={i} x={xP(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--t3)">{l}</text>
          )
        ))}
        {series.map((s, si) => {
          if (s.bars) {
            return s.data.map((v, i) => {
              if (v == null) return null;
              const bH = Math.abs(yP(0) - yP(v));
              const by = v >= 0 ? yP(v) : yP(0);
              const col = v >= 0 ? 'var(--v)' : 'var(--r)';
              return <rect key={i} x={xP(i) - barW / 2} y={by} width={barW} height={bH} fill={col} rx="2" opacity="0.85" />;
            });
          }
          const pts = s.data.map((v, i) => v != null ? `${xP(i).toFixed(1)},${yP(v).toFixed(1)}` : null).filter(Boolean) as string[];
          if (pts.length < 2) return null;
          return (
            <g key={si}>
              {s.fill && (
                <polygon
                  points={[...pts, `${xP(s.data.length - 1).toFixed(1)},${PT + cH}`, `${PL},${PT + cH}`].join(' ')}
                  fill={s.color}
                  opacity="0.08"
                />
              )}
              <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {s.data.map((v, i) => v != null && (
                <circle key={i} cx={xP(i)} cy={yP(v)} r="3" fill={s.color} />
              ))}
            </g>
          );
        })}
      </svg>
      {legend && (
        <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
          {series.map(s => (
            <span key={s.name} style={{ fontSize: 11, color: s.color }}>● {s.name}</span>
          ))}
        </div>
      )}
      {note && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--t3)' }}>{note}</div>}
    </div>
  );
}
