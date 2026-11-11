'use client';

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { getSupabase } from '@/lib/supabase';

/**
 * Perfil del psicólogo/a → "Hoy en la plataforma". El resto del perfil puede
 * ser la foto de un mes cerrado; esto es siempre el presente:
 *
 * - Cancelaciones con motivo de los últimos 30 días (app/api/en-vivo/perfil).
 * - Alertas de rescate vigentes por regla, y las derivadas a CX en 60 días.
 * - Lo que respondió CX sobre sus pacientes (respuestas_cx), con
 *   "Atiende por fuera" destacado.
 * - Reseñas: promedio de 90 días contra el anterior, y bajas sin revisar.
 */

type Datos = {
  cancelaciones: { dias: number; total: number; motivos: { motivo: string; n: number }[]; pacientes: number; repetidos: number };
  resenas: { ahora: number | null; n_ahora: number; antes: number | null; n_antes: number; bajas_ids: number[] };
};
type Regla = 'A' | 'B' | 'C';
type Alerta = { id: string; regla: Regla; estado: string; vista_ultima: string; detectada_el: string };

const TEXTO_REGLA: Record<Regla, string> = { A: 'Sin 1ª sesión', B: 'Sin 2da sesión', C: 'Cortaron tras la 4ª' };
const RESPUESTAS: Record<string, string> = {
  no_responde: 'No responde',
  pide_derivacion: 'Pide derivación',
  va_a_agendar: 'Va a agendar',
  motivos_economicos: 'Motivos económicos',
  terapeuta_externo: 'Terapeuta externo',
  atiende_por_fuera: 'Atiende por fuera',
};
const DIAS_CX = 60;

const coma = (n: number) => n.toFixed(2).replace('.', ',');

// Mismo lenguaje que el resto del perfil (tarjetas oscuras), pero con un
// marco verde "en vivo" y una tarjeta por tema, cada una con su color.
const ESTILOS = `
.ph { border:1px solid rgba(52,211,153,.35); background:linear-gradient(180deg, rgba(52,211,153,.07), rgba(52,211,153,0) 70%); border-radius:10px; padding:10px 10px 11px; }
.ph-hd { display:flex; align-items:center; gap:8px; margin-bottom:9px; flex-wrap:wrap; }
.ph-dot { width:8px; height:8px; border-radius:50%; background:var(--v); box-shadow:0 0 0 0 rgba(52,211,153,.6); animation:ph-pulso 2s infinite; }
@keyframes ph-pulso { 0% { box-shadow:0 0 0 0 rgba(52,211,153,.55); } 70% { box-shadow:0 0 0 7px rgba(52,211,153,0); } 100% { box-shadow:0 0 0 0 rgba(52,211,153,0); } }
.ph-tit { font-size:12px; font-weight:700; letter-spacing:.08em; color:var(--v); }
.ph-aclara { font-size:10px; color:var(--t3); margin-left:auto; }
.ph-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(210px, 1fr)); gap:8px; }
.ph-card { background:var(--bg3); border-radius:8px; padding:9px 11px; border-left:3px solid var(--c); }
.ph-top { display:flex; align-items:baseline; gap:7px; }
.ph-num { font-family:var(--m); font-size:22px; font-weight:600; color:var(--c); line-height:1.1; }
.ph-lbl { font-size:11px; color:var(--t2); }
.ph-sub { font-size:11px; color:var(--t2); margin-top:3px; }
.ph-chips { display:flex; flex-wrap:wrap; gap:4px; margin-top:7px; }
.ph-chip { font-size:10.5px; padding:2px 7px; border-radius:10px; background:var(--bg2); border:1px solid var(--bd2); color:var(--t2); white-space:nowrap; }
.ph-chip b { color:var(--t); font-weight:600; }
.ph-chip.am { background:rgba(245,166,35,.12); border-color:rgba(245,166,35,.4); color:var(--am); }
.ph-chip.r { background:rgba(240,82,82,.12); border-color:rgba(240,82,82,.45); color:var(--r); }
.ph-chip.v { background:rgba(52,211,153,.1); border-color:rgba(52,211,153,.35); color:var(--v); }
.ph-bars { display:flex; flex-direction:column; gap:4px; margin-top:7px; }
.ph-bar { display:grid; grid-template-columns:1fr auto; gap:6px; align-items:center; font-size:10.5px; color:var(--t2); }
.ph-bar span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.ph-track { grid-column:1 / -1; height:4px; background:var(--bg2); border-radius:2px; overflow:hidden; }
.ph-fill { height:100%; background:var(--c); opacity:.75; border-radius:2px; }
.ph-vacio { font-size:11px; color:var(--t3); margin-top:5px; }
.ph.ph-mes { border-color:rgba(79,142,247,.35); background:linear-gradient(180deg, rgba(79,142,247,.07), rgba(79,142,247,0) 70%); }
.ph-mes .ph-tit { color:var(--ac); }
.ph-mes .ph-dot { background:var(--ac); border-radius:2px; animation:none; box-shadow:none; }
`;

