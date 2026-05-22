'use client';

import type { FilterState } from '@/lib/types';
import { SITUACIONES, ACCIONES, ordenarSituacionesPorGravedad } from '@/lib/constants-matrix';

// Re-export para mantener compatibilidad con importaciones que vienen de aquí
export type { FilterState };

interface Props {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  count: number;
}

export function TableFilters({ filters, setFilters, count }: Props) {
  function update<K extends keyof FilterState>(key: K, value: FilterState[K]) {
    setFilters({ ...filters, [key]: value });
  }

  // Situaciones ordenadas por gravedad (rojas primero)
  const situacionesOrdenadas = ordenarSituacionesPorGravedad(
    Object.keys(SITUACIONES) as Array<keyof typeof SITUACIONES>,
  );

  // Acciones ordenadas por prioridad
  const accionesOrdenadas = Object.values(ACCIONES)
    .sort((a, b) => a.prioridad - b.prioridad)
    .map((a) => a.id);

  return (
    <div className="ctr">
      <div className="sw">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
        </svg>
        <input
          className="si"
          placeholder="Buscar terapeuta..."
          value={filters.search}
          onChange={(e) => update('search', e.target.value)}
        />
      </div>

      <select value={filters.accion} onChange={(e) => update('accion', e.target.value)}>
        <option value="">Acción: todas</option>
        {accionesOrdenadas.map((a) => (
          <option key={a} value={a}>
            {ACCIONES[a].icon} {ACCIONES[a].label}
          </option>
        ))}
      </select>

      <select value={filters.situacion} onChange={(e) => update('situacion', e.target.value)}>
        <option value="">Situación: todas</option>
        {situacionesOrdenadas.map((s) => (
          <option key={s} value={s}>
            {SITUACIONES[s].label}
          </option>
        ))}
      </select>

      <select value={filters.cuadrante} onChange={(e) => update('cuadrante', e.target.value)}>
        <option value="">Predicción: todas</option>
        <option value="A">A · Alto valor</option>
        <option value="B">B · Riesgo oculto</option>
        <option value="C">C · Potencial</option>
        <option value="D">D · Intervención</option>
      </select>

      <select value={filters.tendencia} onChange={(e) => update('tendencia', e.target.value)}>
        <option value="">Tendencia: todas</option>
        <option value="subiendo">↑ Sube</option>
        <option value="bajando">↓ Baja</option>
        <option value="estable">→ Estable</option>
        <option value="arrancando">~ Arranca</option>
        <option value="sin actividad">∅ Sin act.</option>
      </select>

      <select value={filters.segmento} onChange={(e) => update('segmento', e.target.value)}>
        <option value="">Segmento: todos</option>
        <option value="Nuevo">Nuevo</option>
        <option value="Junior">Junior</option>
        <option value="Semi Sr">Semi Sr</option>
        <option value="Senior">Senior</option>
      </select>

      <span className="cnt">{count} terapeutas</span>
    </div>
  );
}
