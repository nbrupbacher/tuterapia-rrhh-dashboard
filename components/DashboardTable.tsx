'use client';

import { useState, useMemo } from 'react';
import type { TherapistView, View } from '@/lib/types';
import {
  colorScore, colorSesPaciente, colorHs, colorZona, colorDias,
  segmento, tendenciaBadge, cuadranteBadge,
  situacionBadge, accionBadge, topSituaciones,
  deltaBadge, conversion, rowClass, usd, ganHist,
} from '@/lib/helpers';
import { ACCION_TEMPORAL } from '@/lib/constants-matrix';

interface DashboardTableProps {
  data: TherapistView[];
  view: View;
  onRowClick: (t: TherapistView) => void;
}

const PAGE_SIZE = 50;

// SortKey amplio para columnas computadas
type SortKey = keyof TherapistView | '_ganHist';

function lblShort(month: string): string {
  if (!month || month === '—') return '—';
  const [, mm] = month.split('-').map(Number);
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return meses[mm - 1] || '—';
}

// Función para obtener valor de sort de un row con cualquier clave (incluso computada)
function getSortValue(r: TherapistView, key: SortKey): number | string | null {
  if (key === '_ganHist') return ganHist(r);
  const v = r[key as keyof TherapistView];
  // arrays/objetos no son sorteables: devolvemos null
  if (Array.isArray(v) || (typeof v === 'object' && v !== null)) return null;
  return v as any;
}

