import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { autenticarScript, errorJson } from '@/lib/google-script-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Recibe las respuestas del form "Requisitos Psicos Tu Terapia" (solapa
 * Reclutamiento).
 *
 * Un Apps Script en la planilla de respuestas (apps-script/postulaciones) manda
 * las filas cada vez que entra una respuesta y una vez por hora, en tandas.
 * Se puede mandar la misma fila muchas veces: `clave` (marca temporal + mail)
 * evita duplicar. Lo que ya se cargó no se pisa.
 *
 * Acá solo se guarda la respuesta. El cruce con quienes ya estuvieron en la
 * plataforma se arma al leer (components/ReclutamientoView.tsx), para que esté
 * siempre al día con las bajas y el CSV del mes.
 */

const MAX_FILAS = 1000;

type Fila = {
  clave: string;
  marca: string; // 'YYYY-MM-DD HH:mm:ss', hora de Montevideo
  pais: string;
  nombre: string;
  email: string;
  cuit: string;
  titulo: string;
  proceso_personal: string;
  experiencia_clinica: string;
  supervision: string;
  diez_horas: string;
  estado: string;
  respuestas: Record<string, string>;
};

type Resultado = 'nueva' | 'ya_estaba' | 'error';

function admin() {
  // Adentro del handler: CI compila sin la service key.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// "¿En qué plataforma te inscribes?" → AR / UY. Cualquier otra cosa (Chile,
// u otro país) se guarda como 'otro' y se ve aparte.
function paisDe(texto: string): 'AR' | 'UY' | 'otro' {
  const p = sinTildes(texto);
  if (p.includes('arg')) return 'AR';
  if (p.includes('uru')) return 'UY';
  return 'otro';
}

const texto = (v: unknown, max = 2000) => {
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

  const resultados: Record<string, { resultado: Resultado; detalle?: string }> = {};
  const nuevas: Record<string, unknown>[] = [];
  const vistas = new Set<string>();

  for (const f of filas) {
    const clave = String(f.clave ?? '').trim();
    // La misma clave dos veces en una tanda haría fallar el insert entero.
    if (!clave || vistas.has(clave)) continue;
    vistas.add(clave);
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(String(f.marca ?? ''))) {
      resultados[clave] = { resultado: 'error', detalle: 'Marca temporal inválida' };
      continue;
    }
    const mail = String(f.email ?? '').trim().toLowerCase();
    const nombre = texto(f.nombre, 200);
    if (!mail || !nombre) {
      resultados[clave] = { resultado: 'error', detalle: 'Falta el nombre o el mail' };
      continue;
    }
    const respuestas: Record<string, string> = {};
    for (const [k, v] of Object.entries(f.respuestas ?? {})) {
      const t = texto(v);
      if (t) respuestas[String(k).slice(0, 80)] = t;
    }
    const cuit = String(f.cuit ?? '').replace(/\D/g, '');
    nuevas.push({
      clave,
      postulado_at: `${f.marca.replace(' ', 'T')}-03:00`,
      pais: paisDe(String(f.pais ?? '')),
      pais_texto: texto(f.pais, 100),
      nombre,
      email: mail,
      // Menos de 7 dígitos no es un CUIT/RUT ni un documento: no sirve para cruzar.
      cuit: cuit.length >= 7 ? cuit : null,
      titulo: texto(f.titulo, 200),
      proceso_personal: texto(f.proceso_personal, 200),
      experiencia_clinica: texto(f.experiencia_clinica, 200),
      supervision: texto(f.supervision, 200),
      diez_horas: texto(f.diez_horas, 200),
      estado_planilla: texto(f.estado, 200),
      respuestas,
    });
  }

  try {
    if (nuevas.length) {
      // ignoreDuplicates: lo que ya estaba no se toca, y `select` devuelve
      // solo las filas que entraron recién.
      const { data, error: e } = await sb
        .from('postulaciones')
        .upsert(nuevas, { onConflict: 'clave', ignoreDuplicates: true })
        .select('clave');
      if (e) throw new Error(e.message);
      const entraron = new Set((data ?? []).map((r: { clave: string }) => r.clave));
      for (const n of nuevas) {
        const clave = n.clave as string;
        resultados[clave] = { resultado: entraron.has(clave) ? 'nueva' : 'ya_estaba' };
      }
    }

    const resumen: Record<string, number> = {};
    for (const r of Object.values(resultados)) resumen[r.resultado] = (resumen[r.resultado] ?? 0) + 1;
    console.log('[talent/postulaciones]', email, resumen);
    return NextResponse.json({ resultados, resumen });
  } catch (e) {
    console.error('[talent/postulaciones] falló', e);
    return errorJson(e instanceof Error ? e.message : 'error desconocido', 500);
  }
}
