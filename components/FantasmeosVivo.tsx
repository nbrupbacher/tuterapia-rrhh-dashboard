'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter, TherapistView } from '@/lib/types';

/**
 * Solapa En vivo → Fantasmeos y salidas. Reemplaza la hoja "Monitorear".
 *
 * El fantasmeo real se sigue haciendo a mano en el back ("Mostrar en los
 * listados"): la base de Talent no puede leer ese interruptor. Acá se
 * registra, con fecha, motivo y notas, y queda el historial.
 *
 * Las salidas viven en `desvinculaciones`. El estado no se guarda: lo arma la
 * vista `desvinculaciones_estado` a partir de las fechas (form, liquidación,
 * desvinculado) y de `therapists.activo`. Así no hay un estado que alguien se
 * olvide de actualizar. "Falta desactivar" aparece recién con el CSV del mes
 * siguiente, que es cuando `activo` pasa a false.
 *
 * Lo cargado antes del 2026-11-06 vino de Monitorear y del form de
 * desvinculación (cargado_por = "importado de ..."). Los motivos de esos
 * fantasmeos se dedujeron de las notas: se corrigen con Editar.
 */

type MotivoF = 'salida_nuestra' | 'salida_psicologo' | 'conversion_baja' | 'pausa' | 'otro';
type MotivoD = 'por_el_psicologo' | 'nuestra' | 'a_definir';
type EstadoD =
  | 'falta_desactivar'
  | 'lista_para_desvincular'
  | 'esperando_liquidacion'
  | 'salida_a_definir'
  | 'baja_confirmada'
  | 'cancelada';

type Fantasmeo = {
  id: string;
  therapist_id: string;
  desde: string;
  hasta: string | null;
  motivo: MotivoF;
  vuelve_previsto: string | null;
  nota: string | null;
  cargado_por: string;
  cerrado_por: string | null;
};

type Desv = {
  id: string;
  therapist_id: string;
  motivo: MotivoD;
  fantasmeo_id: string | null;
  form_enviado_at: string | null;
  liquidacion_ok_at: string | null;
  liquidacion_ok_por: string | null;
  desvinculado_at: string | null;
  desvinculado_por: string | null;
  cancelada_at: string | null;
  nota: string | null;
  nombre: string;
  pais: string;
  activo: boolean;
  estado: EstadoD;
};

type Ter = { id: string; nombre: string; pais: string };
type Vivo = { therapist_id: string; pacientes_activos: number; agendadas_7d: number };

type Modal =
  | { tipo: 'nuevoF' }
  | { tipo: 'editF'; f: Fantasmeo }
  | { tipo: 'nuevaD'; therapistId?: string; motivo?: MotivoD; fantasmeoId?: string }
  | { tipo: 'editD'; d: Desv };

const MOTIVO_F: Record<MotivoF, string> = {
  salida_nuestra: 'Salida nuestra',
  salida_psicologo: 'Salida del psicólogo/a',
  conversion_baja: 'Conversión baja',
  pausa: 'Pausa',
  otro: 'Otro',
};

const MOTIVO_D: Record<MotivoD, string> = {
  por_el_psicologo: 'Pedido del psicólogo/a',
  nuestra: 'Nuestra',
  a_definir: 'A definir',
};

// En el orden en que hay que atenderlas: lo rojo primero.
const ESTADO_D: Record<EstadoD, { txt: string; color: string }> = {
  falta_desactivar: { txt: 'Falta desactivar en el back', color: 'var(--r)' },
  lista_para_desvincular: { txt: 'Lista para desvincular', color: 'var(--v)' },
  esperando_liquidacion: { txt: 'Esperando liquidación', color: 'var(--am)' },
  salida_a_definir: { txt: 'Salida a definir', color: 'var(--ar)' },
  baja_confirmada: { txt: 'Baja confirmada', color: 'var(--t2)' },
  cancelada: { txt: 'Cancelada', color: 'var(--t3)' },
};
const EN_CURSO: EstadoD[] = ['falta_desactivar', 'lista_para_desvincular', 'esperando_liquidacion', 'salida_a_definir'];

