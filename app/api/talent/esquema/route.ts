import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';
import { autenticarScript, errorJson } from '@/lib/google-script-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Endpoint temporal para armar la solapa Reseñas (y después Créditos) contra
 * el esquema real, sin depender del CRON_SECRET.
 *
 * Lo llama Talent desde un Apps Script habilitado (ver lib/google-script-auth),
 * y devuelve SOLO metadatos: columnas de las tablas de reseñas/créditos y
 * conteos agregados (por estrellas, por estado, por mes). Nunca una fila, ni
 * un comentario, ni un nombre. Borrar cuando la solapa esté hecha.
 */

const PATRON_TABLAS = '(rating|rese|review|valoraci|credit|saldo|cupon|voucher)';

function admin() {
  // Adentro del handler: CI compila sin la service key.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function GET(request: Request) {
  const email = await autenticarScript(request, admin());
  if (typeof email !== 'string') return email;

  try {
    const resultado = await withMysql(async (conn) => {
      const [tablas] = await conn.query<RowDataPacket[]>(
        `SELECT TABLE_NAME AS t, TABLE_ROWS AS filas
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME REGEXP ?
          ORDER BY TABLE_NAME`,
        [PATRON_TABLAS],
      );
      const [columnas] = await conn.query<RowDataPacket[]>(
        `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS tipo, COLUMN_KEY AS clave
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME REGEXP ?
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [PATRON_TABLAS],
      );

      const esquema: Record<string, { filas: number | null; columnas: string[] }> = {};
      for (const t of tablas) esquema[String(t.t)] = { filas: t.filas == null ? null : Number(t.filas), columnas: [] };
      for (const c of columnas) {
        esquema[String(c.t)]?.columnas.push(`${c.c} ${c.tipo}${c.clave ? ` [${c.clave}]` : ''}`);
      }

      // Conteos de `rating` (si existe): cómo se distribuyen estrellas y
      // estados, y cuántas llegan por mes. Solo números.
      let rating: Record<string, unknown> | null = null;
      if (esquema.rating) {
        const cols = new Set(esquema.rating.columnas.map((x) => x.split(' ')[0]));
        const fecha = ['creacion', 'fecha', 'created_at', 'modificacion'].find((c) => cols.has(c)) ?? null;
        const [porEstado] = await conn.query<RowDataPacket[]>(
          `SELECT rate, status, COUNT(*) AS n,
                  SUM(comentario IS NOT NULL AND comentario <> '') AS con_comentario
             FROM rating GROUP BY rate, status ORDER BY rate, status`,
        );
        let porMes: RowDataPacket[] = [];
        if (fecha) {
          [porMes] = await conn.query<RowDataPacket[]>(
            `SELECT DATE_FORMAT(${fecha}, '%Y-%m') AS mes, COUNT(*) AS n, ROUND(AVG(rate), 2) AS promedio
               FROM rating WHERE ${fecha} >= UTC_TIMESTAMP() - INTERVAL 12 MONTH
              GROUP BY mes ORDER BY mes`,
          );
        }
        rating = { columna_fecha: fecha, por_estrellas_y_estado: porEstado, por_mes: porMes };
      }
      return { esquema, rating };
    });

    console.log('[talent/esquema]', email);
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[talent/esquema] falló', e);
    return errorJson(e instanceof Error ? e.message : 'error desconocido', 500);
  }
}
