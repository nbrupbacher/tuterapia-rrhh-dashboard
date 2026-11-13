'use client';

import { useEffect, useState, type CSSProperties } from 'react';
import { getSupabase } from '@/lib/supabase';
import {
  calcularTendencia,
  desdeTendencia,
  explicarPorque,
  TEXTO_PORQUE,
  type Tendencia,
} from '@/lib/en-vivo-tendencia';

/**
 * Gráficos de la tendencia de sesiones (reglas en lib/en-vivo-tendencia.ts):
 * las barritas de En vivo → Todos los psicólogos y la tarjeta del perfil.
 */

export const TENDENCIA = { sig: 'var(--ac)', nue: 'var(--v)' };

/** % y "antes → ahora", con la flecha del color de la tendencia. */
export function CeldaTendencia({ t }: { t: Tendencia }) {
  if (t.tipo === 'sin') return <span style={{ color: 'var(--t3)' }}>—</span>;
  const color = t.tipo === 'sube' ? 'var(--v)' : t.tipo === 'baja' ? 'var(--r)' : t.tipo === 'nuevo' ? 'var(--ac)' : 'var(--t2)';
  const icono = t.tipo === 'sube' ? '↑' : t.tipo === 'baja' ? '↓' : t.tipo === 'nuevo' ? '✦' : '→';
  return (
    <span style={{ color }}>
      {icono} {t.pct == null ? 'nuevo' : `${t.pct > 0 ? '+' : ''}${t.pct}%`}
      <small>{t.antes} → {t.ahora}</small>
    </span>
  );
}

/**
 * 8 barras semanales apiladas (los que siguen abajo, los nuevos arriba): las 4
 * anteriores claras y las 4 últimas fuertes. Al final, punteada, lo agendado
 * para los próximos 7 días.
 */
export function BarrasTendencia({ t, prox7, tope, alto = 22, paso = 16, ancho = 11 }: { t: Tendencia; prox7: number; tope: number; alto?: number; paso?: number; ancho?: number }) {
  const H = alto;
  const n = t.semanas.length;
  const W = (n + 1) * paso + 4;
  const h = (v: number) => (v ? Math.max(1, Math.round((Math.min(v, tope) / tope) * H)) : 0);
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {t.semanas.map((s, i) => {
        const hs = h(s.sig);
        const hn = Math.min(H - hs, h(s.nue));
        const x = i * paso + (i >= n / 2 ? 4 : 0);
        const op = i < n / 2 ? 0.4 : 1;
        return (
          <g key={s.desde} opacity={op}>
            <title>{`Semana del ${s.desde.slice(8, 10)}/${s.desde.slice(5, 7)}: ${s.sig} de pacientes que siguen, ${s.nue} de nuevos`}</title>
            <rect x={x} y={H - 1} width={ancho} height={1} fill="var(--bg4)" />
            {hs > 0 && <rect x={x} y={H - hs} width={ancho} height={hs} fill={TENDENCIA.sig} />}
            {hn > 0 && <rect x={x} y={H - hs - hn} width={ancho} height={hn} fill={TENDENCIA.nue} />}
          </g>
        );
      })}
      <rect
        x={n * paso + 4.5}
        y={H - Math.max(1, h(prox7)) + 0.5}
        width={ancho - 1}
        height={Math.max(1, h(prox7)) - 1}
        fill="none"
        stroke="var(--t2)"
        strokeDasharray="2 2"
      >
        <title>{`Agendadas próximos 7 días: ${prox7}`}</title>
      </rect>
    </svg>
  );
}

