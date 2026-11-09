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
 * conteos agregados (por estrellas, por estado, por mes), y dónde están los
 * motivos de cancelación y de inactividad con la frecuencia de cada opción.
 * Nunca una fila, ni un comentario, ni un nombre. Borrar cuando la solapa
 * esté hecha.
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
        // Para entender qué es cada `status` (0 / 1 / 9) sin mirar ninguna
        // reseña: cuándo se tocaron por última vez, si el par paciente-psicólogo
        // tiene otra reseña, y cómo están hoy el psicólogo y el paciente.
        const [porStatus] = await conn.query<RowDataPacket[]>(
          `SELECT r.status,
                  COUNT(*) AS n,
                  ROUND(AVG(r.rate), 2) AS prom_estrellas,
                  ROUND(AVG(CHAR_LENGTH(COALESCE(r.comentario, ''))), 0) AS largo_comentario,
                  MIN(r.modificacion) AS primera_mod,
                  MAX(r.modificacion) AS ultima_mod,
                  SUM(r.modificacion >= UTC_TIMESTAMP() - INTERVAL 90 DAY) AS ult_90_dias,
                  SUM(EXISTS (SELECT 1 FROM rating o WHERE o.idPaciente = r.idPaciente AND o.idTerapeuta = r.idTerapeuta AND o.idRating <> r.idRating)) AS par_con_otra,
                  SUM(EXISTS (SELECT 1 FROM rating o WHERE o.idPaciente = r.idPaciente AND o.idTerapeuta = r.idTerapeuta AND o.idRating <> r.idRating AND o.status = 1)) AS par_con_otra_status1,
                  SUM(EXISTS (SELECT 1 FROM rating o WHERE o.idPaciente = r.idPaciente AND o.idTerapeuta = r.idTerapeuta AND o.idRating > r.idRating)) AS par_con_otra_posterior,
                  SUM(lt.active = 1) AS psico_login_activo,
                  SUM(lt.id IS NULL) AS psico_sin_login,
                  SUM(t.seleccionable = 1) AS psico_seleccionable,
                  SUM(lp.active = 1) AS paciente_login_activo,
                  SUM(lp.id IS NULL) AS paciente_sin_login,
                  SUM(p.id_terapeuta = r.idTerapeuta) AS paciente_sigue_con_ese_psico,
                  SUM(EXISTS (SELECT 1 FROM sesiones s WHERE s.id_paciente = r.idPaciente AND s.id_terapeuta = r.idTerapeuta AND s.realizada = 1)) AS con_sesion_realizada
             FROM rating r
             LEFT JOIN login lt ON lt.id = r.idTerapeuta
             LEFT JOIN terapeutas t ON t.id_login = r.idTerapeuta
             LEFT JOIN login lp ON lp.id = r.idPaciente
             LEFT JOIN pacientes p ON p.id_login = r.idPaciente
            GROUP BY r.status
            ORDER BY r.status`,
        );
        const [statusPorAnio] = await conn.query<RowDataPacket[]>(
          `SELECT YEAR(modificacion) AS anio, status, COUNT(*) AS n
             FROM rating GROUP BY anio, status ORDER BY anio, status`,
        );
        rating = { columna_fecha: fecha, por_estrellas_y_estado: porEstado, por_mes: porMes, por_status: porStatus, status_por_anio: statusPorAnio };
      }
      // Motivos de cancelación y de pacientes inactivos: dónde están. Columnas
      // con nombre de motivo/cancelación/baja en cualquier tabla, las tablas que
      // se llaman así, y para las columnas de opciones fijas (números o textos
      // cortos) cuántas veces aparece cada valor. Los textos largos (escritos a
      // mano) no se leen.
      const PATRON_MOTIVOS = '(motivo|razon|reason|cancel|baja|inactiv|desactiv|encuesta)';
      const [colsMotivo] = await conn.query<RowDataPacket[]>(
        `SELECT c.TABLE_NAME AS t, c.COLUMN_NAME AS c, c.DATA_TYPE AS tipo, c.CHARACTER_MAXIMUM_LENGTH AS largo, tb.TABLE_ROWS AS filas
           FROM information_schema.COLUMNS c
           JOIN information_schema.TABLES tb ON tb.TABLE_SCHEMA = c.TABLE_SCHEMA AND tb.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA = DATABASE()
            AND (c.COLUMN_NAME REGEXP ? OR c.TABLE_NAME REGEXP ?)
          ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
        [PATRON_MOTIVOS, PATRON_MOTIVOS],
      );
      const motivos: Record<string, unknown>[] = [];
      let leidas = 0;
      for (const col of colsMotivo) {
        const t = String(col.t);
        const c = String(col.c);
        const nombreMotivo = new RegExp(PATRON_MOTIVOS, 'i').test(c);
        const opcionFija =
          ['tinyint', 'smallint', 'int', 'enum'].includes(String(col.tipo)) ||
          (['varchar', 'char'].includes(String(col.tipo)) && Number(col.largo) <= 60);
        const fila: Record<string, unknown> = { tabla: t, columna: c, tipo: col.tipo, largo: col.largo, filas_tabla: col.filas };
        if (nombreMotivo && opcionFija && leidas < 15 && /^[A-Za-z0-9_]+$/.test(t) && /^[A-Za-z0-9_]+$/.test(c)) {
          leidas++;
          const [valores] = await conn.query<RowDataPacket[]>(
            `SELECT \`${c}\` AS valor, COUNT(*) AS n FROM \`${t}\` GROUP BY \`${c}\` ORDER BY n DESC LIMIT 20`,
          );
          fila.valores = valores;
        }
        motivos.push(fila);
      }
      // Tablas chicas que se llaman como motivos (catálogos tipo id → texto):
      // se leen enteras, porque son la lista de opciones y no tienen a nadie.
      const catalogos: Record<string, unknown> = {};
      const tablasMotivo = [...new Set(colsMotivo.filter((x) => new RegExp(PATRON_MOTIVOS, 'i').test(String(x.t))).map((x) => String(x.t)))];
      for (const t of tablasMotivo.slice(0, 10)) {
        const filas = Number(colsMotivo.find((x) => String(x.t) === t)?.filas ?? 0);
        if (filas > 100 || !/^[A-Za-z0-9_]+$/.test(t)) continue;
        const [rows] = await conn.query<RowDataPacket[]>(`SELECT * FROM \`${t}\` LIMIT 100`);
        catalogos[t] = rows;
      }
      return { esquema, rating, motivos, catalogos };
    });

    console.log('[talent/esquema]', email);
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[talent/esquema] falló', e);
    return errorJson(e instanceof Error ? e.message : 'error desconocido', 500);
  }
}
