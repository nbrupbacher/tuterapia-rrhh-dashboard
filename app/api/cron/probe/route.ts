import { NextResponse } from 'next/server';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';
import { isCronAuthorized } from '@/lib/cron-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Sondeos temporales para escribir las consultas de "En vivo".
 *
 * El esquema (/api/cron/schema) mostró que `sesiones` solo tiene `realizada`
 * como estado, y que las cancelaciones y aprobaciones parecen vivir en otro
 * lado: `sesiones_log` (totales mensuales, de donde sale el CSV) y
 * `terapeutas_log` / `pacientes_log` (eventos con `accion` sin documentar).
 * Antes de elegir de dónde leer cada columna hay que ver qué valores toman.
 *
 * Solo agregados: conteos, mínimos y máximos de fechas. Nunca una columna
 * personal ni el contenido de `dataInfo`, que es texto libre. Borrar junto
 * con /api/cron/schema cuando las consultas estén validadas.
 *
 * `?only=a,b` corre solo esos sondeos.
 */
const DIAS = 90;

const PROBES: Record<string, string> = {
  // ¿Qué valores toma realizada? ¿Hay sesiones a futuro (agenda)? ¿Las
  // canceladas se borran o quedan con otro valor?
  sesiones_realizada: `
    SELECT realizada,
           COUNT(*) AS n,
           SUM(fecha > UTC_TIMESTAMP()) AS a_futuro,
           SUM(fecha <= UTC_TIMESTAMP()) AS pasadas,
           SUM(id_pago IS NULL) AS sin_pago,
           SUM(id_terapeuta IS NULL OR id_terapeuta = 0) AS sin_terapeuta,
           MIN(fecha) AS min_fecha, MAX(fecha) AS max_fecha
      FROM sesiones
     WHERE fecha >= UTC_TIMESTAMP() - INTERVAL ${DIAS} DAY
     GROUP BY realizada`,

  // ¿La agenda de los próximos 7 días tiene volumen razonable?
  sesiones_proximos_7: `
    SELECT realizada, COUNT(*) AS n, COUNT(DISTINCT id_terapeuta) AS terapeutas
      FROM sesiones
     WHERE fecha > UTC_TIMESTAMP() AND fecha <= UTC_TIMESTAMP() + INTERVAL 7 DAY
     GROUP BY realizada`,

  // ¿id_terapeuta apunta a login.id de tipo 2? Si no, el join con la Matrix
  // (therapists.id = login.id) no funciona.
  sesiones_terapeuta_es_login: `
    SELECT l.tipo, COUNT(*) AS n
      FROM sesiones s
      LEFT JOIN login l ON l.id = s.id_terapeuta
     WHERE s.fecha >= UTC_TIMESTAMP() - INTERVAL ${DIAS} DAY
     GROUP BY l.tipo`,

  // Códigos de acción de los terapeutas: buscamos cuál es "canceló",
  // "aprobó", "confirmó", "creó".
  terapeutas_log_acciones: `
    SELECT accion,
           COUNT(*) AS n,
           SUM(idSesion IS NOT NULL AND idSesion <> 0) AS con_sesion,
           SUM(idPaciente IS NOT NULL AND idPaciente <> 0) AS con_paciente,
           COUNT(DISTINCT idLogin) AS terapeutas,
           MIN(fecha) AS min_fecha, MAX(fecha) AS max_fecha
      FROM terapeutas_log
     WHERE fecha >= UTC_TIMESTAMP() - INTERVAL ${DIAS} DAY
     GROUP BY accion
     ORDER BY accion`,

  pacientes_log_acciones: `
    SELECT accion,
           COUNT(*) AS n,
           SUM(idSesion IS NOT NULL AND idSesion <> 0) AS con_sesion,
           SUM(idTerapeuta IS NOT NULL AND idTerapeuta <> 0) AS con_terapeuta,
           MIN(fecha) AS min_fecha, MAX(fecha) AS max_fecha
      FROM pacientes_log
     WHERE fecha >= UTC_TIMESTAMP() - INTERVAL ${DIAS} DAY
     GROUP BY accion
     ORDER BY accion`,

  // ¿El evento de log de una sesión cae el mismo día que la sesión, o el día
  // en que alguien tocó el botón? Define con qué fecha se dibuja la barra.
  terapeutas_log_vs_sesion: `
    SELECT t.accion,
           COUNT(*) AS n,
           SUM(DATE(t.fecha) = DATE(s.fecha)) AS mismo_dia,
           SUM(t.fecha < s.fecha) AS antes_de_la_sesion,
           SUM(s.id IS NULL) AS sesion_inexistente
      FROM terapeutas_log t
      LEFT JOIN sesiones s ON s.id = t.idSesion
     WHERE t.fecha >= UTC_TIMESTAMP() - INTERVAL 30 DAY
       AND t.idSesion IS NOT NULL AND t.idSesion <> 0
     GROUP BY t.accion
     ORDER BY t.accion`,

  // sesiones_log: ¿se actualiza durante el mes o solo al cierre? Si el mes en
  // curso ya tiene filas y modificacion es de hoy, sirve para el vivo.
  sesiones_log_meses: `
    SELECT reporte_yyyy, reporte_mes, tipoLogin,
           COUNT(*) AS filas,
           SUM(tot_creadas) AS creadas, SUM(tot_aprobadas) AS aprobadas,
           SUM(tot_confirmadas) AS confirmadas, SUM(tot_canceladas) AS canceladas,
           MAX(modificacion) AS ultima_modificacion
      FROM sesiones_log
     GROUP BY reporte_yyyy, reporte_mes, tipoLogin
     ORDER BY reporte_yyyy DESC, reporte_mes DESC, tipoLogin
     LIMIT 12`,

  // Lo mismo contado desde sesiones, para comparar con sesiones_log del mismo
  // mes y ver si "creadas" es lo mismo que filas en sesiones.
  sesiones_por_mes: `
    SELECT DATE_FORMAT(DATE_SUB(fecha, INTERVAL 3 HOUR), '%Y-%m') AS mes,
           COUNT(*) AS filas, SUM(realizada = 1) AS realizadas
      FROM sesiones
     WHERE fecha >= UTC_TIMESTAMP() - INTERVAL 120 DAY
     GROUP BY mes
     ORDER BY mes`,

  login_tipos: `
    SELECT tipo, active, COUNT(*) AS n
      FROM login
     GROUP BY tipo, active
     ORDER BY tipo, active`,

  // seleccionable / home: candidatos a "fantasmeado" (no aparece en el
  // matching). horas_disp: ¿está cargado?
  terapeutas_flags: `
    SELECT l.active, t.seleccionable, t.seleccionable_online, t.home,
           COUNT(*) AS n,
           SUM(t.horas_disp IS NOT NULL AND t.horas_disp > 0) AS con_horas
      FROM terapeutas t
      JOIN login l ON l.id = t.id_login
     GROUP BY l.active, t.seleccionable, t.seleccionable_online, t.home
     ORDER BY n DESC`,

  // Reseñas: escala, estados y si llegan al día.
  rating_estados: `
    SELECT rate, status, COUNT(*) AS n,
           SUM(comentario IS NOT NULL AND comentario <> '') AS con_comentario,
           MAX(modificacion) AS ultima
      FROM rating
     GROUP BY rate, status
     ORDER BY rate, status`,
};

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const only = new URL(request.url).searchParams.get('only');
  const nombres = only ? only.split(',').filter((n) => n in PROBES) : Object.keys(PROBES);

  try {
    const resultados = await withMysql(async (conn) => {
      const out: Record<string, unknown> = {};
      // Uno detrás del otro en la misma conexión: si uno falla, los demás
      // igual devuelven su resultado.
      for (const nombre of nombres) {
        const t0 = Date.now();
        try {
          const [rows] = await conn.query<RowDataPacket[]>(PROBES[nombre]);
          out[nombre] = { ms: Date.now() - t0, filas: rows };
        } catch (e) {
          out[nombre] = { ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) };
        }
      }
      return out;
    });

    return NextResponse.json({ ok: true, resultados });
  } catch (error) {
    console.error('[cron/probe] falló', error);
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'error desconocido' },
      { status: 500 },
    );
  }
}
