import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { autenticarScript, errorJson } from '@/lib/google-script-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Recibe la planilla "Proceso y Contratos" (solapas ARG y URU): en qué etapa
 * está cada persona. Lo manda el Apps Script de apps-script/procesos cada vez
 * que alguien edita la planilla y una vez por hora.
 *
 * Cada envío es la foto entera de cada solapa: se guarda lo que vino y se
 * borra lo de ese país que ya no está (alguien borró o movió filas). Si una
 * solapa llega vacía no se borra nada: es más probable un error de lectura
 * que una planilla vaciada.
 *
 * La planilla sigue mandando (de ahí salen los mails automáticos). Esto es
 * solo para verla en Reclutamiento.
 */

const MAX_FILAS = 3000;

type Fila = {
  pais: string; // 'AR' | 'UY'
  fila: number; // número de fila en la planilla
  mes: string;
  nombre: string;
  email: string; // la celda tal cual: puede traer dos mails o una nota
  recruiter: string;
  estado: string;
  fecha_ingreso: string;
};

function admin() {
  // Adentro del handler: CI compila sin la service key.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** El dropdown de la columna Status. Lo que no es del dropdown queda 'otro'. */
function estadoDe(texto: string): string {
  const t = sinTildes(texto);
  if (!t) return 'otro';
  if (t.startsWith('entrevista')) return 'entrevista';
  if (t.startsWith('proximos pasos')) return 'proximos_pasos';
  if (t.startsWith('ultimos pasos')) return 'ultimos_pasos';
  if (t.startsWith('envio de contrato')) return 'contrato';
  if (t.startsWith('comienza')) return 'comienza';
  if (t.startsWith('no avanza')) return 'no_avanza';
  return 'otro';
}

const texto = (v: unknown, max = 300) => {
  const s = String(v ?? '').trim();
  return s ? s.slice(0, max) : null;
};

export async function POST(request: Request) {
  const sb = admin();
  const email = await autenticarScript(request, sb);
  if (typeof email !== 'string') return email;

  let filas: Fila[];
  try {
    const body = await request.json();
    filas = Array.isArray(body?.filas) ? (body.filas as Fila[]).slice(0, MAX_FILAS) : [];
  } catch {
    return errorJson('JSON inválido', 400);
  }

  const porClave = new Map<string, Record<string, unknown>>();
  for (const f of filas) {
    const pais = f.pais === 'AR' || f.pais === 'UY' ? f.pais : null;
    const fila = Number(f.fila);
    const nombre = texto(f.nombre, 200);
    if (!pais || !Number.isInteger(fila) || fila < 2 || !nombre) continue;
    const emails = Array.from(
      new Set((String(f.email ?? '').toLowerCase().match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? []).map((m) => m.trim())),
    );
    porClave.set(`${pais}|${fila}`, {
      clave: `${pais}|${fila}`,
      pais,
      fila,
      mes: texto(f.mes, 40),
      nombre,
      emails,
      recruiter: texto(f.recruiter, 60),
      estado: estadoDe(String(f.estado ?? '')),
      estado_texto: texto(f.estado),
      fecha_ingreso: texto(f.fecha_ingreso, 40),
    });
  }
  const rows = Array.from(porClave.values());

  if (rows.length) {
    const { error: e } = await sb.from('procesos').upsert(rows, { onConflict: 'clave' });
    if (e) {
      console.error('[talent/procesos] upsert', e.message);
      return errorJson(e.message, 500);
    }
  }

  // Lo de cada país que no vino en esta foto se borra.
  const borradas: Record<string, number> = {};
  for (const pais of ['AR', 'UY']) {
    const claves = rows.filter((r) => r.pais === pais).map((r) => r.clave as string);
    if (!claves.length) continue;
    const { data: actuales, error: e1 } = await sb.from('procesos').select('clave').eq('pais', pais);
    if (e1) {
      console.error('[talent/procesos] leer', e1.message);
      continue;
    }
    const sobran = (actuales ?? []).map((r) => r.clave as string).filter((c) => !claves.includes(c));
    if (sobran.length) {
      const { error: e2 } = await sb.from('procesos').delete().in('clave', sobran);
      if (e2) console.error('[talent/procesos] borrar', e2.message);
      else borradas[pais] = sobran.length;
    }
  }

  const resumen: Record<string, number> = {};
  for (const r of rows) resumen[r.estado as string] = (resumen[r.estado as string] ?? 0) + 1;
  console.log('[talent/procesos]', email, rows.length, resumen, 'borradas', borradas);
  return NextResponse.json({ guardadas: rows.length, borradas, resumen });
}
