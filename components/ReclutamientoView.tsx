'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter } from '@/lib/types';
import {
  cruzar,
  CLASE_HISTORIAL,
  TEXTO_DECISION,
  TEXTO_HISTORIAL,
  TEXTO_MOTIVO_BAJA,
  type BajaHist,
  type Cruce,
  type Decision,
  type DecisionRow,
  type DesvRow,
  type FantasmeoRow,
  type Historial,
  type MultaRow,
  type Postulacion,
  type Ter,
} from '@/lib/reclutamiento';
import './reclutamiento.css';

/**
 * Solapa Reclutamiento. Las postulaciones del form "Requisitos Psicos Tu
 * Terapia", cruzadas en vivo con quienes ya estuvieron en la plataforma.
 *
 * Las respuestas llegan solas (apps-script/postulaciones →
 * app/api/talent/postulaciones). El cruce no se guarda: se arma acá cada vez
 * contra therapists, desvinculaciones, multas, fantasmeos y el historial de
 * bajas anteriores al dashboard (lib/reclutamiento), así una baja nueva o el
 * CSV del mes se ven enseguida.
 *
 * Lo que decide Talent queda en `postulacion_decisiones`, con motivo
 * obligatorio y sin pisar lo anterior: si la persona se vuelve a postular, se
 * ve qué se decidió la vez pasada y por qué.
 *
 * Chile cerró: las postulaciones de otros países se guardan igual (alguien
 * puede mudarse) pero no se cuentan ni se muestran salvo que se pida.
 */

const PAGINA = 1000;
const MOSTRAR = 200;
const MIN_MOTIVO = 10;

const COLS_POST =
  'id,postulado_at,pais,pais_texto,nombre,email,cuit,titulo,proceso_personal,experiencia_clinica,supervision,diez_horas,estado_planilla';

type FiltroHist = 'T' | 'ya_estuvo' | Historial;
type FiltroDec = 'T' | 'sin_decidir' | Decision;
type Periodo = '30' | '90' | '365' | 'T';

const PREGUNTAS: [string, string][] = [
  ['disponibilidad', 'Días y horas disponibles'],
  ['modalidad', 'Modalidad'],
  ['zona', 'Dónde atiende presencial'],
  ['formacion', 'Formación / especialización'],
  ['consultorio', 'Consultorio'],
  ['como_se_entero', 'Cómo se enteró'],
  ['comentarios', 'Comentarios'],
];