// Al iniciar una salida desde un fantasmeo, el motivo de salida sale del
// motivo del fantasmeo si ya lo dice.
const SALIDA_DESDE_F: Partial<Record<MotivoF, MotivoD>> = {
  salida_nuestra: 'nuestra',
  salida_psicologo: 'por_el_psicologo',
};

const LOCAL_OFFSET_MS = 3 * 3_600_000;

const ESTILOS = `
.fd-err { background:rgba(240,82,82,.08); border:1px solid rgba(240,82,82,.3); color:var(--r); border-radius:6px; padding:6px 10px; font-size:11px; margin-bottom:8px; }
.fd-sub { font-size:10px; color:var(--t3); }
.fd-nota { font-size:11px; color:var(--t2); max-width:320px; white-space:normal; line-height:1.35; }
.fd-pill { display:inline-block; border-radius:20px; padding:3px 9px; font-size:11px; border:1px solid var(--bd2); cursor:pointer; margin-right:6px; margin-bottom:6px; color:var(--t2); background:transparent; font-family:var(--f); }
.fd-pill.on { color:var(--t); border-color:var(--ac); background:rgba(79,142,247,.08); }
.fd-pill b { font-family:var(--m); margin-left:4px; }
.fd-est { font-size:11px; font-weight:600; }
.fd-acc { display:flex; gap:4px; flex-wrap:wrap; }
.fd-acc .btn { padding:3px 8px; font-size:11px; }
.fd-in, .fd-ta, .fd-sel { width:100%; background:var(--bg3); border:1px solid var(--bd2); color:var(--t); border-radius:6px; padding:6px 8px; font-family:var(--f); font-size:12px; }
.fd-ta { min-height:60px; resize:vertical; }
.fd-lb { font-size:11px; color:var(--t2); margin:8px 0 3px; display:block; }
.fd-hd { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:14px 0 6px; flex-wrap:wrap; }
.fd-hd h3 { margin:0; font-size:14px; }
.fd-tn { cursor:pointer; }
.fd-tn:hover { color:var(--ac); text-decoration:underline; }
`;