/** 'YYYY-MM-DD' de hoy en hora local (UTC−3). */
function hoyLocal(): string {
  return new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Perfil → "Hoy en la plataforma": sesiones por semana de las últimas 8
 * semanas, con el resumen arriba ("↓ 28% · 25 → 18") y el porqué.
 * Va a lo ancho, dentro de la grilla de PerfilHoy (usa sus clases ph-*).
 */
export function PerfilTendencia({ therapistId }: { therapistId: string }) {
  const [t, setT] = useState<Tendencia | null>(null);
  const [prox7, setProx7] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setT(null);
    setError(null);
    (async () => {
      try {
        const sb = getSupabase();
        const hoy = hoyLocal();
        const [d, ter] = await Promise.all([
          sb
            .from('en_vivo_diario')
            .select('dia, realizadas, realizadas_nuevos')
            .eq('therapist_id', therapistId)
            .gte('dia', desdeTendencia(hoy))
            .lt('dia', hoy),
          sb.from('en_vivo_terapeuta').select('agendadas_7d').eq('therapist_id', therapistId).maybeSingle(),
        ]);
        if (d.error) throw d.error;
        if (!vivo) return;
        setT(calcularTendencia((d.data ?? []) as { dia: string; realizadas: number; realizadas_nuevos: number | null }[], hoy));
        setProx7(Number((ter.data as { agendadas_7d?: number } | null)?.agendadas_7d ?? 0));
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [therapistId]);

  const color = !t ? 'var(--t3)' : t.tipo === 'sube' ? 'var(--v)' : t.tipo === 'baja' ? 'var(--r)' : t.tipo === 'nuevo' ? 'var(--ac)' : 'var(--t2)';
  const icono = !t ? '' : t.tipo === 'sube' ? '↑' : t.tipo === 'baja' ? '↓' : t.tipo === 'nuevo' ? '✦' : '→';
  const titulo = !t
    ? '—'
    : t.tipo === 'sin'
      ? 'Sin sesiones'
      : t.pct == null
        ? 'Nuevo/a'
        : t.tipo === 'estable'
          ? `Estable (${t.pct > 0 ? '+' : ''}${t.pct}%)`
          : `${t.pct > 0 ? '+' : ''}${t.pct}%`;
  const frase = t ? explicarPorque(t) : null;

  return (
    <div className="ph-card" style={{ gridColumn: '1 / -1', ['--c' as string]: color } as CSSProperties}>
      <div className="ph-top" style={{ flexWrap: 'wrap' }}>
        <span className="ph-num">{icono} {titulo}</span>
        {t && t.tipo !== 'sin' && (
          <span className="ph-lbl">
            sesiones: <b style={{ color: 'var(--t)' }}>{t.antes} → {t.ahora}</b> · últimas 4 semanas contra las 4 anteriores
          </span>
        )}
      </div>
      {error ? (
        <div className="ph-vacio" style={{ color: 'var(--r)' }}>No se pudo cargar: {error}</div>
      ) : !t ? (
        <div className="ph-vacio">Cargando…</div>
      ) : (
        <>
          {(t.porque || frase) && (
            <div className="ph-chips">
              {t.porque && <span className="ph-chip"><b>{TEXTO_PORQUE[t.porque]}</b></span>}
              {frase && <span className="ph-sub" style={{ marginTop: 0 }}>{frase}</span>}
            </div>
          )}
          <GraficoSemanas t={t} prox7={prox7} />
          <div className="ph-sub" style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 10.5 }}>
            <span><i style={leyenda(TENDENCIA.sig)} />Pacientes que siguen</span>
            <span><i style={leyenda(TENDENCIA.nue)} />Pacientes nuevos (primeras 4 semanas)</span>
            <span><i style={{ ...leyenda('transparent'), border: '1px dashed var(--t2)' }} />Agendadas próx. 7 días</span>
          </div>
        </>
      )}
    </div>
  );
}

function leyenda(bg: string): CSSProperties {
  return { display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: bg, marginRight: 4, verticalAlign: -1 };
}

/** Versión grande de las barritas, con el total arriba y la fecha abajo. */
function GraficoSemanas({ t, prox7 }: { t: Tendencia; prox7: number }) {
  const H = 70;
  const paso = 40;
  const ancho = 26;
  const n = t.semanas.length;
  const tope = Math.max(4, prox7, ...t.semanas.map((s) => s.sig + s.nue));
  const h = (v: number) => (v ? Math.max(2, Math.round((v / tope) * H)) : 0);
  const top = 14;
  const W = (n + 1) * paso + 8;
  const x = (i: number) => i * paso + (i >= n / 2 ? 8 : 0);
  return (
    <svg viewBox={`0 0 ${W} ${top + H + 16}`} width="100%" style={{ maxWidth: W, display: 'block', marginTop: 8 }}>
      <line x1={x(n / 2) - 6} x2={x(n / 2) - 6} y1={0} y2={top + H} stroke="var(--bd2)" strokeDasharray="3 3" />
      {t.semanas.map((s, i) => {
        const hs = h(s.sig);
        const hn = h(s.nue);
        const y0 = top + H;
        return (
          <g key={s.desde} opacity={i < n / 2 ? 0.45 : 1}>
            <title>{`Semana del ${s.desde.slice(8, 10)}/${s.desde.slice(5, 7)}: ${s.sig} de pacientes que siguen, ${s.nue} de nuevos`}</title>
            <rect x={x(i)} y={y0 - 1} width={ancho} height={1} fill="var(--bg4)" />
            {hs > 0 && <rect x={x(i)} y={y0 - hs} width={ancho} height={hs} rx={2} fill={TENDENCIA.sig} />}
            {hn > 0 && <rect x={x(i)} y={y0 - hs - hn} width={ancho} height={hn} rx={2} fill={TENDENCIA.nue} />}
            <text x={x(i) + ancho / 2} y={y0 - hs - hn - 3} textAnchor="middle" fontSize="10" fill="var(--t2)" fontFamily="var(--m)">
              {s.sig + s.nue}
            </text>
            <text x={x(i) + ancho / 2} y={y0 + 12} textAnchor="middle" fontSize="9" fill="var(--t3)">
              {`${s.desde.slice(8, 10)}/${s.desde.slice(5, 7)}`}
            </text>
          </g>
        );
      })}
      <g>
        <title>{`Agendadas próximos 7 días: ${prox7}`}</title>
        <rect x={x(n) + 0.5} y={top + H - Math.max(2, h(prox7)) + 0.5} width={ancho - 1} height={Math.max(2, h(prox7)) - 1} rx={2} fill="none" stroke="var(--t2)" strokeDasharray="3 2" />
        <text x={x(n) + ancho / 2} y={top + H - Math.max(2, h(prox7)) - 3} textAnchor="middle" fontSize="10" fill="var(--t2)" fontFamily="var(--m)">
          {prox7}
        </text>
        <text x={x(n) + ancho / 2} y={top + H + 12} textAnchor="middle" fontSize="9" fill="var(--t3)">próx. 7d</text>
      </g>
    </svg>
  );
}
