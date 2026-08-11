'use client';

import { useEffect, useState } from 'react';
import { getSupabase } from '@/lib/supabase';

type NovedadTipo =
  | 'nuevos'
  | 'total_activos'
  | 'top_pacientes'
  | 'top_registros'
  | 'subio_pacientes'
  | 'bajo_pacientes'
  | 'subio_rango'
  | 'bajo_rango'
  | 'nuevo_convierte'
  | 'alta_conversion'
  | 'record_delta';

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

// Arma el string final a partir de un registro estructurado.
// Todo el copy vive acá — editá solo esta función para cambiar textos.
function formatNovedad(r: NovedadRecord): string {
  const n = (v: number | null) => Math.round(v ?? 0);
  switch (r.tipo) {
    case 'nuevos': {
      const c = n(r.valor_actual);
      const pais = r.pais ? ` (${r.pais})` : '';
      return `🆕 ${c} ${c === 1 ? 'psicólogo nuevo' : 'psicólogos nuevos'} este mes${pais}`;
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
    case 'top_pacientes': {
      const pac = n(r.valor_actual);
      return `⭐ ${r.nombre} tiene ${pac} pacientes activos este mes`;
    }
    case 'top_registros': {
      const reg = n(r.valor_actual);
      return `📋 ${r.nombre} recibió ${reg} registros nuevos este mes`;
    }
    case 'subio_pacientes': {
      const d = n(r.delta);
      return `📈 ${r.nombre} sumó +${d} pacientes este mes`;
    }
    case 'bajo_pacientes': {
      const d = Math.abs(n(r.delta));
      return `📉 ${r.nombre} bajó −${d} pacientes este mes`;
    }
    case 'subio_rango': {
      const count = n(r.valor_actual);
      const min = r.registros ?? 0;
      const max = r.conversiones;
      const rango = max != null ? `entre ${min} y ${max}` : `${min} o más`;
      return `📈 ${count} ${count === 1 ? 'terapeuta sumó' : 'terapeutas sumaron'} ${rango} pacientes este mes`;
    }
    case 'bajo_rango': {
      const count = n(r.valor_actual);
      const min = r.registros ?? 0;
      const max = r.conversiones;
      const rango = max != null ? `entre ${min} y ${max}` : `${min} o más`;
      return `📉 ${count} ${count === 1 ? 'terapeuta perdió' : 'terapeutas perdieron'} ${rango} pacientes este mes`;
    }
    case 'nuevo_convierte': {
      const pac = n(r.valor_actual);
      const reg = r.registros;
      const sufPac = pac === 1 ? 'paciente' : 'pacientes';
      const base = `🌱 ${r.nombre} (nuevo) ya tiene ${pac} ${sufPac} en su primer mes`;
      if (reg && reg > 0) {
        const pct = Math.round((pac / reg) * 100);
        return `${base} (${pct}% de conversión)`;
      }
      return base;
    }
    case 'alta_conversion': {
      const pct = r.valor_actual?.toFixed(1) ?? '0';
      const nuevos = r.conversiones ?? 0;
      const reg = r.registros ?? 0;
      return `🎯 ${r.nombre} convirtió ${pct}% — ${nuevos} pacientes nuevos de ${reg} registros`;
    }
    case 'record_delta': {
      const d = n(r.delta);
      return `🏆 ${r.nombre} bate su récord personal: +${d} pacientes en un mes`;
    }
    default:
      return '';
  }
}

// Fisher-Yates sobre todos los items combinados, luego un pase de separación
// para que nunca aparezcan dos del mismo tipo consecutivos.
// Esto da verdadera aleatoriedad: subio_pacientes (29 items) aparece distribuido
// por todo el ticker en vez de en bloque.
function shuffleVaried(records: NovedadRecord[]): NovedadRecord[] {
  // Paso 1: shuffle completo
  const arr = [...records];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  // Paso 2: separar consecutivos del mismo tipo
  // Cuando dos adyacentes son del mismo tipo, busca el primer item diferente
  // más adelante y lo trae a esa posición.
  for (let i = 0; i < arr.length - 1; i++) {
    if (arr[i].tipo === arr[i + 1].tipo) {
      const swapIdx = arr.findIndex((r, j) => j > i + 1 && r.tipo !== arr[i].tipo);
      if (swapIdx !== -1) {
        [arr[i + 1], arr[swapIdx]] = [arr[swapIdx], arr[i + 1]];
      }
    }
  }

  return arr;
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
        const mixed = shuffleVaried(data as NovedadRecord[]);
        const texts = mixed.map(formatNovedad).filter(Boolean);
        setItems(texts);
      });
  }, []);

  // Agrega padding al body para no tapar contenido con la barra fija
  useEffect(() => {
    const visible = !dismissed && items.length > 0;
    document.body.style.paddingBottom = visible ? '38px' : '';
    return () => { document.body.style.paddingBottom = ''; };
  }, [dismissed, items.length]);

  if (dismissed || items.length === 0) return null;

  const SEP = '   ·   ';
  const durationSeconds = Math.max(40, items.join(SEP).length * 0.11);
  const doubled = [...items, ...items];

  return (
    <div
      className="nticker"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {/* Lista oculta para lectores de pantalla */}
      <ul className="nticker__sr" aria-label="Novedades del último mes">
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
