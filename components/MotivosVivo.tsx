'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter, TherapistView } from '@/lib/types';

/**
 * Solapa En vivo → Motivos: lo que cargan los psicólogos/as en la plataforma
 * (app/api/en-vivo/motivos).
 *
 * - Cancelaciones: cuando cancelan o mueven una sesión, la plataforma les pide
 *   el motivo. La respuesta trae la sesión.
 * - Pacientes inactivos: cuando pasan a un paciente a inactivos aparece
 *   "Motivo de inactividad" (nunca contestó, no puede seguir pagando, abandono,
 *   le di el alta, otro). No trae sesión.
 *
 * Las encuestas empezaron el 2026-11-05: antes no hay datos.
 */

type Clase = 'cancelacion' | 'inactividad';
type Fila = {
  id: number;
  login_id: string;
  pais: string | null;
  motivo: string;
  titulo: string;
  texto: string;
  clase: Clase;
  paciente_id: string | null;
  paciente: string;
  sesion_fecha: string | null;
  sesion_hora: string | null;
  fecha: string;
};

const ESTILOS = `
.mv-err { background:rgba(240,82,82,.08); border:1px solid rgba(240,82,82,.3); color:var(--r); border-radius:6px; padding:6px 10px; font-size:11px; margin-bottom:8px; }
.mv-sub { font-size:11px; color:var(--t3); margin:4px 0 8px; line-height:1.4; }
.mv-hd { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:16px 0 4px; flex-wrap:wrap; }
.mv-hd h3 { margin:0; font-size:14px; }
.mv-bt { display:flex; gap:6px; margin-top:8px; }
.mv-bt .btn.on { border-color:var(--ac); color:var(--t); background:rgba(79,142,247,.1); }
.mv-ps { cursor:pointer; }
.mv-ps:hover { color:var(--ac); text-decoration:underline; }
.mv-bar { height:6px; background:var(--ac); border-radius:3px; opacity:.7; }
.mv-txt { font-size:11px; color:var(--t2); max-width:360px; white-space:normal; line-height:1.35; }
.mv-fila { cursor:pointer; }
.mv-fila:hover td { background:rgba(79,142,247,.06); }
.mv-hd, .ks { scroll-margin-top:80px; }
.mv-th { cursor:pointer; user-select:none; white-space:nowrap; }
.mv-th:hover { color:var(--t); }
.mv-vz { cursor:pointer; }
.mv-vz:hover { text-decoration:underline; }
`;

// Columnas que se pueden ordenar tocando el encabezado.
type ColDet = 'fecha' | 'psico' | 'paciente' | 'veces' | 'sesion' | 'motivo';
type ColPs = 'nombre' | 'n' | 'pacientes' | 'repetidos';
type Orden<C> = { col: C; asc: boolean };
// Texto de A a Z; números y fechas, de mayor a menor (lo que se suele querer ver primero).
const ASC_PRIMERO = new Set<string>(['psico', 'paciente', 'motivo', 'nombre']);

const nombrePac = (f: Pick<Fila, 'paciente' | 'paciente_id'>) => f.paciente || (f.paciente_id ? `Paciente #${f.paciente_id}` : '—');

function cmp(a: string | number, b: string | number): number {
  return typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'es', { sensitivity: 'base' });
}

