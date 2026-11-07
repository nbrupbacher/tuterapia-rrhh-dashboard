import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { autenticarScript, errorJson } from '@/lib/google-script-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Recibe las respuestas del form de desvinculación ("Desvi post 2024").
 *
 * El form lo completan a veces los psicólogos/as y a veces Talent. Un Apps
 * Script en la planilla de respuestas (apps-script/form-desvinculacion) manda
 * las filas cada vez que entra una respuesta y una vez por hora. Se puede
 * mandar la misma fila muchas veces: `form_clave` (marca temporal + mail) evita
 * duplicar salidas.
 *
 * Reglas (acordadas con Talent el 2026-11-07):
 * - Si lo completó alguien de Tu Terapia, la desvinculación y la desactivación
 *   del perfil son ese mismo día: Talent desactiva al completar el form.
 * - Si lo completó el psicólogo/a, la salida queda en curso, esperando
 *   liquidación, como cualquier salida que arranca.
 * - Si ya había una salida de esa persona (abierta, o cerrada cerca de la
 *   fecha del form), el form se le agrega a esa y no se crea otra. Así no se
 *   duplican las que se cargaron antes a mano o desde Monitorear.
 *
 * Lo que ya se cargó no se pisa: el dashboard es donde se corrige.
 */

// Las respuestas anteriores se importaron a mano el 2026-11-06.
const FORM_DESDE = '2026-11-01';
// Una salida cerrada cuenta como "la misma" si está a menos de esto del form.
const DIAS_MISMA_SALIDA = 45;
const MAX_FILAS = 2000;

type Fila = {
  clave: string;
  marca: string; // 'YYYY-MM-DD HH:mm:ss', hora de Montevideo
  email: string;
  nombre: string;
  pais: string;
  aviso: string | null; // 'YYYY-MM-DD'
  pedido: string;
  motivo: string;
};

type Resultado = 'ya_estaba' | 'agregada' | 'creada' | 'sin_psicologo' | 'varios_psicologos' | 'anterior' | 'error';

type Ter = { id: string; nombre: string; pais: string; email: string | null };
type Desv = {
  id: string;
  therapist_id: string;
  form_clave: string | null;
  form_enviado_at: string | null;
  desvinculado_at: string | null;
  desactivado_at: string | null;
  cancelada_at: string | null;
  created_at: string;
};

