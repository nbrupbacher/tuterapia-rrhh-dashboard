'use client';

import { useState, useMemo } from 'react';
import type { TherapistView, View } from '@/lib/types';
import {
  colorScore,
  colorSesPaciente,
  colorHs,
  colorZona,
  colorDias,
  segmento,
  tendenciaBadge,
  cuadranteBadge,
  accionableBadge,
  deltaBadge,
  conversion,
  rowClass,
  usd,
  ganHist,
} from '@/lib/helpers';

interface DashboardTableProps {
  data: TherapistView[];
  view: View;
  onRowClick: (t: TherapistView) => void;
}

const PAGE_SIZE = 50;

// Etiquetas cortas de mes (Mar / Feb)
function lblShort(month: string): string {
  if (!month || month === '—') return '—';
  const [yy, mm] = month.split('-').map(Number);
  const meses = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  return meses[mm - 1] || '—';
}

export function DashboardTable({ data, view, onRowClick }: DashboardTableProps) {
  const isPred = view === 'pred';
  const [sortKey, setSortKey] = useState<keyof TherapistView>(isPred ? 'score' : 'sesMes');
  const [sortDir, setSortDir] = useState<1 | -1>(-1);
  const [page, setPage] = useState(1);

  // Inferir mes actual / anterior de los datos (para los headers Mar/Feb)
  const { mesActLbl, mesAntLbl } = useMemo(() => {
    // Buscamos cualquier registro con sesMes != null y vemos el mes (no lo tenemos directo, lo más simple: tomar de currentMonth via window? No tenemos. Lo pasamos como prop sería ideal, pero para no romper API actual, derivamos)
    // Como workaround, asumimos el último mes cargado y el anterior. El usuario lo verá bien si los meses están bien cargados.
    // Mejor: hardcoded a partir de today
    const now = new Date();
    const actDate = new Date(now.getFullYear(), now.getMonth() - 1, 1); // Mes pasado
    const antDate = new Date(now.getFullYear(), now.getMonth() - 2, 1); // Antepasado
    return {
      mesActLbl: lblShort(`${actDate.getFullYear()}-${String(actDate.getMonth() + 1).padStart(2, '0')}`),
      mesAntLbl: lblShort(`${antDate.getFullYear()}-${String(antDate.getMonth() + 1).padStart(2, '0')}`),
    };
  }, []);

  const sorted = useMemo(() => {
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return sortDir;
      if (bv == null) return -sortDir;
      if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sortDir;
      return ((av as number) - (bv as number)) * sortDir;
    });
  }, [data, sortKey, sortDir]);

  const total = sorted.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.min(page, pages);
  const slice = sorted.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  function handleSort(key: keyof TherapistView) {
    if (sortKey === key) setSortDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(key); setSortDir(-1); }
    setPage(1);
  }

  function SortableTh({ k, cls, children }: { k: keyof TherapistView; cls?: string; children: React.ReactNode }) {
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
                  <SortableTh k="score" cls="c-s">Score</SortableTh>
                  <SortableTh k="dias" cls="c-sg">Segmento</SortableTh>
                  <SortableTh k="tendencia" cls="c-t">Tendencia 4m</SortableTh>
                  <SortableTh k="cuadrante" cls="c-pr">Predicción</SortableTh>
                  <SortableTh k="accionable" cls="c-a">Accionable</SortableTh>
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
                  <SortableTh k="diasSinSesion" cls="c-ul">Últ.ses.</SortableTh>
                  <SortableTh k="hs" cls="c-hs">Hs.</SortableTh>
                  <PlainTh cls="c-gh">Gan.hist.</PlainTh>
                  <SortableTh k="ganMes" cls="c-gm">Gan. {mesActLbl}</SortableTh>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
              if (isPred) {
                const tBadge = tendenciaBadge(r.tendencia);
                const cBadge = cuadranteBadge(r.cuadrante);
                const aBadge = accionableBadge(r.accionable);
                return (
                  <tr key={r.id} className={rowClass(r)} onClick={() => onRowClick(r)}>
                    <td className="c-n tn">
                      {r.videollamada && (
                        <span className="ac avid" style={{ fontSize: 9, padding: '1px 5px', marginRight: 3 }}>📞</span>
                      )}
                      {r.nombre}
                    </td>
                    <td className="c-p"><span className={`b ${r.pais === 'AR' ? 'bar' : 'buy'}`}>{r.pais}</span></td>
                    <td className="c-s">
                      <div className="sb">
                        <div className="sbar">
                          <div className="sf" style={{ width: `${r.score}%`, background: colorScore(r.score) }} />
                        </div>
                        <span className="sn" style={{ color: colorScore(r.score) }}>{r.score}</span>
                      </div>
                    </td>
                    <td className="c-sg"><span className="b bn">{segmento(r.dias)}</span></td>
                    <td className="c-t"><span className={`ts ${tBadge.cls}`}>{tBadge.label}</span></td>
                    <td className="c-pr"><span className={`pr ${cBadge.cls}`}>{cBadge.label}</span></td>
                    <td className="c-a"><span className={`ac ${aBadge.cls}`}>{aBadge.label}</span></td>
                  </tr>
                );
              }

              // VIEW = anal
              const tBadge = tendenciaBadge(r.tendencia);
              const sp = r.sesPaciente3m || 0;
              const dt = deltaBadge(r.pacMes, r.pacAnt);
              const conv = conversion(r.pacMes, r.pacAnt, r.regMes);
              const gh = ganHist(r);
              const dsColor = colorDias(r.diasSinSesion);
              const hsVal = r.hs || 0;
              const hsPct = Math.min(100, Math.round(hsVal / 40 * 100));

              return (
                <tr key={r.id} className={rowClass(r)} onClick={() => onRowClick(r)}>
                  <td className="c-n tn">
                    {r.videollamada && (
                      <span className="ac avid" style={{ fontSize: 9, padding: '1px 5px', marginRight: 3 }}>📞</span>
                    )}
                    {r.nombre}
                  </td>
                  <td className="c-p"><span className={`b ${r.pais === 'AR' ? 'bar' : 'buy'}`}>{r.pais}</span></td>
                  <td className="c-es" style={{ textAlign: 'center' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', display: 'inline-block', background: colorZona(r.zona) }} />
                  </td>
                  <td className="c-t"><span className={`ts ${tBadge.cls}`}>{tBadge.label}</span></td>
                  <td className="c-sg"><span className="b bn">{segmento(r.dias)}</span></td>
                  <td className="c-se tm">{r.sesMes != null ? r.sesMes : '—'}</td>
                  <td className="c-pp tm" style={{ color: 'var(--t2)' }}>{r.pacAnt != null ? r.pacAnt : '—'}</td>
                  <td className="c-pa tm">
                    {r.pacMes != null ? (
                      <>
                        <span style={{ color: 'var(--v)' }}>{r.pacMes}</span>
                        {dt && <span className={`dp ${dt.cls}`} style={{ marginLeft: 4 }}>{dt.label}</span>}
                      </>
                    ) : '—'}
                  </td>
                  <td className="c-rm tm">{r.regMes != null ? r.regMes : '—'}</td>
                  <td className="c-cv tm" style={{ color: conv.color }}>{conv.value !== null ? `${conv.value}%` : '—'}</td>
                  <td className="c-rt tm" style={{ color: 'var(--t2)' }}>{r.regTotalHist || '—'}</td>
                  <td className="c-sp tm" style={{ color: colorSesPaciente(sp) }}>{sp ? sp.toFixed(1) : '—'}</td>
                  <td className="c-ul tm" style={{ color: dsColor }}>{r.diasSinSesion != null ? `${r.diasSinSesion}d` : '—'}</td>
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
