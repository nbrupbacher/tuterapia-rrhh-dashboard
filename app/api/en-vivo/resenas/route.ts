import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Solapa En vivo → Reseñas. Lee `rating` de la plataforma en el momento.
 *
 * Lo que se sabe de la tabla (2026-11-09, mirando conteos):
 * - `status` 1 = publicada; 0 = no aprobada (las de 3 estrellas o menos que
 *   quedaron en revisión o se denegaron); 9 = oculta (casi siempre sin
 *   comentario o con uno vacío).
 * - No hay fecha de creación: `modificacion` cambia al aprobar. Las fechas que
 *   se muestran son "última modificación", y la ubicación respecto de las
 *   sesiones es aproximada.
 * - Promedios: solo publicadas, que es lo que ve el paciente en el perfil.
 *
 * El nombre del paciente se lee acá, en el momento (igual que en Alertas), solo
 * para las reseñas de las listas, y no se guarda en ningún lado.
 *
 * Lo que hace el equipo con cada reseña (revisada, nota, ticker) vive en
 * Supabase (`resenas_revision`), no acá.
 */

const DIAS_LISTAS = 90;

type Fila = RowDataPacket & {
  id: number;
  paciente_id: number;
  therapist_id: number;
  pais: string;
  estrellas: number;
  comentario: string | null;
  status: number;
  fecha: string;
};

