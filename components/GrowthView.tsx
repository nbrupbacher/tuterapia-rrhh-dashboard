'use client';

import { useState, useEffect, useCallback } from 'react';
import { getSupabase } from '@/lib/supabase';
import {
  fetchGrowthMeses, fetchGrowthInsights, setGrowthFeedback, recalcularMes,
  mesLargo, PAIS_NOMBRE,
  type GrowthInsight, type Feedback, type TerapeutaRef,
} from '@/lib/growth';
import { num } from '@/lib/growth-templates';
import type { PaisFilter } from '@/lib/types';

interface Props {
  pais: PaisFilter;
  userEmail?: string;
  /** Abre la ficha del terapeuta si está entre los cargados en el dashboard. */
  onTherapistClick?: (id: string) => void;
}

const PAIS_COLOR: Record<string, string> = { AR: 'var(--ar)', UY: 'var(--uy)' };

export function GrowthView({ pais, userEmail, onTherapistClick }: Props) {
  const [meses, setMeses] = useState<string[]>([]);
  const [month, setMonth] = useState<string>('');
  const [insights, setInsights] = useState<GrowthInsight[]>([]);
  const [topN, setTopN] = useState(6);
  const [loading, setLoading] = useState(true);
  const [recalculando, setRecalculando] = useState(false);
  const [verMas, setVerMas] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // Meses disponibles + top_n configurado
  useEffect(() => {
    let mounted = true;
    async function init() {
      const [ms, { data: cfg }] = await Promise.all([
        fetchGrowthMeses(),
        getSupabase().from('growth_config').select('value').eq('key', 'ranking').eq('pais', 'ALL').maybeSingle(),
      ]);
      if (!mounted) return;
      setMeses(ms);
      if (cfg?.value?.top_n) setTopN(Number(cfg.value.top_n));
      setMonth(prev => prev || ms[0] || '');
      if (!ms.length) setLoading(false);
    }
    init();
    return () => { mounted = false; };
  }, []);

  const cargar = useCallback(async (m: string, p: PaisFilter) => {
    if (!m) return;
    setLoading(true);
    const rows = await fetchGrowthInsights(m, p);
    setInsights(rows);
    setVerMas(false);
    setLoading(false);
  }, []);

  useEffect(() => { cargar(month, pais); }, [month, pais, cargar]);

  async function handleFeedback(ins: GrowthInsight, valor: Exclude<Feedback, null>) {
    // Volver a tocar el mismo botón desmarca, así se puede cambiar de opinión.
    const nuevo: Feedback = ins.feedback === valor ? null : valor;
    setInsights(prev => prev.map(i => (i.id === ins.id ? { ...i, feedback: nuevo } : i)));
    const res = await setGrowthFeedback(ins.id, nuevo, userEmail);
    if (!res) {
      setInsights(prev => prev.map(i => (i.id === ins.id ? { ...i, feedback: ins.feedback } : i)));
      setAviso('No se pudo guardar el feedback. Probá de nuevo.');
    }
  }

  async function handleRecalcular() {
    if (!month || recalculando) return;
    setRecalculando(true);
    setAviso(null);
    const res = await recalcularMes(month);
    setRecalculando(false);
    if (!res.ok) { setAviso(res.error || 'No se pudo recalcular'); return; }
    setAviso(`Listo: ${res.insights} insights para ${mesLargo(month)}.`);
    await cargar(month, pais);
  }

  if (!meses.length && !loading) {
    return <div className="empty-wrap"><h3>🌱 Todavía no hay meses con datos</h3></div>;
  }

  const visibles = verMas ? insights : insights.slice(0, topN);
  const resto = insights.length - topN;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      {/* ===== Barra de controles ===== */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 16,
      }}>
        <div>
          <div style={{ fontSize: 10, color: 'var(--t3)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 3 }}>
            Mes
          </div>
          <select
            className="sf"
            value={month}
            onChange={e => setMonth(e.target.value)}
            style={{ minWidth: 150 }}
          >
            {meses.map(m => <option key={m} value={m}>{mesLargo(m)}</option>)}
          </select>
        </div>
        <div style={{ flex: 1 }} />
        <button className="btn" onClick={handleRecalcular} disabled={recalculando}>
          {recalculando ? 'Recalculando…' : '🔄 Recalcular mes'}
        </button>
      </div>

      {aviso && (
        <div style={{
          background: 'var(--bg2)', border: '1px solid var(--bd2)', borderLeft: '3px solid var(--ac)',
          borderRadius: 8, padding: '9px 13px', marginBottom: 14, fontSize: 12, color: 'var(--t2)',
        }}>
          {aviso}
        </div>
      )}

      {loading ? (
        <div className="empty-wrap"><p>Buscando oportunidades…</p></div>
      ) : insights.length === 0 ? (
        <div className="empty-wrap">
          <h3>🌱 Todavía no hay insights para {mesLargo(month)}</h3>
          <p style={{ fontSize: 12, color: 'var(--t2)' }}>
            Tocá <strong>Recalcular mes</strong> para generarlos con los datos cargados.
          </p>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {visibles.map(ins => (
              <InsightCard
                key={ins.id}
                insight={ins}
                mostrarPais={pais === 'T'}
                onFeedback={handleFeedback}
                onTherapistClick={onTherapistClick}
              />
            ))}
          </div>

          {!verMas && resto > 0 && (
            <div style={{ textAlign: 'center', marginTop: 16 }}>
              <button className="btn" onClick={() => setVerMas(true)}>
                Ver {resto} más
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ===== Tarjeta =====

export function InsightCard({ insight, mostrarPais, onFeedback, onTherapistClick }: {
  insight: GrowthInsight;
  mostrarPais: boolean;
  onFeedback: (ins: GrowthInsight, v: Exclude<Feedback, null>) => void;
  onTherapistClick?: (id: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const terapeutas = (insight.payload?.terapeutas as TerapeutaRef[] | undefined) ?? [];
  const descartado = insight.feedback === 'descarto';

  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--bd)',
      borderLeft: `3px solid ${descartado ? 'var(--t3)' : 'var(--v)'}`,
      borderRadius: 10,
      padding: 16,
      opacity: descartado ? 0.6 : 1,
      transition: 'opacity .15s',
    }}>
      {/* Encabezado */}
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--t)', flex: 1, lineHeight: 1.35 }}>
          {insight.titulo}
        </h3>
        {mostrarPais && (
          <span style={{
            fontSize: 10, fontWeight: 600, color: PAIS_COLOR[insight.pais] || 'var(--t2)',
            border: `1px solid ${PAIS_COLOR[insight.pais] || 'var(--bd2)'}`,
            borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap',
          }}>
            {PAIS_NOMBRE[insight.pais] ?? insight.pais}
          </span>
        )}
      </div>

      {/* Qué pasa */}
      <p style={{ margin: '0 0 10px', fontSize: 13, color: 'var(--t2)', lineHeight: 1.5 }}>
        {insight.que_pasa}
      </p>

      {/* Oportunidad */}
      {insight.oportunidad && (
        <div style={{
          background: 'var(--bg3)', borderRadius: 7, padding: '9px 12px', marginBottom: 10,
        }}>
          <div style={{
            fontSize: 9, fontWeight: 600, color: 'var(--v)', textTransform: 'uppercase',
            letterSpacing: 0.6, marginBottom: 3,
          }}>
            Oportunidad
          </div>
          <div style={{ fontSize: 13, color: 'var(--t)', lineHeight: 1.5 }}>{insight.oportunidad}</div>
        </div>
      )}

      {/* Qué hacer */}
      <div style={{ marginBottom: 12 }}>
        <div style={{
          fontSize: 9, fontWeight: 600, color: 'var(--ac)', textTransform: 'uppercase',
          letterSpacing: 0.6, marginBottom: 3,
        }}>
          Qué hacer
        </div>
        <div style={{ fontSize: 13, color: 'var(--t)', lineHeight: 1.5 }}>{insight.accion}</div>
      </div>

      {/* Terapeutas */}
      {terapeutas.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <button
            onClick={() => setAbierto(v => !v)}
            style={{
              background: 'none', border: 'none', color: 'var(--t2)', cursor: 'pointer',
              fontSize: 11, padding: 0, display: 'flex', alignItems: 'center', gap: 5,
            }}
          >
            <span style={{ transform: abierto ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}>▸</span>
            Ver terapeutas ({terapeutas.length})
          </button>
          {abierto && (
            <div style={{
              marginTop: 8, border: '1px solid var(--bd)', borderRadius: 7,
              maxHeight: 280, overflowY: 'auto',
            }}>
              {terapeutas.map((t, i) => (
                <div
                  key={t.id}
                  onClick={() => onTherapistClick?.(t.id)}
                  style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10,
                    padding: '7px 11px',
                    borderTop: i === 0 ? 'none' : '1px solid var(--bd)',
                    cursor: onTherapistClick ? 'pointer' : 'default',
                    fontSize: 12,
                  }}
                >
                  <span style={{ color: 'var(--t)', fontWeight: 500 }}>{t.nombre}</span>
                  <span style={{ color: 'var(--t2)', fontSize: 11, textAlign: 'right' }}>{t.metrica}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Feedback */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 7,
        borderTop: '1px solid var(--bd)', paddingTop: 11,
      }}>
        <span style={{ fontSize: 10, color: 'var(--t3)', marginRight: 2 }}>
          ¿Te sirve este insight?
        </span>
        <FeedbackBtn
          activo={insight.feedback === 'sirve'}
          color="var(--v)"
          label="👍 Sirve"
          onClick={() => onFeedback(insight, 'sirve')}
        />
        <FeedbackBtn
          activo={insight.feedback === 'descarto'}
          color="var(--t2)"
          label="👎 Descarto"
          onClick={() => onFeedback(insight, 'descarto')}
        />
        <div style={{ flex: 1 }} />
        {insight.impacto_usd != null && insight.impacto_usd > 0 && (
          <span style={{ fontSize: 11, color: 'var(--v)', fontWeight: 600, fontFamily: 'var(--m)' }}>
            ~{num(insight.impacto_usd)} USD
          </span>
        )}
      </div>
    </div>
  );
}

function FeedbackBtn({ activo, color, label, onClick }: {
  activo: boolean; color: string; label: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        background: activo ? color : 'transparent',
        color: activo ? 'var(--bg)' : 'var(--t2)',
        border: `1px solid ${activo ? color : 'var(--bd2)'}`,
        borderRadius: 6, padding: '4px 10px', fontSize: 11, cursor: 'pointer',
        fontWeight: activo ? 600 : 400,
      }}
    >
      {label}
    </button>
  );
}
