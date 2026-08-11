'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

type NovedadTipo =
  | 'nuevos'
  | 'subio_pacientes'
  | 'bajo_pacientes'
  | 'alta_conversion'
  | 'total_activos';

interface NovedadRecord {
  tipo: NovedadTipo;
  therapist_id: string | null;
  nombre: string | null;
  pais: string | null;
  valor_actual: number | null;
  valor_previo: number | null;
  delta: number | null;
  registros: number | null;
  conversiones: number | null;
  orden: number;
}

function formatNovedad(r: NovedadRecord): string {
  const n = (v: number | null) => Math.round(v ?? 0);
  switch (r.tipo) {
    case 'nuevos': {
      const c = n(r.valor_actual);
      const pais = r.pais ? ` (${r.pais})` : '';
      return `🆕 ${c} ${c === 1 ? 'psicólogo nuevo' : 'psicólogos nuevos'} este mes${pais}`;
    }
    case 'subio_pacientes': {
      return `📈 ${r.nombre} sumó +${n(r.delta)} pacientes vs. el mes pasado`;
    }
    case 'bajo_pacientes': {
      return `📉 ${r.nombre} bajó −${Math.abs(n(r.delta))} pacientes vs. el mes pasado`;
    }
    case 'alta_conversion': {
      const pct = r.valor_actual?.toFixed(1) ?? '0';
      return `🎯 ${r.nombre} convirtió ${pct}% (${r.conversiones} de ${r.registros} registros)`;
    }
    case 'total_activos': {
      const total = n(r.valor_actual);
      const fmt = total.toLocaleString('es-AR');
      if (r.delta != null) {
        const d = n(r.delta);
        return `👥 Total de pacientes activos: ${fmt} (${d >= 0 ? '+' : ''}${d} vs. mes ant.)`;
      }
      return `👥 Total de pacientes activos: ${fmt}`;
    }
    default:
      return '';
  }
}

export function NovedadesTicker() {
  const [items, setItems] = useState<string[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [paused, setPaused] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReducedMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  useEffect(() => {
    getSupabase()
      .rpc('get_novedades_ultimo_mes')
      .then(({ data, error }) => {
        if (error || !data) return;
        const sorted = [...(data as NovedadRecord[])].sort((a, b) => a.orden - b.orden);
        const texts = sorted.map(formatNovedad).filter(Boolean);
        setItems(texts);
      });
  }, []);

  // Gestiona el padding del body para no tapar contenido
  useEffect(() => {
    const visible = !dismissed && items.length > 0;
    document.body.style.paddingBottom = visible ? '38px' : '';
    return () => { document.body.style.paddingBottom = ''; };
  }, [dismissed, items.length]);

  if (dismissed || items.length === 0) return null;

  const SEP = '   ·   ';
  const durationSeconds = Math.max(25, items.join(SEP).length * 0.13);
  const doubled = [...items, ...items];

  return (
    <div
      className="nticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <span className="nticker__label" aria-hidden="true">NOVEDADES</span>

      {/* Contenido para lectores de pantalla */}
      <ul className="nticker__sr">
        {items.map((item, i) => <li key={i}>{item}</li>)}
      </ul>

      {reducedMotion ? (
        <div className="nticker__static" aria-hidden="true">
          {items.map((item, i) => (
            <span key={i} className="nticker__item">{item}</span>
          ))}
        </div>
      ) : (
        <div
          className="nticker__track"
          aria-hidden="true"
          style={{
            animationDuration: `${durationSeconds}s`,
            animationPlayState: paused ? 'paused' : 'running',
          }}
        >
          {doubled.map((item, i) => (
            <span key={i} className="nticker__item">
              {item}<span className="nticker__sep">{SEP}</span>
            </span>
          ))}
        </div>
      )}

      <button
        className="nticker__close"
        onClick={() => setDismissed(true)}
        aria-label="Cerrar novedades"
        title="Cerrar"
      >
        ✕
      </button>
    </div>
  );
}
