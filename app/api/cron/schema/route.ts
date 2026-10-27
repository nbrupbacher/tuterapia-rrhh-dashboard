import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';
import { isCronAuthorized } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Endpoint temporal para escribir las consultas de "En vivo" contra el
 * esquema real.
 *
 * Lo que el repo de marketing documenta de MySQL no alcanza para medir por
 * terapeuta: solo usa `sesiones.realizada`, y no dice cómo una sesión se
 * vincula con su terapeuta ni cómo se marca agendada, aprobada o cancelada.
 * Tampoco aparecen las tablas de reseñas ni de créditos que piden las fases
 * siguientes.
 *
 * Devuelve SOLO metadatos: nombre de cada tabla, sus columnas con el tipo, y
 * la cantidad aproximada de filas que estima el motor. Nunca una fila de
 * datos, así que no expone a nadie. Borrar cuando las consultas estén
 * validadas.
 */
type ColumnaRow = RowDataPacket & {
  TABLE_NAME: string;
  COLUMN_NAME: string;
  COLUMN_TYPE: string;
  IS_NULLABLE: string;
  COLUMN_KEY: string;
};

type TablaRow = RowDataPacket & {
  TABLE_NAME: string;
  TABLE_ROWS: number | null;
};

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const esquema = await withMysql(async (conn) => {
      const db = process.env.MYSQL_DATABASE;

      const [tablas] = await conn.query<TablaRow[]>(
        `SELECT TABLE_NAME, TABLE_ROWS
           FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = ? AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
          ORDER BY TABLE_NAME`,
        [db],
      );

      const [columnas] = await conn.query<ColumnaRow[]>(
        `SELECT TABLE_NAME, COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = ?
          ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        [db],
      );

      const porTabla: Record<string, { filas_aprox: number | null; columnas: string[] }> = {};
      for (const t of tablas) {
        porTabla[t.TABLE_NAME] = { filas_aprox: t.TABLE_ROWS, columnas: [] };
      }
      for (const c of columnas) {
        // Formato compacto, una línea por columna: "id_terapeuta int(11) null MUL".
        const extra = [c.IS_NULLABLE === 'YES' ? 'null' : '', c.COLUMN_KEY].filter(Boolean).join(' ');
        (porTabla[c.TABLE_NAME] ??= { filas_aprox: null, columnas: [] }).columnas.push(
          `${c.COLUMN_NAME} ${c.COLUMN_TYPE}${extra ? ` ${extra}` : ''}`,
        );
      }
      return porTabla;
    });

    return NextResponse.json({ ok: true, tablas: Object.keys(esquema).length, esquema });
  } catch (error) {
    console.error('[cron/schema] falló', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'error desconocido' },
      { status: 500 },
    );
  }
}
