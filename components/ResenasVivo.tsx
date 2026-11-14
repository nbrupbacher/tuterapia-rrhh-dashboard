'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter, TherapistView } from '@/lib/types';

/**
 * Solapa En vivo → Reseñas (mockup de Talent).
 *
 * Las reseñas se leen en el momento de la plataforma (app/api/en-vivo/resenas),
 * con el nombre del paciente.
 * Lo que hace el equipo con cada una queda en `resenas_revision`.
 *
 * - Para mirar: 3 estrellas o menos. Una reseña baja no es un juicio sobre el
 *   psicólogo/a: es una invitación a mirar el caso con su contexto.
 * - Para reconocer: 5 estrellas con comentario, ya publicadas. Se pueden sumar
 *   al ticker de novedades por 30 días.
 * - Cambios en el promedio: publicadas de los últimos 90 días contra los 90
 *   días que terminaban hace un mes, con 5 reseñas o más, si se movió 0,5 o más.
 */

type Contexto = { sesiones: number; ultima: string | null; proxima: string | null };
type Resena = {
  id: number;
  paciente_id: number;
  paciente: string;
  therapist_id: string;
  pais: string;
  estrellas: number;
  comentario: string;
  status: number;
  fecha: string;
  contexto: Contexto | null;
};
type Promedio = { therapist_id: string; pais: string; ahora: number | null; n_ahora: number; antes: number | null; n_antes: number };
type Datos = {
  kpi: { nuevas_7d: number; con_comentario_7d: number; prom_90d: number | null; prom_90d_antes: number | null; n_90d: number };
  resenas: Resena[];
  promedios: Promedio[];
};
type Revision = {
  resena_id: number;
  therapist_id: string;
  tipo: 'mirar' | 'reconocer';
  revisada_at: string | null;
  revisada_por: string | null;
  nota: string | null;
  en_ticker: boolean;
  ticker_hasta: string | null;
};

const MIN_RESENAS = 5;
const MOVIMIENTO = 0.5;
const DIAS_RECONOCER = 30;
const DIAS_TICKER = 30;

const ESTADO: Record<number, { txt: string; color: string }> = {
  0: { txt: 'No publicada (en revisión o denegada)', color: 'var(--am)' },
  1: { txt: 'Publicada en su perfil', color: 'var(--v)' },
  9: { txt: 'Oculta', color: 'var(--t3)' },
};

const ESTILOS = `
.rs-err { background:rgba(240,82,82,.08); border:1px solid rgba(240,82,82,.3); color:var(--r); border-radius:6px; padding:6px 10px; font-size:11px; margin-bottom:8px; }
.rs-hd { display:flex; align-items:center; justify-content:space-between; gap:8px; margin:16px 0 4px; flex-wrap:wrap; scroll-margin-top:80px; }
.rs-hd h3 { margin:0; font-size:14px; }
.rs-sub { font-size:11px; color:var(--t3); margin-bottom:8px; line-height:1.4; }
.rs-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(320px, 1fr)); gap:8px; }
.rs-card { background:var(--bg2); border:1px solid var(--bd); border-radius:8px; padding:10px 12px; font-size:12px; }
.rs-card.hecha { opacity:.55; }
.rs-top { display:flex; justify-content:space-between; gap:8px; align-items:baseline; }
.rs-est { color:#f5a623; letter-spacing:1px; font-size:13px; }
.rs-ps { font-weight:600; cursor:pointer; }
.rs-ps:hover { color:var(--ac); text-decoration:underline; }
.rs-txt { margin:6px 0; line-height:1.45; white-space:pre-wrap; }
.rs-meta { font-size:11px; color:var(--t2); line-height:1.45; }
.rs-acc { display:flex; gap:4px; flex-wrap:wrap; margin-top:8px; }
.rs-acc .btn { padding:3px 8px; font-size:11px; }
.rs-pill { display:inline-block; border-radius:20px; padding:3px 9px; font-size:11px; border:1px solid var(--bd2); cursor:pointer; margin-right:6px; color:var(--t2); background:transparent; font-family:var(--f); }
.rs-pill.on { color:var(--t); border-color:var(--ac); background:rgba(79,142,247,.08); }
`;

function estrellas(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));
}

