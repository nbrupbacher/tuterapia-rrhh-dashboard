'use client';

import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter } from '@/lib/types';

interface MonthSummary {
  month: string;
  label: string;
  A: number; B: number; C: number; D: number;
  irr: number;
  gan: number;
  sp: number;
}

const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MESES_CORTOS[m-1]} ${String(y).slice(-2)}`;
}

interface Props { pais: PaisFilter; }

export function ProgressView({ pais }: Props) {
  const [data, setData] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const sb = getSupabase();
      const { data: months } = await sb
        .from('therapist_state')
        .select('month')
        .order('month', { ascending: true });
      if (!months || !mounted) return;
      const uniqueMonths = Array.from(new Set(months.map((m: any) => m.month))) as string[];

      let countryIds: Set<string> | null = null;
      if (pais !== 'T') {
        const { data: th } = await sb.from('therapists').select('id').eq('pais', pais);
        countryIds = new Set((th || []).map((t: any) => t.id));
      }

      const results: MonthSummary[] = [];
      for (const m of uniqueMonths) {
        const { data: rows } = await sb
          .from('therapist_state')
          .select('cuadrante, irrecuperable, gan_mes, ses_paciente_3m, therapist_id')
          .eq('month', m);
        if (!rows) continue;
        const filtered = countryIds ? rows.filter((r: any) => countryIds!.has(r.therapist_id)) : rows;

        results.push({
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
        });
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
  if (data.length === 0) return <div className="empty-wrap"><h3>📊 Sin datos históricos</h3></div>;

  const isOneMonth = data.length === 1;

  return (
    <div>
      {isOneMonth && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--am)', borderLeft: '3px solid var(--am)', borderRadius: 8, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: 'var(--t2)' }}>
          📊 Solo hay <strong style={{ color: 'var(--t)' }}>1 mes</strong> de datos cargado ({data[0].label}). Las tendencias se van a poder ver mejor cuando cargues Abril 26.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16, maxWidth: 1100, margin: '0 auto' }}>
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
    tickLines.push({ yc: yP(yv), label: formatY ? formatY(yv) : `${Math.round(yv)}` });
  }

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 10, padding: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--t2)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 }}>
        {title}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" style={{ width: '100%', height: H }}>
        {tickLines.map((t, i) => (
          <g key={`tick-${i}`}>
            <line x1={PL} y1={t.yc} x2={W - PR} y2={t.yc} stroke="var(--bd)" strokeWidth="0.5" />
            <text x={PL - 4} y={t.yc + 4} textAnchor="end" fontSize="9" fill="var(--t3)">{t.label}</text>
          </g>
        ))}
        {labels.map((l, i) => (
          (n <= 8 || i % Math.ceil(n / 6) === 0) ? (
            <text key={`xl-${i}`} x={xP(i)} y={H - 6} textAnchor="middle" fontSize="9" fill="var(--t3)">{l}</text>
          ) : null
        ))}
        {series.map((s, si) => {
          if (s.bars) {
            const barW = Math.max(8, Math.min(36, (cW / Math.max(n, 1)) * 0.5));
            return (
              <g key={`bars-${si}`}>
                {s.data.map((v, i) => {
                  if (v == null) return null;
                  const bH = Math.abs(yP(0) - yP(v));
                  const by = v >= 0 ? yP(v) : yP(0);
                  const col = v >= 0 ? 'var(--v)' : 'var(--r)';
                  return (
                    <g key={`bar-${i}`}>
                      <rect x={xP(i) - barW / 2} y={by} width={barW} height={bH} fill={col} rx="2" opacity="0.85" />
                      {n <= 4 && (
                        <text x={xP(i)} y={by - 4} textAnchor="middle" fontSize="10" fill={col}>
                          {formatY ? formatY(v) : v}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          }
          // Líneas o puntos
          const validPts = s.data.map((v, i) => v != null ? { x: xP(i), y: yP(v), v, i } : null).filter(Boolean) as { x: number; y: number; v: number; i: number }[];
          if (validPts.length === 0) return null;
          // Si hay 1 solo punto, dibujar un círculo grande con su valor encima
          if (validPts.length === 1) {
            const p = validPts[0];
            return (
              <g key={`pt-${si}`}>
                <circle cx={p.x} cy={p.y} r="5" fill={s.color} />
                <text x={p.x} y={p.y - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill={s.color}>
                  {formatY ? formatY(p.v) : p.v}
                </text>
              </g>
            );
          }
          // ≥ 2 puntos: línea + área opcional
          const pts = validPts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`);
          return (
            <g key={`line-${si}`}>
              {s.fill && (
                <polygon
                  points={[...pts, `${validPts[validPts.length - 1].x.toFixed(1)},${PT + cH}`, `${validPts[0].x.toFixed(1)},${PT + cH}`].join(' ')}
                  fill={s.color}
                  opacity="0.08"
                />
              )}
              <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {validPts.map((p) => (
                <circle key={`dot-${p.i}`} cx={p.x} cy={p.y} r="3" fill={s.color} />
              ))}
              {n <= 10 && validPts.map((p) => (
                <text key={`val-${p.i}`} x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9" fill={s.color}>
                  {formatY ? formatY(p.v) : Math.round(p.v)}
                </text>
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