function admin() {
  // Adentro del handler: CI compila sin la service key.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

function normalizar(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function esDeTuTerapia(email: string): boolean {
  return /@tuterapia\.com\.(uy|ar)$/i.test(email.trim());
}

// "¿De quién es el pedido de desvinculación?"
function motivoDe(pedido: string): 'por_el_psicologo' | 'nuestra' | 'a_definir' {
  const p = normalizar(pedido);
  if (p === 'terapeuta') return 'por_el_psicologo';
  if (p === 'tu terapia') return 'nuestra';
  return 'a_definir'; // "Ambos", "Terapeuta y Tu Terapia" o vacío
}

function paisDe(pais: string): string | null {
  const p = normalizar(pais);
  return p.startsWith('arg') ? 'AR' : p.startsWith('uru') ? 'UY' : null;
}

/** Marca temporal de Montevideo → ISO con zona. */
function isoDe(marca: string): string {
  return `${marca.replace(' ', 'T')}-03:00`;
}

async function leerTodo<T>(sb: SupabaseClient, tabla: string, columnas: string): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await sb.from(tabla).select(columnas).range(i, i + 999);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

/**
 * El psicólogo/a de la fila. Si lo completó él/ella, el mail de la cuenta es lo
 * más seguro; si no, el nombre (como figura en el perfil) dentro de su país.
 */
function buscarPsicologo(f: Fila, ters: Ter[]): Ter[] {
  if (!esDeTuTerapia(f.email)) {
    const porMail = ters.filter((t) => t.email && t.email.trim().toLowerCase() === f.email.trim().toLowerCase());
    if (porMail.length === 1) return porMail;
  }
  const pais = paisDe(f.pais);
  const enPais = pais ? ters.filter((t) => t.pais === pais) : ters;
  const buscado = normalizar(f.nombre);
  if (!buscado) return [];
  const exacto = enPais.filter((t) => normalizar(t.nombre) === buscado);
  if (exacto.length) return exacto;
  // Nombre incompleto o con un apellido de más: todas las palabras de uno
  // tienen que estar en el otro.
  const palabras = buscado.split(' ');
  return enPais.filter((t) => {
    const n = normalizar(t.nombre).split(' ');
    return palabras.every((p) => n.includes(p)) || (n.length >= 2 && n.every((p) => palabras.includes(p)));
  });
}

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

  try {
    const [ters, desvs] = await Promise.all([
      leerTodo<Ter>(sb, 'therapists', 'id,nombre,pais,email'),
      leerTodo<Desv>(sb, 'desvinculaciones', 'id,therapist_id,form_clave,form_enviado_at,desvinculado_at,desactivado_at,cancelada_at,created_at'),
    ]);
    const porClave = new Set(desvs.map((d) => d.form_clave).filter(Boolean));

    const resultados: Record<string, { resultado: Resultado; detalle?: string }> = {};
    const anotar = (clave: string, resultado: Resultado, detalle?: string) => {
      resultados[clave] = detalle ? { resultado, detalle } : { resultado };
    };

    for (const f of filas) {
      const clave = String(f.clave ?? '').trim();
      if (!clave) continue;
      if (porClave.has(clave)) {
        anotar(clave, 'ya_estaba');
        continue;
      }
      const dia = String(f.marca ?? '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) {
        anotar(clave, 'error', 'Marca temporal inválida');
        continue;
      }
      if (dia < FORM_DESDE) {
        anotar(clave, 'anterior');
        continue;
      }

      const candidatos = buscarPsicologo(f, ters);
      if (candidatos.length === 0) {
        anotar(clave, 'sin_psicologo', `No hay un psicólogo/a "${f.nombre}" en ${f.pais || 'ningún país'}`);
        continue;
      }
      if (candidatos.length > 1) {
        anotar(clave, 'varios_psicologos', candidatos.map((t) => `${t.nombre} #${t.id}`).join(', '));
        continue;
      }
      const ter = candidatos[0];

      const talent = esDeTuTerapia(f.email);
      const cuando = isoDe(f.marca);
      const formEnviado = f.aviso && /^\d{4}-\d{2}-\d{2}$/.test(f.aviso) ? `${f.aviso}T12:00:00-03:00` : cuando;
      // Lo que agrega Talent al completar el form: la baja y la desactivación.
      const baja = talent ? { desvinculado_at: cuando, desvinculado_por: f.email, desactivado_at: cuando, desactivado_por: f.email } : {};

      const cerca = (ts: string | null) =>
        ts != null && Math.abs(Date.parse(ts) - Date.parse(cuando)) <= DIAS_MISMA_SALIDA * 86_400_000;
      const existente =
        desvs.find((d) => d.therapist_id === ter.id && !d.form_clave && !d.desvinculado_at && !d.cancelada_at) ??
        desvs.find(
          (d) =>
            d.therapist_id === ter.id &&
            !d.form_clave &&
            !d.cancelada_at &&
            (cerca(d.desvinculado_at) || cerca(d.form_enviado_at) || cerca(d.created_at)),
        );

      if (existente) {
        // Solo se completa lo que falta.
        const cambios: Record<string, string> = { form_clave: clave, form_email: f.email };
        if (!existente.form_enviado_at) cambios.form_enviado_at = formEnviado;
        if (talent && !existente.desvinculado_at) Object.assign(cambios, { desvinculado_at: cuando, desvinculado_por: f.email });
        if (talent && !existente.desactivado_at) Object.assign(cambios, { desactivado_at: cuando, desactivado_por: f.email });
        const { error: e } = await sb.from('desvinculaciones').update(cambios).eq('id', existente.id);
        if (e) {
          anotar(clave, 'error', e.message);
          continue;
        }
        existente.form_clave = clave;
        porClave.add(clave);
        anotar(clave, 'agregada', `${ter.nombre} #${ter.id}`);
      } else {
        // Tipo explícito: con `...baja` (que puede ser {}) supabase-js no acepta la unión.
        const nueva: Record<string, string | null> = {
          therapist_id: ter.id,
          motivo: motivoDe(f.pedido),
          form_enviado_at: formEnviado,
          form_clave: clave,
          form_email: f.email,
          nota: f.motivo?.trim() ? `Form: ${f.motivo.trim().slice(0, 500)}` : null,
          cargado_por: 'form de desvinculación',
          ...baja,
        };
        const { data, error: e } = await sb.from('desvinculaciones').insert(nueva).select('id,created_at').single();
        if (e) {
          anotar(clave, 'error', e.code === '23505' ? 'Ya tiene una salida abierta' : e.message);
          continue;
        }
        desvs.push({
          id: data.id,
          therapist_id: ter.id,
          form_clave: clave,
          form_enviado_at: formEnviado,
          desvinculado_at: talent ? cuando : null,
          desactivado_at: talent ? cuando : null,
          cancelada_at: null,
          created_at: data.created_at,
        });
        porClave.add(clave);
        anotar(clave, 'creada', `${ter.nombre} #${ter.id}`);
      }

      // Si Talent ya lo desvinculó y seguía fantasmeado, el fantasmeo termina
      // ese día: pasa a ser una baja (igual que el botón Desvincular).
      if (talent) {
        await sb.from('fantasmeos').update({ hasta: dia, cerrado_por: f.email }).eq('therapist_id', ter.id).is('hasta', null);
      }
    }

    const resumen: Record<string, number> = {};
    for (const r of Object.values(resultados)) resumen[r.resultado] = (resumen[r.resultado] ?? 0) + 1;
    console.log('[talent/form-desvinculacion]', email, resumen);
    return NextResponse.json({ resultados, resumen });
  } catch (e) {
    console.error('[talent/form-desvinculacion] falló', e);
    return errorJson(e instanceof Error ? e.message : 'error desconocido', 500);
  }
}
