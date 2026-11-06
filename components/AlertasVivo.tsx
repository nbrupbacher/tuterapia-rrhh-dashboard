'use client';

import { useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter, TherapistView } from '@/lib/types';

/**
 * Solapa En vivo → Alertas: pacientes para rescatar.
 *
 * Las alertas las crea el cron diario (lib/en-vivo-alertas.ts) en
 * `alertas_vivo`. Acá el equipo se las pasa a CX.
 *
 * Una alerta está "vigente" si la vio la última corrida del cron. Si dejó de
 * verla, el paciente agendó o pasó la ventana de la regla: va a Cerradas como
 * "Agendó" o "Venció sin agendar", sin que nadie la toque. Por eso no hay
 * botón "Resuelto": lo que importa (si agendó) se detecta solo.
 *
 * A CX se le pasa una planilla (CX tiene su propia matrix, no conectada con
 * esta): "Descargar para CX" baja lo que se ve y lo marca como derivado. CX
 * la devuelve con "Respuesta CX" completa y se carga en `respuestas_cx`.
 *
 * Descartar es la excepción (por ejemplo, un paciente con problemas graves):
 * se hace desde el caso, con motivo obligatorio, y no cuenta en los
 * resultados.
 *
 * El nombre del paciente no está en Supabase: se pide a /api/en-vivo/pacientes,
 * que lo lee de la plataforma en el momento.
 */

type Estado = 'abierta' | 'derivada_cx' | 'resuelta' | 'descartada';
type Vista = 'pendientes' | 'derivadas' | 'cerradas';
type CodRegla = 'A' | 'B' | 'C';
type Regla = 'T' | CodRegla;
type Orden = { col: 'dias' | 'psicologo'; dir: 'asc' | 'desc' };

