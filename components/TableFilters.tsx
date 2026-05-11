'use client';

export interface FilterState {
  search: string;
  accionable: string;
  segmento: string;
  tendencia: string;
  senal: string;
}

interface TableFiltersProps {
  filters: FilterState;
  setFilters: (f: FilterState) => void;
  count: number;
}

export function TableFilters({ filters, setFilters, count }: TableFiltersProps) {
  const set = (key: keyof FilterState, value: string) =>
    setFilters({ ...filters, [key]: value });

  return (
    <div className="ctr">
      <div className="sw">
        <svg width="13" height="13" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="11" cy="11" r="8" />
          <path d="M21 21l-4.35-4.35" />
        </svg>
        <input
          className="si"
          placeholder="Buscar…"
          value={filters.search}
          onChange={(e) => set('search', e.target.value)}
        />
      </div>

      <select value={filters.accionable} onChange={(e) => set('accionable', e.target.value)}>
        <option value="">Accionable</option>
        <option value="irrecuperable">Irrecuperable</option>
        <option value="revisar_urgente">Revisar urgente</option>
        <option value="dejar_mostrar">Fantasmear</option>
        <option value="potenciar">Potenciar</option>
        <option value="retencion">Retención</option>
        <option value="cancelaciones">Cancelaciones</option>
        <option value="disponibilidad">Disponibilidad</option>
        <option value="monitorear">Monitorear</option>
      </select>

      <select value={filters.segmento} onChange={(e) => set('segmento', e.target.value)}>
        <option value="">Segmento</option>
        <option>Nuevo</option>
        <option>Junior</option>
        <option>Semi Sr</option>
        <option>Senior</option>
      </select>

      <select value={filters.tendencia} onChange={(e) => set('tendencia', e.target.value)}>
        <option value="">Tendencia</option>
        <option value="subiendo">Subiendo</option>
        <option value="estable">Estable</option>
        <option value="bajando">Bajando</option>
        <option value="arrancando">Arrancando</option>
        <option value="sin actividad">Sin actividad</option>
      </select>

      <select value={filters.senal} onChange={(e) => set('senal', e.target.value)}>
        <option value="">Señal</option>
        <option value="arrancando_bien">Arrancando bien</option>
        <option value="alerta_arranque">Alerta arranque</option>
        <option value="abandono">Abandono</option>
      </select>

      <span className="cnt">{count} terapeutas</span>
    </div>
  );
}