// Siempre con orden hasta `id`: sin un orden único, al paginar de a 1000 se
// pueden repetir o saltear filas.
async function leerTodo<T>(tabla: string, columnas: string, orden?: string): Promise<T[]> {
  const sb = getSupabase();
  const out: T[] = [];
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await sb
      .from(tabla)
      .select(columnas)
      .order(orden ?? 'id', { ascending: false })
      .order('id', { ascending: false })
      .range(i, i + PAGINA - 1);
    if (error) throw new Error(`${tabla}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGINA) break;
  }
  return out;
}

function fecha(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso);
  return d.toLocaleDateString('es-UY', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const TEXTO_QUIEN: Record<string, string> = {
  nuestra: 'la desvinculamos nosotros',
  propia: 'se fue por su cuenta',
  ambos: 'de común acuerdo',
};

/** "Baja 04/02/25 (form de desvinculación) · se fue por su cuenta". */
function textoBajaHist(b: BajaHist): string {
  const cuando = b.fecha ? fecha(b.fecha) : b.anio ? String(b.anio) : 'sin fecha';
  const fuente = b.fuente === 'form' ? 'form de desvinculación' : 'planilla de bajas previa a 2024';
  return `Baja ${cuando} (${fuente})${b.quien ? ` · ${TEXTO_QUIEN[b.quien]}` : ''}`;
}

function esLink(s: string) {
  return /^https?:\/\//i.test(s.trim());
}

export function ReclutamientoView({ pais, userEmail }: { pais: PaisFilter; userEmail?: string }) {
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posts, setPosts] = useState<Postulacion[]>([]);
  const [decisiones, setDecisiones] = useState<DecisionRow[]>([]);
  const [base, setBase] = useState<{ ters: Ter[]; desvs: DesvRow[]; multas: MultaRow[]; fants: FantasmeoRow[]; bajas: BajaHist[] }>({
    ters: [],
    desvs: [],
    multas: [],
    fants: [],
    bajas: [],
  });

  const [busqueda, setBusqueda] = useState('');
  const [hist, setHist] = useState<FiltroHist>('T');
  const [dec, setDec] = useState<FiltroDec>('sin_decidir');
  const [soloMinimos, setSoloMinimos] = useState(false);
  const [periodo, setPeriodo] = useState<Periodo>('90');
  const [otrosPaises, setOtrosPaises] = useState(false);
  const [mostrar, setMostrar] = useState(MOSTRAR);
  const [abierta, setAbierta] = useState<Postulacion | null>(null);

  const cargar = useCallback(async () => {
    setError(null);
    try {
      const [p, d, ters, desvs, multas, fants, bajas] = await Promise.all([
        leerTodo<Postulacion>('postulaciones', COLS_POST, 'postulado_at'),
        leerTodo<DecisionRow>('postulacion_decisiones', 'id,postulacion_id,decision,motivo,decidido_por,created_at'),
        leerTodo<Ter>('therapists', 'id,nombre,pais,email,activo,inicio,fecha_baja,motivo_baja'),
        leerTodo<DesvRow>('desvinculaciones', 'therapist_id,motivo,desvinculado_at,cancelada_at,nota,created_at'),
        leerTodo<MultaRow>('multas', 'therapist_id,saldo,moneda,anulada_el,pago_confirmado_el'),
        leerTodo<FantasmeoRow>('fantasmeos', 'therapist_id,desde,hasta,motivo'),
        leerTodo<BajaHist>('bajas_historicas', 'id,fuente,pais,nombre,email,cuit,fecha,anio,quien,motivo'),
      ]);
      setPosts(p);
      setDecisiones(d);
      setBase({ ters, desvs, multas, fants, bajas });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar');
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    cargar();
  }, [cargar]);

  const cruces = useMemo(
    () => cruzar(posts, decisiones, base.ters, base.desvs, base.multas, base.fants, base.bajas),
    [posts, decisiones, base],
  );

  // Una fila por persona: la postulación más nueva. Las anteriores se ven en
  // la ficha. Si no, quien se postuló tres veces aparece tres veces.
  const ultimas = useMemo(() => {
    const vistas = new Set<string>();
    const out: Postulacion[] = [];
    for (const p of posts) {
      if (vistas.has(p.id)) continue;
      const c = cruces.get(p.id);
      c?.previas.forEach((q) => vistas.add(q.id));
      out.push(p);
    }
    return out;
  }, [posts, cruces]);

  const enPais = useMemo(
    () =>
      ultimas.filter((p) => {
        if (p.pais === 'otro') return otrosPaises && pais === 'T';
        return pais === 'T' || p.pais === pais;
      }),
    [ultimas, pais, otrosPaises],
  );
  const cantOtros = useMemo(() => ultimas.filter((p) => p.pais === 'otro').length, [ultimas]);

  const desdeMs = periodo === 'T' ? 0 : Date.now() - Number(periodo) * 86_400_000;
  const enPeriodo = useMemo(() => enPais.filter((p) => Date.parse(p.postulado_at) >= desdeMs), [enPais, desdeMs]);

  const kpis = useMemo(() => {
    let sinDecidir = 0,
      yaEstuvo = 0,
      nuestra = 0,
      minimos = 0,
      repiten = 0;
    for (const p of enPeriodo) {
      const c = cruces.get(p.id)!;
      if (!c.decision) sinDecidir++;
      if (c.historial !== 'nuevo') yaEstuvo++;
      if (c.historial === 'baja_nuestra') nuestra++;
      if (c.cumpleMinimos) minimos++;
      if (c.previas.length) repiten++;
    }
    return { total: enPeriodo.length, sinDecidir, yaEstuvo, nuestra, minimos, repiten };
  }, [enPeriodo, cruces]);

  const filas = useMemo(() => {
    const b = busqueda.trim().toLowerCase();
    const bDigitos = b.replace(/\D/g, '');
    return enPeriodo.filter((p) => {
      const c = cruces.get(p.id)!;
      if (hist === 'ya_estuvo' && c.historial === 'nuevo') return false;
      if (hist !== 'T' && hist !== 'ya_estuvo' && c.historial !== hist) return false;
      if (dec === 'sin_decidir' && c.decision) return false;
      if (dec !== 'T' && dec !== 'sin_decidir' && c.decision?.decision !== dec) return false;
      if (soloMinimos && !c.cumpleMinimos) return false;
      if (b) {
        const porCuit = bDigitos.length >= 4 && (p.cuit ?? '').includes(bDigitos);
        if (!p.nombre.toLowerCase().includes(b) && !p.email.includes(b) && !porCuit) return false;
      }
      return true;
    });
  }, [enPeriodo, cruces, busqueda, hist, dec, soloMinimos]);

  if (cargando) return <div className="empty-wrap">Cargando postulaciones…</div>;

  return (
    <div>
      {error && <div className="rc-err">No se pudo cargar: {error}</div>}
      {!error && posts.length === 0 && (
        <div className="rc-err">
          Todavía no llegó ninguna postulación. Se cargan desde la planilla de respuestas del form (menú Dashboard RRHH → Mandar todo).
        </div>
      )}

      <div className="ks" style={{ marginTop: 8 }}>
        <div className="k" onClick={() => { setHist('T'); setDec('T'); setSoloMinimos(false); }}>
          <div className="kv">{kpis.total}</div>
          <div className="kl">Postulaciones</div>
        </div>
        <div className="k" onClick={() => { setHist('T'); setDec('sin_decidir'); }}>
          <div className="kv" style={{ color: 'var(--ac)' }}>{kpis.sinDecidir}</div>
          <div className="kl">Sin decidir</div>
        </div>
        <div className="k" onClick={() => { setSoloMinimos(true); setHist('T'); }}>
          <div className="kv" style={{ color: 'var(--v)' }}>{kpis.minimos}</div>
          <div className="kl">Cumplen mínimos</div>
        </div>
        <div className="k" onClick={() => { setHist('ya_estuvo'); setDec('T'); }}>
          <div className="kv" style={{ color: 'var(--am)' }}>{kpis.yaEstuvo}</div>
          <div className="kl">Ya estuvieron</div>
        </div>
        <div className="k" onClick={() => { setHist('baja_nuestra'); setDec('T'); }}>
          <div className="kv" style={{ color: 'var(--r)' }}>{kpis.nuestra}</div>
          <div className="kl">Baja nuestra</div>
        </div>
        <div className="k" title="Se postularon más de una vez (mismo mail o mismo CUIT/RUT)">
          <div className="kv">{kpis.repiten}</div>
          <div className="kl">Repiten</div>
        </div>
      </div>

      <div className="ctr">
        <div className="sw">
          <input className="si" placeholder="Buscar nombre, mail o CUIT/RUT..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        <select value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
          <option value="30">Últimos 30 días</option>
          <option value="90">Últimos 90 días</option>
          <option value="365">Último año</option>
          <option value="T">Desde siempre</option>
        </select>
        <select value={hist} onChange={(e) => setHist(e.target.value as FiltroHist)}>
          <option value="T">Todo el historial</option>
          <option value="ya_estuvo">Ya estuvieron (cualquiera)</option>
          {(Object.keys(TEXTO_HISTORIAL) as Historial[]).map((h) => (
            <option key={h} value={h}>{TEXTO_HISTORIAL[h]}</option>
          ))}
        </select>
        <select value={dec} onChange={(e) => setDec(e.target.value as FiltroDec)}>
          <option value="T">Todas las decisiones</option>
          <option value="sin_decidir">Sin decidir</option>
          {(Object.keys(TEXTO_DECISION) as Decision[]).map((d) => (
            <option key={d} value={d}>{TEXTO_DECISION[d]}</option>
          ))}
        </select>
        <label className="rc-chk">
          <input type="checkbox" checked={soloMinimos} onChange={(e) => setSoloMinimos(e.target.checked)} /> Solo cumplen mínimos
        </label>
        {pais === 'T' && cantOtros > 0 && (
          <label className="rc-chk" title="Chile cerró. Se guardan por si alguien se muda a AR o UY.">
            <input type="checkbox" checked={otrosPaises} onChange={(e) => setOtrosPaises(e.target.checked)} /> Otros países ({cantOtros})
          </label>
        )}
        <span className="cnt">{filas.length}</span>
      </div>

      <div className="tw">
        <table className="rc-tabla">
          <thead>
            <tr>
              <th style={{ width: 70 }}>Fecha</th>
              <th style={{ width: 40 }}>País</th>
              <th style={{ width: 210 }}>Nombre</th>
              <th style={{ width: 160 }}>Historial</th>
              <th>En la plataforma</th>
              <th style={{ width: 150 }}>Mínimos</th>
              <th style={{ width: 110 }}>Decisión</th>
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, mostrar).map((p) => {
              const c = cruces.get(p.id)!;
              return (
                <tr key={p.id} onClick={() => setAbierta(p)} className={c.historial === 'baja_nuestra' ? 'rc-alerta' : ''}>
                  <td className="rc-mono">{fecha(p.postulado_at)}</td>
                  <td>
                    {p.pais === 'otro' ? (
                      <span title={p.pais_texto ?? ''}>—</span>
                    ) : (
                      <span style={{ color: p.pais === 'AR' ? 'var(--ar)' : 'var(--uy)' }}>{p.pais}</span>
                    )}
                  </td>
                  <td>
                    <div style={{ fontWeight: 500 }}>{p.nombre}</div>
                    <div className="rc-sub">{p.email}</div>
                  </td>
                  <td>
                    <span className={CLASE_HISTORIAL[c.historial]} style={c.historial === 'posible' ? { borderStyle: 'dashed' } : undefined}>
                      {TEXTO_HISTORIAL[c.historial]}
                    </span>
                    {c.previas.length > 0 && <div className="rc-sub">Se postuló {c.previas.length + 1} veces</div>}
                  </td>
                  <td>
                    {c.ter ? (
                      <>
                        <div>
                          {c.ter.nombre} <span className="rc-sub">· por {c.coincide}</span>
                        </div>
                        <div className="rc-sub">
                          Alta {fecha(c.ter.inicio)}
                          {!c.ter.activo && ` · baja ${fecha(c.ter.fecha_baja)}`}
                          {c.motivoBaja && ` · ${TEXTO_MOTIVO_BAJA[c.motivoBaja]}`}
                          {c.multaPendiente && ' · multa pendiente'}
                          {c.fantasmeos > 0 && ` · ${c.fantasmeos} fantasmeo${c.fantasmeos > 1 ? 's' : ''}`}
                        </div>
                      </>
                    ) : c.bajaHist ? (
                      <>
                        <div>
                          {c.bajaHist.nombre} <span className="rc-sub">· por {c.bajaHistPor === 'cuit' ? 'CUIT/RUT' : c.bajaHistPor}</span>
                        </div>
                        <div className="rc-sub">{textoBajaHist(c.bajaHist)}</div>
                      </>
                    ) : (
                      <span className="rc-sub">—</span>
                    )}
                  </td>
                  <td>
                    {c.cumpleMinimos ? (
                      <span className="sit sit-g">Cumple</span>
                    ) : (
                      <span className="rc-sub">Falta: {c.minimosQueFaltan.join(', ')}</span>
                    )}
                  </td>
                  <td>
                    {c.decision ? (
                      <span className={`rc-dec rc-dec-${c.decision.decision}`}>{TEXTO_DECISION[c.decision.decision]}</span>
                    ) : c.decisionPrevia ? (
                      <span className="rc-sub" title={c.decisionPrevia.motivo}>
                        Antes: {TEXTO_DECISION[c.decisionPrevia.decision]}
                      </span>
                    ) : (
                      <span className="rc-sub">Sin decidir</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {filas.length > mostrar && (
        <div style={{ textAlign: 'center', margin: 10 }}>
          <button className="btn" onClick={() => setMostrar((m) => m + MOSTRAR)}>
            Mostrar más ({filas.length - mostrar} restantes)
          </button>
        </div>
      )}

      {abierta && (
        <Ficha
          p={abierta}
          c={cruces.get(abierta.id)!}
          decisiones={decisiones.filter(
            (d) => d.postulacion_id === abierta.id || cruces.get(abierta.id)!.previas.some((q) => q.id === d.postulacion_id),
          )}
          userEmail={userEmail}
          onClose={() => setAbierta(null)}
          onDecidida={(d) => setDecisiones((prev) => [...prev, d])}
        />
      )}
    </div>
  );
}

function Ficha({
  p,
  c,
  decisiones,
  userEmail,
  onClose,
  onDecidida,
}: {
  p: Postulacion;
  c: Cruce;
  decisiones: DecisionRow[];
  userEmail?: string;
  onClose: () => void;
  onDecidida: (d: DecisionRow) => void;
}) {
  const [respuestas, setRespuestas] = useState<Record<string, string> | null>(null);
  const [motivo, setMotivo] = useState('');
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Las respuestas largas (disponibilidad, CV, video…) se traen al abrir: con
  // todas las postulaciones juntas la carga de la solapa se hace pesada.
  useEffect(() => {
    let vivo = true;
    (async () => {
      const { data } = await getSupabase().from('postulaciones').select('respuestas').eq('id', p.id).maybeSingle();
      if (vivo) setRespuestas(((data as { respuestas?: Record<string, string> } | null)?.respuestas) ?? {});
    })();
    return () => {
      vivo = false;
    };
  }, [p.id]);

  async function decidir(decision: Decision) {
    if (motivo.trim().length < MIN_MOTIVO) return;
    if (!userEmail) {
      setError('No se sabe quién está usando el dashboard: volvé a entrar.');
      return;
    }
    setGuardando(true);
    setError(null);
    const { data, error: e } = await getSupabase()
      .from('postulacion_decisiones')
      .insert({ postulacion_id: p.id, decision, motivo: motivo.trim(), decidido_por: userEmail })
      .select('id,postulacion_id,decision,motivo,decidido_por,created_at')
      .single();
    setGuardando(false);
    if (e) {
      setError(e.message);
      return;
    }
    onDecidida(data as DecisionRow);
    setMotivo('');
  }

  const historialDec = decisiones.slice().sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  const motivoOk = motivo.trim().length >= MIN_MOTIVO;
  // Si lo desvinculamos nosotros, que avance tiene que estar muy justificado.
  const avisoNuestra = c.historial === 'baja_nuestra';

  return (
    <div className="ov open" onClick={onClose}>
      <div className="mo" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div>
            <div className="mn2">{p.nombre}</div>
            <div className="mm" style={{ marginBottom: 0 }}>
              {p.pais === 'otro' ? p.pais_texto : p.pais} · {p.email}
              {p.cuit && ` · CUIT/RUT ${p.cuit}`} · se postuló el {fecha(p.postulado_at)}
            </div>
          </div>
          <button className="mcl" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>
        <div className="mb">
          {/* Historial en la plataforma: lo primero que hay que ver. */}
          <div className="ms">
            <div className="mst">En la plataforma</div>
            {c.ter ? (
              <div className={`rc-box ${avisoNuestra ? 'rc-box-r' : ''}`}>
                <div>
                  <span className={CLASE_HISTORIAL[c.historial]}>{TEXTO_HISTORIAL[c.historial]}</span>{' '}
                  <b>{c.ter.nombre}</b>{' '}
                  <span className="rc-sub">
                    #{c.ter.id} · {c.ter.pais} · coincide por {c.coincide}
                  </span>
                </div>
                <div className="rc-sub" style={{ marginTop: 4 }}>
                  Alta {fecha(c.ter.inicio)}
                  {!c.ter.activo && ` · baja ${fecha(c.ter.fecha_baja)}`}
                  {c.ter.email && c.ter.email.toLowerCase() !== p.email && ` · en la plataforma con ${c.ter.email}`}
                </div>
                {c.motivoBaja && <div style={{ marginTop: 4 }}>{TEXTO_MOTIVO_BAJA[c.motivoBaja]}</div>}
                {c.notaBaja && <div className="rc-sub" style={{ marginTop: 2 }}>{c.notaBaja}</div>}
                {c.multaPendiente && (
                  <div style={{ marginTop: 4, color: 'var(--r)' }}>
                    Multa pendiente: {c.multaPendiente.moneda} {c.multaPendiente.saldo}
                  </div>
                )}
                {c.fantasmeos > 0 && (
                  <div className="rc-sub" style={{ marginTop: 2 }}>
                    Fantasmeado {c.fantasmeos === 1 ? 'una vez' : `${c.fantasmeos} veces`}
                  </div>
                )}
                {c.coincide === 'nombre' && (
                  <div className="rc-sub" style={{ marginTop: 4 }}>
                    Coincide solo el nombre: puede ser otra persona. Confirmalo antes de decidir.
                    {c.otrosPorNombre.length > 0 && ` También: ${c.otrosPorNombre.map((t) => `${t.nombre} #${t.id}`).join(', ')}.`}
                  </div>
                )}
              </div>
            ) : !c.bajaHist ? (
              <div className="rc-sub">No aparece en la plataforma (ni por mail ni por nombre) ni en el historial de bajas.</div>
            ) : (
              <div className="rc-sub">No está en la plataforma desde abril 2026, pero sí en el historial de bajas (abajo).</div>
            )}
          </div>

          {/* Bajas anteriores al dashboard (form de desvinculación desde 2024 y
              planilla 2022-2023): sin esto, quien se fue antes no se ve. */}
          {c.bajaHist && (
            <div className="ms">
              <div className="mst">Historial de bajas</div>
              <div className={`rc-box ${c.bajaHist.quien === 'nuestra' ? 'rc-box-r' : ''}`}>
                <div>
                  <b>{c.bajaHist.nombre}</b>{' '}
                  <span className="rc-sub">
                    {c.bajaHist.pais ?? '—'} · coincide por {c.bajaHistPor === 'cuit' ? 'CUIT/RUT' : c.bajaHistPor}
                    {c.bajaHist.email && c.bajaHist.email !== p.email.toLowerCase() && ` · con ${c.bajaHist.email}`}
                  </span>
                </div>
                <div style={{ marginTop: 4 }}>{textoBajaHist(c.bajaHist)}</div>
                {c.bajaHist.motivo && <div className="rc-sub" style={{ marginTop: 2 }}>{c.bajaHist.motivo}</div>}
                {c.bajaHistPor === 'nombre' && (
                  <div className="rc-sub" style={{ marginTop: 4 }}>
                    Coincide solo el nombre: puede ser otra persona. Confirmalo antes de decidir.
                  </div>
                )}
              </div>
            </div>
          )}

          {c.previas.length > 0 && (
            <div className="ms">
              <div className="mst">Postulaciones anteriores</div>
              {c.previas.map((q) => (
                <div key={q.id} className="rc-sub">
                  {fecha(q.postulado_at)} · {q.email}
                  {q.cuit && q.cuit === p.cuit && q.email !== p.email && ' · mismo CUIT/RUT, otro mail'}
                </div>
              ))}
            </div>
          )}

          <div className="ms">
            <div className="mst">Mínimos</div>
            <div className="ind" style={{ marginTop: 0 }}>
              {(
                [
                  ['Título', p.titulo],
                  ['Proceso personal', p.proceso_personal],
                  ['Experiencia clínica', p.experiencia_clinica],
                  ['Supervisión', p.supervision],
                  ['10 horas', p.diez_horas],
                ] as [string, string | null][]
              ).map(([k, v]) => (
                <span key={k} className="ic" style={{ color: c.minimosQueFaltan.includes(k) ? 'var(--r)' : undefined }}>
                  {k}: {v || '—'}
                </span>
              ))}
            </div>
          </div>

          <div className="ms">
            <div className="mst">Respuestas</div>
            {respuestas === null ? (
              <div className="rc-sub">Cargando…</div>
            ) : (
              <>
                {PREGUNTAS.filter(([k]) => respuestas[k]).map(([k, t]) => (
                  <div key={k} className="rc-resp">
                    <div className="rc-sub">{t}</div>
                    <div>{respuestas[k]}</div>
                  </div>
                ))}
                <div className="ind">
                  {(['cv', 'video', 'linkedin'] as const)
                    .filter((k) => respuestas[k])
                    .map((k) =>
                      esLink(respuestas[k]) ? (
                        <a
                          key={k}
                          className="btn"
                          href={respuestas[k].split(/[\s,]+/)[0]}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ textDecoration: 'none' }}
                        >
                          {k === 'cv' ? 'CV' : k === 'video' ? 'Video' : 'LinkedIn'} ↗
                        </a>
                      ) : (
                        <span key={k} className="ic">
                          {k}: {respuestas[k]}
                        </span>
                      ),
                    )}
                </div>
              </>
            )}
          </div>

          <div className="ms">
            <div className="mst">Decisión</div>
            {historialDec.map((d) => (
              <div key={d.id} className="rc-resp">
                <span className={`rc-dec rc-dec-${d.decision}`}>{TEXTO_DECISION[d.decision]}</span>{' '}
                <span className="rc-sub">
                  {fecha(d.created_at)} · {d.decidido_por}
                  {d.postulacion_id !== p.id && ' · en una postulación anterior'}
                </span>
                <div>{d.motivo}</div>
              </div>
            ))}
            {avisoNuestra && (
              <div className="rc-err" style={{ marginTop: 6 }}>
                La desvinculamos nosotros. Antes de que avance, revisá el motivo de la baja con quien la decidió.
              </div>
            )}
            <textarea
              className="rc-ta"
              placeholder={`Motivo (obligatorio, al menos ${MIN_MOTIVO} caracteres). Queda para la próxima vez que se postule.`}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
              <button className="btn rc-btn rc-b-avanza" disabled={!motivoOk || guardando} onClick={() => decidir('avanza')}>
                Avanza
              </button>
              <button className="btn rc-btn rc-b-no" disabled={!motivoOk || guardando} onClick={() => decidir('no_avanza')}>
                No avanza
              </button>
              <button className="btn rc-btn" disabled={!motivoOk || guardando} onClick={() => decidir('en_espera')}>
                En espera
              </button>
            </div>
            {error && <div className="rc-err" style={{ marginTop: 6 }}>{error}</div>}
            <div className="rc-sub" style={{ marginTop: 6 }}>
              Por ahora esto no manda mails ni toca la planilla de Procesos: solo deja registrada la decisión.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
