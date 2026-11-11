'use client';

import { useEffect, useState } from 'react';
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
const caja = { background: 'var(--bg3)', borderRadius: 7, padding: '9px 11px' } as const;
const sub = { fontSize: 11, color: 'var(--t2)', lineHeight: 1.5 } as const;

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

  return (
    <div className="ms">
      <div className="mst">Hoy en la plataforma</div>
      <div style={{ ...sub, marginBottom: 6, color: 'var(--t3)' }}>
        Datos de hoy, no del mes de la matriz. Cancelaciones: últimos 30 días (con motivo desde el 05/11).
      </div>
      {cargando ? (
        <div style={{ ...caja, ...sub }}>Cargando…</div>
      ) : error ? (
        <div style={{ ...caja, ...sub, color: 'var(--r)' }}>No se pudo cargar: {error}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={caja}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 3 }}>
              Cancelaciones con motivo: {c?.total ?? 0}
              {c && c.repetidos > 0 && (
                <span style={{ color: 'var(--am)', fontWeight: 600 }}>
                  {' '}· {c.repetidos} paciente{c.repetidos === 1 ? '' : 's'} con 2 o más
                </span>
              )}
            </div>
            <div style={sub}>
              {c && c.total > 0
                ? `${c.pacientes} paciente${c.pacientes === 1 ? '' : 's'} distinto${c.pacientes === 1 ? '' : 's'} · ` +
                  c.motivos.map((m) => `${m.motivo} (${m.n})`).join(' · ')
                : 'Sin cancelaciones con motivo en los últimos 30 días.'}
            </div>
          </div>

          <div style={caja}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 3 }}>Alertas de pacientes vigentes: {vigTotal}</div>
            <div style={sub}>
              {(['A', 'B', 'C'] as Regla[]).map((k) => `${TEXTO_REGLA[k]}: ${alertas.vigentes[k]}`).join(' · ')}
              {` · Derivadas a CX (${DIAS_CX} días): ${alertas.derivadas}`}
            </div>
          </div>

          <div style={caja}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 3 }}>
              Lo que respondió CX: {totalCx}
              {porFuera > 0 && <span style={{ color: 'var(--r)', fontWeight: 600 }}> · {porFuera} atiende{porFuera === 1 ? '' : 'n'} por fuera</span>}
            </div>
            <div style={sub}>
              {totalCx > 0
                ? Object.entries(cx)
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, n]) => `${RESPUESTAS[k] ?? k} (${n})`)
                    .join(' · ')
                : 'Sin respuestas de CX sobre sus pacientes todavía.'}
            </div>
          </div>

          <div style={caja}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 3 }}>
              Reseñas (90 días): {r?.ahora != null ? `${coma(r.ahora)} ★ · ${r.n_ahora}` : 'sin publicadas'}
              {mov != null && Math.abs(mov) >= 0.05 && (
                <span style={{ color: mov > 0 ? 'var(--v)' : 'var(--r)' }}> {mov > 0 ? '↑' : '↓'} antes {coma(r!.antes!)}</span>
              )}
            </div>
            <div style={sub}>
              {r && r.bajas_ids.length > 0
                ? `${r.bajas_ids.length} de 3 ★ o menos en 90 días` + (bajasSinRevisar ? ` · ${bajasSinRevisar} sin revisar` : ' · todas revisadas')
                : 'Sin reseñas de 3 ★ o menos en 90 días.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