function diaLocal(d: Date): string {
  return new Date(d.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);
}

function ddmm(ts: string | null): string {
  if (!ts) return '—';
  const d = diaLocal(new Date(ts.includes('T') ? ts : `${ts.replace(' ', 'T')}Z`));
  return `${d.slice(8, 10)}/${d.slice(5, 7)}`;
}

function dias(desde: string, hasta: string): number {
  const a = Date.parse(desde.includes('T') ? desde : `${desde.replace(' ', 'T')}Z`);
  const b = Date.parse(hasta.includes('T') ? hasta : `${hasta.replace(' ', 'T')}Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

function coma(n: number | null): string {
  return n == null ? '—' : n.toFixed(1).replace('.', ',');
}

function contextoTexto(r: Resena): string {
  const c = r.contexto;
  if (!c) return '';
  const partes: string[] = [];
  if (c.sesiones > 0 && c.ultima) {
    const d = dias(c.ultima, r.fecha);
    partes.push(`reseña ${d === 0 ? 'el mismo día de' : `${d} ${d === 1 ? 'día' : 'días'} después de`} su ${c.sesiones}ª sesión`);
  } else {
    partes.push('sin sesiones realizadas antes de la reseña');
  }
  partes.push(c.proxima ? `próxima sesión agendada el ${ddmm(c.proxima)}` : 'sin próxima sesión agendada');
  return partes.join(' · ');
}

export function ResenasVivo({
  pais,
  therapists,
  onRowClick,
}: {
  pais: PaisFilter;
  therapists: TherapistView[];
  onRowClick: (t: TherapistView) => void;
}) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [revisiones, setRevisiones] = useState<Map<number, Revision>>(new Map());
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState<number | null>(null);
  const [verRevisadas, setVerRevisadas] = useState(false);
  // Filtro por psicólogo/a (o paciente): se aplica a las tres secciones.
  const [busqueda, setBusqueda] = useState('');
  // Psicólogos/as que no están en la Matrix del mes (por ejemplo, dados de
  // baja): el nombre sale de `therapists`, como en Fantasmeos y salidas.
  const [ters, setTers] = useState<Map<string, { nombre: string; activo: boolean }>>(new Map());

  const matrixPor = useMemo(() => new Map(therapists.map((t) => [t.id, t])), [therapists]);
  const nombreDe = useCallback(
    (id: string) => matrixPor.get(id)?.nombre ?? ters.get(id)?.nombre ?? `Terapeuta #${id}`,
    [matrixPor, ters],
  );
  // Los que ya no están en la plataforma se marcan en rojo (pedido de Talent).
  const estiloPs = useCallback(
    (id: string) =>
      ters.get(id)?.activo === false ? { color: 'var(--r)', title: 'Ya no está en la plataforma' } : { color: undefined, title: undefined },
    [ters],
  );

  useEffect(() => {
    if (!datos) return;
    const faltan = [...new Set([...datos.resenas.map((r) => r.therapist_id), ...datos.promedios.map((p) => p.therapist_id)])].filter(
      (id) => !matrixPor.has(id),
    );
    if (faltan.length === 0) return;
    (async () => {
      const m = new Map<string, { nombre: string; activo: boolean }>();
      for (let i = 0; i < faltan.length; i += 200) {
        const { data } = await getSupabase().from('therapists').select('id,nombre,activo').in('id', faltan.slice(i, i + 200));
        for (const t of (data ?? []) as { id: string; nombre: string; activo: boolean }[]) m.set(String(t.id), { nombre: t.nombre, activo: t.activo });
      }
      setTers(m);
    })();
  }, [datos, matrixPor]);

  const cargarRevisiones = useCallback(async () => {
    const { data, error: e } = await getSupabase().from('resenas_revision').select('*');
    if (e) throw e;
    setRevisiones(new Map(((data ?? []) as Revision[]).map((r) => [Number(r.resena_id), r])));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const sb = getSupabase();
        const { data: s } = await sb.auth.getSession();
        const token = s?.session?.access_token;
        setEmail(s?.session?.user?.email ?? null);
        const res = await fetch('/api/en-vivo/resenas', { headers: { Authorization: `Bearer ${token ?? ''}` } });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        setDatos(json as Datos);
        await cargarRevisiones();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setCargando(false);
      }
    })();
  }, [cargarRevisiones]);

  const enPais = useCallback((p: string) => pais === 'T' || p === pais, [pais]);
  const promedioDe = useMemo(() => new Map((datos?.promedios ?? []).map((p) => [p.therapist_id, p])), [datos]);

  const hoy = diaLocal(new Date());
  const q = busqueda.trim().toLowerCase();
  const coincide = useCallback(
    (id: string, paciente = '') => !q || nombreDe(id).toLowerCase().includes(q) || paciente.toLowerCase().includes(q),
    [q, nombreDe],
  );
  const resenas = useMemo(
    () => (datos?.resenas ?? []).filter((r) => enPais(r.pais) && coincide(r.therapist_id, r.paciente ?? '')),
    [datos, enPais, coincide],
  );
  const mirarTodas = resenas.filter((r) => r.estrellas <= 3);
  const mirarPend = mirarTodas.filter((r) => !revisiones.get(r.id)?.revisada_at);
  const mirar = verRevisadas ? mirarTodas : mirarPend;
  const reconocer = resenas.filter((r) => r.estrellas === 5 && dias(r.fecha, new Date().toISOString()) <= DIAS_RECONOCER);
  const cambios = useMemo(
    () =>
      (datos?.promedios ?? [])
        .filter((p) => enPais(p.pais) && coincide(p.therapist_id) && p.ahora != null && p.antes != null && p.n_ahora >= MIN_RESENAS && p.n_antes >= MIN_RESENAS)
        .map((p) => ({ ...p, mov: (p.ahora as number) - (p.antes as number) }))
        .filter((p) => Math.abs(p.mov) >= MOVIMIENTO)
        .sort((a, b) => a.mov - b.mov),
    [datos, enPais, coincide],
  );

  async function guardar(r: Resena, tipo: 'mirar' | 'reconocer', campos: Partial<Revision> & { ticker_texto?: string | null }) {
    setGuardando(r.id);
    setError(null);
    const { error: e } = await getSupabase()
      .from('resenas_revision')
      .upsert({ resena_id: r.id, therapist_id: r.therapist_id, tipo, ...campos }, { onConflict: 'resena_id' });
    if (e) setError(e.message);
    else await cargarRevisiones().catch((x) => setError(String(x)));
    setGuardando(null);
  }

  const marcarRevisada = (r: Resena) => {
    const rev = revisiones.get(r.id);
    if (rev?.revisada_at) {
      guardar(r, 'mirar', { revisada_at: null, revisada_por: null });
      return;
    }
    const nota = window.prompt('Nota (opcional): qué se miró o qué se hizo', rev?.nota ?? '');
    if (nota === null) return;
    guardar(r, 'mirar', { revisada_at: new Date().toISOString(), revisada_por: email, nota: nota.trim() || null });
  };

  const alternarTicker = (r: Resena) => {
    const rev = revisiones.get(r.id);
    if (rev?.en_ticker) {
      guardar(r, 'reconocer', { en_ticker: false });
      return;
    }
    // Una frase corta: el ticker es una línea que pasa.
    const corto = r.comentario.length > 90 ? `${r.comentario.slice(0, 87).trimEnd()}…` : r.comentario;
    const hasta = new Date(Date.now() + DIAS_TICKER * 86_400_000).toISOString().slice(0, 10);
    guardar(r, 'reconocer', {
      en_ticker: true,
      ticker_texto: `⭐ ${nombreDe(r.therapist_id)} recibió 5 estrellas: “${corto}”`,
      ticker_hasta: hasta,
    });
  };

  if (cargando) return <div className="loading-wrap">Cargando reseñas…</div>;

  const k = datos?.kpi;
  const pctComentario = k && k.nuevas_7d > 0 ? Math.round((k.con_comentario_7d / k.nuevas_7d) * 100) : null;
  const movPlat = k?.prom_90d != null && k?.prom_90d_antes != null ? k.prom_90d - k.prom_90d_antes : null;
  const irA = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const tarjeta = (r: Resena, tipo: 'mirar' | 'reconocer') => {
    const mx = matrixPor.get(r.therapist_id);
    const rev = revisiones.get(r.id);
    const prom = promedioDe.get(r.therapist_id);
    return (
      <div key={r.id} className={`rs-card ${tipo === 'mirar' && rev?.revisada_at ? 'hecha' : ''}`}>
        <div className="rs-top">
          <span className="rs-est">{estrellas(r.estrellas)}</span>
          <span className="rs-meta">{ddmm(r.fecha)}</span>
        </div>
        <div style={{ marginTop: 4 }}>
          <span className="rs-ps" style={{ color: estiloPs(r.therapist_id).color }} title={estiloPs(r.therapist_id).title} onClick={() => mx && onRowClick(mx)}>
            {nombreDe(r.therapist_id)}
          </span>{' '}
          <span className={`b ${r.pais === 'AR' ? 'bar' : 'buy'}`}>{r.pais}</span>
        </div>
        {r.comentario ? <div className="rs-txt">“{r.comentario}”</div> : <div className="rs-txt rs-meta">Sin comentario</div>}
        <div className="rs-meta">
          {r.paciente ? `${r.paciente} · #${r.paciente_id}` : `Paciente #${r.paciente_id}`}
          {tipo === 'mirar' && contextoTexto(r) && ` · ${contextoTexto(r)}`}
        </div>
        <div className="rs-meta">
          Su promedio (90 días): {prom?.ahora != null ? `${coma(prom.ahora)} ★ · ${prom.n_ahora} reseñas` : 'sin reseñas publicadas'}
          {' · '}
          <span style={{ color: ESTADO[r.status]?.color }}>{ESTADO[r.status]?.txt ?? `Estado ${r.status}`}</span>
        </div>
        {rev?.revisada_at && (
          <div className="rs-meta" style={{ marginTop: 4 }}>
            ✓ Revisada el {ddmm(rev.revisada_at)}{rev.revisada_por ? ` por ${rev.revisada_por.split('@')[0]}` : ''}
            {rev.nota ? ` · ${rev.nota}` : ''}
          </div>
        )}
        <div className="rs-acc">
          {mx && <button className="btn" onClick={() => onRowClick(mx)}>Abrir ficha</button>}
          {tipo === 'mirar' ? (
            <button className="btn" disabled={guardando === r.id} onClick={() => marcarRevisada(r)}>
              {rev?.revisada_at ? 'Volver a pendiente' : 'Marcar revisada · nota'}
            </button>
          ) : (
            <button className="btn" disabled={guardando === r.id} onClick={() => alternarTicker(r)}>
              {rev?.en_ticker && (rev.ticker_hasta ?? '') >= hoy ? `En el ticker hasta ${ddmm(rev.ticker_hasta)} · Quitar` : 'Sumar al ticker'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{ESTILOS}</style>
      {error && <div className="rs-err">{error}</div>}

      <div className="ks" style={{ marginTop: 8 }}>
        <div className="k" style={{ cursor: 'default' }}>
          <div className="kv">{k?.nuevas_7d ?? '—'}</div>
          <div className="kl">Reseñas nuevas (7 días){pctComentario != null ? ` · ${pctComentario}% con comentario` : ''}</div>
        </div>
        <div className="k" style={{ cursor: 'default' }}>
          <div className="kv" style={{ color: '#f5a623' }}>{coma(k?.prom_90d ?? null)} ★</div>
          <div className="kl">
            Promedio plataforma (90 días)
            {movPlat != null && ` · ${Math.abs(movPlat) < 0.05 ? '= vs 90 días anteriores' : `${movPlat > 0 ? '↑' : '↓'} ${coma(Math.abs(movPlat))}`}`}
          </div>
        </div>
        <div className="k" onClick={() => irA('rs-mirar')}>
          <div className="kv" style={{ color: 'var(--am)' }}>{mirarPend.length}</div>
          <div className="kl">Para mirar · 3 estrellas o menos</div>
        </div>
        <div className="k" onClick={() => irA('rs-reconocer')}>
          <div className="kv" style={{ color: 'var(--v)' }}>{reconocer.length}</div>
          <div className="kl">Para reconocer · 5 estrellas con comentario</div>
        </div>
      </div>

      <div className="ctr" style={{ marginTop: 10 }}>
        <div className="sw">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input className="si" placeholder="Filtrar por psicólogo/a o paciente..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} />
        </div>
        {q && (
          <button className="btn" onClick={() => setBusqueda('')}>
            Ver todos
          </button>
        )}
      </div>

      <div className="rs-hd" id="rs-mirar">
        <h3>Para mirar</h3>
        <div>
          <button className={`rs-pill ${!verRevisadas ? 'on' : ''}`} onClick={() => setVerRevisadas(false)}>Pendientes ({mirarPend.length})</button>
          <button className={`rs-pill ${verRevisadas ? 'on' : ''}`} onClick={() => setVerRevisadas(true)}>Todas las de 90 días ({mirarTodas.length})</button>
        </div>
      </div>
      <div className="rs-sub">
        Las de 3 estrellas o menos pasan a revisión en el back, donde se aprueban o deniegan; las no publicadas el psicólogo/a no
        las ve. Una reseña baja no es un juicio sobre el psicólogo/a: es una invitación a mirar el caso con su contexto. La fecha
        es la de la última modificación en la plataforma (no guarda cuándo se escribió).
      </div>
      {mirar.length === 0 ? (
        <div className="rs-sub">No hay reseñas para mirar con estos filtros.</div>
      ) : (
        <div className="rs-grid">{mirar.map((r) => tarjeta(r, 'mirar'))}</div>
      )}

      <div className="rs-hd" id="rs-reconocer">
        <h3>Para reconocer</h3>
      </div>
      <div className="rs-sub">
        Reseñas de 5 estrellas con comentario de los últimos {DIAS_RECONOCER} días. Ya están publicadas en el perfil y el
        psicólogo/a las ve: acá sirven para reconocer. &ldquo;Sumar al ticker&rdquo; la muestra en la barra de novedades durante{' '}
        {DIAS_TICKER} días.
      </div>
      {reconocer.length === 0 ? (
        <div className="rs-sub">No hay reseñas para reconocer con estos filtros.</div>
      ) : (
        <div className="rs-grid">{reconocer.map((r) => tarjeta(r, 'reconocer'))}</div>
      )}

      <div className="rs-hd">
        <h3>Cambios en el promedio</h3>
      </div>
      <div className="rs-sub">
        Promedio de reseñas publicadas de los últimos 90 días contra los 90 días que terminaban hace un mes. Solo con{' '}
        {MIN_RESENAS} reseñas o más en cada período, y si se movió {coma(MOVIMIENTO)} o más.
      </div>
      <div className="tw">
        <table>
          <thead>
            <tr>
              <th className="c-n">Psicólogo/a</th>
              <th className="c-p">País</th>
              <th>Antes</th>
              <th>Ahora</th>
              <th>Reseñas (ahora)</th>
              <th>Movimiento</th>
            </tr>
          </thead>
          <tbody>
            {cambios.length === 0 && (
              <tr>
                <td colSpan={6} className="rs-sub" style={{ padding: 12 }}>Nadie se movió {coma(MOVIMIENTO)} o más con estos filtros.</td>
              </tr>
            )}
            {cambios.map((c) => {
              const mx = matrixPor.get(c.therapist_id);
              return (
                <tr key={c.therapist_id}>
                  <td className="c-n">
                    <span className="rs-ps" style={{ color: estiloPs(c.therapist_id).color }} title={estiloPs(c.therapist_id).title} onClick={() => mx && onRowClick(mx)}>
                      {nombreDe(c.therapist_id)}
                    </span>
                  </td>
                  <td className="c-p"><span className={`b ${c.pais === 'AR' ? 'bar' : 'buy'}`}>{c.pais}</span></td>
                  <td className="tm">{coma(c.antes)} ★</td>
                  <td className="tm">{coma(c.ahora)} ★</td>
                  <td className="tm">{c.n_ahora}</td>
                  <td className="tm" style={{ color: c.mov < 0 ? 'var(--r)' : 'var(--v)' }}>{c.mov > 0 ? '↑' : '↓'} {coma(Math.abs(c.mov))}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="rs-sub" style={{ marginTop: 6 }}>
        Las reseñas bajas se muestran aunque el psicólogo/a esté en ventana de respeto. En rojo, los psicólogos/as que ya no están
        en la plataforma. El nombre del paciente se lee en el momento de la plataforma y no se guarda en el dashboard.
      </div>
    </>
  );
}