const COLOR = { cancel: 'var(--am)', alertas: 'var(--ac)', cx: 'var(--ar)', resenas: '#facc15' };
// Tarjeta sin nada para mostrar: gris, para que resalte lo que sí tiene datos.
const GRIS = 'var(--t3)';

export function PerfilHoy({ therapistId }: { therapistId: string }) {
  const [datos, setDatos] = useState<Datos | null>(null);
  const [alertas, setAlertas] = useState<{ vigentes: Record<Regla, number>; derivadas: number }>({ vigentes: { A: 0, B: 0, C: 0 }, derivadas: 0 });
  const [cx, setCx] = useState<Record<string, number>>({});
  const [bajasSinRevisar, setBajasSinRevisar] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);

  useEffect(() => {
    let vivo = true;
    setCargando(true);
    setError(null);
    (async () => {
      try {
        const sb = getSupabase();
        const { data: s } = await sb.auth.getSession();
        const res = await fetch(`/api/en-vivo/perfil?id=${encodeURIComponent(therapistId)}`, {
          headers: { Authorization: `Bearer ${s?.session?.access_token ?? ''}` },
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
        if (!vivo) return;
        const d = json as Datos;
        setDatos(d);

        // Alertas: vigentes = vistas en la última corrida del sync.
        const { data: ult } = await sb.from('alertas_vivo').select('vista_ultima').order('vista_ultima', { ascending: false }).limit(1);
        const ultima = (ult?.[0] as { vista_ultima?: string } | undefined)?.vista_ultima ?? null;
        const desde = new Date(Date.now() - DIAS_CX * 86_400_000).toISOString().slice(0, 10);
        const { data: als } = await sb
          .from('alertas_vivo')
          .select('id, regla, estado, vista_ultima, detectada_el')
          .eq('therapist_id', therapistId)
          .gte('vista_ultima', desde);
        const lista = (als ?? []) as Alerta[];
        const vigentes: Record<Regla, number> = { A: 0, B: 0, C: 0 };
        for (const a of lista) if (ultima && a.vista_ultima >= ultima) vigentes[a.regla]++;
        const derivadas = lista.filter((a) => a.estado === 'derivada_cx');
        if (vivo) setAlertas({ vigentes, derivadas: derivadas.length });

        // Respuestas de CX de las alertas suyas derivadas.
        const conteo: Record<string, number> = {};
        const ids = derivadas.map((a) => a.id);
        for (let i = 0; i < ids.length; i += 200) {
          const { data: rs } = await sb.from('respuestas_cx').select('respuesta, alerta_id').in('alerta_id', ids.slice(i, i + 200));
          for (const r of (rs ?? []) as { respuesta: string }[]) conteo[r.respuesta] = (conteo[r.respuesta] ?? 0) + 1;
        }
        if (vivo) setCx(conteo);

        // Reseñas bajas sin revisar.
        if (d.resenas.bajas_ids.length) {
          const { data: rev } = await sb.from('resenas_revision').select('resena_id, revisada_at').in('resena_id', d.resenas.bajas_ids);
          const revisadas = new Set(((rev ?? []) as { resena_id: number; revisada_at: string | null }[]).filter((x) => x.revisada_at).map((x) => Number(x.resena_id)));
          if (vivo) setBajasSinRevisar(d.resenas.bajas_ids.filter((x) => !revisadas.has(x)).length);
        } else if (vivo) setBajasSinRevisar(0);
      } catch (e) {
        if (vivo) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (vivo) setCargando(false);
      }
    })();
    return () => {
      vivo = false;
    };
  }, [therapistId]);

  const c = datos?.cancelaciones;
  const r = datos?.resenas;
  const totalCx = Object.values(cx).reduce((s, n) => s + n, 0);
  const porFuera = cx.atiende_por_fuera ?? 0;
  const vigTotal = alertas.vigentes.A + alertas.vigentes.B + alertas.vigentes.C;
  const mov = r?.ahora != null && r?.antes != null ? r.ahora - r.antes : null;
  const maxMotivo = c?.motivos[0]?.n ?? 1;
  const card = (color: string) => ({ ['--c' as string]: color }) as CSSProperties;

  return (
    <div className="ms">
      <style>{ESTILOS}</style>
      <div className="ph">
        <div className="ph-hd">
          <span className="ph-dot" />
          <span className="ph-tit">HOY EN LA PLATAFORMA</span>
          <span className="ph-aclara">Datos de hoy, no del mes de la matriz</span>
        </div>

        {cargando ? (
          <div className="ph-vacio">Cargando…</div>
        ) : error ? (
          <div className="ph-vacio" style={{ color: 'var(--r)' }}>No se pudo cargar: {error}</div>
        ) : (
          <div className="ph-grid">
            {/* Cancelaciones */}
            <div className="ph-card" style={card(c?.total ? COLOR.cancel : GRIS)}>
              <div className="ph-top">
                <span className="ph-num">{c?.total ?? 0}</span>
                <span className="ph-lbl">cancelaciones con motivo · 30 días</span>
              </div>
              {c && c.total > 0 ? (
                <>
                  <div className="ph-sub">
                    De {c.pacientes} paciente{c.pacientes === 1 ? '' : 's'}
                  </div>
                  {c.repetidos > 0 && (
                    <div className="ph-chips">
                      <span className="ph-chip am">
                        ⚠ {c.repetidos} paciente{c.repetidos === 1 ? '' : 's'} con 2 o más cancelaciones
                      </span>
                    </div>
                  )}
                  <div className="ph-bars">
                    {c.motivos.slice(0, 4).map((m) => (
                      <div key={m.motivo} className="ph-bar">
                        <span title={m.motivo}>{m.motivo}</span>
                        <b style={{ color: 'var(--t)' }}>{m.n}</b>
                        <div className="ph-track">
                          <div className="ph-fill" style={{ width: `${(m.n / maxMotivo) * 100}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="ph-vacio">Ninguna en 30 días (la encuesta existe desde el 05/11).</div>
              )}
            </div>

            {/* Alertas */}
            <div className="ph-card" style={card(vigTotal ? COLOR.alertas : GRIS)}>
              <div className="ph-top">
                <span className="ph-num">{vigTotal}</span>
                <span className="ph-lbl">pacientes en alerta ahora</span>
              </div>
              <div className="ph-chips">
                {(['A', 'B', 'C'] as Regla[]).map((k) => (
                  <span key={k} className={`ph-chip${alertas.vigentes[k] > 0 ? ' am' : ''}`}>
                    {TEXTO_REGLA[k]} <b>{alertas.vigentes[k]}</b>
                  </span>
                ))}
              </div>
              <div className="ph-sub" style={{ marginTop: 6 }}>
                Derivados a CX en {DIAS_CX} días: <b style={{ color: 'var(--t)' }}>{alertas.derivadas}</b>
              </div>
            </div>

            {/* CX */}
            <div className="ph-card" style={card(porFuera > 0 ? 'var(--r)' : totalCx ? COLOR.cx : GRIS)}>
              <div className="ph-top">
                <span className="ph-num">{totalCx}</span>
                <span className="ph-lbl">respuestas de CX sobre sus pacientes</span>
              </div>
              {totalCx > 0 ? (
                <div className="ph-chips">
                  {porFuera > 0 && (
                    <span className="ph-chip r">
                      🚩 Atiende por fuera <b style={{ color: 'var(--r)' }}>{porFuera}</b>
                    </span>
                  )}
                  {Object.entries(cx)
                    .filter(([k]) => k !== 'atiende_por_fuera')
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, n]) => (
                      <span key={k} className={`ph-chip${k === 'va_a_agendar' ? ' v' : ''}`}>
                        {RESPUESTAS[k] ?? k} <b>{n}</b>
                      </span>
                    ))}
                </div>
              ) : (
                <div className="ph-vacio">Sin respuestas todavía.</div>
              )}
            </div>

            {/* Reseñas */}
            <div className="ph-card" style={card(r?.ahora != null ? COLOR.resenas : GRIS)}>
              <div className="ph-top">
                <span className="ph-num">{r?.ahora != null ? `${coma(r.ahora)}★` : '—'}</span>
                <span className="ph-lbl">
                  promedio 90 días{r?.n_ahora ? ` · ${r.n_ahora} reseña${r.n_ahora === 1 ? '' : 's'}` : ''}
                </span>
              </div>
              {mov != null && Math.abs(mov) >= 0.05 && (
                <div className="ph-sub" style={{ color: mov > 0 ? 'var(--v)' : 'var(--r)' }}>
                  {mov > 0 ? '↑ Subió' : '↓ Bajó'} desde {coma(r!.antes!)}★
                </div>
              )}
              <div className="ph-chips">
                {r && r.bajas_ids.length > 0 ? (
                  <span className={`ph-chip${bajasSinRevisar ? ' r' : ''}`}>
                    {r.bajas_ids.length} de 3★ o menos
                    {bajasSinRevisar ? ` · ${bajasSinRevisar} sin revisar` : ' · revisadas'}
                  </span>
                ) : (
                  <span className="ph-chip v">Sin reseñas bajas</span>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * Marco de "Métricas del mes" en el perfil: mismo formato que "Hoy en la
 * plataforma" pero en azul y con el punto quieto, porque es la foto del mes.
 */
export function MarcoMes({ mes, children }: { mes?: string; children: ReactNode }) {
  const nombre = mes && /^\d{4}-\d{2}/.test(mes) ? `${MESES[Number(mes.slice(5, 7)) - 1]} ${mes.slice(0, 4)}` : null;
  return (
    <div className="ms">
      <style>{ESTILOS}</style>
      <div className="ph ph-mes">
        <div className="ph-hd">
          <span className="ph-dot" />
          <span className="ph-tit">MÉTRICAS DEL MES</span>
          <span className="ph-aclara">{nombre ? `Foto de ${nombre}` : 'Foto del mes de la matriz'}</span>
        </div>
        {children}
      </div>
    </div>
  );
}
