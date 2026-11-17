'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter, TherapistView } from '@/lib/types';
import { Ojito } from '@/components/Ojito';

/**
 * Solapa En vivo → Registros (app/api/en-vivo/registros).
 *
 * Registros históricos de cada psicólogo/a, partidos en cuatro divisiones que
 * suman el total: sin 1ra sesión, 1ra sin 2da, siguen activos y dejaron.
 * Marca los hitos de 50 y 100 registros y compara la llegada a la 1ra y la
 * continuidad a la 2da contra el promedio de la plataforma:
 * - "Para mirar": 50+ registros y 10 puntos o más por debajo en alguna.
 * - "Para reconocer": 50+ registros, 10 puntos o más arriba en continuidad y
 *   no por debajo en llegada.
 * No va a CX: es para Talent.
 */

type Division = 'sin_1ra' | 'solo_1ra' | 'activo' | 'dejo';
type Psico = {
  therapist_id: string;
  pais: string;
  registros: number;
  sin_1ra: number;
  solo_1ra: number;
  activo: number;
  dejo: number;
  agendados_sin_1ra: number;
  registros_maduros: number;
  llegaron: number;
  primeras_maduras: number;
  con_2da: number;
  hito_50: string | null;
  hito_100: string | null;
};
type Paciente = {
  paciente_id: number;
  paciente: string;
  division: Division;
  realizadas: number;
  agendada: boolean;
  vinculo: string;
  primera: string | null;
  ultima: string | null;
};
type Senal = 'mirar' | 'reconocer' | null;
type Fila = Psico & {
  nombre: string;
  mx: TherapistView | undefined;
  llegada: number | null;
  continuidad: number | null;
  senal: Senal;
  hitoReciente: 50 | 100 | null;
};
type Col = 'nombre' | 'registros' | 'sin_1ra' | 'solo_1ra' | 'activo' | 'dejo' | 'llegada' | 'continuidad';
type Filtro = 'todos' | '100' | '50' | 'reciente' | 'mirar' | 'reconocer';

const PUNTOS = 10;
const MIN_REGISTROS = 50;
const MIN_MUESTRA = 10;
const DIAS_RECIENTE = 30;

const DIVISIONES: { k: Division; label: string; ayuda: string; color?: string }[] = [
  { k: 'sin_1ra', label: 'Sin 1ra sesión', ayuda: 'Nunca tuvieron una sesión realizada con este psicólogo/a', color: 'var(--am)' },
  { k: 'solo_1ra', label: '1ra sin 2da', ayuda: 'Tuvieron una sola sesión realizada', color: 'var(--r)' },
  { k: 'activo', label: 'Siguen activos', ayuda: '2 o más sesiones, y una realizada en los últimos 30 días o una agendada', color: 'var(--v)' },
  { k: 'dejo', label: 'Dejaron', ayuda: '2 o más sesiones, pero ninguna en 30 días ni agendada' },
];

const ESTILOS = `
.rg-sub { font-size:11px; color:var(--t3); margin:4px 0 8px; line-height:1.4; }
.rg-err { background:rgba(240,82,82,.08); border:1px solid rgba(240,82,82,.3); color:var(--r); border-radius:6px; padding:6px 10px; font-size:11px; margin-bottom:8px; }
.rg-th { cursor:pointer; user-select:none; white-space:nowrap; }
.rg-th:hover { color:var(--t); }
.rg-fila { cursor:pointer; }
.rg-fila:hover td { background:rgba(79,142,247,.06); }
.rg-fila.on td { background:rgba(79,142,247,.1); }
.rg-n { font-family:var(--m); font-size:12px; white-space:nowrap; }
.rg-n small { color:var(--t3); margin-left:4px; font-size:10px; }
.rg-hito { display:inline-block; font-size:10px; padding:1px 6px; border-radius:10px; margin-left:6px; border:1px solid var(--bd2); color:var(--t2); white-space:nowrap; }
.rg-hito.nuevo { color:var(--ac); border-color:rgba(79,142,247,.5); background:rgba(79,142,247,.12); }
.rg-sn { display:inline-block; font-size:10.5px; padding:2px 7px; border-radius:10px; white-space:nowrap; }
.rg-sn.mirar { color:var(--r); border:1px solid rgba(240,82,82,.4); background:rgba(240,82,82,.1); }
.rg-sn.reconocer { color:var(--v); border:1px solid rgba(52,211,153,.35); background:rgba(52,211,153,.1); }
.rg-bar { display:flex; height:8px; width:120px; border-radius:3px; overflow:hidden; background:var(--bg4); }
.rg-det { background:var(--bg2); padding:10px 12px !important; }
.rg-tabs { display:flex; gap:6px; flex-wrap:wrap; margin-bottom:8px; align-items:center; }
.rg-tabs .btn.on { border-color:var(--ac); color:var(--t); background:rgba(79,142,247,.1); }
.rg-busca { flex:1; max-width:320px; padding:6px 10px; border:1px solid rgba(128,128,128,.35); border-radius:6px; background:transparent; color:var(--t); font-size:12px; }
.rg-ps { cursor:pointer; }
.rg-ps:hover { color:var(--ac); text-decoration:underline; }
.k.on { border-color:var(--ac); background:rgba(79,142,247,.1); }
`;

