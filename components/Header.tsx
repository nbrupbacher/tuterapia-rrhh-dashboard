'use client';

import { useState } from 'react';
import type { View, PaisFilter } from '@/lib/types';
import { UploadModal } from './UploadModal';

interface Props {
  view: View;
  setView: (v: View) => void;
  pais: PaisFilter;
  setPais: (p: PaisFilter) => void;
  mesActual: string;
  userEmail?: string;
  onLogout: () => void;
  onUploadSuccess?: () => void;
}

function nextMonth(current: string): string {
  if (!current || current === '—') {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }
  const [y, m] = current.split('-').map(Number);
  const next = new Date(y, m, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

export function Header({ view, setView, pais, setPais, mesActual, userEmail, onLogout, onUploadSuccess }: Props) {
  const [uploadOpen, setUploadOpen] = useState(false);
  
  return (
    <>
      <header className="hdr">
        <div className="logo">
          <div className="lm">TT</div>
          <div>
            <div className="ln">Tu Terapia · RRHH</div>
            <div className="ls">Mes actual: {mesActual}</div>
          </div>
        </div>
        
        <div className="hr">
          {/* Toggle vista */}
          <div className="tog">
            <button className={`togb ${view === 'pred' ? 'on' : ''}`} onClick={() => setView('pred')}>Predicción</button>
            <button className={`togb ${view === 'anal' ? 'on' : ''}`} onClick={() => setView('anal')}>Análisis</button>
            <button className={`togb ${view === 'prog' ? 'on' : ''}`} onClick={() => setView('prog')}>📈 Progreso</button>
            <button className={`togb ${view === 'interv' ? 'on' : ''}`} onClick={() => setView('interv')}>👥 Intervenidos</button>
          </div>
          
          {/* Toggle país */}
          <div className="tog">
            <button className={`togb ${pais === 'T' ? 'on' : ''}`} onClick={() => setPais('T')}>Todos</button>
            <button className={`togb ar ${pais === 'AR' ? 'on' : ''}`} onClick={() => setPais('AR')}>AR</button>
            <button className={`togb uy ${pais === 'UY' ? 'on' : ''}`} onClick={() => setPais('UY')}>UY</button>
          </div>
          
          {/* Botón upload */}
          <button className="btn" onClick={() => setUploadOpen(true)} style={{ background: 'var(--ac)', color: '#fff', borderColor: 'var(--ac)' }}>
            📥 Cargar CSV
          </button>
          
          {/* User info */}
          {userEmail && (
            <>
              <span className="user-info">{userEmail}</span>
              <button className="logout-btn" onClick={onLogout}>Salir</button>
            </>
          )}
        </div>
      </header>
      
      <UploadModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={() => onUploadSuccess?.()}
        suggestedMonth={nextMonth(mesActual)}
      />
    </>
  );
}
