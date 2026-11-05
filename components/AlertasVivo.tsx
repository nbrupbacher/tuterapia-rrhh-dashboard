'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter, TherapistView } from '@/lib/types';

/**
 * Solapa En vivo → Alertas: pacientes para rescatar.
 *
 * Las alertas las crea el cron diario (lib/en-vivo-alertas.ts) en
 * `alertas_vivo`. Acá el equipo las deriva a CX o las cierra.
 *
 * Una alerta está "vigente" si la vio la última corrida del cron. Si dejó de
 * verla, el paciente agendó: se muestra como "Agendó" en Cerradas, sin que
 * nadie la toque. Así se distingue lo que resolvió el equipo de lo que se
 * resolvió solo.
 *
 * El nombre del paciente no está en Supabase: se pide a /api/en-vivo/pacientes,
 * que lo lee de la plataforma en el momento.
 */

type Estado = 'abierta' | 'derivada_cx' | 'resuelta' | 'descartada';
type Vista = 'pendientes' | 'derivadas' | 'cerradas';
type Regla = 'T' | 'A' | 'B';

type Alerta = {
  id: string;
  regla: 'A' | 'B';
  therapist_id: string;
  paciente_id: number;
  fecha_referencia: string;
  detectada_el: string;
  vista_ultima: string;
  estado: Estado;
  estado_por: string | null;
  estado_at: string | null;
  nota: string | null;
};

type Fila = Alerta & {
  vigente: boolean;
  vista: Vista;
  psicologo: string;
  pais: string;
  matrix: TherapistView | null;
  dias: number;
};

const POR_PAGINA = 50;
const LOCAL_OFFSET_MS = 3 * 3_600_000;
// Las cerradas se miran hasta dos meses para atrás: alcanza para ver qué
// pasó con lo derivado sin cargar la historia entera.
const DIAS_HISTORIA = 60;

const TEXTO_REGLA: Record<'A' | 'B', string> = {
  A: 'Se registró y no agendó',
  B: 'Tuvo la 1ª sesión y no agendó la 2ª',
};

const ESTILOS = `
.va-leg { font-size:11px; color:var(--t2); margin:6px 0 8px; display:flex; gap:14px; flex-wrap:wrap; }
.va-r { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:4px; font-size:10px; font-weight:700; font-family:var(--m); }
.va-rA { background:rgba(245,166,35,.12); color:var(--am); border:1px solid rgba(245,166,35,.3); }
.va-rB { background:rgba(79,142,247,.1); color:var(--ac); border:1px solid rgba(79,142,247,.3); }
.va-acc { display:flex; gap:4px; }
.va-acc .btn { padding:3px 8px; font-size:10px; }
.va-cx { border-color:rgba(52,211,153,.4) !important; color:var(--v) !important; }
.va-sub { font-size:10px; color:var(--t3); }
.va-err { background:rgba(240,82,82,.08); border:1px solid rgba(240,82,82,.3); color:var(--r); border-radius:6px; padding:6px 10px; font-size:11px; margin-bottom:8px; }
.c-va-r { width:34px; } .c-va-pac { width:190px; } .c-va-ps { width:170px; } .c-va-d { width:150px; }
.c-va-det { width:74px; } .c-va-est { width:120px; } .c-va-acc { width:220px; }
`;

