'use client';

import { useState } from 'react';
import type { TherapistView, PaisFilter } from '@/lib/types';
import { colorScore, segmento } from '@/lib/helpers';

type Filtro = 'todos' | 'mejoro' | 'igual' | 'empeoro' | 'meet' | 'whatsapp';

interface Props {
  data: TherapistView[];
  pais: PaisFilter;
}

function MetricCell({ label, prev, curr }: { label: string; prev: number | null; curr: number | null }) {
  const delta = prev != null && curr != null ? curr - prev : null;
  const color = delta == null ? 'var(--t3)' : delta > 0 ? 'var(--v)' : delta < 0 ? 'var(--r)' : 'var(--t3)';
  return (
    <div className="mst2">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--m)', fontSize: 11, color: 'var(--t3)' }}>
          {prev != null ? prev : '—'}
        </span>
        <span style={{ fontSize: 9, color: 'var(--t3)' }}>→</span>
        <span style={{ fontFamily: 'var(--m)', fontSize: 13, fontWeight: 600 }}>
          {curr != null ? curr : '—'}
        </span>
      </div>
      {delta != null && (
        <div className="msb2" style={{ color }}>
          {delta > 0 ? `↑ +${delta}` : delta < 0 ? `↓ ${delta}` : '→ igual'}
        </div>
      )}
      <div className="ml">{label}</div>
    </div>
  );
}