function diaLocal(d: Date): string {
  return new Date(d.getTime() - LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

function ddmm(dia: string | null): string {
  if (!dia) return '—';
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** Fecha de un timestamptz, en día local. */
function diaDe(ts: string | null): string | null {
  return ts ? diaLocal(new Date(ts)) : null;
}

function diasDesde(dia: string, hoy: string): number {
  return Math.max(0, Math.round((Date.parse(hoy) - Date.parse(dia)) / 86_400_000));
}

async function leerTodo<T>(tabla: string, columnas = '*'): Promise<T[]> {
  const sb = getSupabase();
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from(tabla).select(columnas).range(i, i + 999);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export function FantasmeosVivo({
  pais,
  therapists,
  onRowClick,
}: {
  pais: PaisFilter;
  therapists: TherapistView[];
  onRowClick: (t: TherapistView) => void;
}) {
  const [fantasmeos, setFantasmeos] = useState<Fantasmeo[]>([]);
  const [desv, setDesv] = useState<Desv[]>([]);
  const [ters, setTers] = useState<Map<string, Ter>>(new Map());
  const [vivo, setVivo] = useState<Map<string, Vivo>>(new Map());
  const [email, setEmail] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [busqueda, setBusqueda] = useState('');
  const [verHistF, setVerHistF] = useState(false);
  const [filtroD, setFiltroD] = useState<EstadoD | 'curso' | 'historial'>('curso');
  const [modal, setModal] = useState<Modal | null>(null);

  const hoy = diaLocal(new Date());
  const matrixPor = useMemo(() => new Map(therapists.map((t) => [t.id, t])), [therapists]);

  const cargar = useCallback(async () => {
    try {
      const sb = getSupabase();
      const [f, d, v, u] = await Promise.all([
        leerTodo<Fantasmeo>('fantasmeos'),
        leerTodo<Desv>('desvinculaciones_estado'),
        leerTodo<Vivo>('en_vivo_terapeuta', 'therapist_id,pacientes_activos,agendadas_7d'),
        sb.auth.getUser(),
      ]);
      // Nombres de los fantasmeados: pueden no estar en la Matrix del mes
      // (por ejemplo, si ya se dieron de baja).
      const ids = [...new Set(f.map((x) => x.therapist_id))];
      const tmap = new Map<string, Ter>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error: e } = await sb.from('therapists').select('id,nombre,pais').in('id', ids.slice(i, i + 200));
        if (e) throw e;
        for (const t of (data ?? []) as Ter[]) tmap.set(t.id, t);
      }
      setFantasmeos(f);
      setDesv(d);
      setTers(tmap);
      setVivo(new Map(v.map((x) => [x.therapist_id, x])));
      setEmail(u.data?.user?.email ?? null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const nombreDe = useCallback(
    (id: string) => matrixPor.get(id)?.nombre ?? ters.get(id)?.nombre ?? `Terapeuta #${id}`,
    [matrixPor, ters],
  );
  const paisDe = useCallback((id: string) => matrixPor.get(id)?.pais ?? ters.get(id)?.pais ?? '—', [matrixPor, ters]);

  const q = busqueda.trim().toLowerCase();
  const pasa = useCallback(
    (id: string, nombre: string, p: string) =>
      (pais === 'T' || p === pais) && (!q || nombre.toLowerCase().includes(q) || id.includes(q)),
    [pais, q],
  );

  const salidaAbierta = useMemo(() => {
    const m = new Map<string, Desv>();
    for (const d of desv) if (EN_CURSO.includes(d.estado)) m.set(d.therapist_id, d);
    return m;
  }, [desv]);

  const vecesAntes = useMemo(() => {
    const m = new Map<string, number>();
    for (const f of fantasmeos) if (f.hasta) m.set(f.therapist_id, (m.get(f.therapist_id) ?? 0) + 1);
    return m;
  }, [fantasmeos]);

  const vigentes = useMemo(
    () =>
      fantasmeos
        .filter((f) => !f.hasta && pasa(f.therapist_id, nombreDe(f.therapist_id), paisDe(f.therapist_id)))
        .sort((a, b) => a.desde.localeCompare(b.desde)),
    [fantasmeos, pasa, nombreDe, paisDe],
  );
  const cerrados = useMemo(
    () =>
      fantasmeos
        .filter((f) => f.hasta && pasa(f.therapist_id, nombreDe(f.therapist_id), paisDe(f.therapist_id)))
        .sort((a, b) => (b.hasta ?? '').localeCompare(a.hasta ?? '')),
    [fantasmeos, pasa, nombreDe, paisDe],
  );

  const desvPais = useMemo(() => desv.filter((d) => pasa(d.therapist_id, d.nombre, d.pais)), [desv, pasa]);
  const conteoD = useMemo(() => {
    const c: Record<string, number> = {};
    for (const d of desvPais) c[d.estado] = (c[d.estado] ?? 0) + 1;
    return c;
  }, [desvPais]);
  const desvVisibles = useMemo(() => {
    const out = desvPais.filter((d) =>
      filtroD === 'curso'
        ? EN_CURSO.includes(d.estado)
        : filtroD === 'historial'
          ? !EN_CURSO.includes(d.estado)
          : d.estado === filtroD,
    );
    const orden = (e: EstadoD) => Object.keys(ESTADO_D).indexOf(e);
    return out.sort(
      (a, b) =>
        orden(a.estado) - orden(b.estado) ||
        (b.desvinculado_at ?? b.form_enviado_at ?? '').localeCompare(a.desvinculado_at ?? a.form_enviado_at ?? ''),
    );
  }, [desvPais, filtroD]);
  const enCurso = EN_CURSO.reduce((a, e) => a + (conteoD[e] ?? 0), 0);

  async function guardar(op: () => PromiseLike<{ error: { message: string; code?: string } | null }>) {
    setGuardando(true);
    setError(null);
    const { error: e } = await op();
    if (e) {
      // 23505 = índice único: ya hay un fantasmeo o una salida abierta.
      setError(e.code === '23505' ? 'Ya tiene uno abierto: editá el que está en la lista.' : e.message);
      setGuardando(false);
      return false;
    }
    await cargar();
    setGuardando(false);
    return true;
  }

  const sb = getSupabase();

  const desfantasmear = (f: Fantasmeo) => {
    if (!window.confirm(`¿Desfantasmear a ${nombreDe(f.therapist_id)}? Acordate de volver a mostrarlo en el back.`)) return;
    guardar(() => sb.from('fantasmeos').update({ hasta: hoy, cerrado_por: email }).eq('id', f.id));
  };

  const marcarLiquidacion = (d: Desv) =>
    guardar(() =>
      sb
        .from('desvinculaciones')
        .update(
          d.liquidacion_ok_at
            ? { liquidacion_ok_at: null, liquidacion_ok_por: null }
            : { liquidacion_ok_at: new Date().toISOString(), liquidacion_ok_por: email },
        )
        .eq('id', d.id),
    );

  const desvincular = async (d: Desv) => {
    if (!window.confirm(`¿Desvincular a ${d.nombre}? Después hay que desactivar el perfil en el back.`)) return;
    const ok = await guardar(() =>
      sb.from('desvinculaciones').update({ desvinculado_at: new Date().toISOString(), desvinculado_por: email }).eq('id', d.id),
    );
    // Si estaba fantasmeado, el fantasmeo termina acá: pasa a ser una baja.
    const f = fantasmeos.find((x) => x.therapist_id === d.therapist_id && !x.hasta);
    if (ok && f) await guardar(() => sb.from('fantasmeos').update({ hasta: hoy, cerrado_por: email }).eq('id', f.id));
  };

  if (cargando) return <div className="loading-wrap">Cargando fantasmeos…</div>;

  return (
    <>
      <style>{ESTILOS}</style>

      <div className="ks" style={{ marginTop: 8 }}>
        <div className="k" style={{ cursor: 'default' }}>
          <div className="kv" style={{ color: 'var(--ar)' }}>{vigentes.length}</div>
          <div className="kl">Fantasmeados hoy</div>
        </div>
        <div className="k" onClick={() => setFiltroD('curso')}>
          <div className="kv" style={{ color: 'var(--am)' }}>{enCurso}</div>
          <div className="kl">Salidas en curso</div>
        </div>
        <div className="k" onClick={() => setFiltroD('falta_desactivar')}>
          <div className="kv" style={{ color: 'var(--r)' }}>{conteoD.falta_desactivar ?? 0}</div>
          <div className="kl">Falta desactivar en el back</div>
        </div>
        <div className="k" onClick={() => setFiltroD('lista_para_desvincular')}>
          <div className="kv" style={{ color: 'var(--v)' }}>{conteoD.lista_para_desvincular ?? 0}</div>
          <div className="kl">Listas para desvincular</div>
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
      </div>

      {error && <div className="fd-err">{error}</div>}

      {/* ===== Fantasmeos ===== */}
      <div className="fd-hd">
        <h3>Fantasmeados ({vigentes.length})</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={() => setVerHistF((v) => !v)}>
            {verHistF ? 'Ocultar historial' : `Ver historial (${cerrados.length})`}
          </button>
          <button className="btn" onClick={() => setModal({ tipo: 'nuevoF' })}>+ Registrar fantasmeo</button>
        </div>
      </div>
      <div className="fd-sub" style={{ marginBottom: 6 }}>
        Se fantasmea a mano en el back (&ldquo;Mostrar en los listados&rdquo;) y se registra acá. Pac. activos y Próx. 7d salen
        de la base de la plataforma: sirven para ver si ya se puede desfantasmear o desvincular.
      </div>

      <div className="tw">
        <table>
          <thead>
            <tr>
              <th className="c-n">Psicólogo/a</th>
              <th className="c-p">País</th>
              <th title="Día en que se fantasmeó">Desde</th>
              <th>Días</th>
              <th>Motivo</th>
              <th title="Pacientes con al menos una sesión realizada este mes">Pac. activos</th>
              <th title="Sesiones agendadas en los próximos 7 días">Próx. 7d</th>
              <th>Notas</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {vigentes.length === 0 && (
              <tr>
                <td colSpan={9} className="fd-sub" style={{ padding: 12 }}>No hay fantasmeados con estos filtros.</td>
              </tr>
            )}
            {vigentes.map((f) => {
              const mx = matrixPor.get(f.therapist_id);
              const v = vivo.get(f.therapist_id);
              const dias = diasDesde(f.desde, hoy);
              const salida = salidaAbierta.get(f.therapist_id);
              const antes = vecesAntes.get(f.therapist_id) ?? 0;
              return (
                <tr key={f.id}>
                  <td className="c-n">
                    <span className={`tn ${mx ? 'fd-tn' : ''}`} onClick={() => mx && onRowClick(mx)}>{nombreDe(f.therapist_id)}</span>
                    {antes > 0 && <div className="fd-sub">Fantasmeado {antes === 1 ? '1 vez' : `${antes} veces`} antes</div>}
                  </td>
                  <td className="c-p"><span className={`b ${paisDe(f.therapist_id) === 'AR' ? 'bar' : 'buy'}`}>{paisDe(f.therapist_id)}</span></td>
                  <td className="tm">{ddmm(f.desde)}</td>
                  <td className="tm" style={{ color: dias > 60 ? 'var(--r)' : dias > 30 ? 'var(--am)' : undefined }}>{dias}</td>
                  <td>
                    {MOTIVO_F[f.motivo]}
                    {f.motivo === 'pausa' && f.vuelve_previsto && <div className="fd-sub">Vuelve {ddmm(f.vuelve_previsto)}</div>}
                    {salida && <div className="fd-sub" style={{ color: ESTADO_D[salida.estado].color }}>{ESTADO_D[salida.estado].txt}</div>}
                  </td>
                  <td className="tm">{v?.pacientes_activos ?? '—'}</td>
                  <td className="tm">{v?.agendadas_7d ?? '—'}</td>
                  <td><div className="fd-nota">{f.nota || <span className="fd-sub">—</span>}</div></td>
                  <td>
                    <div className="fd-acc">
                      <button className="btn" onClick={() => setModal({ tipo: 'editF', f })}>Editar</button>
                      <button className="btn" disabled={guardando} onClick={() => desfantasmear(f)}>Desfantasmear</button>
                      {!salida && (
                        <button
                          className="btn"
                          onClick={() =>
                            setModal({ tipo: 'nuevaD', therapistId: f.therapist_id, motivo: SALIDA_DESDE_F[f.motivo], fantasmeoId: f.id })
                          }
                        >
                          Iniciar salida
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {verHistF && (
        <div className="tw" style={{ marginTop: 8 }}>
          <table>
            <thead>
              <tr>
                <th className="c-n">Psicólogo/a (historial)</th>
                <th className="c-p">País</th>
                <th>Desde</th>
                <th>Hasta</th>
                <th>Días</th>
                <th>Motivo</th>
                <th>Notas</th>
              </tr>
            </thead>
            <tbody>
              {cerrados.map((f) => (
                <tr key={f.id}>
                  <td className="c-n tn">{nombreDe(f.therapist_id)}</td>
                  <td className="c-p"><span className={`b ${paisDe(f.therapist_id) === 'AR' ? 'bar' : 'buy'}`}>{paisDe(f.therapist_id)}</span></td>
                  <td className="tm">{ddmm(f.desde)}</td>
                  <td className="tm">{ddmm(f.hasta)}</td>
                  <td className="tm">{f.hasta ? diasDesde(f.desde, f.hasta) : '—'}</td>
                  <td>{MOTIVO_F[f.motivo]}</td>
                  <td><div className="fd-nota">{f.nota || '—'}</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ===== Salidas y desvinculaciones ===== */}
      <div className="fd-hd">
        <h3>Salidas y desvinculaciones</h3>
        <button className="btn" onClick={() => setModal({ tipo: 'nuevaD' })}>+ Registrar salida</button>
      </div>
      <div>
        <button className={`fd-pill ${filtroD === 'curso' ? 'on' : ''}`} onClick={() => setFiltroD('curso')}>En curso<b>{enCurso}</b></button>
        {EN_CURSO.map((e) => (
          <button key={e} className={`fd-pill ${filtroD === e ? 'on' : ''}`} onClick={() => setFiltroD(e)} style={{ color: ESTADO_D[e].color }}>
            {ESTADO_D[e].txt}<b>{conteoD[e] ?? 0}</b>
          </button>
        ))}
        <button className={`fd-pill ${filtroD === 'historial' ? 'on' : ''}`} onClick={() => setFiltroD('historial')}>
          Historial<b>{(conteoD.baja_confirmada ?? 0) + (conteoD.cancelada ?? 0)}</b>
        </button>
      </div>

      <div className="tw">
        <table>
          <thead>
            <tr>
              <th className="c-n">Psicólogo/a</th>
              <th className="c-p">País</th>
              <th>Salida</th>
              <th title="Día en que se envió el form de desvinculación">Form</th>
              <th title="Pacientes con al menos una sesión realizada este mes">Pac. activos</th>
              <th title="Sesiones agendadas en los próximos 7 días">Próx. 7d</th>
              <th title="La tildan ustedes cuando Admin confirma la liquidación">Liquidación</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {desvVisibles.length === 0 && (
              <tr>
                <td colSpan={9} className="fd-sub" style={{ padding: 12 }}>No hay salidas con estos filtros.</td>
              </tr>
            )}
            {desvVisibles.map((d) => {
              const mx = matrixPor.get(d.therapist_id);
              const v = vivo.get(d.therapist_id);
              const abierta = EN_CURSO.includes(d.estado);
              return (
                <tr key={d.id}>
                  <td className="c-n">
                    <span className={`tn ${mx ? 'fd-tn' : ''}`} onClick={() => mx && onRowClick(mx)}>{d.nombre}</span>
                    {d.nota && <div className="fd-nota fd-sub">{d.nota}</div>}
                  </td>
                  <td className="c-p"><span className={`b ${d.pais === 'AR' ? 'bar' : 'buy'}`}>{d.pais}</span></td>
                  <td>{MOTIVO_D[d.motivo]}</td>
                  <td className="tm">{ddmm(diaDe(d.form_enviado_at))}</td>
                  <td className="tm">{abierta ? v?.pacientes_activos ?? '—' : '—'}</td>
                  <td className="tm">{abierta ? v?.agendadas_7d ?? '—' : '—'}</td>
                  <td>
                    {d.liquidacion_ok_at ? (
                      <span className="tm" style={{ color: 'var(--v)' }} title={d.liquidacion_ok_por ?? undefined}>✓ {ddmm(diaDe(d.liquidacion_ok_at))}</span>
                    ) : d.desvinculado_at ? (
                      <span className="fd-sub">—</span>
                    ) : (
                      <span className="fd-sub">Pendiente</span>
                    )}
                  </td>
                  <td>
                    <span className="fd-est" style={{ color: ESTADO_D[d.estado].color }}>{ESTADO_D[d.estado].txt}</span>
                    {d.desvinculado_at && <div className="fd-sub">Desvinculado {ddmm(diaDe(d.desvinculado_at))}</div>}
                  </td>
                  <td>
                    <div className="fd-acc">
                      {abierta && !d.desvinculado_at && (
                        <button className="btn" disabled={guardando} onClick={() => marcarLiquidacion(d)}>
                          {d.liquidacion_ok_at ? 'Quitar liquidación' : 'Liquidación OK'}
                        </button>
                      )}
                      {d.estado === 'lista_para_desvincular' && (
                        <button className="btn" disabled={guardando} onClick={() => desvincular(d)}>Desvincular</button>
                      )}
                      <button className="btn" onClick={() => setModal({ tipo: 'editD', d })}>Editar</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="fd-sub" style={{ marginTop: 6 }}>
        &ldquo;Falta desactivar&rdquo; aparece cuando se marcó como desvinculado y el perfil sigue activo en el CSV del mes. Créditos a
        favor de los pacientes: pendiente de saber dónde están en la plataforma.
      </div>

      {modal && (
        <ModalFD
          modal={modal}
          therapists={therapists}
          nombreDe={nombreDe}
          guardando={guardando}
          error={error}
          hoy={hoy}
          onCerrar={() => {
            setModal(null);
            setError(null);
          }}
          onGuardar={async (op) => {
            if (await guardar(op)) setModal(null);
          }}
          email={email}
        />
      )}
    </>
  );
}

type Op = () => PromiseLike<{ error: { message: string; code?: string } | null }>;

function ModalFD({
  modal,
  therapists,
  nombreDe,
  guardando,
  error,
  hoy,
  email,
  onCerrar,
  onGuardar,
}: {
  modal: Modal;
  therapists: TherapistView[];
  nombreDe: (id: string) => string;
  guardando: boolean;
  error: string | null;
  hoy: string;
  email: string | null;
  onCerrar: () => void;
  onGuardar: (op: Op) => void;
}) {
  const sb = getSupabase();
  const f = modal.tipo === 'editF' ? modal.f : null;
  const d = modal.tipo === 'editD' ? modal.d : null;
  const presetId = modal.tipo === 'nuevaD' ? modal.therapistId : f?.therapist_id ?? d?.therapist_id;

  const [psico, setPsico] = useState('');
  const [desde, setDesde] = useState(f?.desde ?? hoy);
  const [motivoF, setMotivoF] = useState<MotivoF>(f?.motivo ?? 'otro');
  const [vuelve, setVuelve] = useState(f?.vuelve_previsto ?? '');
  const [motivoD, setMotivoD] = useState<MotivoD>(d?.motivo ?? (modal.tipo === 'nuevaD' ? modal.motivo : undefined) ?? 'a_definir');
  const [form, setForm] = useState(diaDe(d?.form_enviado_at ?? null) ?? '');
  const [nota, setNota] = useState(f?.nota ?? d?.nota ?? '');

  // El buscador muestra "Nombre (País) · #id"; el id es lo que se guarda.
  const opciones = useMemo(
    () => [...therapists].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((t) => `${t.nombre} (${t.pais}) · #${t.id}`),
    [therapists],
  );
  const elegido = presetId ?? psico.match(/#(\w+)\s*$/)?.[1] ?? null;

  const titulo =
    modal.tipo === 'nuevoF' ? 'Registrar fantasmeo' : modal.tipo === 'editF' ? 'Editar fantasmeo' : modal.tipo === 'nuevaD' ? 'Registrar salida' : 'Editar salida';

  const notaLimpia = nota.trim() || null;

  const guardar = () => {
    if (!elegido) return;
    if (modal.tipo === 'nuevoF') {
      onGuardar(() =>
        sb.from('fantasmeos').insert({
          therapist_id: elegido,
          desde,
          motivo: motivoF,
          vuelve_previsto: motivoF === 'pausa' && vuelve ? vuelve : null,
          nota: notaLimpia,
          cargado_por: email ?? 'sin usuario',
        }),
      );
    } else if (modal.tipo === 'editF' && f) {
      onGuardar(() =>
        sb
          .from('fantasmeos')
          .update({ desde, motivo: motivoF, vuelve_previsto: motivoF === 'pausa' && vuelve ? vuelve : null, nota: notaLimpia })
          .eq('id', f.id),
      );
    } else if (modal.tipo === 'nuevaD') {
      onGuardar(() =>
        sb.from('desvinculaciones').insert({
          therapist_id: elegido,
          motivo: motivoD,
          fantasmeo_id: modal.fantasmeoId ?? null,
          form_enviado_at: form ? `${form}T12:00:00-03:00` : null,
          nota: notaLimpia,
          cargado_por: email ?? 'sin usuario',
        }),
      );
    } else if (d) {
      onGuardar(() =>
        sb
          .from('desvinculaciones')
          .update({ motivo: motivoD, form_enviado_at: form ? `${form}T12:00:00-03:00` : null, nota: notaLimpia })
          .eq('id', d.id),
      );
    }
  };

  const esF = modal.tipo === 'nuevoF' || modal.tipo === 'editF';

  return (
    <div className="ov open" onClick={onCerrar}>
      <div className="mo" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div>
            <div className="mn2">{titulo}</div>
            {presetId && <div className="mm">{nombreDe(presetId)}</div>}
          </div>
          <button className="mcl" onClick={onCerrar}>✕</button>
        </div>
        <div className="mb">
          <div className="ms">
            {error && <div className="fd-err">{error}</div>}

            {!presetId && (
              <>
                <label className="fd-lb">Psicólogo/a</label>
                <input className="fd-in" list="fd-psicos" placeholder="Escribí el nombre y elegí de la lista" value={psico} onChange={(e) => setPsico(e.target.value)} />
                <datalist id="fd-psicos">
                  {opciones.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </>
            )}

            {esF ? (
              <>
                <label className="fd-lb">Fantasmeado desde</label>
                <input className="fd-in" type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
                <label className="fd-lb">Motivo</label>
                <select className="fd-sel" value={motivoF} onChange={(e) => setMotivoF(e.target.value as MotivoF)}>
                  {Object.entries(MOTIVO_F).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                {motivoF === 'pausa' && (
                  <>
                    <label className="fd-lb">Vuelve (aprox.)</label>
                    <input className="fd-in" type="date" value={vuelve} onChange={(e) => setVuelve(e.target.value)} />
                  </>
                )}
              </>
            ) : (
              <>
                <label className="fd-lb">Pedido de</label>
                <select className="fd-sel" value={motivoD} onChange={(e) => setMotivoD(e.target.value as MotivoD)}>
                  {Object.entries(MOTIVO_D).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                <label className="fd-lb">Form de desvinculación enviado el (vacío si todavía no)</label>
                <input className="fd-in" type="date" value={form} onChange={(e) => setForm(e.target.value)} />
              </>
            )}

            <label className="fd-lb">Notas</label>
            <textarea className="fd-ta" value={nota} onChange={(e) => setNota(e.target.value)} />

            <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
              <button className="btn" disabled={guardando || !elegido} onClick={guardar}>Guardar</button>
              <button className="btn" onClick={onCerrar}>Cancelar</button>
              {d && !d.cancelada_at && !d.desvinculado_at && (
                <button
                  className="btn"
                  disabled={guardando}
                  title="El psicólogo/a se queda: la salida no se borra, queda como cancelada"
                  onClick={() => onGuardar(() => sb.from('desvinculaciones').update({ cancelada_at: new Date().toISOString() }).eq('id', d.id))}
                >
                  Cancelar salida
                </button>
              )}
              {d && (d.cancelada_at || d.desvinculado_at) && (
                <button
                  className="btn"
                  disabled={guardando}
                  title="Para corregir un error: vuelve a quedar en curso"
                  onClick={() =>
                    onGuardar(() =>
                      sb.from('desvinculaciones').update({ cancelada_at: null, desvinculado_at: null, desvinculado_por: null }).eq('id', d.id),
                    )
                  }
                >
                  Volver a en curso
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
