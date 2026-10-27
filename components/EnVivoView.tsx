'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter, TherapistView } from '@/lib/types';

/**
 * Solapa En vivo → Todos los psicólogos.
 *
 * Lee solo de Supabase (`en_vivo_*`), que el cron diario llena desde MySQL.
 * Las definiciones de cada número están en `lib/en-vivo-sync.ts`.
 *
 * Alertas y Reseñas son las fases siguientes del mockup de Talent: se ven en
 * la barra de sub-pestañas para que se entienda dónde van, pero todavía no
 * tienen contenido.
 */

type Diario = {
  therapist_id: string;
  dia: string;
  realizadas: number;
  agendadas: number;
  sin_confirmar: number;
  canceladas: number;
};

type Terapeuta = {
  therapist_id: string;
  pais: string | null;
  pacientes_activos: number;
  registros_mes: number;
  registros_con_1ra: number;
  agendadas_7d: number;
  ultima_sesion: string | null;
  horas_disp: number | null;
};

type Sync = { corrida_en: string };

type Fila = {
  id: string;
  nombre: string;
  pais: string;
  matrix: TherapistView | null;
  dias: Diario[]; // índice 0 = día 1 del mes en curso
  sesAlDia: number;
  sesAlDiaAnt: number;
  sinConfirmarMes: number;
  canceladasMes: number;
  activos: number;
  registros: number;
  conv: number | null;
  diasSinSesion: number | null;
  prox7: number;
  hs: number | null;
};

type Orden = 'ses' | 'prox7' | 'ult' | 'nombre';
type Escala = 'dia' | 'semana';

// Estilos propios de la solapa, con las variables de globals.css. Viven acá
// para que todo lo de En vivo esté en un solo archivo.
const ESTILOS = `
.vv-top { display:flex; align-items:flex-end; justify-content:space-between; gap:8px; flex-wrap:wrap; border-bottom:1px solid var(--bd); }
.vv-sync { font-size:11px; color:var(--t2); font-family:var(--m); padding-bottom:6px; }
.vv-off { color:var(--t3); cursor:default; }
.vv-off:hover { color:var(--t3); }
.vv-chk { display:inline-flex; align-items:center; gap:5px; font-size:12px; color:var(--t2); cursor:pointer; }
.vv-leg { display:flex; gap:12px; flex-wrap:wrap; font-size:10px; color:var(--t2); margin-bottom:6px; }
.vv-leg i { display:inline-block; width:8px; height:8px; border-radius:2px; margin-right:4px; vertical-align:-1px; }
.vv-c-bar { width:170px; }
`;

const POR_PAGINA = 50;
const LOCAL_OFFSET_MS = 3 * 3_600_000;

const COLOR = {
  realizadas: 'var(--v)',
  sin_confirmar: 'var(--am)',
  agendadas: 'var(--ac)',
  canceladas: 'var(--r)',
};