export function IntervenidosView({ data, pais }: Props) {
  const [filtro, setFiltro] = useState<Filtro>('todos');

  const base = data.filter(t => pais === 'T' || t.pais === pais);
  const mejoraron = base.filter(t => t.evolucion === 'mejoro').length;
  const iguales   = base.filter(t => t.evolucion === 'igual').length;
  const empeoraron = base.filter(t => t.evolucion === 'empeoro').length;
  const viaMeet   = base.filter(t => t.intervencion?.type === 'meet').length;

  const filtered = base.filter(t => {
    if (filtro === 'mejoro')    return t.evolucion === 'mejoro';
    if (filtro === 'igual')     return t.evolucion === 'igual';
    if (filtro === 'empeoro')   return t.evolucion === 'empeoro';
    if (filtro === 'meet')      return t.intervencion?.type === 'meet';
    if (filtro === 'whatsapp')  return t.intervencion?.type === 'whatsapp';
    return true;
  });

  const chips: { key: Filtro; label: string }[] = [
    { key: 'todos',    label: `Todos (${base.length})` },
    { key: 'mejoro',   label: `⬆ Mejoraron (${mejoraron})` },
    { key: 'igual',    label: `→ Igual (${iguales})` },
    { key: 'empeoro',  label: `⬇ Empeoraron (${empeoraron})` },
    { key: 'meet',     label: `📹 Meet (${viaMeet})` },
    { key: 'whatsapp', label: `📱 WhatsApp (${base.length - viaMeet})` },
  ];

  return (
    <div>
      {/* KPIs */}
      <div className="ks-lbl">Intervenidos</div>
      <div className="ks" style={{ marginBottom: 12 }}>
        <div className="k"><div className="kv">{base.length}</div><div className="kl">Total</div></div>
        <div className="k"><div className="kv" style={{ color: 'var(--v)' }}>{mejoraron}</div><div className="kl">Mejoraron</div></div>
        <div className="k"><div className="kv" style={{ color: 'var(--t2)' }}>{iguales}</div><div className="kl">Igual</div></div>
        <div className="k"><div className="kv" style={{ color: 'var(--r)' }}>{empeoraron}</div><div className="kl">Empeoraron</div></div>
        <div className="k"><div className="kv" style={{ color: 'var(--uy)' }}>{viaMeet}</div><div className="kl">Vía Meet</div></div>
      </div>

      {/* Banner explicativo */}
      <div style={{ background: 'var(--bg3)', border: '1px solid var(--bd2)', borderRadius: 7, padding: '8px 12px', fontSize: 11, color: 'var(--t2)', marginBottom: 10 }}>
        Durante la ventana de respeto (📹 Meet = 2 meses · 📱 WhatsApp = 1 mes) el terapeuta no aparece en las acciones de riesgo.
      </div>

      {/* Filtros chip */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
        {chips.map(c => (
          <button
            key={c.key}
            onClick={() => setFiltro(c.key)}
            style={{
              padding: '4px 10px', fontSize: 11, fontWeight: 600, borderRadius: 20, cursor: 'pointer',
              fontFamily: 'var(--f)', border: '1px solid',
              background: filtro === c.key ? 'var(--ac)' : 'var(--bg3)',
              color: filtro === c.key ? '#fff' : 'var(--t2)',
              borderColor: filtro === c.key ? 'var(--ac)' : 'var(--bd2)',
            }}
          >{c.label}</button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: '40px 24px', textAlign: 'center', color: 'var(--t2)', fontSize: 13 }}>
          No hay terapeutas intervenidos con este filtro.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {filtered.map(t => {
            const iv = t.intervencion!;
            const seg = segmento(t.dias);
            const evol = t.evolucion;
            const evolLabel = evol === 'mejoro' ? '⬆ Mejoró' : evol === 'igual' ? '→ Igual' : evol === 'empeoro' ? '⬇ Empeoró' : null;
            const evolColor = evol === 'mejoro' ? 'var(--v)' : evol === 'empeoro' ? 'var(--r)' : 'var(--t2)';
            const sesPac = t.sesMes != null && t.pacMes != null && t.pacMes > 0
              ? (t.sesMes / t.pacMes).toFixed(2) : null;
            const sesPacAnt = t.sesAnt != null && t.pacAnt != null && t.pacAnt > 0
              ? (t.sesAnt / t.pacAnt).toFixed(2) : null;
            return (
              <div key={t.id} style={{ background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 8, padding: '10px 14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{t.nombre}</span>
                    <span className={`b ${t.pais === 'AR' ? 'bar' : 'buy'}`} style={{ marginLeft: 6 }}>{t.pais}</span>
                    <span className="b bn" style={{ marginLeft: 4 }}>{seg}</span>
                  </div>
                  <div style={{ textAlign: 'right', fontSize: 10, color: 'var(--t2)' }}>
                    <div>{iv.type === 'meet' ? '📹 Meet' : '📱 WhatsApp'} · {iv.intervention_date}</div>
                    <div style={{ color: 'var(--t3)' }}>hasta {iv.respect_until_month}</div>
                  </div>
                </div>
                <div className="mg" style={{ marginBottom: 8 }}>
                  <div className="mst2">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontFamily: 'var(--m)', fontSize: 11, color: 'var(--t3)' }}>
                        {iv.score_at_intervention ?? '—'}
                      </span>
                      <span style={{ fontSize: 9, color: 'var(--t3)' }}>→</span>
                      <span style={{ fontFamily: 'var(--m)', fontSize: 13, fontWeight: 600, color: colorScore(t.score) }}>
                        {t.score}
                      </span>
                    </div>
                    {iv.score_at_intervention != null && (
                      <div className="msb2" style={{ color: t.score - iv.score_at_intervention >= 5 ? 'var(--v)' : t.score - iv.score_at_intervention <= -5 ? 'var(--r)' : 'var(--t3)' }}>
                        {t.score - iv.score_at_intervention > 0 ? `↑ +${t.score - iv.score_at_intervention}` : t.score - iv.score_at_intervention < 0 ? `↓ ${t.score - iv.score_at_intervention}` : '→ igual'}
                      </div>
                    )}
                    <div className="ml">Score</div>
                  </div>
                  <MetricCell label="Ses. mes" prev={t.sesAnt} curr={t.sesMes} />
                  <MetricCell label="Pacientes" prev={t.pacAnt} curr={t.pacMes} />
                  <div className="mst2">
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                      <span style={{ fontFamily: 'var(--m)', fontSize: 11, color: 'var(--t3)' }}>{sesPacAnt ?? '—'}</span>
                      <span style={{ fontSize: 9, color: 'var(--t3)' }}>→</span>
                      <span style={{ fontFamily: 'var(--m)', fontSize: 13, fontWeight: 600 }}>{sesPac ?? '—'}</span>
                    </div>
                    <div className="ml">Ses/Pac</div>
                  </div>
                </div>
                {evolLabel && (
                  <div style={{ fontSize: 11, color: evolColor, fontWeight: 600 }}>
                    {evolLabel}
                    <span style={{ fontWeight: 400, color: 'var(--t3)', marginLeft: 6 }}>
                      · Delta score ±5
                      {iv.marked_in_month === (t.intervencion?.marked_in_month) && ' · mismo mes, sin comparación aún' }
                    </span>
                  </div>
                )}
                {evol == null && (
                  <div style={{ fontSize: 11, color: 'var(--t3)' }}>
                    Intervención marcada este mes · sin comparación todavía
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
