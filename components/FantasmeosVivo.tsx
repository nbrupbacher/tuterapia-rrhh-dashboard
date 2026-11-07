'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
 * desvinculado, perfil desactivado). Así no hay un estado que alguien se
 * olvide de actualizar. Talent desactiva el perfil el mismo día que
 * desvincula: con esa fecha la salida pasa a "Baja confirmada". Si no se cargó,
 * la confirma el CSV del mes siguiente (`therapists.activo` = false).
 *
 * El form de desvinculación se lee solo (app/api/talent/form-desvinculacion):
 * si lo completó Talent, la baja y la desactivación son ese día; si lo completó
 * el psicólogo/a, la salida queda en curso.
 *
 * Las multas (tabla `multas`) se avisan por mail. El pago lo informa el
 * psicólogo/a y lo confirma Administración: son dos pasos distintos.
 *
 * Las mismas acciones están en el perfil de cada psicólogo/a (AccionesTalent,
 * al final de este archivo), para no tener que venir a esta solapa.
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
  desactivado_at: string | null;
  desactivado_por: string | null;
  form_email: string | null;
  nota: string | null;
  nombre: string;
  pais: string;
  activo: boolean;
  estado: EstadoD;
};

type Ter = { id: string; nombre: string; pais: string };
type Vivo = { therapist_id: string; pacientes_activos: number; agendadas_7d: number };

type Moneda = 'ARS' | 'UYU' | 'USD';
type Multa = {
  id: string;
  therapist_id: string;
  desvinculacion_id: string | null;
  moneda: Moneda;
  monto: number;
  retenido: number;
  saldo: number;
  notificada_el: string;
  vence_el: string | null;
  pago_informado_el: string | null;
  pago_confirmado_el: string | null;
  pago_confirmado_por: string | null;
  anulada_el: string | null;
  mail_url: string | null;
  nota: string | null;
};
type EstadoM = 'vencida' | 'notificada' | 'pago_informado' | 'pagada' | 'cubierta' | 'anulada';

type Modal =
  | { tipo: 'nuevoF'; therapistId?: string }
  | { tipo: 'editF'; f: Fantasmeo }
  | { tipo: 'nuevaD'; therapistId?: string; motivo?: MotivoD; fantasmeoId?: string }
  | { tipo: 'editD'; d: Desv }
  | { tipo: 'nuevaM'; therapistId?: string; desvinculacionId?: string }
  | { tipo: 'editM'; m: Multa };

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

// Igual que las salidas: lo que hay que mirar primero, arriba.
const ESTADO_M: Record<EstadoM, { txt: string; color: string }> = {
  vencida: { txt: 'Vencida sin pagar', color: 'var(--r)' },
  notificada: { txt: 'Notificada', color: 'var(--ac)' },
  pago_informado: { txt: 'Pago informado (falta confirmar)', color: 'var(--am)' },
  pagada: { txt: 'Pagada', color: 'var(--v)' },
  cubierta: { txt: 'Cubierta con lo retenido', color: 'var(--v)' },
  anulada: { txt: 'Anulada', color: 'var(--t3)' },
};
const M_ABIERTAS: EstadoM[] = ['vencida', 'notificada', 'pago_informado'];

const MONEDAS: Moneda[] = ['ARS', 'UYU', 'USD'];

const DE_TU_TERAPIA = /@tuterapia\.com\.(uy|ar)$/i;

function estadoMulta(m: Multa, hoy: string): EstadoM {
  if (m.anulada_el) return 'anulada';
  if (m.pago_confirmado_el) return 'pagada';
  if (Number(m.saldo) <= 0) return 'cubierta';
  if (m.pago_informado_el) return 'pago_informado';
  if (m.vence_el && m.vence_el < hoy) return 'vencida';
  return 'notificada';
}