export function DashboardTable({ data, view, onRowClick }: DashboardTableProps) {
  const isPred = view === 'pred';
  const [sortKey, setSortKey] = useState<SortKey>(isPred ? 'score' : 'sesMes');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(1);

  const { mesActLbl, mesAntLbl } = useMemo(() => {
    const now = new Date();
    const actDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const antDate = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    return {
      mesActLbl: lblShort(`${actDate.getFullYear()}-${String(actDate.getMonth() + 1).padStart(2, '0')}`),
      mesAntLbl: lblShort(`${antDate.getFullYear()}-${String(antDate.getMonth() + 1).padStart(2, '0')}`),
    };
  }, []);

  const sorted = useMemo(() => {
    const cuadOrder: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
    return [...data].sort((a, b) => {
      const av = getSortValue(a, sortKey);
      const bv = getSortValue(b, sortKey);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (sortKey === 'cuadrante') {
        return ((cuadOrder[av as string] ?? 99) - (cuadOrder[bv as string] ?? 99)) * sortDir;
      }
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sortDir;
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [data, sortKey, sortDir]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const slice = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(-1); }
    setPage(1);
  }

  function SortableTh({ k, cls, children }: { k: SortKey; cls?: string; children: React.ReactNode }) {
    return (
      <th className={`${cls || ''} ${sortKey === k ? 'ths' : ''}`} onClick={() => handleSort(k)}>
        {children}
      </th>
    );
  }
  function PlainTh({ cls, children }: { cls?: string; children: React.ReactNode }) {
    return <th className={cls}>{children}</th>;
  }

  return (
    <>
      <div className="tw">
        <table>
          <thead>
            <tr>
              {isPred ? (
                <>
                  <SortableTh k="nombre" cls="c-n">Terapeuta</SortableTh>
                  <SortableTh k="pais" cls="c-p">País</SortableTh>
                  <SortableTh k="dias" cls="c-sg">Segm.</SortableTh>
                  <SortableTh k="cuadrante" cls="c-pr">Predicción</SortableTh>
                  <SortableTh k="score" cls="c-s">Score</SortableTh>
                  <PlainTh cls="c-sit">Situación</PlainTh>
                  <SortableTh k="accion" cls="c-acc">Acción</SortableTh>
                </>
              ) : (
                <>
                  <SortableTh k="nombre" cls="c-n">Terapeuta</SortableTh>
                  <SortableTh k="pais" cls="c-p">País</SortableTh>
                  <PlainTh cls="c-es">Est.</PlainTh>
                  <SortableTh k="tendencia" cls="c-t">Tendencia 4m</SortableTh>
                  <SortableTh k="dias" cls="c-sg">Segmento</SortableTh>
                  <SortableTh k="sesMes" cls="c-se">Ses. {mesActLbl}</SortableTh>
                  <SortableTh k="pacAnt" cls="c-pp">Pac. {mesAntLbl}</SortableTh>
                  <SortableTh k="pacMes" cls="c-pa">Pac. {mesActLbl}</SortableTh>
                  <SortableTh k="regMes" cls="c-rm">Reg. {mesActLbl}</SortableTh>
                  <PlainTh cls="c-cv">Conv.</PlainTh>
                  <SortableTh k="regTotalHist" cls="c-rt">Reg.total</SortableTh>
                  <SortableTh k="sesPaciente3m" cls="c-sp">Prom.ses 3m</SortableTh>
                  <SortableTh k="ultimaSesion" cls="c-ul">Últ.ses.</SortableTh>
                  <SortableTh k="hs" cls="c-hs">Hs.</SortableTh>
                  <SortableTh k="_ganHist" cls="c-gh">Gan.hist.</SortableTh>
                  <SortableTh k="ganMes" cls="c-gm">Gan. {mesActLbl}</SortableTh>
                  <SortableTh k="accion" cls="c-acc">Acción</SortableTh>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              if (isPred) {
                // ===== VISTA PREDICTIBILIDAD =====
                const cBadge = cuadranteBadge(r.cuadrante);
                const aBadge = accionBadge(r.accion);
                const sitsTop = topSituaciones(r.situaciones || [], 2);
                // Identificar si esta acción es la "pendiente" (escalada temporal no cumplida)
                const tienePendiente = (r.accionesPendientes || []).length > 0;
                const pendiente = tienePendiente ? r.accionesPendientes[0] : null;

                return (
                  <tr key={r.id} className={rowClass(r)} onClick={() => onRowClick(r)}>
                    <td className="c-n tn">{r.nombre}</td>
                    <td className="c-p"><span className={`b ${r.pais === 'AR' ? 'bar' : 'buy'}`}>{r.pais}</span></td>
                    <td className="c-sg"><span className="b bn">{segmento(r.dias)}</span></td>
                    <td className="c-pr"><span className={`pr ${cBadge.cls}`}>{cBadge.label}</span></td>
                    <td className="c-s">
                      <div className="sb">
                        <div className="sbar">
                          <div className="sf" style={{ width: `${r.score}%`, background: colorScore(r.score) }} />
                        </div>
                        <span className="sn" style={{ color: colorScore(r.score) }}>{r.score}</span>
                      </div>
                    </td>
                    <td className="c-sit">
                      <div className="sits">
                        {sitsTop.length === 0 ? (
                          <span className="sit sit-g">Estable</span>
                        ) : (
                          sitsTop.map((sid) => {
                            const sb = situacionBadge(sid);
                            return (
                              <span key={sid} className={`sit ${sb.cls}`}>
                                <span className="sit-dot" style={{ background: sb.dot }} />
                                {sb.label}
                              </span>
                            );
                          })
                        )}
                      </div>
                    </td>
                    <td className="c-acc">
                      <div className="acc-multi">
                        <span className={`acc ${aBadge.cls}`}>{aBadge.icon} {aBadge.label}</span>
                        {pendiente && (
                          <span className={`acc ${accionBadge(pendiente.accion).cls} acc-pending`}>
                            {accionBadge(pendiente.accion).icon} {accionBadge(pendiente.accion).label} · tras {pendiente.meses_para_activar}m
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              }

              // ===== VISTA ANÁLISIS =====
              // Sin columna "Situación" pero con "Acción" al final
              const tBadge = tendenciaBadge(r.tendencia);
              const aBadge = accionBadge(r.accion);
              const sp = r.sesPaciente3m || 0;
              const dtPac = deltaBadge(r.pacMes, r.pacAnt);
              const dtSes = deltaBadge(r.sesMes, r.sesAnt);
              const conv = conversion(r.pacMes, r.pacAnt, r.regMes);
              const gh = ganHist(r);
              const hsVal = r.hs || 0;
              const hsPct = Math.min(100, Math.round(hsVal / 40 * 100));

              return (
                <tr key={r.id} className={rowClass(r)} onClick={() => onRowClick(r)}>
                  <td className="c-n tn">{r.nombre}</td>
                  <td className="c-p"><span className={`b ${r.pais === 'AR' ? 'bar' : 'buy'}`}>{r.pais}</span></td>
                  <td className="c-es" style={{ textAlign: 'center' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: colorZona(r.zona) }} />
                  </td>
                  <td className="c-t"><span className={`ts ${tBadge.cls}`}>{tBadge.label}</span></td>
                  <td className="c-sg"><span className="b bn">{segmento(r.dias)}</span></td>
                  <td className="c-se tm">
                    {r.sesMes != null ? (
                      <>
                        <span>{r.sesMes}</span>
                        {dtSes && <span className={`dp ${dtSes.cls}`} style={{ marginLeft: 4 }}>{dtSes.label}</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="c-pp tm" style={{ color: 'var(--t2)' }}>{r.pacAnt != null ? r.pacAnt : '—'}</td>
                  <td className="c-pa tm">
                    {r.pacMes != null ? (
                      <>
                        <span style={{ color: 'var(--v)' }}>{r.pacMes}</span>
                        {dtPac && <span className={`dp ${dtPac.cls}`} style={{ marginLeft: 4 }}>{dtPac.label}</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="c-rm tm">{r.regMes != null ? r.regMes : '—'}</td>
                  <td className="c-cv tm" style={{ color: r.pacAnt == null ? 'var(--t3)' : conv.color }}>
                    {r.pacAnt == null ? '—' : conv.value !== null ? `${conv.value}%` : '—'}
                  </td>
                  <td className="c-rt tm" style={{ color: 'var(--t2)' }}>{r.regTotalHist || '—'}</td>
                  <td className="c-sp tm" style={{ color: colorSesPaciente(sp) }}>{sp ? sp.toFixed(1) : '—'}</td>
                  <td className="c-ul tm" style={{ color: colorDias(r.diasSinSesion) }}>
                    {r.diasSinSesion != null ? `${r.diasSinSesion}d` : '—'}
                  </td>
                  <td className="c-hs">
                    <div className="hb">
                      <div className="hbg">
                        <div className="hbf" style={{ width: `${hsPct}%`, background: colorHs(hsVal) }} />
                      </div>
                      <span className="tm" style={{ color: colorHs(hsVal) }}>{hsVal}h</span>
                    </div>
                  </td>
                  <td className={`c-gh ${gh >= 0 ? 'gp' : 'gn'}`}>{usd(gh)}</td>
                  <td className={`c-gm ${r.ganMes == null ? 'g0' : r.ganMes >= 0 ? 'gp' : 'gn'}`}>{usd(r.ganMes)}</td>
                  <td className="c-acc"><span className={`acc ${aBadge.cls}`}>{aBadge.icon} {aBadge.label}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="pg">
          <button className="pb" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>←</button>
          {Array.from({ length: pages }, (_, i) => i + 1)
            .filter((p) => p === 1 || p === pages || Math.abs(p - currentPage) <= 1)
            .map((p, i, arr) => (
              <span key={p}>
                {i > 0 && arr[i - 1] !== p - 1 && (
                  <span style={{ color: 'var(--t3)', padding: '0 2px' }}>…</span>
                )}
                <button className={`pb ${p === currentPage ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>
              </span>
            ))}
          <button className="pb" disabled={currentPage === pages} onClick={() => setPage(currentPage + 1)}>→</button>
        </div>
      )}
    </>
  );
}
