import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Perfil del psicólogo/a → "Hoy en la plataforma": lo que se lee en el momento
 * de la plataforma para UN psicólogo/a (?id=login). Lo que vive en Supabase
 * (alertas, respuestas de CX, revisión de reseñas) lo lee el componente.
 *
 * - Cancelaciones de los últimos 30 días con motivo (encuesta_motivos: existe
 *   desde el 2026-11-05), por motivo, y cuántos pacientes tuvieron 2 o más.
 * - Reseñas: promedio de publicadas de los últimos 90 días contra la ventana de
 *   90 días que terminaba hace 30 (igual que la solapa Reseñas), y los ids de
 *   las de 3 estrellas o menos de los últimos 90 días.
 */

const DIAS_CANCEL = 30;

export async function GET(request: Request) {
  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: userData, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !userData?.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: 'Falta id' }, { status: 400 });

  try {
    const resultado = await withMysql(async (conn) => {
      const [motivos] = await conn.query<RowDataPacket[]>(
        `SELECT COALESCE(NULLIF(motivoTitulo, ''), motivo) AS motivo, COUNT(*) AS n
           FROM encuesta_motivos
          WHERE idLogin = ? AND tipo = 2 AND fecha >= UTC_TIMESTAMP() - INTERVAL ${DIAS_CANCEL} DAY
          GROUP BY 1
          ORDER BY n DESC`,
        [id],
      );
      const [[rep]] = await conn.query<RowDataPacket[]>(
        `SELECT COUNT(*) AS pacientes, SUM(n >= 2) AS repetidos
           FROM (
             SELECT JSON_UNQUOTE(JSON_EXTRACT(data, '$.idPaciente')) AS pac, COUNT(*) AS n
               FROM encuesta_motivos
              WHERE idLogin = ? AND tipo = 2 AND JSON_VALID(data)
                AND fecha >= UTC_TIMESTAMP() - INTERVAL ${DIAS_CANCEL} DAY
              GROUP BY pac
           ) x
          WHERE pac IS NOT NULL AND pac <> 'null'`,
        [id],
      );
      const [[prom]] = await conn.query<RowDataPacket[]>(
        `SELECT ROUND(AVG(CASE WHEN modificacion >= UTC_TIMESTAMP() - INTERVAL 90 DAY THEN rate END), 2) AS ahora,
                SUM(modificacion >= UTC_TIMESTAMP() - INTERVAL 90 DAY) AS n_ahora,
                ROUND(AVG(CASE WHEN modificacion < UTC_TIMESTAMP() - INTERVAL 30 DAY
                                AND modificacion >= UTC_TIMESTAMP() - INTERVAL 120 DAY THEN rate END), 2) AS antes,
                SUM(modificacion < UTC_TIMESTAMP() - INTERVAL 30 DAY AND modificacion >= UTC_TIMESTAMP() - INTERVAL 120 DAY) AS n_antes
           FROM rating
          WHERE idTerapeuta = ? AND status = 1 AND modificacion >= UTC_TIMESTAMP() - INTERVAL 120 DAY`,
        [id],
      );
      const [bajas] = await conn.query<RowDataPacket[]>(
        `SELECT idRating AS id FROM rating
          WHERE idTerapeuta = ? AND rate <= 3 AND modificacion >= UTC_TIMESTAMP() - INTERVAL 90 DAY`,
        [id],
      );
      const total = motivos.reduce((s, m) => s + Number(m.n), 0);
      return {
        cancelaciones: {
          dias: DIAS_CANCEL,
          total,
          motivos: motivos.map((m) => ({ motivo: String(m.motivo ?? ''), n: Number(m.n) })),
          pacientes: Number(rep?.pacientes ?? 0),
          repetidos: Number(rep?.repetidos ?? 0),
        },
        resenas: {
          ahora: prom?.ahora == null ? null : Number(prom.ahora),
          n_ahora: Number(prom?.n_ahora ?? 0),
          antes: prom?.antes == null ? null : Number(prom.antes),
          n_antes: Number(prom?.n_antes ?? 0),
          bajas_ids: bajas.map((b) => Number(b.id)),
        },
      };
    });
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[en-vivo/perfil] falló', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error desconocido' }, { status: 500 });
  }
}
