import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { autenticarScript, errorJson } from '@/lib/google-script-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Matrix → planilla de Requisitos. Lo que Talent decide en la solapa
 * Reclutamiento se escribe en la columna ESTADO de la planilla, para que
 * haya un solo lugar donde se decide. El dashboard no puede escribir en Google
 * Sheets: lo hace el Apps Script de la planilla (apps-script/postulaciones),
 * que cada 5 minutos:
 *   GET  → las decisiones que faltan escribir (solo la última de cada
 *          postulación, y solo si es más nueva que el último cambio de ESTADO
 *          en la planilla: si alguien cambió la planilla después, gana eso).
 *   POST → { ids } las que ya escribió.
 *
 * ESTADO hoy no dispara ningún mail: escribirlo no le manda nada a nadie.
 */

// Next solo deja exportar handlers desde un route.ts: esto queda adentro.
const ESTADO_DE: Record<string, string> = {
  avanza: 'APTO',
  no_avanza: 'NO CUMPLE',
  en_espera: 'REVISAR',
};

function admin() {
  // Adentro del handler: CI compila sin la service key.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

type Dec = { id: string; postulacion_id: string; decision: string; created_at: string; planilla_escrita_at: string | null };

export async function GET(request: Request) {
  const sb = admin();
  const email = await autenticarScript(request, sb);
  if (typeof email !== 'string') return email;

  const { data: pend, error: e1 } = await sb
    .from('postulacion_decisiones')
    .select('id,postulacion_id,decision,created_at,planilla_escrita_at')
    .is('planilla_escrita_at', null)
    .order('created_at', { ascending: true })
    .limit(500);
  if (e1) return errorJson(e1.message, 500);
  const pendientes = (pend ?? []) as Dec[];
  if (!pendientes.length) return NextResponse.json({ pendientes: [] });

  const ids = Array.from(new Set(pendientes.map((d) => d.postulacion_id)));
  const [{ data: posts, error: e2 }, { data: todas, error: e3 }] = await Promise.all([
    sb.from('postulaciones').select('id,clave,estado_planilla_at').in('id', ids),
    sb.from('postulacion_decisiones').select('id,postulacion_id,created_at').in('postulacion_id', ids),
  ]);
  if (e2 || e3) return errorJson((e2 ?? e3)!.message, 500);

  // La última decisión de cada postulación (pendiente o no).
  const ultima = new Map<string, { id: string; created_at: string }>();
  for (const d of (todas ?? []) as { id: string; postulacion_id: string; created_at: string }[]) {
    const prev = ultima.get(d.postulacion_id);
    if (!prev || d.created_at > prev.created_at) ultima.set(d.postulacion_id, d);
  }
  const postPorId = new Map(
    ((posts ?? []) as { id: string; clave: string; estado_planilla_at: string | null }[]).map((p) => [p.id, p]),
  );

  const out: { id: string; clave: string; estado: string }[] = [];
  const viejas: string[] = [];
  for (const d of pendientes) {
    const p = postPorId.get(d.postulacion_id);
    const esUltima = ultima.get(d.postulacion_id)?.id === d.id;
    const planillaMasNueva = !!p?.estado_planilla_at && p.estado_planilla_at > d.created_at;
    // Una decisión vieja o pisada por la planilla no se escribe: se marca como
    // resuelta para que no quede pendiente para siempre.
    if (!p || !esUltima || planillaMasNueva || !ESTADO_DE[d.decision]) {
      viejas.push(d.id);
      continue;
    }
    out.push({ id: d.id, clave: p.clave, estado: ESTADO_DE[d.decision] });
  }
  if (viejas.length) {
    await sb.from('postulacion_decisiones').update({ planilla_escrita_at: new Date().toISOString() }).in('id', viejas);
  }
  return NextResponse.json({ pendientes: out });
}

export async function POST(request: Request) {
  const sb = admin();
  const email = await autenticarScript(request, sb);
  if (typeof email !== 'string') return email;

  let ids: string[];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids) ? (body.ids as unknown[]).map(String).slice(0, 500) : [];
  } catch {
    return errorJson('JSON inválido', 400);
  }
  if (!ids.length) return NextResponse.json({ escritas: 0 });

  const { data: decs, error: e1 } = await sb.from('postulacion_decisiones').select('id,postulacion_id,decision').in('id', ids);
  if (e1) return errorJson(e1.message, 500);
  const ahora = new Date().toISOString();
  const { error: e2 } = await sb.from('postulacion_decisiones').update({ planilla_escrita_at: ahora }).in('id', ids);
  if (e2) return errorJson(e2.message, 500);
  // Lo que quedó en la planilla es ahora su ESTADO.
  for (const d of (decs ?? []) as { postulacion_id: string; decision: string }[]) {
    const estado = ESTADO_DE[d.decision];
    if (estado) await sb.from('postulaciones').update({ estado_planilla: estado, estado_planilla_at: ahora }).eq('id', d.postulacion_id);
  }
  console.log('[talent/postulaciones/decisiones]', email, 'escritas', ids.length);
  return NextResponse.json({ escritas: ids.length });
}
