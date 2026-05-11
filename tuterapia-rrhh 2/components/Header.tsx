'use client';

import type { View, PaisFilter } from '@/lib/types';

interface HeaderProps {
  view: View;
  setView: (v: View) => void;
  pais: PaisFilter;
  setPais: (p: PaisFilter) => void;
  mesActual: string;
  userEmail?: string;
  onLogout: () => void;
}

export function Header({ view, setView, pais, setPais, mesActual, userEmail, onLogout }: HeaderProps) {
  const views: { id: View; label: string }[] = [
    { id: 'pred', label: 'Predictibilidad' },
    { id: 'anal', label: 'Análisis' },
    { id: 'prog', label: '📈 Progreso' },
  ];
  const paises: { id: PaisFilter; label: string; cls: string }[] = [
    { id: 'T', label: 'AR+UY', cls: '' },
    { id: 'AR', label: 'AR', cls: 'ar' },
    { id: 'UY', label: 'UY', cls: 'uy' },
  ];

  const userShortName = userEmail?.split('@')[0] || '';

  return (
    <div className="hdr">
      <div className="logo">
        <div className="lm">TT</div>
        <div>
          <div className="ln">Tu Terapia</div>
          <div className="ls">
            RRHH Dashboard
            {pais !== 'T' && ` · ${pais === 'AR' ? 'Argentina' : 'Uruguay'}`}
          </div>
        </div>
      </div>

      <div className="hr">
        <div className="tog">
          {views.map((v) => (
            <button
              key={v.id}
              className={`togb ${view === v.id ? 'on' : ''}`}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </div>

        <div className="tog">
          {paises.map((p) => (
            <button
              key={p.id}
              className={`togb ${p.cls} ${pais === p.id ? 'on' : ''}`}
              onClick={() => setPais(p.id)}
            >
              {p.label}
            </button>
          ))}
        </div>

        <span style={{ fontSize: 11, color: 'var(--t2)', marginLeft: 4 }}>{mesActual}</span>

        {userShortName && (
          <>
            <span className="user-info">· {userShortName}</span>
            <button className="logout-btn" onClick={onLogout} title="Cerrar sesión">
              salir
            </button>
          </>
        )}
      </div>
    </div>
  );
}
