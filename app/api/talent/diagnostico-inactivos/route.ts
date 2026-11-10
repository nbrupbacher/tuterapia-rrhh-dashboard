import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';
import { autenticarScript } from '@/lib/google-script-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * TEMPORAL (2026-11-10): dónde guarda la plataforma el pop-up "Motivo de
 * inactividad" (al tildar "Desactivar paciente" en el listado de pacientes).
 * No aparece en `encuesta_motivos`.
 *
 * Solo nombres y fechas, nunca filas:
 * - ?parte=recientes&min=N: tablas modificadas en los últimos N minutos (se
 *   corre justo después de desactivar un paciente de prueba).
 * - ?parte=columnas: columnas cuyo nombre suena a motivo / baja / inactivo.
 *
 * Solo para el Apps Script de Talent (lib/google-script-auth). Borrar cuando
 * se sepa dónde está.
 */

function admin() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

export async function GET(request: Request) {
  const email = await autenticarScript(request, admin());
  if (typeof email !== 'string') return email;

  const url = new URL(request.url);
  const parte = url.searchParams.get('parte') ?? 'recientes';
  const min = Math.min(Math.max(Number(url.searchParams.get('min')) || 30, 1), 1440);

  try {
    const resultado = await withMysql(async (conn) => {
      if (parte === 'columnas') {
        const [cols] = await conn.query<RowDataPacket[]>(
          `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, DATA_TYPE AS tipo
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND COLUMN_NAME REGEXP 'motiv|razon|causa|inactiv|desactiv|activ|alta|baja|estado|status|encuesta'
            ORDER BY TABLE_NAME, COLUMN_NAME`,
        );
        return { columnas: cols };
      }
      const [tablas] = await conn.query<RowDataPacket[]>(
        `SELECT TABLE_NAME AS tabla, UPDATE_TIME AS modificada, TABLE_ROWS AS filas_aprox
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE()
            AND UPDATE_TIME >= NOW() - INTERVAL ? MINUTE
          ORDER BY UPDATE_TIME DESC`,
        [min],
      );
      const [[reloj]] = await conn.query<RowDataPacket[]>(`SELECT NOW() AS ahora`);
      return { minutos: min, ahora_mysql: reloj?.ahora ?? null, tablas };
    });
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[talent/diagnostico-inactivos] falló', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error desconocido' }, { status: 500 });
  }
}