function plata(n: number, moneda: Moneda): string {
  return `${moneda} ${Number(n).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
}

// El mail de la multa da 10 días hábiles para transferir el saldo.
function sumarHabiles(dia: string, n: number): string {
  const d = new Date(`${dia}T12:00:00Z`);
  let k = 0;
  while (k < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const w = d.getUTCDay();
    if (w !== 0 && w !== 6) k++;
  }
  return d.toISOString().slice(0, 10);
}

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
  const [multas, setMultas] = useState<Multa[]>([]);
  const [verTodasM, setVerTodasM] = useState(false);
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
      const [f, d, v, u, m] = await Promise.all([
        leerTodo<Fantasmeo>('fantasmeos'),
        leerTodo<Desv>('desvinculaciones_estado'),
        leerTodo<Vivo>('en_vivo_terapeuta', 'therapist_id,pacientes_activos,agendadas_7d'),
        sb.auth.getUser(),
        leerTodo<Multa>('multas'),
      ]);
      // Nombres de fantasmeados y multados: pueden no estar en la Matrix del
      // mes (por ejemplo, si ya se dieron de baja).
      const ids = [...new Set([...f.map((x) => x.therapist_id), ...m.map((x) => x.therapist_id)])];
      const tmap = new Map<string, Ter>();
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error: e } = await sb.from('therapists').select('id,nombre,pais').in('id', ids.slice(i, i + 200));
        if (e) throw e;
        for (const t of (data ?? []) as Ter[]) tmap.set(t.id, t);
      }
      setFantasmeos(f);
      setDesv(d);
      setMultas(m);
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

  const multasPais = useMemo(() => {
    const orden = (e: EstadoM) => Object.keys(ESTADO_M).indexOf(e);
    return multas
      .filter((m) => pasa(m.therapist_id, nombreDe(m.therapist_id), paisDe(m.therapist_id)))
      .map((m) => ({ m, estado: estadoMulta(m, hoy) }))
      .sort((a, b) => orden(a.estado) - orden(b.estado) || b.m.notificada_el.localeCompare(a.m.notificada_el));
  }, [multas, pasa, nombreDe, paisDe, hoy]);
  const multasPorCobrar = multasPais.filter((x) => M_ABIERTAS.includes(x.estado));
  const multasVisibles = verTodasM ? multasPais : multasPorCobrar;
  const multaDeSalida = useMemo(() => {
    const mp = new Map<string, Multa>();
    for (const m of multas) if (m.desvinculacion_id && !m.anulada_el) mp.set(m.desvinculacion_id, m);
    return mp;
  }, [multas]);

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
    if (!window.confirm(`¿Desvincular a ${d.nombre}?`)) return;
    // Talent desactiva el perfil en el back en el momento: si ya está hecho,
    // la salida queda cerrada sin esperar el CSV del mes siguiente.
    const desactivado = window.confirm(
      `¿Ya desactivaste el perfil de ${d.nombre} en el back?\n\nAceptar: sí, hoy.\nCancelar: todavía no (queda en "Falta desactivar").`,
    );
    const ahoraIso = new Date().toISOString();
    const ok = await guardar(() =>
      sb
        .from('desvinculaciones')
        .update({
          desvinculado_at: ahoraIso,
          desvinculado_por: email,
          ...(desactivado ? { desactivado_at: ahoraIso, desactivado_por: email } : {}),
        })
        .eq('id', d.id),
    );
    // Si estaba fantasmeado, el fantasmeo termina acá: pasa a ser una baja.
    const f = fantasmeos.find((x) => x.therapist_id === d.therapist_id && !x.hasta);
    if (ok && f) await guardar(() => sb.from('fantasmeos').update({ hasta: hoy, cerrado_por: email }).eq('id', f.id));
  };

  const marcarDesactivado = (d: Desv) =>
    guardar(() =>
      sb.from('desvinculaciones').update({ desactivado_at: new Date().toISOString(), desactivado_por: email }).eq('id', d.id),
    );

  const pasoMulta = (m: Multa, paso: 'informado' | 'confirmado') => {
    if (paso === 'confirmado' && !window.confirm(`¿Administración confirmó la transferencia de ${nombreDe(m.therapist_id)}?`)) return;
    guardar(() =>
      sb
        .from('multas')
        .update(paso === 'confirmado' ? { pago_confirmado_el: hoy, pago_confirmado_por: email } : { pago_informado_el: hoy })
        .eq('id', m.id),
    );
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
        <div className="k" onClick={() => setVerTodasM(false)}>
          <div className="kv" style={{ color: 'var(--am)' }}>{multasPorCobrar.length}</div>
          <div className="kl">Multas por cobrar</div>
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
                  <td className="tm">
                    {ddmm(diaDe(d.form_enviado_at))}
                    {d.form_email && (
                      <div className="fd-sub">{DE_TU_TERAPIA.test(d.form_email) ? 'lo completó Talent' : 'lo completó el psicólogo/a'}</div>
                    )}
                  </td>
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
                    {d.desactivado_at && <div className="fd-sub">Perfil desactivado {ddmm(diaDe(d.desactivado_at))}</div>}
                    {multaDeSalida.has(d.id) &&
                      (() => {
                        const e = estadoMulta(multaDeSalida.get(d.id)!, hoy);
                        return <div className="fd-sub" style={{ color: ESTADO_M[e].color }}>Multa: {ESTADO_M[e].txt}</div>;
                      })()}
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
                      {d.estado === 'falta_desactivar' && (
                        <button className="btn" disabled={guardando} onClick={() => marcarDesactivado(d)}>Ya desactivado</button>
                      )}
                      {d.motivo === 'nuestra' && !d.cancelada_at && !multaDeSalida.has(d.id) && (
                        <button className="btn" onClick={() => setModal({ tipo: 'nuevaM', therapistId: d.therapist_id, desvinculacionId: d.id })}>
                          + Multa
                        </button>
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
        &ldquo;Falta desactivar&rdquo;: se desvinculó pero no se cargó que el perfil esté desactivado en el back (y el CSV del mes
        todavía lo muestra activo). El form de desvinculación entra solo. Créditos a favor de los pacientes: pendiente de saber
        dónde están en la plataforma.
      </div>

      {/* ===== Multas ===== */}
      <div className="fd-hd">
        <h3>Multas</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button className="btn" onClick={() => setVerTodasM((v) => !v)}>
            {verTodasM ? 'Ver solo por cobrar' : `Ver todas (${multasPais.length})`}
          </button>
          <button className="btn" onClick={() => setModal({ tipo: 'nuevaM' })}>+ Registrar multa</button>
        </div>
      </div>
      <div className="fd-sub" style={{ marginBottom: 6 }}>
        El pago lo informa el psicólogo/a (por ejemplo, contesta el mail) y lo confirma Administración cuando ve la transferencia.
        Hasta que Administración lo confirme queda en &ldquo;Pago informado&rdquo;.
      </div>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th className="c-n">Psicólogo/a</th>
              <th className="c-p">País</th>
              <th title="Día del mail. Si se cargó el link, abre el mail">Notificada</th>
              <th>Multa</th>
              <th title="Honorarios pendientes que se imputan a la multa">Retenido</th>
              <th>Saldo</th>
              <th>Vence</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {multasVisibles.length === 0 && (
              <tr>
                <td colSpan={9} className="fd-sub" style={{ padding: 12 }}>
                  {verTodasM ? 'No hay multas con estos filtros.' : 'No hay multas por cobrar con estos filtros.'}
                </td>
              </tr>
            )}
            {multasVisibles.map(({ m, estado }) => {
              const mx = matrixPor.get(m.therapist_id);
              return (
                <tr key={m.id}>
                  <td className="c-n">
                    <span className={`tn ${mx ? 'fd-tn' : ''}`} onClick={() => mx && onRowClick(mx)}>{nombreDe(m.therapist_id)}</span>
                    {m.nota && <div className="fd-nota fd-sub">{m.nota}</div>}
                  </td>
                  <td className="c-p"><span className={`b ${paisDe(m.therapist_id) === 'AR' ? 'bar' : 'buy'}`}>{paisDe(m.therapist_id)}</span></td>
                  <td className="tm">
                    {m.mail_url ? (
                      <a href={m.mail_url} target="_blank" rel="noopener noreferrer">{ddmm(m.notificada_el)}</a>
                    ) : (
                      ddmm(m.notificada_el)
                    )}
                  </td>
                  <td className="tm">{plata(m.monto, m.moneda)}</td>
                  <td className="tm">{Number(m.retenido) > 0 ? plata(m.retenido, m.moneda) : '—'}</td>
                  <td className="tm">{plata(m.saldo, m.moneda)}</td>
                  <td className="tm">{ddmm(m.vence_el)}</td>
                  <td>
                    <span className="fd-est" style={{ color: ESTADO_M[estado].color }}>{ESTADO_M[estado].txt}</span>
                    {m.pago_informado_el && !m.pago_confirmado_el && <div className="fd-sub">Informó el {ddmm(m.pago_informado_el)}</div>}
                    {m.pago_confirmado_el && (
                      <div className="fd-sub" title={m.pago_confirmado_por ?? undefined}>Confirmado el {ddmm(m.pago_confirmado_el)}</div>
                    )}
                  </td>
                  <td>
                    <div className="fd-acc">
                      {(estado === 'notificada' || estado === 'vencida') && (
                        <button className="btn" disabled={guardando} onClick={() => pasoMulta(m, 'informado')}>Informó pago</button>
                      )}
                      {M_ABIERTAS.includes(estado) && (
                        <button className="btn" disabled={guardando} onClick={() => pasoMulta(m, 'confirmado')}>Pago confirmado</button>
                      )}
                      <button className="btn" onClick={() => setModal({ tipo: 'editM', m })}>Editar</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {modal && (
        <ModalFD
          modal={modal}
          therapists={therapists}
          nombreDe={nombreDe}
          paisDe={paisDe}
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
  paisDe,
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
  paisDe: (id: string) => string;
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
  const m = modal.tipo === 'editM' ? modal.m : null;
  const presetId =
    modal.tipo === 'nuevaD' || modal.tipo === 'nuevoF' || modal.tipo === 'nuevaM'
      ? modal.therapistId
      : f?.therapist_id ?? d?.therapist_id ?? m?.therapist_id;

  const [psico, setPsico] = useState('');
  const [desde, setDesde] = useState(f?.desde ?? hoy);
  const [motivoF, setMotivoF] = useState<MotivoF>(f?.motivo ?? 'otro');
  const [vuelve, setVuelve] = useState(f?.vuelve_previsto ?? '');
  const [motivoD, setMotivoD] = useState<MotivoD>(d?.motivo ?? (modal.tipo === 'nuevaD' ? modal.motivo : undefined) ?? 'a_definir');
  const [form, setForm] = useState(diaDe(d?.form_enviado_at ?? null) ?? '');
  const [nota, setNota] = useState(f?.nota ?? d?.nota ?? m?.nota ?? '');
  const [moneda, setMoneda] = useState<Moneda>(m?.moneda ?? (presetId && paisDe(presetId) === 'UY' ? 'UYU' : 'ARS'));
  const [monto, setMonto] = useState(m ? String(m.monto) : '');
  const [retenido, setRetenido] = useState(m && Number(m.retenido) > 0 ? String(m.retenido) : '');
  const [notificada, setNotificada] = useState(m?.notificada_el ?? hoy);
  const [vence, setVence] = useState(m?.vence_el ?? '');
  const [mailUrl, setMailUrl] = useState(m?.mail_url ?? '');
  const [informado, setInformado] = useState(m?.pago_informado_el ?? '');
  const [confirmado, setConfirmado] = useState(m?.pago_confirmado_el ?? '');
  const [errLocal, setErrLocal] = useState<string | null>(null);

  // El buscador muestra "Nombre (País) · #id"; el id es lo que se guarda.
  const opciones = useMemo(
    () => [...therapists].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')).map((t) => `${t.nombre} (${t.pais}) · #${t.id}`),
    [therapists],
  );
  const elegido = presetId ?? psico.match(/#(\w+)\s*$/)?.[1] ?? null;

  const titulo = {
    nuevoF: 'Registrar fantasmeo',
    editF: 'Editar fantasmeo',
    nuevaD: 'Registrar salida',
    editD: 'Editar salida',
    nuevaM: 'Registrar multa',
    editM: 'Editar multa',
  }[modal.tipo];

  const notaLimpia = nota.trim() || null;

  const guardar = () => {
    if (!elegido) return;
    setErrLocal(null);
    if (modal.tipo === 'nuevaM' || modal.tipo === 'editM') {
      const montoN = Number(monto);
      const retN = retenido ? Number(retenido) : 0;
      if (!(montoN > 0)) return setErrLocal('Falta el monto de la multa.');
      if (!(retN >= 0) || retN > montoN) return setErrLocal('Lo retenido tiene que estar entre 0 y el monto de la multa.');
      if (!notificada) return setErrLocal('Falta la fecha del mail.');
      const fila = {
        moneda,
        monto: montoN,
        retenido: retN,
        notificada_el: notificada,
        vence_el: vence || sumarHabiles(notificada, 10),
        pago_informado_el: informado || null,
        pago_confirmado_el: confirmado || null,
        ...(confirmado && !m?.pago_confirmado_el ? { pago_confirmado_por: email } : {}),
        ...(!confirmado ? { pago_confirmado_por: null } : {}),
        mail_url: mailUrl.trim() || null,
        nota: notaLimpia,
      };
      if (modal.tipo === 'nuevaM') {
        onGuardar(() =>
          sb.from('multas').insert({
            ...fila,
            therapist_id: elegido,
            desvinculacion_id: modal.desvinculacionId ?? null,
            cargado_por: email ?? 'sin usuario',
          }),
        );
      } else if (m) {
        onGuardar(() => sb.from('multas').update(fila).eq('id', m.id));
      }
      return;
    }
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
  const esM = modal.tipo === 'nuevaM' || modal.tipo === 'editM';

  const contenido = (
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
            {(errLocal ?? error) && <div className="fd-err">{errLocal ?? error}</div>}

            {!presetId && (
              <>
                <label className="fd-lb">Psicólogo/a</label>
                <input
                  className="fd-in"
                  list="fd-psicos"
                  placeholder="Escribí el nombre y elegí de la lista"
                  value={psico}
                  onChange={(e) => {
                    setPsico(e.target.value);
                    // La moneda de la multa sigue al país del psicólogo/a.
                    if (esM && !m) {
                      const p = e.target.value.match(/\((AR|UY)\) · #\w+\s*$/)?.[1];
                      if (p) setMoneda(p === 'UY' ? 'UYU' : 'ARS');
                    }
                  }}
                />
                <datalist id="fd-psicos">
                  {opciones.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </>
            )}

            {esM ? (
              <>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ width: 90 }}>
                    <label className="fd-lb">Moneda</label>
                    <select className="fd-sel" value={moneda} onChange={(e) => setMoneda(e.target.value as Moneda)}>
                      {MONEDAS.map((x) => (
                        <option key={x} value={x}>{x}</option>
                      ))}
                    </select>
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="fd-lb">Multa</label>
                    <input className="fd-in" type="number" min="0" step="any" placeholder="200000" value={monto} onChange={(e) => setMonto(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="fd-lb">Honorarios retenidos</label>
                    <input className="fd-in" type="number" min="0" step="any" placeholder="0" value={retenido} onChange={(e) => setRetenido(e.target.value)} />
                  </div>
                </div>
                {Number(monto) > 0 && (
                  <div className="fd-sub" style={{ marginTop: 4 }}>
                    Saldo a transferir: {plata(Math.max(Number(monto) - (Number(retenido) || 0), 0), moneda)}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label className="fd-lb">Mail enviado el</label>
                    <input className="fd-in" type="date" value={notificada} onChange={(e) => setNotificada(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="fd-lb">Vence (vacío: 10 días hábiles)</label>
                    <input className="fd-in" type="date" value={vence} onChange={(e) => setVence(e.target.value)} />
                  </div>
                </div>
                <label className="fd-lb">Link al mail (opcional)</label>
                <input className="fd-in" placeholder="https://mail.google.com/…" value={mailUrl} onChange={(e) => setMailUrl(e.target.value)} />
                <div style={{ display: 'flex', gap: 8 }}>
                  <div style={{ flex: 1 }}>
                    <label className="fd-lb">Informó el pago el</label>
                    <input className="fd-in" type="date" value={informado} onChange={(e) => setInformado(e.target.value)} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <label className="fd-lb">Administración confirmó el</label>
                    <input className="fd-in" type="date" value={confirmado} onChange={(e) => setConfirmado(e.target.value)} />
                  </div>
                </div>
              </>
            ) : esF ? (
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
              {m && (
                <button
                  className="btn"
                  disabled={guardando}
                  title={m.anulada_el ? 'Vuelve a contar como multa' : 'Se deja sin efecto (acuerdo, error): no se borra'}
                  onClick={() => {
                    if (!m.anulada_el && !window.confirm('¿Anular esta multa? Queda en el historial como anulada.')) return;
                    onGuardar(() => sb.from('multas').update({ anulada_el: m.anulada_el ? null : hoy }).eq('id', m.id));
                  }}
                >
                  {m.anulada_el ? 'Reactivar multa' : 'Anular multa'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // En un portal: desde el perfil del psicólogo/a este modal se abre encima de
  // otro, y adentro de aquel el overlay no cubre la pantalla.
  return typeof document === 'undefined' ? contenido : createPortal(contenido, document.body);
}

/**
 * Bloque del perfil del psicólogo/a (TherapistModal): fantasmeo, salida y
 * multas de esa persona, con las acciones para arrancar cada cosa. Así no hace
 * falta ir a En vivo para fantasmear, iniciar una salida o registrar una multa.
 * El seguimiento (liquidación, desvincular, pagos) sigue en la solapa.
 */
export function AccionesTalent({ therapist }: { therapist: TherapistView }) {
  const sb = getSupabase();
  const id = therapist.id;
  const hoy = diaLocal(new Date());
  const [fantasmeo, setFantasmeo] = useState<Fantasmeo | null>(null);
  const [salidas, setSalidas] = useState<Desv[]>([]);
  const [multas, setMultas] = useState<Multa[]>([]);
  const [email, setEmail] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const [a, b, c, u] = await Promise.all([
      sb.from('fantasmeos').select('*').eq('therapist_id', id).is('hasta', null).maybeSingle(),
      sb.from('desvinculaciones_estado').select('*').eq('therapist_id', id).order('created_at', { ascending: false }),
      sb.from('multas').select('*').eq('therapist_id', id).order('notificada_el', { ascending: false }),
      sb.auth.getUser(),
    ]);
    const e = a.error ?? b.error ?? c.error;
    setError(e ? e.message : null);
    setFantasmeo((a.data as Fantasmeo | null) ?? null);
    setSalidas((b.data ?? []) as Desv[]);
    setMultas((c.data ?? []) as Multa[]);
    setEmail(u.data?.user?.email ?? null);
  }, [sb, id]);

  useEffect(() => {
    cargar();
  }, [cargar]);

  async function guardar(op: Op) {
    setGuardando(true);
    setError(null);
    const { error: e } = await op();
    setGuardando(false);
    if (e) {
      setError(e.code === '23505' ? 'Ya tiene uno abierto: está en En vivo → Fantasmeos y salidas.' : e.message);
      return false;
    }
    await cargar();
    return true;
  }

  const abierta = salidas.find((d) => EN_CURSO.includes(d.estado)) ?? null;
  const cerrada = salidas.find((d) => d.estado === 'baja_confirmada') ?? null;
  const salida = abierta ?? cerrada;

  const desfantasmear = () => {
    if (!fantasmeo) return;
    if (!window.confirm(`¿Desfantasmear a ${therapist.nombre}? Acordate de volver a mostrarlo en el back.`)) return;
    guardar(() => sb.from('fantasmeos').update({ hasta: hoy, cerrado_por: email }).eq('id', fantasmeo.id));
  };

  return (
    <div className="ms">
      <style>{ESTILOS}</style>
      <div className="mst">Fantasmeo, salida y multas</div>
      <div style={{ background: 'var(--bg3)', borderRadius: 7, padding: '9px 11px', fontSize: 12, lineHeight: 1.5 }}>
        {error && <div className="fd-err">{error}</div>}
        <div>
          {fantasmeo ? (
            <>
              Fantasmeado desde <b>{ddmm(fantasmeo.desde)}</b> · {MOTIVO_F[fantasmeo.motivo]}
              {fantasmeo.nota && <div className="fd-sub">{fantasmeo.nota}</div>}
            </>
          ) : (
            <span className="fd-sub">No está fantasmeado.</span>
          )}
        </div>
        {salida && (
          <div>
            Salida ({MOTIVO_D[salida.motivo]}):{' '}
            <span style={{ color: ESTADO_D[salida.estado].color, fontWeight: 600 }}>{ESTADO_D[salida.estado].txt}</span>
            {salida.desactivado_at && <span className="fd-sub"> · perfil desactivado {ddmm(diaDe(salida.desactivado_at))}</span>}
          </div>
        )}
        {multas.map((m) => {
          const e = estadoMulta(m, hoy);
          return (
            <div key={m.id}>
              Multa del {ddmm(m.notificada_el)}: {plata(m.monto, m.moneda)} · saldo {plata(m.saldo, m.moneda)} ·{' '}
              <span style={{ color: ESTADO_M[e].color, fontWeight: 600 }}>{ESTADO_M[e].txt}</span>
            </div>
          );
        })}
        <div className="fd-acc" style={{ marginTop: 8 }}>
          {fantasmeo ? (
            <button className="btn" disabled={guardando} onClick={desfantasmear}>Desfantasmear</button>
          ) : (
            !cerrada && <button className="btn" onClick={() => setModal({ tipo: 'nuevoF', therapistId: id })}>Fantasmear</button>
          )}
          {!salida && (
            <button
              className="btn"
              onClick={() =>
                setModal({ tipo: 'nuevaD', therapistId: id, motivo: fantasmeo ? SALIDA_DESDE_F[fantasmeo.motivo] : undefined, fantasmeoId: fantasmeo?.id })
              }
            >
              Iniciar salida
            </button>
          )}
          {abierta && <button className="btn" onClick={() => setModal({ tipo: 'editD', d: abierta })}>Editar salida</button>}
          <button className="btn" onClick={() => setModal({ tipo: 'nuevaM', therapistId: id, desvinculacionId: salida?.id })}>+ Multa</button>
        </div>
        <div className="fd-sub" style={{ marginTop: 6 }}>
          Liquidación, desvincular y el seguimiento de los pagos están en En vivo → Fantasmeos y salidas.
        </div>
      </div>
      {modal && (
        <ModalFD
          modal={modal}
          therapists={[]}
          nombreDe={() => therapist.nombre}
          paisDe={() => therapist.pais}
          guardando={guardando}
          error={error}
          hoy={hoy}
          email={email}
          onCerrar={() => {
            setModal(null);
            setError(null);
          }}
          onGuardar={async (op) => {
            if (await guardar(op)) setModal(null);
          }}
        />
      )}
    </div>
  );
}