type Alerta = {
  id: string;
  regla: CodRegla;
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

type RespuestaCx = {
  paciente_id: number;
  respuesta: string;
  comentario: string | null;
  fecha_reporte: string;
};

type Fila = Alerta & {
  vigente: boolean;
  /** Dejó de aparecer porque pasó la ventana de la regla, no porque agendó. */
  vencida: boolean;
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

// Hasta cuántos días mira cada regla del cron (lib/en-vivo-alertas.ts). Una
// alerta que deja de aparecer cerca de ese tope salió por edad: sin esto se
// mostraría como "Agendó" y inflaría los rescates.
const VENTANA_DIAS: Record<CodRegla, number> = { A: 30, B: 35, C: 45 };

const TEXTO_REGLA: Record<CodRegla, string> = {
  A: 'Se registró y no agendó',
  B: 'Tuvo la 1ª sesión y no agendó la 2ª',
  C: 'Tuvo la 4ª sesión y no volvió a la 5ª',
};

const DESDE_REGLA: Record<CodRegla, string> = {
  A: 'desde el registro',
  B: 'desde la 1ª sesión',
  C: 'desde la 4ª sesión',
};

// Las opciones de "Respuesta CX", en el orden en que van en la planilla.
const RESPUESTAS_CX: Record<string, string> = {
  no_responde: 'No responde',
  pide_derivacion: 'Pide derivación',
  va_a_agendar: 'Va a agendar',
  motivos_economicos: 'Motivos económicos',
  siguio_por_fuera: 'Siguió por fuera',
};

// "Siguió por fuera" es señal de que el psicólogo/a se llevó al paciente de la
// plataforma: se resalta para que Talent lo mire como posible desvinculación.
const RESPUESTA_ALERTA = 'siguio_por_fuera';

const ESTILOS = `
.va-leg { font-size:11px; color:var(--t2); margin:6px 0 8px; display:flex; gap:14px; flex-wrap:wrap; }
.va-r { display:inline-flex; align-items:center; justify-content:center; width:18px; height:18px; border-radius:4px; font-size:10px; font-weight:700; font-family:var(--m); }
.va-rA { background:rgba(245,166,35,.12); color:var(--am); border:1px solid rgba(245,166,35,.3); }
.va-rB { background:rgba(79,142,247,.1); color:var(--ac); border:1px solid rgba(79,142,247,.3); }
.va-rC { background:rgba(167,139,250,.1); color:var(--ar); border:1px solid rgba(167,139,250,.3); }
.va-cx { border-color:rgba(52,211,153,.4) !important; color:var(--v) !important; }
.va-sub { font-size:10px; color:var(--t3); }
.va-pac { cursor:pointer; }
.va-pac:hover .tn { color:var(--ac); text-decoration:underline; }
.va-err { background:rgba(240,82,82,.08); border:1px solid rgba(240,82,82,.3); color:var(--r); border-radius:6px; padding:6px 10px; font-size:11px; margin-bottom:8px; }
.va-res { background:var(--bg2); border:1px solid var(--bd); border-radius:8px; padding:8px 11px; font-size:12px; color:var(--t2); margin-bottom:8px; display:flex; gap:14px; flex-wrap:wrap; align-items:center; }
.va-res b { color:var(--t); font-family:var(--m); }
.va-ta { width:100%; min-height:60px; background:var(--bg3); border:1px solid var(--bd2); color:var(--t); border-radius:6px; padding:6px 8px; font-family:var(--f); font-size:12px; resize:vertical; }
.c-va-r { width:40px; } .c-va-pac { width:200px; } .c-va-ps { width:180px; } .c-va-d { width:150px; }
.c-va-det { width:74px; } .c-va-est { width:170px; }
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
  const [respuestas, setRespuestas] = useState<Map<number, RespuestaCx[]>>(new Map());
  const [nombres, setNombres] = useState<Record<string, string>>({});
  const [errorNombres, setErrorNombres] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [caso, setCaso] = useState<Fila | null>(null);

  const [vista, setVista] = useState<Vista>('pendientes');
  const [regla, setRegla] = useState<Regla>('T');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(0);
  // null = orden por defecto de cada vista; se cambia tocando "Hace" o
  // "Psicólogo/a" (por nombre, para ver cuántos casos se juntan en uno).
  const [orden, setOrden] = useState<Orden | null>(null);
  const ordenarPor = (col: Orden['col']) =>
    setOrden((o) => ({ col, dir: o?.col === col ? (o.dir === 'asc' ? 'desc' : 'asc') : col === 'dias' ? 'desc' : 'asc' }));
  const flecha = (col: Orden['col']) => (!orden || orden.col !== col ? '↕' : orden.dir === 'asc' ? '↑' : '↓');

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

        // Respuestas de CX. Si la tabla todavía no existe o falla, la bandeja
        // se ve igual, sin esa información.
        const resp = new Map<number, RespuestaCx[]>();
        for (let i = 0; ; i += 1000) {
          const { data, error: e } = await sb
            .from('respuestas_cx')
            .select('paciente_id, respuesta, comentario, fecha_reporte')
            .order('fecha_reporte', { ascending: false })
            .range(i, i + 999);
          if (e || !data) break;
          for (const r of data as RespuestaCx[]) {
            const arr = resp.get(Number(r.paciente_id));
            if (arr) arr.push(r);
            else resp.set(Number(r.paciente_id), [r]);
          }
          if (data.length < 1000) break;
        }
        if (vivo) setRespuestas(resp);

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
      const edadAlUltimoVisto = (Date.parse(a.vista_ultima) - Date.parse(a.fecha_referencia)) / 86_400_000;
      const vencida = !vigente && edadAlUltimoVisto >= (VENTANA_DIAS[a.regla] ?? 30) - 2;
      const v: Vista =
        !vigente || a.estado === 'resuelta' || a.estado === 'descartada'
          ? 'cerradas'
          : a.estado === 'derivada_cx'
            ? 'derivadas'
            : 'pendientes';
      return {
        ...a,
        vigente,
        vencida,
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
    if (orden) {
      const s = orden.dir === 'asc' ? 1 : -1;
      return orden.col === 'dias'
        ? out.sort((a, b) => s * (a.dias - b.dias))
        : out.sort((a, b) => s * a.psicologo.localeCompare(b.psicologo, 'es', { sensitivity: 'base' }) || b.dias - a.dias);
    }
    // Por defecto. Pendientes: lo más viejo primero, es lo que más urge.
    // Cerradas: lo último que pasó primero.
    return vista === 'cerradas'
      ? out.sort((a, b) => (b.estado_at ?? b.vista_ultima).localeCompare(a.estado_at ?? a.vista_ultima))
      : out.sort((a, b) => b.dias - a.dias);
  }, [enPais, vista, regla, busqueda, nombres, orden]);

  useEffect(() => setPagina(0), [vista, regla, busqueda, pais, orden]);

  const totales = useMemo(() => {
    const hace7 = diaLocal(new Date(Date.now() - 7 * 86_400_000));
    const t = { A: 0, B: 0, C: 0, pendientes: 0, derivadas: 0, cerradas: 0, solas7: 0 };
    for (const f of enPais) {
      // Las tarjetas A/B/C muestran siempre el total de cada regla; los
      // contadores de las vistas, solo la regla elegida, para que coincidan
      // con la lista que se ve.
      if (f.vista === 'pendientes') t[f.regla]++;
      if (regla !== 'T' && f.regla !== regla) continue;
      if (f.vista === 'pendientes') t.pendientes++;
      else if (f.vista === 'derivadas') t.derivadas++;
      else t.cerradas++;
      if (!f.vigente && !f.vencida && f.vista_ultima >= hace7) t.solas7++;
    }
    return t;
  }, [enPais, regla]);

  // Qué pasó con lo que se le pasó a CX, sin pedirle nada a CX: si agendó o
  // venció lo detecta el cron. Lo descartado no cuenta.
  const resultadosCx = useMemo(() => {
    const r = { total: 0, agendaron: 0, vencieron: 0, esperando: 0 };
    for (const f of enPais) {
      if (f.estado !== 'derivada_cx') continue;
      if (regla !== 'T' && f.regla !== regla) continue;
      r.total++;
      if (f.vigente) r.esperando++;
      else if (f.vencida) r.vencieron++;
      else r.agendaron++;
    }
    return r;
  }, [enPais, regla]);

  async function cambiar(a: Fila, estado: Estado, nota?: string) {
    setGuardando(a.id);
    setError(null);
    const cambios: Partial<Alerta> = { estado, estado_por: email, estado_at: new Date().toISOString() };
    if (nota !== undefined) cambios.nota = nota;
    const { error: e } = await getSupabase().from('alertas_vivo').update(cambios).eq('id', a.id);
    if (e) setError(`No se pudo guardar: ${e.message}`);
    else setAlertas((prev) => prev.map((x) => (x.id === a.id ? { ...x, ...cambios } : x)));
    setGuardando(null);
    return !e;
  }

  function nombrePaciente(f: Fila): string {
    return nombres[String(f.paciente_id)] ?? `Paciente #${f.paciente_id}`;
  }

  function motivo(f: Fila): string {
    if (f.regla === 'A') return `se registró hace ${f.dias} días y no agendó`;
    if (f.regla === 'B') return `tuvo la 1ª sesión hace ${f.dias} días y no agendó la 2ª`;
    return `tuvo la 4ª sesión hace ${f.dias} días y no volvió a la 5ª`;
  }

  function ultimaRespuesta(f: Fila): RespuestaCx | null {
    return respuestas.get(f.paciente_id)?.[0] ?? null;
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

  // Planilla para CX con lo que se ve (respeta filtros y buscador). Desde
  // Pendientes, las marca como derivadas sin preguntar: así la descarga del
  // día siguiente trae solo las nuevas, y queda registro de qué se le pasó a CX.
  // Las dos últimas columnas van vacías: las completa CX y la planilla vuelve.
  async function descargarParaCx() {
    const filasCsv = visibles;
    const encabezado = [
      'Paciente', 'N° paciente', 'Psicólogo/a', 'País', 'Regla', 'Motivo', 'Días',
      'Fecha (registro o sesión)', 'Detectada',
      `Respuesta CX (${Object.values(RESPUESTAS_CX).join(' / ')})`,
      'Comentario CX',
    ];
    const lineas = filasCsv.map((f) => [
      nombrePaciente(f),
      String(f.paciente_id),
      f.psicologo,
      f.pais,
      f.regla,
      motivo(f),
      String(f.dias),
      ddmm(diaLocal(new Date(f.fecha_referencia))),
      ddmm(f.detectada_el),
      '',
      '',
    ]);
    // Punto y coma y BOM: así Excel en español lo abre en columnas y con tildes.
    const csv = String.fromCharCode(0xfeff) + [encabezado, ...lineas].map((l) => l.map(celdaCsv).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `alertas-cx-${diaLocal(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    if (vista !== 'pendientes' || filasCsv.length === 0) return;
    // Descargar es derivar: Talent no quiere un click más por caso.
    setGuardando('lote');
    setError(null);
    const cambios = { estado: 'derivada_cx' as Estado, estado_por: email, estado_at: new Date().toISOString() };
    const ids = filasCsv.map((f) => f.id);
    for (let i = 0; i < ids.length; i += 200) {
      const tanda = ids.slice(i, i + 200);
      const { error: e } = await getSupabase().from('alertas_vivo').update(cambios).in('id', tanda);
      if (e) {
        setError(`No se pudieron marcar como derivadas: ${e.message}`);
        break;
      }
      const hechas = new Set(tanda);
      setAlertas((prev) => prev.map((x) => (hechas.has(x.id) ? { ...x, ...cambios } : x)));
    }
    setGuardando(null);
  }

  if (cargando) return <div className="empty-wrap">Cargando alertas…</div>;

  const paginas = Math.ceil(visibles.length / POR_PAGINA);
  const pag = visibles.slice(pagina * POR_PAGINA, (pagina + 1) * POR_PAGINA);
  const pct = (n: number) => (resultadosCx.total ? Math.round((n / resultadosCx.total) * 100) : 0);

  return (
    <>
      <style>{ESTILOS}</style>

      <div className="ks" style={{ marginTop: 8 }}>
        <div className="k" onClick={() => { setVista('pendientes'); setRegla('A'); }}>
          <div className="kv" style={{ color: 'var(--am)' }}>{totales.A}</div>
          <div className="kl">A · Registro sin agendar</div>
        </div>
        <div className="k" onClick={() => { setVista('pendientes'); setRegla('B'); }}>
          <div className="kv" style={{ color: 'var(--ac)' }}>{totales.B}</div>
          <div className="kl">B · Sin 2ª sesión</div>
        </div>
        <div className="k" onClick={() => { setVista('pendientes'); setRegla('C'); }}>
          <div className="kv" style={{ color: 'var(--ar)' }}>{totales.C}</div>
          <div className="kl">C · Sin 5ª sesión</div>
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

      {resultadosCx.total > 0 && (
        <div className="va-res" title="Se calcula solo: el cron detecta si cada paciente derivado agendó o si venció la ventana sin agendar">
          <span>Derivados a CX{regla !== 'T' ? ` (regla ${regla})` : ''}: <b>{resultadosCx.total}</b></span>
          <span style={{ color: 'var(--v)' }}>Agendaron <b>{resultadosCx.agendaron}</b> ({pct(resultadosCx.agendaron)}%)</span>
          <span style={{ color: 'var(--r)' }}>Vencieron sin agendar <b>{resultadosCx.vencieron}</b> ({pct(resultadosCx.vencieron)}%)</span>
          <span>Siguen esperando <b>{resultadosCx.esperando}</b></span>
        </div>
      )}

      <div className="va-leg">
        <span><span className="va-r va-rA">A</span> Se registró hace más de 48 h y no agendó con su psicólogo/a.</span>
        <span><span className="va-r va-rB">B</span> Tuvo la 1ª sesión hace más de 5 días y no tiene otra agendada.</span>
        <span><span className="va-r va-rC">C</span> Tuvo la 4ª sesión hace más de 14 días y no tiene otra agendada.</span>
      </div>

      {error && <div className="va-err">{error}</div>}
      {errorNombres && <div className="va-err">No se pudieron traer los nombres de los pacientes ({errorNombres}). Se muestra el número.</div>}

      <div className="ctr">
        <div className="tog">
          <button className={`togb ${vista === 'pendientes' ? 'on' : ''}`} onClick={() => setVista('pendientes')}>Pendientes ({totales.pendientes})</button>
          <button className={`togb ${vista === 'derivadas' ? 'on' : ''}`} onClick={() => setVista('derivadas')}>Derivadas a CX ({totales.derivadas})</button>
          <button className={`togb ${vista === 'cerradas' ? 'on' : ''}`} onClick={() => setVista('cerradas')}>Cerradas ({totales.cerradas})</button>
        </div>
        <select value={regla} onChange={(e) => setRegla(e.target.value as Regla)}>
          <option value="T">Todas las reglas</option>
          <option value="A">A · Registro sin agendar</option>
          <option value="B">B · Sin 2ª sesión</option>
          <option value="C">C · Sin 5ª sesión</option>
        </select>
        <div className="sw">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="si" placeholder="Buscar paciente o psicólogo..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        {vista !== 'cerradas' && visibles.length > 0 && (
          <button className="btn va-cx" disabled={guardando === 'lote'} onClick={descargarParaCx} title="Baja una planilla con las alertas que se ven, para pasarle a CX">
            {guardando === 'lote' ? 'Marcando…' : `Descargar para CX (${visibles.length})`}
          </button>
        )}
        {vista === 'derivadas' && visibles.length > 0 && (
          <button className="btn" onClick={copiarParaCx}>{copiado ? 'Copiado ✓' : 'Copiar lista'}</button>
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
                <th className="c-va-pac" title="Tocá el nombre para ver el caso">Paciente</th>
                <th
                  className={`c-va-ps ${orden?.col === 'psicologo' ? 'ths' : ''}`}
                  title="Tocá para ordenar por nombre y ver cuántos casos tiene cada psicólogo/a"
                  onClick={() => ordenarPor('psicologo')}
                  style={{ cursor: 'pointer' }}
                >
                  Psicólogo/a {flecha('psicologo')}
                </th>
                <th className="c-p">País</th>
                <th
                  className={`c-va-d ${orden?.col === 'dias' ? 'ths' : ''}`}
                  title="Días desde el registro (A), la 1ª sesión (B) o la 4ª sesión (C). Tocá para ordenar."
                  onClick={() => ordenarPor('dias')}
                >
                  Hace {flecha('dias')}
                </th>
                <th className="c-va-det" title="Primer día en que apareció la alerta">Detectada</th>
                <th className="c-va-est">Estado</th>
              </tr>
            </thead>
            <tbody>
              {pag.map((f) => {
                const rcx = ultimaRespuesta(f);
                return (
                  <tr
                    key={f.id}
                    onClick={() => f.matrix && onRowClick(f.matrix)}
                    style={{ cursor: f.matrix ? 'pointer' : 'default' }}
                  >
                    <td className="c-va-r"><span className={`va-r va-r${f.regla}`} title={TEXTO_REGLA[f.regla]}>{f.regla}</span></td>
                    <td
                      className="c-va-pac va-pac"
                      onClick={(e) => {
                        e.stopPropagation();
                        setCaso(f);
                      }}
                    >
                      <div className="tn">{nombrePaciente(f)}</div>
                      <div className="va-sub tm">#{f.paciente_id}</div>
                    </td>
                    <td className="c-va-ps tn" style={{ color: f.matrix ? undefined : 'var(--t2)' }}>{f.psicologo}</td>
                    <td className="c-p">{f.pais === '—' ? '—' : <span className={`b ${f.pais === 'AR' ? 'bar' : 'buy'}`}>{f.pais}</span>}</td>
                    <td className="c-va-d" title={motivo(f)}>
                      <span className="tm" style={{ color: f.dias >= 14 ? 'var(--r)' : f.dias >= 7 ? 'var(--am)' : undefined }}>{f.dias} días</span>
                      <div className="va-sub">{DESDE_REGLA[f.regla]}</div>
                    </td>
                    <td className="c-va-det tm">{ddmm(f.detectada_el)}</td>
                    <td className="c-va-est">
                      <EstadoBadge f={f} />
                      {rcx && (
                        <div className="va-sub" style={rcx.respuesta === RESPUESTA_ALERTA ? { color: 'var(--r)', fontWeight: 600 } : undefined}>
                          CX: {RESPUESTAS_CX[rcx.respuesta] ?? rcx.respuesta}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
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

      {caso && (
        <Caso
          f={filas.find((x) => x.id === caso.id) ?? caso}
          nombre={nombrePaciente(caso)}
          motivo={motivo(caso)}
          respuestas={respuestas.get(caso.paciente_id) ?? []}
          guardando={guardando === caso.id}
          onCerrar={() => setCaso(null)}
          onDescartar={async (texto) => {
            if (await cambiar(caso, 'descartada', texto)) setCaso(null);
          }}
          onReabrir={async () => {
            // Vuelve a donde estaba antes de descartarla: si ya se la habían
            // pasado a CX no hay forma de saberlo, así que va a Pendientes.
            if (await cambiar(caso, 'abierta', '')) setCaso(null);
          }}
          onVolverAPendiente={async () => {
            // Para deshacer una derivación por error (por ejemplo, una
            // descarga de prueba) sin tener que tocar la base a mano.
            if (await cambiar(caso, 'abierta')) setCaso(null);
          }}
        />
      )}
    </>
  );
}

/** Ficha del caso: datos, respuestas de CX y la opción de descartar. */
function Caso({
  f,
  nombre,
  motivo,
  respuestas,
  guardando,
  onCerrar,
  onDescartar,
  onReabrir,
  onVolverAPendiente,
}: {
  f: Fila;
  nombre: string;
  motivo: string;
  respuestas: RespuestaCx[];
  guardando: boolean;
  onCerrar: () => void;
  onDescartar: (motivo: string) => void;
  onReabrir: () => void;
  onVolverAPendiente: () => void;
}) {
  const [texto, setTexto] = useState('');
  const [descartando, setDescartando] = useState(false);
  return (
    <div className="ov open" onClick={onCerrar}>
      <div className="mo" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div>
            <div className="mn2">{nombre}</div>
            <div className="mm">Paciente #{f.paciente_id} · {f.psicologo} ({f.pais})</div>
          </div>
          <button className="mcl" onClick={onCerrar}>✕</button>
        </div>
        <div className="mb">
          <div className="ms">
            <div className="mst">Alerta</div>
            <div style={{ fontSize: 12 }}>
              <span className={`va-r va-r${f.regla}`} style={{ marginRight: 6 }}>{f.regla}</span>
              {motivo.charAt(0).toUpperCase() + motivo.slice(1)}.
            </div>
            <div className="va-sub" style={{ marginTop: 4 }}>Detectada el {ddmm(f.detectada_el)}</div>
            <div style={{ marginTop: 6 }}><EstadoBadge f={f} /></div>
          </div>

          <div className="ms">
            <div className="mst">Respuestas de CX</div>
            {respuestas.length === 0 ? (
              <div className="va-sub">Todavía no hay respuesta de CX para este paciente.</div>
            ) : (
              respuestas.map((r) => (
                <div key={r.fecha_reporte} style={{ fontSize: 12, marginBottom: 4 }}>
                  <span className="tm">{ddmm(r.fecha_reporte)}</span> ·{' '}
                  <span style={r.respuesta === RESPUESTA_ALERTA ? { color: 'var(--r)', fontWeight: 600 } : undefined}>
                    {RESPUESTAS_CX[r.respuesta] ?? r.respuesta}
                    {r.respuesta === RESPUESTA_ALERTA && ' · posible desvinculación'}
                  </span>
                  {r.comentario && <div className="va-sub">{r.comentario}</div>}
                </div>
              ))
            )}
          </div>

          <div className="ms">
            {f.estado === 'descartada' ? (
              <>
                <div className="mst">Descartada</div>
                <div style={{ fontSize: 12, marginBottom: 8 }}>{f.nota || 'Sin motivo cargado.'}</div>
                <button className="btn" disabled={guardando} onClick={onReabrir}>Reabrir</button>
              </>
            ) : !descartando ? (
              <div style={{ display: 'flex', gap: 6 }}>
                {f.estado === 'derivada_cx' && f.vigente && (
                  <button className="btn" disabled={guardando} onClick={onVolverAPendiente} title="Deshace la derivación a CX">
                    Volver a pendiente
                  </button>
                )}
                <button className="btn" onClick={() => setDescartando(true)} title="Solo para excepciones: el caso deja de contar en los resultados">
                  Descartar caso…
                </button>
              </div>
            ) : (
              <>
                <div className="mst">Descartar caso</div>
                <div className="va-sub" style={{ marginBottom: 6 }}>
                  Solo para excepciones (por ejemplo, un paciente con problemas graves). No cuenta en los resultados.
                  Esto no lo bloquea en la plataforma: eso se sigue haciendo en el back.
                </div>
                <textarea className="va-ta" placeholder="Motivo (obligatorio)" value={texto} onChange={(e) => setTexto(e.target.value)} />
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="btn" disabled={guardando || !texto.trim()} onClick={() => onDescartar(texto.trim())}>Confirmar descarte</button>
                  <button className="btn" onClick={() => setDescartando(false)}>Cancelar</button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function EstadoBadge({ f }: { f: Fila }) {
  const quien = f.estado_por ? f.estado_por.split('@')[0] : null;
  const cuando = f.estado_at ? ddmm(diaLocal(new Date(f.estado_at))) : null;
  const pie = quien && cuando ? `${quien} · ${cuando}` : null;
  const viaCx = f.estado === 'derivada_cx';
  let txt: string;
  let cls: string;
  if (f.estado === 'descartada') {
    txt = 'Descartada';
    cls = 'ts ts-s';
  } else if (f.vencida) {
    txt = viaCx ? 'Venció sin agendar (tras CX)' : 'Venció sin agendar';
    cls = 'ts ts-d';
  } else if (!f.vigente) {
    txt = viaCx ? 'Agendó tras CX' : 'Agendó solo';
    cls = 'ts ts-u';
  } else if (viaCx) {
    txt = 'Derivada a CX';
    cls = 'ts ts-a';
  } else if (f.estado === 'resuelta') {
    txt = 'Resuelta';
    cls = 'ts ts-u';
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

/** Celda de CSV: entre comillas si trae separador, comillas o salto de línea. */
function celdaCsv(v: string): string {
  return /[;"\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