/** Hoy en día local (UTC−3), 'YYYY-MM-DD'. */
function hoyLocal(): string {
  return new Date(Date.now() - LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

function diasDelMes(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Lee una tabla entera de a 1000 filas: es el tope por request de Supabase. */
async function leerTodo<T>(tabla: string, desde?: string): Promise<T[]> {
  const sb = getSupabase();
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    let q = sb.from(tabla).select('*').range(i, i + 999);
    if (desde) q = q.gte('dia', desde);
    const { data, error } = await q;
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function EnVivoView({
  pais,
  therapists,
  onRowClick,
}: {
  pais: PaisFilter;
  therapists: TherapistView[];
  onRowClick: (t: TherapistView) => void;
}) {
  const [diario, setDiario] = useState<Diario[]>([]);
  const [terapeutas, setTerapeutas] = useState<Terapeuta[]>([]);
  const [sync, setSync] = useState<Sync | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [busqueda, setBusqueda] = useState('');
  const [orden, setOrden] = useState<Orden>('ses');
  const [escala, setEscala] = useState<Escala>('dia');
  const [soloAgendaVacia, setSoloAgendaVacia] = useState(false);
  const [pagina, setPagina] = useState(0);

  const hoy = hoyLocal();
  const [y, m, d] = hoy.split('-').map(Number);
  const nDias = diasDelMes(y, m);
  const inicioMes = `${hoy.slice(0, 7)}-01`;
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const mesAnt = prev.toISOString().slice(0, 7);
  const inicioMesAnt = `${mesAnt}-01`;
  const nombreMes = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es-UY', { month: 'long', timeZone: 'UTC' });
  const nombreMesAnt = prev.toLocaleDateString('es-UY', { month: 'short', timeZone: 'UTC' });

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const sb = getSupabase();
        const [d, t, s] = await Promise.all([
          leerTodo<Diario>('en_vivo_diario', inicioMesAnt),
          leerTodo<Terapeuta>('en_vivo_terapeuta'),
          sb.from('en_vivo_sync').select('corrida_en').eq('ok', true).order('corrida_en', { ascending: false }).limit(1),
        ]);
        if (!vivo) return;
        setDiario(d);
        setTerapeutas(t);
        setSync((s.data?.[0] as Sync) ?? null);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [inicioMesAnt]);

  const filas = useMemo<Fila[]>(() => {
    const matrixPor = new Map(therapists.map((t) => [t.id, t]));
    const diarioPor = new Map<string, Diario[]>();
    for (const r of diario) {
      const arr = diarioPor.get(r.therapist_id);
      if (arr) arr.push(r);
      else diarioPor.set(r.therapist_id, [r]);
    }
    const ahora = Date.now();

    return terapeutas.map((t) => {
      const mx = matrixPor.get(t.therapist_id) ?? null;
      const propias = diarioPor.get(t.therapist_id) ?? [];
      const dias: Diario[] = Array.from({ length: nDias }, (_, i) => ({
        therapist_id: t.therapist_id,
        dia: `${hoy.slice(0, 7)}-${String(i + 1).padStart(2, '0')}`,
        realizadas: 0,
        agendadas: 0,
        sin_confirmar: 0,
        canceladas: 0,
      }));
      let sesAlDiaAnt = 0;
      for (const r of propias) {
        if (r.dia >= inicioMes && r.dia.slice(0, 7) === hoy.slice(0, 7)) {
          dias[Number(r.dia.slice(8, 10)) - 1] = r;
        } else if (r.dia.slice(0, 7) === mesAnt && Number(r.dia.slice(8, 10)) <= d) {
          // Mismo tramo del mes anterior: día 18 contra día 18, no contra el
          // mes entero, que haría parecer una caída lo que es medio mes.
          sesAlDiaAnt += r.realizadas;
        }
      }
      const hastaHoy = dias.slice(0, d);
      const sesAlDia = hastaHoy.reduce((a, r) => a + r.realizadas, 0);
      return {
        id: t.therapist_id,
        nombre: mx?.nombre ?? `Terapeuta #${t.therapist_id}`,
        pais: t.pais ?? mx?.pais ?? '—',
        matrix: mx,
        dias,
        sesAlDia,
        sesAlDiaAnt,
        sinConfirmarMes: hastaHoy.reduce((a, r) => a + r.sin_confirmar, 0),
        canceladasMes: hastaHoy.reduce((a, r) => a + r.canceladas, 0),
        activos: t.pacientes_activos,
        registros: t.registros_mes,
        conv: t.registros_mes > 0 ? Math.round((t.registros_con_1ra / t.registros_mes) * 100) : null,
        diasSinSesion: t.ultima_sesion
          ? Math.max(0, Math.floor((ahora - new Date(t.ultima_sesion).getTime()) / 86_400_000))
          : null,
        prox7: t.agendadas_7d,
        hs: t.horas_disp,
      };
    });
  }, [terapeutas, diario, therapists, nDias, hoy, inicioMes, mesAnt, d]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const out = filas
      .filter((f) => pais === 'T' || f.pais === pais)
      .filter((f) => !q || f.nombre.toLowerCase().includes(q))
      .filter((f) => !soloAgendaVacia || f.prox7 === 0);
    const cmp: Record<Orden, (a: Fila, b: Fila) => number> = {
      ses: (a, b) => b.sesAlDia - a.sesAlDia,
      prox7: (a, b) => b.prox7 - a.prox7,
      // Sin sesión nunca va al final: no es "el que más días lleva".
      ult: (a, b) => (b.diasSinSesion ?? -1) - (a.diasSinSesion ?? -1),
      nombre: (a, b) => a.nombre.localeCompare(b.nombre, 'es'),
    };
    return out.sort(cmp[orden]);
  }, [filas, pais, busqueda, soloAgendaVacia, orden]);

  useEffect(() => setPagina(0), [pais, busqueda, soloAgendaVacia, orden]);

  // Escala común a todas las filas, así una barra alta significa lo mismo en
  // cualquier terapeuta. Percentil 95 para que un día atípico no aplaste al
  // resto.
  const topeBarra = useMemo(() => {
    const totales: number[] = [];
    for (const f of visibles) {
      const grupos = escala === 'dia' ? f.dias : semanas(f.dias);
      for (const r of grupos) totales.push(r.realizadas + r.agendadas + r.sin_confirmar + r.canceladas);
    }
    totales.sort((a, b) => a - b);
    return Math.max(escala === 'dia' ? 4 : 12, totales[Math.floor(totales.length * 0.95)] ?? 0);
  }, [visibles, escala]);

  const totales = useMemo(() => {
    const t = { terapeutas: visibles.length, ses: 0, sesAnt: 0, prox7: 0, sinConfirmar: 0, canceladas: 0, agendaVacia: 0 };
    for (const f of visibles) {
      t.ses += f.sesAlDia;
      t.sesAnt += f.sesAlDiaAnt;
      t.prox7 += f.prox7;
      t.sinConfirmar += f.sinConfirmarMes;
      t.canceladas += f.canceladasMes;
      if (f.prox7 === 0) t.agendaVacia += 1;
    }
    return t;
  }, [visibles]);

  if (cargando) return <div className="loading-wrap">Cargando En vivo…</div>;
  if (error) return <div className="empty-wrap"><h3>No se pudo leer En vivo</h3><p className="tm">{error}</p></div>;
  if (terapeutas.length === 0) {
    return (
      <div className="empty-wrap">
        <h3>Todavía no hay datos en vivo</h3>
        <p style={{ color: 'var(--t2)', fontSize: 12 }}>Se llenan con la sincronización diaria de las 07:00.</p>
      </div>
    );
  }

  const paginas = Math.ceil(visibles.length / POR_PAGINA);
  const pag = visibles.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const dSes = delta(totales.ses, totales.sesAnt);

  return (
    <>
      <style>{ESTILOS}</style>
      <div className="vv-top">
        <div className="tabs" style={{ marginBottom: 0, borderBottom: 'none' }}>
          <div className="tab vv-off" title="Próxima fase">Alertas</div>
          <div className="tab on">Todos los psicólogos</div>
          <div className="tab vv-off" title="Próxima fase">Reseñas</div>
        </div>
        <div className="vv-sync">
          {sync ? `Datos al ${fechaHora(sync.corrida_en)}` : 'Sin sincronización todavía'}
          <span style={{ color: 'var(--t3)' }}> · mes en curso: {nombreMes}, día {d} de {nDias}</span>
        </div>
      </div>

      <div className="ks" style={{ marginTop: 8 }}>
        <div className="k" style={{ cursor: 'default' }}>
          <div className="kv">{totales.terapeutas}</div>
          <div className="kl">Terapeutas</div>
        </div>
        <div className="k" style={{ cursor: 'default' }}>
          <div className="kv">{totales.ses.toLocaleString('es-UY')}</div>
          <div className="kl">Sesiones al día {d}</div>
          {dSes && <div className={`kd ${dSes.cls === 'dp-u' ? 'kd-u' : dSes.cls === 'dp-d' ? 'kd-d' : 'kd-e'}`}>{dSes.label} vs {nombreMesAnt}</div>}
        </div>
        <div className="k" style={{ cursor: 'default' }}>
          <div className="kv">{totales.prox7.toLocaleString('es-UY')}</div>
          <div className="kl">Agendadas próx. 7 días</div>
        </div>
        <div className="k" style={{ cursor: 'pointer' }} onClick={() => setSoloAgendaVacia((v) => !v)}>
          <div className="kv">{totales.agendaVacia}</div>
          <div className="kl">Agenda vacía 7 días</div>
        </div>
        <div className="k" style={{ cursor: 'default' }}>
          <div className="kv" style={{ color: 'var(--am)' }}>{totales.sinConfirmar.toLocaleString('es-UY')}</div>
          <div className="kl">Sin confirmar (mes)</div>
        </div>
        <div className="k" style={{ cursor: 'default' }}>
          <div className="kv" style={{ color: 'var(--r)' }}>{totales.canceladas.toLocaleString('es-UY')}</div>
          <div className="kl">Canceladas (mes)</div>
        </div>
      </div>

      <div className="ctr">
        <div className="sw">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="si" placeholder="Buscar psicólogo..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <div className="tog">
          <button className={`togb ${escala === 'dia' ? 'on' : ''}`} onClick={() => setEscala('dia')}>Por día</button>
          <button className={`togb ${escala === 'semana' ? 'on' : ''}`} onClick={() => setEscala('semana')}>Por semana</button>
        </div>
        <select value={orden} onChange={(e) => setOrden(e.target.value as Orden)}>
          <option value="ses">Ordenar: sesiones al día ↓</option>
          <option value="prox7">Ordenar: agendadas próx. 7 días ↓</option>
          <option value="ult">Ordenar: días sin sesión ↓</option>
          <option value="nombre">Ordenar: nombre</option>
        </select>
        <label className="vv-chk">
          <input type="checkbox" checked={soloAgendaVacia} onChange={(e) => setSoloAgendaVacia(e.target.checked)} />
          Solo agenda vacía próx. 7 días
        </label>
        <span className="cnt">{visibles.length} terapeutas</span>
      </div>

      <div className="vv-leg">
        <span><i style={{ background: COLOR.realizadas }} />Realizadas</span>
        <span><i style={{ background: COLOR.sin_confirmar }} />Sin confirmar</span>
        <span><i style={{ background: COLOR.agendadas }} />Agendadas</span>
        <span><i style={{ background: COLOR.canceladas }} />Canceladas por el psicólogo</span>
        <span style={{ color: 'var(--t3)' }}>· cada barrita es un {escala === 'dia' ? 'día' : 'tramo de 7 días'} de {nombreMes}; la línea marca hoy</span>
      </div>

      <div className="tw">
        <table>
          <thead>
            <tr>
              <th className="c-n">Terapeuta</th>
              <th className="c-p">País</th>
              <th className="vv-c-bar">{nombreMes}, {escala === 'dia' ? 'día a día' : 'por semana'}</th>
              <th className="c-se" title={`Sesiones realizadas del 1 al ${d}, contra el mismo tramo de ${nombreMesAnt}`}>Ses. al {d}</th>
              <th className="c-pa" title="Pacientes con al menos una sesión realizada este mes">Pac. activos</th>
              <th className="c-rm" title="Registros del mes asignados hoy a este psicólogo">Reg. {nombreMes.slice(0, 3)}</th>
              <th className="c-cv" title="De los registros del mes, % que ya tuvo una sesión realizada con este psicólogo. Madura con el mes.">Conv.</th>
              <th className="c-ul" title="Días desde la última sesión realizada">Últ. ses.</th>
              <th className="c-rm" title="Sesiones agendadas en los próximos 7 días">Próx. 7d</th>
              <th className="c-hs" title="Horas disponibles por semana">Hs.</th>
            </tr>
          </thead>
          <tbody>
            {pag.map((f) => {
              const ds = delta(f.sesAlDia, f.sesAlDiaAnt);
              const hsPct = Math.min(100, Math.round(((f.hs ?? 0) / 40) * 100));
              return (
                <tr
                  key={f.id}
                  onClick={() => f.matrix && onRowClick(f.matrix)}
                  style={{ cursor: f.matrix ? 'pointer' : 'default' }}
                  title={f.matrix ? undefined : 'No figura entre los terapeutas activos de la Matrix'}
                >
                  <td className="c-n tn" style={{ color: f.matrix ? undefined : 'var(--t2)' }}>{f.nombre}</td>
                  <td className="c-p"><span className={`b ${f.pais === 'AR' ? 'bar' : 'buy'}`}>{f.pais}</span></td>
                  <td className="vv-c-bar">
                    <Barras grupos={escala === 'dia' ? f.dias : semanas(f.dias)} hoyIdx={escala === 'dia' ? d - 1 : Math.floor((d - 1) / 7)} tope={topeBarra} />
                  </td>
                  <td className="c-se tm">
                    <span>{f.sesAlDia}</span>
                    {ds && <span className={`dp ${ds.cls}`} style={{ marginLeft: 4 }}>{ds.label}</span>}
                  </td>
                  <td className="c-pa tm">{f.activos}</td>
                  <td className="c-rm tm">{f.registros}</td>
                  <td className="c-cv tm" style={{ color: colorConv(f.conv) }}>{f.conv == null ? '—' : `${f.conv}%`}</td>
                  <td className="c-ul tm" style={{ color: colorDias(f.diasSinSesion) }}>{f.diasSinSesion == null ? '—' : `${f.diasSinSesion}d`}</td>
                  <td className="c-rm tm" style={{ color: f.prox7 === 0 ? 'var(--r)' : undefined }}>{f.prox7}</td>
                  <td className="c-hs">
                    {f.hs ? (
                      <div className="hb">
                        <div className="hbg"><div className="hbf" style={{ width: `${hsPct}%`, background: 'var(--ac)' }} /></div>
                        <span className="tm">{f.hs}</span>
                      </div>
                    ) : <span className="tm" style={{ color: 'var(--t3)' }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {paginas > 1 && (
        <div className="pg">
          <button className="pb" disabled={pagina === 0} onClick={() => setPagina((p) => p - 1)}>‹</button>
          {Array.from({ length: paginas }, (_, i) => (
            <button key={i} className={`pb ${i === pagina ? 'on' : ''}`} onClick={() => setPagina(i)}>{i + 1}</button>
          ))}
          <button className="pb" disabled={pagina >= paginas - 1} onClick={() => setPagina((p) => p + 1)}>›</button>
        </div>
      )}
    </>
  );
}

/** Agrupa los días del mes en tramos de 7 (1–7, 8–14, …). */
function semanas(dias: Diario[]): Diario[] {
  const out: Diario[] = [];
  for (let i = 0; i < dias.length; i += 7) {
    const tramo = dias.slice(i, i + 7);
    out.push({
      therapist_id: tramo[0].therapist_id,
      dia: tramo[0].dia,
      realizadas: tramo.reduce((a, r) => a + r.realizadas, 0),
      agendadas: tramo.reduce((a, r) => a + r.agendadas, 0),
      sin_confirmar: tramo.reduce((a, r) => a + r.sin_confirmar, 0),
      canceladas: tramo.reduce((a, r) => a + r.canceladas, 0),
    });
  }
  return out;
}

/** Barras apiladas en SVG, como ProgressView: no hay librería de gráficos. */
function Barras({ grupos, hoyIdx, tope }: { grupos: Diario[]; hoyIdx: number; tope: number }) {
  const H = 22;
  const paso = grupos.length > 10 ? 5 : 30;
  const ancho = grupos.length > 10 ? 4 : 24;
  const W = grupos.length * paso;
  const capas: (keyof typeof COLOR)[] = ['realizadas', 'sin_confirmar', 'agendadas', 'canceladas'];
  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      {grupos.map((g, i) => {
        let yAcum = H;
        return (
          <g key={g.dia}>
            <rect x={i * paso} y={H - 1} width={ancho} height={1} fill="var(--bg4)" />
            {capas.map((c) => {
              const v = g[c];
              if (!v) return null;
              const h = Math.max(1, Math.round((Math.min(v, tope) / tope) * H));
              yAcum -= h;
              return (
                <rect key={c} x={i * paso} y={Math.max(0, yAcum)} width={ancho} height={h} fill={COLOR[c]}>
                  <title>{`${g.dia}: ${v} ${c.replace('_', ' ')}`}</title>
                </rect>
              );
            })}
          </g>
        );
      })}
      <line x1={hoyIdx * paso + ancho + 0.5} x2={hoyIdx * paso + ancho + 0.5} y1={0} y2={H} stroke="var(--t2)" strokeWidth={1} strokeDasharray="2 2" />
    </svg>
  );
}

function delta(actual: number, anterior: number): { label: string; cls: string } | null {
  if (!anterior && !actual) return null;
  if (!anterior) return { label: 'nuevo', cls: 'dp-u' };
  const pct = Math.round(((actual - anterior) / anterior) * 100);
  if (pct === 0) return { label: '=', cls: 'dp-e' };
  return { label: `${pct > 0 ? '+' : ''}${pct}%`, cls: pct > 0 ? 'dp-u' : 'dp-d' };
}

function colorDias(d: number | null): string | undefined {
  if (d == null) return 'var(--t3)';
  if (d > 30) return 'var(--r)';
  if (d > 14) return 'var(--am)';
  return undefined;
}

// Sin semáforo: es una métrica nueva y todavía no hay umbrales acordados.
// Los de Análisis (20% / 10%) miden otra cosa y no aplican.
function colorConv(c: number | null): string | undefined {
  return c == null ? 'var(--t3)' : undefined;
}

function fechaHora(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('es-UY', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/Montevideo',
  }).replace(',', ' ·');
}