function diaLocal(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function ddmm(ts: string | null): string {
  if (!ts) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(ts) ? ts : diaLocal(new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`));
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

export function MotivosVivo({
  pais,
  therapists,
  onRowClick,
}: {
  pais: PaisFilter;
  therapists: TherapistView[];
  onRowClick: (t: TherapistView) => void;
}) {
  const [filas, setFilas] = useState<Fila[]>([]);
  const [clase, setClase] = useState<Clase>('cancelacion');
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [ters, setTers] = useState<Map<string, { nombre: string; activo: boolean }>>(new Map());
  // Filtros del detalle: se eligen tocando un cuadro, un motivo, un psicólogo/a o un paciente.
  const [filtroPs, setFiltroPs] = useState<string | null>(null);
  const [filtroMotivo, setFiltroMotivo] = useState<string | null>(null);
  const [filtroPac, setFiltroPac] = useState<string | null>(null);
  // Orden elegido tocando un encabezado. Sin elegir: el detalle va por fecha
  // (o agrupado por paciente si hay un psicólogo/a elegido).
  const [ordDet, setOrdDet] = useState<Orden<ColDet> | null>(null);
  const [ordPs, setOrdPs] = useState<Orden<ColPs>>({ col: 'n', asc: false });

  const matrixPor = useMemo(() => new Map(therapists.map((t) => [t.id, t])), [therapists]);
  const nombreDe = useCallback(
    (id: string) => matrixPor.get(id)?.nombre ?? ters.get(id)?.nombre ?? `Terapeuta #${id}`,
    [matrixPor, ters],
  );
  const rojo = useCallback((id: string) => (ters.get(id)?.activo === false ? 'var(--r)' : undefined), [ters]);

  useEffect(() => {
    (async () => {
      try {
        const sb = getSupabase();
        const { data: s } = await sb.auth.getSession();
        const res = await fetch('/api/en-vivo/motivos', { headers: { Authorization: `Bearer ${s?.session?.access_token ?? ''}` } });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        const fs = (json.filas ?? []) as Fila[];
        setFilas(fs);
        // Psicólogos/as que no están en la Matrix del mes: nombre desde `therapists`.
        const faltan = [...new Set(fs.map((f) => f.login_id))].filter((id) => !matrixPor.has(id));
        const m = new Map<string, { nombre: string; activo: boolean }>();
        for (let i = 0; i < faltan.length; i += 200) {
          const { data } = await sb.from('therapists').select('id,nombre,activo').in('id', faltan.slice(i, i + 200));
          for (const t of (data ?? []) as { id: string; nombre: string; activo: boolean }[]) m.set(String(t.id), { nombre: t.nombre, activo: t.activo });
        }
        setTers(m);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCargando(false);
      }
    })();
    // matrixPor solo se usa para saber a quién buscar: no hace falta recargar si cambia.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const enPais = useMemo(() => filas.filter((f) => pais === 'T' || f.pais === pais), [filas, pais]);
  const cuenta = useMemo(
    () => ({
      cancelacion: enPais.filter((f) => f.clase === 'cancelacion').length,
      inactividad: enPais.filter((f) => f.clase === 'inactividad').length,
    }),
    [enPais],
  );
  const visibles = useMemo(() => enPais.filter((f) => f.clase === clase), [enPais, clase]);
  const desde = useMemo(() => filas.reduce<string | null>((m, f) => (!m || f.fecha < m ? f.fecha : m), null), [filas]);

  const porMotivo = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of visibles) m.set(f.titulo || f.motivo, (m.get(f.titulo || f.motivo) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [visibles]);

  const porPsico = useMemo(() => {
    const m = new Map<string, { n: number; motivos: Map<string, number>; pacientes: Map<string, number> }>();
    for (const f of visibles) {
      const x = m.get(f.login_id) ?? { n: 0, motivos: new Map<string, number>(), pacientes: new Map<string, number>() };
      x.n++;
      x.motivos.set(f.titulo || f.motivo, (x.motivos.get(f.titulo || f.motivo) ?? 0) + 1);
      if (f.paciente_id) x.pacientes.set(f.paciente_id, (x.pacientes.get(f.paciente_id) ?? 0) + 1);
      m.set(f.login_id, x);
    }
    return [...m.entries()];
  }, [visibles]);

  // Cuántas veces aparece cada paciente con su psicólogo/a: así se ve si a un
  // mismo paciente le cancelaron varias veces.
  const vecesPar = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of visibles) if (f.paciente_id) m.set(`${f.login_id}|${f.paciente_id}`, (m.get(`${f.login_id}|${f.paciente_id}`) ?? 0) + 1);
    return m;
  }, [visibles]);

  // Qué número de cancelación es cada una dentro de su par psicólogo/a-paciente,
  // por fecha de la sesión (o de la respuesta): 1 de 2, 2 de 2…
  const numeroEnPar = useMemo(() => {
    const grupos = new Map<string, Fila[]>();
    for (const f of visibles) {
      if (!f.paciente_id) continue;
      const k = `${f.login_id}|${f.paciente_id}`;
      grupos.set(k, [...(grupos.get(k) ?? []), f]);
    }
    const m = new Map<number, number>();
    for (const g of grupos.values()) {
      g.sort((a, b) => `${a.sesion_fecha ?? a.fecha} ${a.sesion_hora ?? ''}`.localeCompare(`${b.sesion_fecha ?? b.fecha} ${b.sesion_hora ?? ''}`));
      g.forEach((f, i) => m.set(f.id, i + 1));
    }
    return m;
  }, [visibles]);

  const detalle = useMemo(() => {
    const out = visibles.filter(
      (f) =>
        (!filtroPs || f.login_id === filtroPs) &&
        (!filtroMotivo || (f.titulo || f.motivo) === filtroMotivo) &&
        (!filtroPac || f.paciente_id === filtroPac),
    );
    const veces = (f: Fila) => vecesPar.get(`${f.login_id}|${f.paciente_id}`) ?? 1;
    if (ordDet) {
      const clave = (f: Fila): string | number => {
        switch (ordDet.col) {
          case 'fecha': return f.fecha;
          case 'psico': return nombreDe(f.login_id);
          case 'paciente': return nombrePac(f);
          case 'veces': return veces(f);
          case 'sesion': return `${f.sesion_fecha ?? ''} ${f.sesion_hora ?? ''}`;
          case 'motivo': return f.titulo || f.motivo;
        }
      };
      // Desempate: mismo psicólogo/a y paciente juntos, lo último primero.
      return out.sort(
        (a, b) =>
          (ordDet.asc ? 1 : -1) * cmp(clave(a), clave(b)) ||
          cmp(nombreDe(a.login_id), nombreDe(b.login_id)) ||
          String(a.paciente_id).localeCompare(String(b.paciente_id)) ||
          b.fecha.localeCompare(a.fecha),
      );
    }
    // Con un psicólogo/a elegido, agrupado por paciente; si no, lo último primero.
    return filtroPs
      ? out.sort(
          (a, b) =>
            (vecesPar.get(`${b.login_id}|${b.paciente_id}`) ?? 0) - (vecesPar.get(`${a.login_id}|${a.paciente_id}`) ?? 0) ||
            String(a.paciente_id).localeCompare(String(b.paciente_id)) ||
            b.fecha.localeCompare(a.fecha),
        )
      : out.sort((a, b) => b.fecha.localeCompare(a.fecha));
  }, [visibles, filtroPs, filtroMotivo, filtroPac, vecesPar, ordDet, nombreDe]);

  const psicosOrdenados = useMemo(() => {
    const clave = ([id, x]: (typeof porPsico)[number]): string | number => {
      switch (ordPs.col) {
        case 'nombre': return nombreDe(id);
        case 'n': return x.n;
        case 'pacientes': return x.pacientes.size;
        case 'repetidos': return [...x.pacientes.values()].filter((n) => n >= 2).length;
      }
    };
    return [...porPsico].sort((a, b) => (ordPs.asc ? 1 : -1) * cmp(clave(a), clave(b)) || b[1].n - a[1].n);
  }, [porPsico, ordPs, nombreDe]);

  if (cargando) return <div className="loading-wrap">Cargando motivos…</div>;

  const max = porMotivo[0]?.[1] ?? 1;
  const total = visibles.length;
  const esCancel = clase === 'cancelacion';
  const hayFiltro = Boolean(filtroPs || filtroMotivo || filtroPac);
  const irA = (id: string) => setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0);
  const filtrar = (ps: string | null, motivo: string | null, pac: string | null) => {
    setFiltroPs(ps);
    setFiltroMotivo(motivo);
    setFiltroPac(pac);
    irA('mv-detalle');
  };
  const cambiarClase = (c: Clase) => {
    setClase(c);
    setFiltroPs(null);
    setFiltroMotivo(null);
    setFiltroPac(null);
  };

  const ps = (id: string, clickable = true) => {
    const mx = matrixPor.get(id);
    return (
      <span
        className={clickable && mx ? 'mv-ps' : ''}
        style={{ color: rojo(id) }}
        title={rojo(id) ? 'Ya no está en la plataforma' : undefined}
        onClick={(e) => {
          if (!clickable || !mx) return;
          e.stopPropagation();
          onRowClick(mx);
        }}
      >
        {nombreDe(id)}
      </span>
    );
  };
  // Encabezado que ordena: tocarlo de nuevo invierte el orden.
  const th = <C extends string>(
    orden: Orden<C> | null,
    setOrden: (o: Orden<C>) => void,
    col: C,
    label: string,
    extra: { title?: string; className?: string } = {},
  ) => {
    const activo = orden?.col === col;
    return (
      <th
        className={`mv-th ${extra.className ?? ''}`}
        title={`${extra.title ? `${extra.title}. ` : ''}Tocá para ordenar`}
        onClick={() => setOrden({ col, asc: activo ? !orden!.asc : ASC_PRIMERO.has(col) })}
        style={activo ? { color: 'var(--t)' } : undefined}
      >
        {label}
        {activo ? (orden!.asc ? ' ▲' : ' ▼') : ''}
      </th>
    );
  };

  return (
    <>
      <style>{ESTILOS}</style>
      {error && <div className="mv-err">{error}</div>}

      <div className="mv-bt">
        <button className={`btn ${esCancel ? 'on' : ''}`} onClick={() => cambiarClase('cancelacion')}>Cancelaciones ({cuenta.cancelacion})</button>
        <button className={`btn ${!esCancel ? 'on' : ''}`} onClick={() => cambiarClase('inactividad')}>Pacientes inactivos ({cuenta.inactividad})</button>
      </div>
      <div className="mv-sub">
        {esCancel
          ? 'Lo que contesta el psicólogo/a cuando cancela o mueve una sesión.'
          : 'Lo que contesta el psicólogo/a cuando pasa a un paciente a inactivos ("Motivo de inactividad").'}{' '}
        Las encuestas existen desde el {ddmm(desde ?? '2026-11-05')}: antes no hay datos. Tocá un motivo o un psicólogo/a para ver
        sus {esCancel ? 'cancelaciones' : 'pacientes'} abajo.
      </div>

      <div className="ks">
        <div className="k" onClick={() => filtrar(null, null, null)} title="Ver todas en el detalle">
          <div className="kv">{total}</div>
          <div className="kl">{esCancel ? 'Cancelaciones con motivo' : 'Pacientes pasados a inactivos'}</div>
        </div>
        <div className="k" onClick={() => irA('mv-psicos')} title="Ver por psicólogo/a">
          <div className="kv">{porPsico.length}</div>
          <div className="kl">Psicólogos/as</div>
        </div>
        <div className="k" onClick={() => porMotivo[0] && filtrar(null, porMotivo[0][0], null)} title="Ver las de este motivo">
          <div className="kv" style={{ fontSize: 15 }}>{porMotivo[0]?.[0] ?? '—'}</div>
          <div className="kl">Motivo más elegido{porMotivo[0] ? ` · ${Math.round((porMotivo[0][1] / total) * 100)}%` : ''}</div>
        </div>
      </div>

      {total === 0 ? (
        <div className="mv-sub" style={{ marginTop: 12 }}>
          {esCancel
            ? 'Todavía no hay cancelaciones con motivo con estos filtros.'
            : 'Todavía no hay respuestas de "Motivo de inactividad". Van a aparecer acá a medida que los psicólogos/as pasen pacientes a inactivos.'}
        </div>
      ) : (
        <>
          <div className="mv-hd"><h3>Por motivo</h3></div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  <th>Motivo</th>
                  <th>Veces</th>
                  <th>%</th>
                  <th style={{ width: '35%' }}></th>
                </tr>
              </thead>
              <tbody>
                {porMotivo.map(([m, n]) => (
                  <tr key={m} className="mv-fila" onClick={() => filtrar(null, m, null)} title="Ver las de este motivo">
                    <td>{m}</td>
                    <td className="tm">{n}</td>
                    <td className="tm">{Math.round((n / total) * 100)}%</td>
                    <td><div className="mv-bar" style={{ width: `${(n / max) * 100}%` }} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mv-hd" id="mv-psicos"><h3>Por psicólogo/a</h3></div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  {th(ordPs, setOrdPs, 'nombre', 'Psicólogo/a', { className: 'c-n' })}
                  {th(ordPs, setOrdPs, 'n', esCancel ? 'Cancelaciones' : 'Pacientes')}
                  {esCancel && th(ordPs, setOrdPs, 'pacientes', 'Pacientes distintos', { title: 'A cuántos pacientes distintos les canceló' })}
                  {esCancel && th(ordPs, setOrdPs, 'repetidos', 'Pacientes con 2+', { title: 'Cuántos de esos pacientes tuvieron 2 cancelaciones o más con este psicólogo/a' })}
                  <th>Motivos</th>
                </tr>
              </thead>
              <tbody>
                {psicosOrdenados.map(([id, x]) => {
                  const repetidos = [...x.pacientes.values()].filter((n) => n >= 2).length;
                  return (
                    <tr key={id} className="mv-fila" onClick={() => filtrar(id, null, null)} title="Ver sus cancelaciones abajo">
                      <td className="c-n">{ps(id, false)}</td>
                      <td className="tm">{x.n}</td>
                      {esCancel && <td className="tm">{x.pacientes.size}</td>}
                      {esCancel && <td className="tm" style={{ color: repetidos ? 'var(--am)' : undefined }}>{repetidos || '—'}</td>}
                      <td className="mv-txt">
                        {[...x.motivos.entries()].sort((a, b) => b[1] - a[1]).map(([m, n]) => `${m} (${n})`).join(' · ')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mv-hd" id="mv-detalle">
            <h3>
              Detalle
              {filtroPs && <> · {ps(filtroPs)}</>}
              {filtroPac && <> · {nombrePac(detalle[0] ?? ({ paciente: '', paciente_id: filtroPac } as Fila))}</>}
              {filtroMotivo && <> · {filtroMotivo}</>}
              <span className="mv-sub" style={{ marginLeft: 6 }}>({detalle.length})</span>
            </h3>
            {hayFiltro && <button className="btn" onClick={() => filtrar(null, null, null)}>Ver todas</button>}
          </div>
          <div className="tw">
            <table>
              <thead>
                <tr>
                  {th(ordDet, setOrdDet, 'fecha', 'Fecha', { title: 'Cuándo contestó el psicólogo/a' })}
                  {th(ordDet, setOrdDet, 'psico', 'Psicólogo/a', { className: 'c-n' })}
                  {th(ordDet, setOrdDet, 'paciente', 'Paciente')}
                  {esCancel && th(ordDet, setOrdDet, 'veces', 'Cancelación n°', { title: 'Cuál de las cancelaciones de este paciente con este psicólogo/a es: 1 de 2 es la primera de dos' })}
                  {esCancel && th(ordDet, setOrdDet, 'sesion', 'Sesión')}
                  {th(ordDet, setOrdDet, 'motivo', 'Motivo')}
                  <th>Detalle</th>
                </tr>
              </thead>
              <tbody>
                {detalle.map((f) => {
                  const veces = f.paciente_id ? vecesPar.get(`${f.login_id}|${f.paciente_id}`) ?? 1 : 1;
                  return (
                    <tr key={f.id}>
                      <td className="tm">{ddmm(f.fecha)}</td>
                      <td className="c-n">
                        <span className="mv-ps" onClick={() => filtrar(f.login_id, null, null)} title="Ver solo sus cancelaciones">
                          {nombreDe(f.login_id)}
                        </span>
                      </td>
                      <td>
                        {f.paciente_id ? (
                          <span className="mv-ps" onClick={() => filtrar(f.login_id, null, f.paciente_id)} title="Ver solo las de este paciente">
                            {nombrePac(f)}
                          </span>
                        ) : (
                          '—'
                        )}
                        {f.paciente && f.paciente_id && <span className="tm" style={{ color: 'var(--t3)' }}> #{f.paciente_id}</span>}
                      </td>
                      {esCancel && (
                        <td className="tm" style={{ color: veces >= 2 ? 'var(--am)' : undefined, fontWeight: veces >= 2 ? 600 : undefined }}>
                          {veces >= 2 && f.paciente_id ? (
                            <span className="mv-vz" onClick={() => filtrar(f.login_id, null, f.paciente_id)} title="Ver solo las de este paciente con este psicólogo/a">
                              {numeroEnPar.get(f.id) ?? '?'} de {veces}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--t3)' }}>única</span>
                          )}
                        </td>
                      )}
                      {esCancel && (
                        <td className="tm">
                          {ddmm(f.sesion_fecha)}
                          {f.sesion_hora ? ` ${f.sesion_hora.slice(0, 5)}` : ''}
                        </td>
                      )}
                      <td>{f.titulo || f.motivo}</td>
                      <td className="mv-txt">{f.texto || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="mv-sub" style={{ marginTop: 6 }}>
        &ldquo;Cancelación n°&rdquo;: si el mismo paciente tuvo varias cancelaciones con el mismo psicólogo/a, dice cuál es (1 de 2 = la
        primera de dos, por fecha de la sesión), en naranja; tocalo para verlas juntas. &ldquo;Única&rdquo;: fue la única. Tocá un encabezado para ordenar. En rojo, los psicólogos/as que ya no están en la
        plataforma. El nombre del paciente se lee en el momento de la plataforma y no se guarda en el dashboard.
      </div>
    </>
  );
}
