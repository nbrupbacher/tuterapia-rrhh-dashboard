'use client';

import { useState, useMemo } from 'react';
import type { TherapistView } from '@/lib/types';
import {
  colorScore,
  segmento,
  tendenciaBadge,
  cuadranteBadge,
  accionableBadge,
  rowClass,
} from '@/lib/helpers';

interface DashboardTableProps {
  data: TherapistView[];
  onRowClick: (t: TherapistView) => void;
}

const PAGE_SIZE = 50;

export function DashboardTable({ data, onRowClick }: DashboardTableProps) {
  const [sortKey, setSortKey] = useState<keyof TherapistView>('nombre');
  const [sortDir, setSortDir] = useState<1 | -1>(1);
  const [page, setPage] = useState(1);

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

  return (
    <>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <SortableTh k="nombre" cls="c-n">Terapeuta</SortableTh>
              <SortableTh k="pais" cls="c-p">País</SortableTh>
              <SortableTh k="score" cls="c-s">Score</SortableTh>
              <SortableTh k="dias" cls="c-sg">Segmento</SortableTh>
              <SortableTh k="tendencia" cls="c-t">Tendencia</SortableTh>
              <SortableTh k="cuadrante" cls="c-pr">Predicción</SortableTh>
              <SortableTh k="accionable" cls="c-a">Accionable</SortableTh>
            </tr>
          </thead>
          <tbody>
            {slice.map((r) => {
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
                  <td className="c-p">
                    <span className={`b ${r.pais === 'AR' ? 'bar' : 'buy'}`}>{r.pais}</span>
                  </td>
                  <td className="c-s">
                    <div className="sb">
                      <div className="sbar">
                        <div className="sf" style={{ width: `${r.score}%`, background: colorScore(r.score) }} />
                      </div>
                      <span className="sn" style={{ color: colorScore(r.score) }}>{r.score}</span>
                    </div>
                  </td>
                  <td className="c-sg"><span className="b bn">{segmento(r.dias)}</span></td>
                  <td className="c-t">
                    <span className={`ts ${tBadge.cls}`}>{tBadge.icon} {tBadge.label}</span>
                  </td>
                  <td className="c-pr">
                    <span className={`pr ${cBadge.cls}`}>{cBadge.label}</span>
                  </td>
                  <td className="c-a">
                    <span className={`ac ${aBadge.cls}`}>{aBadge.label}</span>
                  </td>
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