function diaLocal(d: Date): string {
  return new Date(d.getTime() - LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

function ddmm(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

export function AlertasVivo({
  pais,
  therapists,
  onRowClick,
  ultimaCorrida,
}: {
  pais: PaisFilter;
  therapists: TherapistView[];
  onRowClick: (t: TherapistView) => void;
  /** Última corrida buena del cron (ISO). Define qué alertas siguen vigentes. */
  ultimaCorrida: string | null;
}) {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [errorNombres, setErrorNombres] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);

  const [vista, setVista] = useState<Vista>('pendientes');
  const [regla, setRegla] = useState<Regla>('T');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(0);

  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const sb = getSupabase();
        const { data: u } = await sb.auth.getUser();
        if (vivo) setEmail(u?.user?.email ?? null);

        const desde = diaLocal(new Date(Date.now() - DIAS_HISTORIA * 86_400_000));
        const out: Alerta[] = [];
        for (let i = 0; ; i += 1000) {
          const { data, error: e } = await sb
            .from('alertas_vivo')
            .select('*')
            .gte('vista_ultima', desde)
            .order('fecha_referencia', { ascending: true })
            .range(i, i + 999);
          if (e) throw e;
          out.push(...((data ?? []) as Alerta[]));
          if (!data || data.length < 1000) break;
        }
        if (!vivo) return;
        setAlertas(out);

        // Los nombres llegan después: la bandeja se ve igual con el número
        // de paciente si la plataforma tarda o falla.
        const ids = [...new Set(out.map((a) => a.paciente_id))];
        if (ids.length === 0) return;
        const { data: s } = await sb.auth.getSession();
        const token = s?.session?.access_token;
        if (!token) return;
        const res = await fetch('/api/en-vivo/pacientes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ ids }),
        });
        const json = await res.json().catch(() => ({}));
        if (!vivo) return;
        if (!res.ok) setErrorNombres(json?.error ?? `HTTP ${res.status}`);
        else setNombres(json?.nombres ?? {});
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);

  const filas = useMemo<Fila[]>(() => {
    const matrixPor = new Map(therapists.map((t) => [t.id, t]));
    const diaCorrida = ultimaCorrida ? diaLocal(new Date(ultimaCorrida)) : null;
    const ahora = Date.now();
    return alertas.map((a) => {
      const mx = matrixPor.get(a.therapist_id) ?? null;
      const vigente = !diaCorrida || a.vista_ultima >= diaCorrida;
      const v: Vista =
        !vigente || a.estado === 'resuelta' || a.estado === 'descartada'
          ? 'cerradas'
          : a.estado === 'derivada_cx'
            ? 'derivadas'
            : 'pendientes';
      return {
        ...a,
        vigente,
        vista: v,
        psicologo: mx?.nombre ?? `Terapeuta #${a.therapist_id}`,
        pais: mx?.pais ?? '—',
        matrix: mx,
        dias: Math.max(0, Math.floor((ahora - Date.parse(a.fecha_referencia)) / 86_400_000)),
      };
    });
  }, [alertas, therapists, ultimaCorrida]);

  const enPais = useMemo(() => filas.filter((f) => pais === 'T' || f.pais === pais), [filas, pais]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const out = enPais
      .filter((f) => f.vista === vista)
      .filter((f) => regla === 'T' || f.regla === regla)
      .filter((f) => {
        if (!q) return true;
        const pac = (nombres[String(f.paciente_id)] ?? '').toLowerCase();
        return f.psicologo.toLowerCase().includes(q) || pac.includes(q) || String(f.paciente_id).includes(q);
      });
    // Pendientes: lo más viejo primero, es lo que más urge. Cerradas: lo
    // último que pasó primero.
    return vista === 'cerradas'
      ? out.sort((a, b) => (b.estado_at ?? b.vista_ultima).localeCompare(a.estado_at ?? a.vista_ultima))
      : out.sort((a, b) => b.dias - a.dias);
  }, [enPais, vista, regla, busqueda, nombres]);

  useEffect(() => setPagina(0), [vista, regla, busqueda, pais]);

  const totales = useMemo(() => {
    const hace7 = diaLocal(new Date(Date.now() - 7 * 86_400_000));
    const t = { a: 0, b: 0, derivadas: 0, cerradas: 0, solas7: 0 };
    for (const f of enPais) {
      if (f.vista === 'pendientes') {
        if (f.regla === 'A') t.a++;
        else t.b++;
      } else if (f.vista === 'derivadas') t.derivadas++;
      else t.cerradas++;
      if (!f.vigente && f.vista_ultima >= hace7) t.solas7++;
    }
    return t;
  }, [enPais]);

  async function cambiar(a: Fila, estado: Estado) {
    setGuardando(a.id);
    setError(null);
    const cambios = { estado, estado_por: email, estado_at: new Date().toISOString() };
    const { error: e } = await getSupabase().from('alertas_vivo').update(cambios).eq('id', a.id);
    if (e) setError(`No se pudo guardar: ${e.message}`);
    else setAlertas((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...cambios } : x)));
    setGuardando(null);
  }

  function nombrePaciente(f: Fila): string {
    return nombres[String(f.paciente_id)] ?? `Paciente #${f.paciente_id}`;
  }

  function motivo(f: Fila): string {
    return f.regla === 'A'
      ? `se registró hace ${f.dias} días y no agendó`
      : `tuvo la 1ª sesión hace ${f.dias} días y no agendó la 2ª`;
  }

  // Texto listo para pegar en el canal de CX: una línea por paciente.
  async function copiarParaCx() {
    const lineas = visibles.map(
      (f) => `• ${nombrePaciente(f)} (#${f.paciente_id}) — psicólogo/a: ${f.psicologo} (${f.pais}) — ${motivo(f)}`,
    );
    try {
      await navigator.clipboard.writeText(lineas.join('\n'));
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2000);
    } catch {
      setError('No se pudo copiar al portapapeles');
    }
  }

  if (cargando) return <div className="empty-wrap">Cargando alertas…</div>;

  const paginas = Math.ceil(visibles.length / POR_PAGINA);
  const pag = visibles.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);

  return (
    <>
      <style>{ESTILOS}</style>

      <div className="ks" style={{ marginTop: 8 }}>
        <div className="k" onClick={() => { setVista('pendientes'); setRegla('A'); }}>
          <div className="kv" style={{ color: 'var(--am)' }}>{totales.a}</div>
          <div className="kl">A · Registro sin agendar</div>
        </div>
        <div className="k" onClick={() => { setVista('pendientes'); setRegla('B'); }}>
          <div className="kv" style={{ color: 'var(--ac)' }}>{totales.b}</div>
          <div className="kl">B · Sin 2ª sesión</div>
        </div>
        <div className="k" onClick={() => { setVista('derivadas'); setRegla('T'); }}>
          <div className="kv" style={{ color: 'var(--v)' }}>{totales.derivadas}</div>
          <div className="kl">Derivadas a CX</div>
        </div>
        <div className="k" onClick={() => { setVista('cerradas'); setRegla('T'); }} title="Alertas que dejaron de aparecer porque el paciente agendó">
          <div className="kv">{totales.solas7}</div>
          <div className="kl">Agendaron (últ. 7 días)</div>
        </div>
      </div>

      <div className="va-leg">
        <span><span className="va-r va-rA">A</span> Se registró hace más de 48 h y no agendó con su psicólogo/a.</span>
        <span><span className="va-r va-rB">B</span> Tuvo la 1ª sesión hace más de 5 días y no tiene otra agendada.</span>
      </div>

      {error && <div className="va-err">{error}</div>}
      {errorNombres && <div className="va-err">No se pudieron traer los nombres de los pacientes ({errorNombres}). Se muestra el número.</div>}

      <div className="ctr">
        <div className="tog">
          <button className={`togb ${vista === 'pendientes' ? 'on' : ''}`} onClick={() => setVista('pendientes')}>Pendientes ({totales.a + totales.b})</button>
          <button className={`togb ${vista === 'derivadas' ? 'on' : ''}`} onClick={() => setVista('derivadas')}>Derivadas a CX ({totales.derivadas})</button>
          <button className={`togb ${vista === 'cerradas' ? 'on' : ''}`} onClick={() => setVista('cerradas')}>Cerradas ({totales.cerradas})</button>
        </div>
        <select value={regla} onChange={(e) => setRegla(e.target.value as Regla)}>
          <option value="T">Todas las reglas</option>
          <option value="A">A · Registro sin agendar</option>
          <option value="B">B · Sin 2ª sesión</option>
        </select>
        <div className="sw">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="si" placeholder="Buscar paciente o psicólogo..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        {vista === 'derivadas' && visibles.length > 0 && (
          <button className="btn va-cx" onClick={copiarParaCx}>{copiado ? 'Copiado ✓' : 'Copiar lista para CX'}</button>
        )}
        <span className="cnt">{visibles.length} alertas</span>
      </div>

      {visibles.length === 0 ? (
        <div className="empty-wrap" style={{ padding: '40px 24px' }}>
          <h3>{alertas.length === 0 ? 'Todavía no hay alertas' : 'Nada por acá'}</h3>
          <p style={{ fontSize: 12 }}>
            {alertas.length === 0
              ? 'Se cargan con la sincronización diaria de las 07:00.'
              : vista === 'pendientes'
                ? 'No hay pacientes pendientes de rescate con estos filtros.'
                : 'No hay alertas en esta vista con estos filtros.'}
          </p>
        </div>
      ) : (
        <div className="tw">
          <table>
            <thead>
              <tr>
                <th className="c-va-r">Regla</th>
                <th className="c-va-pac">Paciente</th>
                <th className="c-va-ps">Psicólogo/a</th>
                <th className="c-p">País</th>
                <th className="c-va-d" title="Días desde el registro (A) o desde la 1ª sesión (B)">Hace</th>
                <th className="c-va-det" title="Primer día en que apareció la alerta">Detectada</th>
                <th className="c-va-est">Estado</th>
                <th className="c-va-acc">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pag.map((f) => (
                <tr
                  key={f.id}
                  onClick={() => f.matrix && onRowClick(f.matrix)}
                  style={{ cursor: f.matrix ? 'pointer' : 'default' }}
                >
                  <td className="c-va-r"><span className={`va-r va-r${f.regla}`} title={TEXTO_REGLA[f.regla]}>{f.regla}</span></td>
                  <td className="c-va-pac">
                    <div className="tn">{nombrePaciente(f)}</div>
                    <div className="va-sub tm">#{f.paciente_id}</div>
                  </td>
                  <td className="c-va-ps tn" style={{ color: f.matrix ? undefined : 'var(--t2)' }}>{f.psicologo}</td>
                  <td className="c-p">{f.pais === '—' ? '—' : <span className={`b ${f.pais === 'AR' ? 'bar' : 'buy'}`}>{f.pais}</span>}</td>
                  <td className="c-va-d" title={motivo(f)}>
                    <span className="tm" style={{ color: f.dias >= 14 ? 'var(--r)' : f.dias >= 7 ? 'var(--am)' : undefined }}>{f.dias} días</span>
                    <div className="va-sub">{f.regla === 'A' ? 'desde el registro' : 'desde la 1ª sesión'}</div>
                  </td>
                  <td className="c-va-det tm">{ddmm(f.detectada_el)}</td>
                  <td className="c-va-est">
                    <EstadoBadge f={f} />
                  </td>
                  <td className="c-va-acc" onClick={(e) => e.stopPropagation()}>
                    <div className="va-acc">
                      {f.vista === 'pendientes' && (
                        <>
                          <button className="btn va-cx" disabled={guardando === f.id} onClick={() => cambiar(f, 'derivada_cx')}>Derivar a CX</button>
                          <button className="btn" disabled={guardando === f.id} onClick={() => cambiar(f, 'resuelta')}>Resuelto</button>
                          <button className="btn" disabled={guardando === f.id} onClick={() => cambiar(f, 'descartada')} title="No hace falta rescatarlo (ej.: lo habló directo con el psicólogo)">Descartar</button>
                        </>
                      )}
                      {f.vista === 'derivadas' && (
                        <>
                          <button className="btn" disabled={guardando === f.id} onClick={() => cambiar(f, 'resuelta')}>Resuelto</button>
                          <button className="btn" disabled={guardando === f.id} onClick={() => cambiar(f, 'abierta')}>Volver a pendiente</button>
                        </>
                      )}
                      {f.vista === 'cerradas' && f.vigente && (
                        <button className="btn" disabled={guardando === f.id} onClick={() => cambiar(f, 'abierta')}>Reabrir</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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

function EstadoBadge({ f }: { f: Fila }) {
  const quien = f.estado_por ? f.estado_por.split('@')[0] : null;
  const cuando = f.estado_at ? ddmm(diaLocal(new Date(f.estado_at))) : null;
  const pie = quien && cuando ? `${quien} · ${cuando}` : null;
  let txt: string;
  let cls: string;
  if (!f.vigente) {
    txt = 'Agendó';
    cls = 'ts ts-u';
  } else if (f.estado === 'derivada_cx') {
    txt = 'Derivada a CX';
    cls = 'ts ts-a';
  } else if (f.estado === 'resuelta') {
    txt = 'Resuelta';
    cls = 'ts ts-u';
  } else if (f.estado === 'descartada') {
    txt = 'Descartada';
    cls = 'ts ts-s';
  } else {
    txt = 'Pendiente';
    cls = 'ts ts-e';
  }
  return (
    <>
      <span className={cls}>{txt}</span>
      {pie && <div className="va-sub">{pie}</div>}
    </>
  );
}
