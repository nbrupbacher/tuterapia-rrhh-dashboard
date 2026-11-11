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
 * Nombres y fechas; filas solo del paciente de prueba:
 * - ?parte=recientes&min=N: tablas modificadas en los últimos N minutos (se
 *   corre justo después de desactivar un paciente de prueba).
 * - ?parte=columnas: columnas cuyo nombre suena a motivo / baja / inactivo.
 * - ?parte=paciente&q=Nombre Apellido: para UN paciente de prueba que Talent
 *   desactivó a propósito: su id, si tiene respuestas en encuesta_motivos,
 *   sus últimas filas de pacientes_log y terapeutas_log (textos largos
 *   cortados), si su login está activo, y qué acciones registran los dos logs
 *   en el último mes (solo conteos).
 * - ?parte=tablas: todas las tablas con sus columnas (solo nombres) y filas
 *   aproximadas. El activo/inactivo es del listado de cada psicólogo/a, no del
 *   paciente: hay que encontrar dónde lo guarda.
 *
 * - ?parte=cruce_b&tid=N&mes=AAAA-MM: pacientes que tuvieron la 1ª sesión
 *   realizada con ese psicólogo/a en ese mes (hora de Argentina), y para cada
 *   uno todas sus sesiones posteriores (con cualquier psicólogo/a), si están
 *   realizadas o canceladas, y a quién está asignado hoy. Para entender por
 *   qué la caída de 1ª sesión de la matriz no coincide con la regla B.
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
      // Sin esto MySQL 8 devuelve UPDATE_TIME cacheado (hasta 24 h viejo).
      await conn.query('SET SESSION information_schema_stats_expiry = 0').catch(() => undefined);
      if (parte === 'paciente') {
        const q = (url.searchParams.get('q') ?? '').trim();
        const [nombre, ...resto] = q.split(/\s+/);
        if (!nombre || !resto.length) return { error: 'Falta q=Nombre Apellido' };
        const [colsPac] = await conn.query<RowDataPacket[]>(
          `SELECT TABLE_NAME AS tabla, COLUMN_NAME AS columna, DATA_TYPE AS tipo
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND (TABLE_NAME LIKE '%paciente%' OR TABLE_NAME LIKE '%\\_log' OR TABLE_NAME LIKE '%relacion%' OR TABLE_NAME LIKE '%vinculo%')
            ORDER BY TABLE_NAME, ORDINAL_POSITION`,
        );
        const apellidoCol = colsPac.find((c) => c.tabla === 'pacientes' && ['apellido', 'apellidos'].includes(String(c.columna)))?.columna;
        const [pacs] = await conn.query<RowDataPacket[]>(
          `SELECT id_login AS id FROM pacientes
            WHERE nombre LIKE ? ${apellidoCol ? `AND ${apellidoCol} LIKE ?` : ''}
            LIMIT 5`,
          apellidoCol ? [`%${nombre}%`, `%${resto.join(' ')}%`] : [`%${nombre}%`],
        );
        const ids = pacs.map((p) => Number(p.id));
        let encuesta: RowDataPacket[] = [];
        let log: Record<string, unknown>[] = [];
        let logTer: Record<string, unknown>[] = [];
        let logins: RowDataPacket[] = [];
        const cortar = (filas: RowDataPacket[]) =>
          filas.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}…` : v])));
        if (ids.length) {
          [encuesta] = await conn.query<RowDataPacket[]>(
            `SELECT idEncuestaMotivo AS id, tipo, accion, motivo, motivoTitulo AS titulo, fecha, JSON_KEYS(data) AS claves
               FROM encuesta_motivos
              WHERE JSON_VALID(data) AND CAST(JSON_UNQUOTE(JSON_EXTRACT(data, '$.idPaciente')) AS UNSIGNED) IN (?)
              ORDER BY fecha DESC LIMIT 20`,
            [ids],
          );
          const colsLog = colsPac.filter((c) => c.tabla === 'pacientes_log').map((c) => String(c.columna));
          const colId = ['id_paciente', 'idPaciente', 'id_login', 'idLogin', 'paciente_id'].find((c) => colsLog.includes(c));
          const colOrden = ['fecha', 'created_at', 'fechaAlta', 'id'].find((c) => colsLog.includes(c));
          if (colId) {
            const [filasLog] = await conn.query<RowDataPacket[]>(
              `SELECT * FROM pacientes_log WHERE ${colId} IN (?) ${colOrden ? `ORDER BY ${colOrden} DESC` : ''} LIMIT 10`,
              [ids],
            );
            log = cortar(filasLog);
          }
          const [filasTer] = await conn.query<RowDataPacket[]>(
            `SELECT * FROM terapeutas_log WHERE idPaciente IN (?) ORDER BY fecha DESC LIMIT 15`,
            [ids],
          );
          logTer = cortar(filasTer);
          [logins] = await conn.query<RowDataPacket[]>(`SELECT id, tipo, active FROM login WHERE id IN (?)`, [ids]);
        }
        const [acciones] = await conn.query<RowDataPacket[]>(
          `SELECT 'terapeutas_log' AS tabla, accion, COUNT(*) AS n, MAX(fecha) AS ultima
             FROM terapeutas_log WHERE fecha >= UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY accion
           UNION ALL
           SELECT 'pacientes_log', accion, COUNT(*), MAX(fecha)
             FROM pacientes_log WHERE fecha >= UTC_TIMESTAMP() - INTERVAL 30 DAY GROUP BY accion
           ORDER BY tabla, n DESC`,
        );
        return { ids, logins, encuesta, pacientes_log: log, terapeutas_log: logTer, acciones };
      }
      if (parte === 'cruce_b') {
        const tid = Number(url.searchParams.get('tid'));
        const mes = url.searchParams.get('mes') ?? '';
        if (!Number.isInteger(tid) || tid <= 0 || !/^\d{4}-\d{2}$/.test(mes)) return { error: 'Falta tid=N y mes=AAAA-MM' };
        const [a, m] = mes.split('-').map(Number);
        const sig = m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, '0')}`;
        // Mes en hora de Argentina (UTC-3); en la base las sesiones están en UTC.
        const desde = `${mes}-01 03:00:00`;
        const hasta = `${sig}-01 03:00:00`;
        const [prim] = await conn.query<RowDataPacket[]>(
          `SELECT s.id_paciente AS pid, MIN(s.fecha) AS primera
             FROM sesiones s
            WHERE s.realizada = 1 AND s.id_terapeuta = ?
            GROUP BY s.id_paciente
           HAVING primera >= ? AND primera < ?
            ORDER BY primera`,
          [tid, desde, hasta],
        );
        const ids = prim.map((p) => Number(p.pid));
        if (!ids.length) return { tid, mes, pacientes: [] };
        const [pacs] = await conn.query<RowDataPacket[]>(
          `SELECT id_login AS pid, nombre, id_terapeuta AS asignado FROM pacientes WHERE id_login IN (?)`,
          [ids],
        );
        const [ses] = await conn.query<RowDataPacket[]>(
          `SELECT s.id, s.id_paciente AS pid, s.id_terapeuta AS tid, s.fecha, s.realizada,
                  (c.idSesion IS NOT NULL) AS cancelada
             FROM sesiones s
             LEFT JOIN (
               SELECT idSesion FROM terapeutas_log WHERE accion = 2 AND idSesion IS NOT NULL
               UNION
               SELECT idSesion FROM pacientes_log WHERE accion = 2 AND idSesion IS NOT NULL
             ) c ON c.idSesion = s.id
            WHERE s.id_paciente IN (?) AND s.fecha >= ?
            ORDER BY s.id_paciente, s.fecha`,
          [ids, desde],
        );
        const pacientes = prim.map((p) => {
          const pid = Number(p.pid);
          const info = pacs.find((x) => Number(x.pid) === pid);
          return {
            pid,
            nombre: info?.nombre ?? null,
            asignado_hoy: info ? Number(info.asignado) : null,
            primera: p.primera,
            despues: ses
              .filter((x) => Number(x.pid) === pid && String(x.fecha) > String(p.primera))
              .map((x) => ({ fecha: x.fecha, tid: Number(x.tid), realizada: Number(x.realizada), cancelada: Number(x.cancelada) })),
          };
        });
        const [[reloj]] = await conn.query<RowDataPacket[]>(`SELECT UTC_TIMESTAMP() AS ahora_utc`);
        return { tid, mes, ahora_utc: reloj?.ahora_utc ?? null, pacientes };
      }
      if (parte === 'tablas') {
        const [filas] = await conn.query<RowDataPacket[]>(
          `SELECT t.TABLE_NAME AS tabla, t.TABLE_ROWS AS filas,
                  GROUP_CONCAT(c.COLUMN_NAME ORDER BY c.ORDINAL_POSITION SEPARATOR ',') AS columnas
             FROM information_schema.TABLES t
             JOIN information_schema.COLUMNS c ON c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME
            WHERE t.TABLE_SCHEMA = DATABASE()
            GROUP BY t.TABLE_NAME, t.TABLE_ROWS
            ORDER BY t.TABLE_NAME`,
        );
        return { tablas: filas };
      }
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