export async function GET(request: Request) {
  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: userData, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !userData?.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });

  try {
    const resultado = await withMysql(async (conn) => {
      const AR_UY = `l.tipo = 2 AND l.paisDominio IN ('AR', 'UY')`;

      // Totales de la plataforma: nuevas en 7 días y promedio de publicadas en
      // los últimos 90 días contra los 90 anteriores.
      const [[kpi]] = await conn.query<RowDataPacket[]>(
        `SELECT
            SUM(r.modificacion >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS nuevas_7d,
            SUM(r.modificacion >= UTC_TIMESTAMP() - INTERVAL 7 DAY AND CHAR_LENGTH(TRIM(COALESCE(r.comentario, ''))) >= 3) AS con_comentario_7d,
            ROUND(AVG(CASE WHEN r.status = 1 AND r.modificacion >= UTC_TIMESTAMP() - INTERVAL 90 DAY THEN r.rate END), 2) AS prom_90d,
            ROUND(AVG(CASE WHEN r.status = 1 AND r.modificacion < UTC_TIMESTAMP() - INTERVAL 90 DAY
                                         AND r.modificacion >= UTC_TIMESTAMP() - INTERVAL 180 DAY THEN r.rate END), 2) AS prom_90d_antes,
            SUM(r.status = 1 AND r.modificacion >= UTC_TIMESTAMP() - INTERVAL 90 DAY) AS n_90d
           FROM rating r JOIN login l ON l.id = r.idTerapeuta AND ${AR_UY}`,
      );

      // Las de las listas: 3 estrellas o menos (para mirar) y 5 con
      // comentario publicadas (para reconocer), de los últimos 90 días.
      const [filas] = await conn.query<Fila[]>(
        `SELECT r.idRating AS id, r.idPaciente AS paciente_id, r.idTerapeuta AS therapist_id, l.paisDominio AS pais,
                r.rate AS estrellas, r.comentario, r.status, r.modificacion AS fecha
           FROM rating r JOIN login l ON l.id = r.idTerapeuta AND ${AR_UY}
          WHERE r.modificacion >= UTC_TIMESTAMP() - INTERVAL ${DIAS_LISTAS} DAY
            AND (r.rate <= 3 OR (r.rate = 5 AND r.status = 1 AND CHAR_LENGTH(TRIM(COALESCE(r.comentario, ''))) >= 3))
          ORDER BY r.modificacion DESC`,
      );

      // Nombres de los pacientes de las listas. Igual que /api/en-vivo/pacientes:
      // el apellido puede no existir o llamarse distinto.
      const nombres: Record<string, string> = {};
      const idsPac = [...new Set(filas.map((f) => Number(f.paciente_id)))];
      if (idsPac.length) {
        const [cols] = await conn.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pacientes'
              AND COLUMN_NAME IN ('apellido', 'apellidos')`,
        );
        const apellido = cols[0]?.c ? String(cols[0].c) : null;
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT id_login AS id, nombre${apellido ? `, ${apellido} AS apellido` : ''}
             FROM pacientes
            WHERE id_login IN (?)`,
          [idsPac],
        );
        for (const r of rows) {
          const completo = [r.nombre, r.apellido].map((s) => (s == null ? '' : String(s).trim())).filter(Boolean).join(' ');
          if (completo) nombres[String(r.id)] = completo;
        }
      }

      // Contexto de las bajas respecto de las sesiones de ese paciente con
      // ese psicólogo/a: cuántas tuvo hasta la reseña, la última antes, y si
      // tiene una próxima agendada.
      const bajas = filas.filter((f) => f.estrellas <= 3);
      const contexto: Record<number, { sesiones: number; ultima: string | null; proxima: string | null }> = {};
      for (const b of bajas) {
        const [[c]] = await conn.query<RowDataPacket[]>(
          `SELECT SUM(s.realizada = 1 AND s.fecha <= ?) AS sesiones,
                  MAX(CASE WHEN s.realizada = 1 AND s.fecha <= ? THEN s.fecha END) AS ultima,
                  MIN(CASE WHEN s.realizada <> 1 AND s.fecha > UTC_TIMESTAMP() THEN s.fecha END) AS proxima
             FROM sesiones s
            WHERE s.id_paciente = ? AND s.id_terapeuta = ?`,
          [b.fecha, b.fecha, b.paciente_id, b.therapist_id],
        );
        contexto[b.id] = { sesiones: Number(c?.sesiones ?? 0), ultima: c?.ultima ?? null, proxima: c?.proxima ?? null };
      }

      // Promedio de publicadas por psicólogo/a: últimos 90 días y la ventana de
      // 90 días que terminaba hace 30. Sirve para la tabla de cambios y para
      // mostrar "su promedio" al lado de cada reseña.
      const [promedios] = await conn.query<RowDataPacket[]>(
        `SELECT r.idTerapeuta AS therapist_id, l.paisDominio AS pais,
                ROUND(AVG(CASE WHEN r.modificacion >= UTC_TIMESTAMP() - INTERVAL 90 DAY THEN r.rate END), 2) AS ahora,
                SUM(r.modificacion >= UTC_TIMESTAMP() - INTERVAL 90 DAY) AS n_ahora,
                ROUND(AVG(CASE WHEN r.modificacion < UTC_TIMESTAMP() - INTERVAL 30 DAY
                                AND r.modificacion >= UTC_TIMESTAMP() - INTERVAL 120 DAY THEN r.rate END), 2) AS antes,
                SUM(r.modificacion < UTC_TIMESTAMP() - INTERVAL 30 DAY AND r.modificacion >= UTC_TIMESTAMP() - INTERVAL 120 DAY) AS n_antes
           FROM rating r JOIN login l ON l.id = r.idTerapeuta AND ${AR_UY}
          WHERE r.status = 1 AND r.modificacion >= UTC_TIMESTAMP() - INTERVAL 120 DAY
          GROUP BY r.idTerapeuta, l.paisDominio`,
      );

      return {
        kpi: {
          nuevas_7d: Number(kpi?.nuevas_7d ?? 0),
          con_comentario_7d: Number(kpi?.con_comentario_7d ?? 0),
          prom_90d: kpi?.prom_90d == null ? null : Number(kpi.prom_90d),
          prom_90d_antes: kpi?.prom_90d_antes == null ? null : Number(kpi.prom_90d_antes),
          n_90d: Number(kpi?.n_90d ?? 0),
        },
        resenas: filas.map((f) => ({
          id: Number(f.id),
          paciente_id: Number(f.paciente_id),
          paciente: nombres[String(f.paciente_id)] ?? '',
          therapist_id: String(f.therapist_id),
          pais: f.pais,
          estrellas: Number(f.estrellas),
          comentario: f.comentario ? String(f.comentario).trim() : '',
          status: Number(f.status),
          fecha: f.fecha,
          contexto: contexto[Number(f.id)] ?? null,
        })),
        promedios: promedios.map((p) => ({
          therapist_id: String(p.therapist_id),
          pais: p.pais,
          ahora: p.ahora == null ? null : Number(p.ahora),
          n_ahora: Number(p.n_ahora ?? 0),
          antes: p.antes == null ? null : Number(p.antes),
          n_antes: Number(p.n_antes ?? 0),
        })),
      };
    });
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[en-vivo/resenas] falló', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error desconocido' }, { status: 500 });
  }
}