const pct = (n: number, d: number) => (d >= MIN_MUESTRA ? n / d : null);
const fmtPct = (x: number | null) => (x == null ? '—' : `${Math.round(x * 100)}%`);
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function ddmmaa(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString();
  return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}`;
}

async function token(): Promise<string> {
  const { data } = await getSupabase().auth.getSession();
  return data?.session?.access_token ?? '';
}

export function RegistrosVivo({
  pais,
  therapists,
  onRowClick,
}: {
  pais: PaisFilter;
  therapists: TherapistView[];
  onRowClick: (t: TherapistView) => void;
}) {
  const [psicos, setPsicos] = useState<Psico[]>([]);
  const [prom, setProm] = useState<{ llegada: number | null; continuidad: number | null }>({ llegada: null, continuidad: null });
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nombres, setNombres] = useState<Map<string, string>>(new Map());
  const [filtro, setFiltro] = useState<Filtro>('todos');
  const [busca, setBusca] = useState('');
  const [orden, setOrden] = useState<{ col: Col; asc: boolean }>({ col: 'registros', asc: false });
  const [abierto, setAbierto] = useState<string | null>(null);
  const [division, setDivision] = useState<Division>('solo_1ra');
  const [pacientes, setPacientes] = useState<Record<string, Paciente[] | 'cargando' | string>>({});

  const matrixPor = useMemo(() => new Map(therapists.map((t) => [t.id, t])), [therapists]);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/en-vivo/registros', { headers: { Authorization: `Bearer ${await token()}` } });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        const ps = (json.psicologos ?? []) as Psico[];
        setPsicos(ps);
        setProm(json.promedio ?? { llegada: null, continuidad: null });
        // Psicólogos/as que no están en la Matrix del mes: nombre desde `therapists`.
        const faltan = ps.map((p) => p.therapist_id).filter((id) => !matrixPor.has(id));
        const m = new Map<string, string>();
        const sb = getSupabase();
        for (let i = 0; i < faltan.length; i += 200) {
          const { data } = await sb.from('therapists').select('id,nombre').in('id', faltan.slice(i, i + 200));
          for (const t of (data ?? []) as { id: string; nombre: string }[]) m.set(String(t.id), t.nombre);
        }
        setNombres(m);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCargando(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abrir = useCallback(
    async (tid: string) => {
      setAbierto((x) => (x === tid ? null : tid));
      if (pacientes[tid] && typeof pacientes[tid] !== 'string') return;
      setPacientes((p) => ({ ...p, [tid]: 'cargando' }));
      try {
        const res = await fetch(`/api/en-vivo/registros?tid=${encodeURIComponent(tid)}`, { headers: { Authorization: `Bearer ${await token()}` } });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        setPacientes((p) => ({ ...p, [tid]: (json.pacientes ?? []) as Paciente[] }));
      } catch (e) {
        setPacientes((p) => ({ ...p, [tid]: `No se pudo leer: ${e instanceof Error ? e.message : String(e)}` }));
      }
    },
    [pacientes],
  );

  const filas = useMemo<Fila[]>(() => {
    const ahora = Date.now();
    const reciente = (iso: string | null) => Boolean(iso && ahora - new Date(iso).getTime() <= DIAS_RECIENTE * 86_400_000);
    return psicos.map((p) => {
      const mx = matrixPor.get(p.therapist_id);
      const llegada = pct(p.llegaron, p.registros_maduros);
      const continuidad = pct(p.con_2da, p.primeras_maduras);
      let senal: Senal = null;
      if (p.registros >= MIN_REGISTROS && prom.llegada != null && prom.continuidad != null) {
        const dL = llegada == null ? 0 : (llegada - prom.llegada) * 100;
        const dC = continuidad == null ? 0 : (continuidad - prom.continuidad) * 100;
        if (dL <= -PUNTOS || dC <= -PUNTOS) senal = 'mirar';
        else if (dC >= PUNTOS && dL > -PUNTOS / 2) senal = 'reconocer';
      }
      const hitoReciente: 50 | 100 | null = reciente(p.hito_100) ? 100 : reciente(p.hito_50) ? 50 : null;
      return {
        ...p,
        nombre: mx?.nombre ?? nombres.get(p.therapist_id) ?? `Terapeuta #${p.therapist_id}`,
        mx,
        llegada,
        continuidad,
        senal,
        hitoReciente,
      };
    });
  }, [psicos, matrixPor, nombres, prom]);

  const enPais = useMemo(() => filas.filter((f) => pais === 'T' || f.pais === pais), [filas, pais]);

  const cuenta = useMemo(
    () => ({
      todos: enPais.length,
      '100': enPais.filter((f) => f.registros >= 100).length,
      '50': enPais.filter((f) => f.registros >= 50 && f.registros < 100).length,
      reciente: enPais.filter((f) => f.hitoReciente).length,
      mirar: enPais.filter((f) => f.senal === 'mirar').length,
      reconocer: enPais.filter((f) => f.senal === 'reconocer').length,
    }),
    [enPais],
  );

  const visibles = useMemo(() => {
    const q = norm(busca.trim());
    const out = enPais.filter((f) => {
      if (q && !norm(f.nombre).includes(q) && !f.therapist_id.includes(q)) return false;
      switch (filtro) {
        case '100': return f.registros >= 100;
        case '50': return f.registros >= 50 && f.registros < 100;
        case 'reciente': return Boolean(f.hitoReciente);
        case 'mirar': return f.senal === 'mirar';
        case 'reconocer': return f.senal === 'reconocer';
        default: return true;
      }
    });
    const col = orden.col;
    const clave = (f: Fila): number | string => {
      if (col === 'nombre') return f.nombre;
      if (col === 'llegada' || col === 'continuidad') return f[col] ?? -1;
      if (col === 'registros') return f.registros;
      // Divisiones: por porcentaje del total, que es lo que se compara.
      return f.registros ? f[col] / f.registros : 0;
    };
    return out.sort((a, b) => {
      const x = clave(a);
      const y = clave(b);
      const c = typeof x === 'string' ? x.localeCompare(String(y), 'es') : x - (y as number);
      return (orden.asc ? 1 : -1) * c || b.registros - a.registros;
    });
  }, [enPais, busca, filtro, orden]);

  if (cargando) return <div className="loading-wrap">Cargando registros…</div>;

  const th = (col: Col, label: string, title?: string) => {
    const on = orden.col === col;
    return (
      <th
        className="rg-th"
        title={`${title ? `${title}. ` : ''}Tocá para ordenar`}
        style={on ? { color: 'var(--t)' } : undefined}
        onClick={() => setOrden({ col, asc: on ? !orden.asc : col === 'nombre' })}
      >
        {label}
        {on ? (orden.asc ? ' ▲' : ' ▼') : ''}
      </th>
    );
  };

  const tarjeta = (k: Filtro, valor: number, label: string, color?: string, title?: string) => (
    <div className={`k ${filtro === k ? 'on' : ''}`} onClick={() => setFiltro((x) => (x === k ? 'todos' : k))} title={title}>
      <div className="kv" style={{ color }}>{valor}</div>
      <div className="kl">{label}</div>
    </div>
  );

  const celda = (f: Fila, k: Division) => {
    const color = DIVISIONES.find((d) => d.k === k)?.color;
    return (
      <td className="rg-n" style={{ color: f[k] ? color : 'var(--t3)' }}>
        {f[k]}
        <small>{f.registros ? Math.round((f[k] / f.registros) * 100) : 0}%</small>
      </td>
    );
  };

  const vsProm = (x: number | null, p: number | null) => {
    if (x == null || p == null) return undefined;
    const d = (x - p) * 100;
    return d <= -PUNTOS ? 'var(--r)' : d >= PUNTOS ? 'var(--v)' : undefined;
  };

  return (
    <>
      <style>{ESTILOS}</style>
      {error && <div className="rg-err">{error}</div>}

      <div className="ks" style={{ marginTop: 8 }}>
        {tarjeta('todos', cuenta.todos, 'Psicólogos/as')}
        {tarjeta('100', cuenta['100'], '100+ registros')}
        {tarjeta('50', cuenta['50'], '50 a 99 registros')}
        {tarjeta('reciente', cuenta.reciente, `Llegaron a 50 o 100 (últ. ${DIAS_RECIENTE} días)`, 'var(--ac)')}
        {tarjeta('mirar', cuenta.mirar, 'Para mirar', 'var(--r)', `50+ registros y ${PUNTOS} puntos o más por debajo del promedio en llegada a la 1ra o en continuidad a la 2da`)}
        {tarjeta('reconocer', cuenta.reconocer, 'Para reconocer', 'var(--v)', `50+ registros y ${PUNTOS} puntos o más por encima del promedio en continuidad a la 2da`)}
      </div>
      <div className="rg-sub">
        Promedio Tu Terapia: <b>{fmtPct(prom.llegada)}</b> de los registros llega a la 1ra sesión y <b>{fmtPct(prom.continuidad)}</b> de los
        que tienen la 1ra vuelve a una 2da. Registros = todos los pacientes históricos asignados o atendidos por cada psicólogo/a.
      </div>

      <div className="rg-tabs">
        <input className="rg-busca" type="search" placeholder="Buscar psicólogo/a" value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="cnt">{visibles.length} psicólogos/as</span>
      </div>

      <div className="tw">
        <table>
          <thead>
            <tr>
              {th('nombre', 'Psicólogo/a')}
              <th className="c-p">País</th>
              {th('registros', 'Registros', 'Total histórico. La medalla marca los hitos de 50 y 100; en azul, si llegó en los últimos 30 días')}
              <th title="Cómo se reparten los registros">Reparto</th>
              {th('sin_1ra', 'Sin 1ra', DIVISIONES[0].ayuda)}
              {th('solo_1ra', '1ra sin 2da', DIVISIONES[1].ayuda)}
              {th('activo', 'Activos', DIVISIONES[2].ayuda)}
              {th('dejo', 'Dejaron', DIVISIONES[3].ayuda)}
              {th('llegada', 'Llegada 1ra', 'De los registros de hace más de 30 días, % que tuvo la 1ra sesión')}
              {th('continuidad', 'Vuelven a 2da', 'De los que tuvieron la 1ra hace más de 35 días, % que tuvo una 2da')}
              <th>Señal</th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((f) => {
              const on = abierto === f.therapist_id;
              const hito = f.registros >= 100 ? 100 : f.registros >= 50 ? 50 : null;
              const fechaHito = hito === 100 ? f.hito_100 : hito === 50 ? f.hito_50 : null;
              const det = pacientes[f.therapist_id];
              return (
                <Fragment key={f.therapist_id}>
                  <tr className={`rg-fila ${on ? 'on' : ''}`} onClick={() => abrir(f.therapist_id)} title="Ver sus pacientes por división">
                    <td className="c-n tn">
                      {f.nombre}
                      <Ojito t={f.mx} />
                    </td>
                    <td className="c-p"><span className={`b ${f.pais === 'AR' ? 'bar' : 'buy'}`}>{f.pais}</span></td>
                    <td className="rg-n">
                      {f.registros}
                      {hito ? (
                        <span className={`rg-hito ${f.hitoReciente ? 'nuevo' : ''}`} title={`Llegó a ${hito} el ${ddmmaa(fechaHito)}`}>
                          {hito === 100 ? '🏆' : '🏅'} {hito} · {ddmmaa(fechaHito)}
                        </span>
                      ) : f.registros >= 40 ? (
                        <small>faltan {50 - f.registros} para 50</small>
                      ) : null}
                    </td>
                    <td>
                      <div className="rg-bar">
                        {DIVISIONES.map((d) => (
                          <div
                            key={d.k}
                            style={{ width: `${f.registros ? (f[d.k] / f.registros) * 100 : 0}%`, background: d.color ?? 'var(--t3)', opacity: 0.8 }}
                            title={`${d.label}: ${f[d.k]}`}
                          />
                        ))}
                      </div>
                    </td>
                    {celda(f, 'sin_1ra')}
                    {celda(f, 'solo_1ra')}
                    {celda(f, 'activo')}
                    {celda(f, 'dejo')}
                    <td className="rg-n" style={{ color: vsProm(f.llegada, prom.llegada) }}>{fmtPct(f.llegada)}</td>
                    <td className="rg-n" style={{ color: vsProm(f.continuidad, prom.continuidad) }}>{fmtPct(f.continuidad)}</td>
                    <td>
                      {f.senal === 'mirar' && <span className="rg-sn mirar">Para mirar</span>}
                      {f.senal === 'reconocer' && <span className="rg-sn reconocer">Para reconocer</span>}
                    </td>
                  </tr>
                  {on && (
                    <tr>
                      <td colSpan={11} className="rg-det" onClick={(e) => e.stopPropagation()}>
                        <div className="rg-tabs">
                          {DIVISIONES.map((d) => (
                            <button key={d.k} className={`btn ${division === d.k ? 'on' : ''}`} onClick={() => setDivision(d.k)} title={d.ayuda}>
                              {d.label} ({f[d.k]})
                            </button>
                          ))}
                          {f.mx && (
                            <span className="rg-ps" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={() => onRowClick(f.mx!)}>
                              Ver perfil ↗
                            </span>
                          )}
                        </div>
                        {det === 'cargando' || det === undefined ? (
                          <div className="rg-sub">Cargando pacientes…</div>
                        ) : typeof det === 'string' ? (
                          <div className="rg-err">{det}</div>
                        ) : (
                          <ListaPacientes pacientes={det.filter((p) => p.division === division)} />
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rg-sub" style={{ marginTop: 6 }}>
        Tocá un psicólogo/a para ver sus pacientes en cada división. Llegada y continuidad se calculan solo con registros que ya tuvieron
        tiempo (30 y 35 días, como las alertas A y B) y desde 10 casos; en rojo o verde si están {PUNTOS} puntos por debajo o por encima del
        promedio. Los pacientes reasignados sin ninguna sesión no quedan en el histórico de su psicólogo/a anterior: la plataforma no guarda
        esa asignación. El nombre del paciente se lee en el momento y no se guarda en el dashboard.
      </div>
    </>
  );
}

function ListaPacientes({ pacientes }: { pacientes: Paciente[] }) {
  if (!pacientes.length) return <div className="rg-sub">No hay pacientes en esta división.</div>;
  return (
    <div className="tw" style={{ maxHeight: 360, overflowY: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Paciente</th>
            <th title="Primer turno con este psicólogo/a o, si no tuvo, fecha de registro">Desde</th>
            <th>Sesiones</th>
            <th>1ra</th>
            <th>Última</th>
            <th>Agendada</th>
          </tr>
        </thead>
        <tbody>
          {pacientes.map((p) => (
            <tr key={p.paciente_id}>
              <td>
                {p.paciente || `Paciente #${p.paciente_id}`}
                {p.paciente && <span className="tm" style={{ color: 'var(--t3)' }}> #{p.paciente_id}</span>}
              </td>
              <td className="tm">{ddmmaa(p.vinculo)}</td>
              <td className="tm">{p.realizadas}</td>
              <td className="tm">{ddmmaa(p.primera)}</td>
              <td className="tm">{ddmmaa(p.ultima)}</td>
              <td className="tm" style={{ color: p.agendada ? 'var(--v)' : 'var(--t3)' }}>{p.agendada ? 'Sí' : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
