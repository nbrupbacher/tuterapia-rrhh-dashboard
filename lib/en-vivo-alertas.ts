import type { Connection, RowDataPacket } from 'mysql2/promise';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Alertas de rescate de pacientes para la bandeja de En vivo.
 *
 * - Regla A: el paciente se registró hace entre 48 h y 30 días, tiene
 *   terapeuta asignado y no tiene ninguna sesión no cancelada con él. El reloj
 *   es `login.creacion` (no hay fecha de asignación): un paciente reasignado
 *   arranca con el reloj adelantado, y Talent lo aceptó así.
 * - Regla B: tuvo la primera sesión realizada con su terapeuta actual hace
 *   entre 5 y 35 días y no tiene ninguna sesión no cancelada después de esa,
 *   ni pasada ni agendada. La primera se busca en toda la historia del par,
 *   para no tomar como nuevo a alguien que vuelve después de meses.
 *
 * Mismas definiciones de cancelada que lib/en-vivo-sync.ts. Del paciente sale
 * solo `login.id`: el nombre se lee en vivo al abrir la bandeja, para no
 * copiar datos personales a Supabase.
 *
 * Cada corrida hace upsert por (regla, terapeuta, paciente, fecha de
 * referencia) y solo toca `vista_ultima`: el estado que puso el equipo no se
 * pisa. Lo que deja de aparecer queda con `vista_ultima` vieja, que en la
 * bandeja es "se resolvió sola".
 */

const CANCELADAS = `
  SELECT idSesion FROM terapeutas_log
   WHERE accion = 2 AND idSesion IS NOT NULL AND fecha >= UTC_TIMESTAMP() - INTERVAL 150 DAY
  UNION
  SELECT idSesion FROM pacientes_log
   WHERE accion = 2 AND idSesion IS NOT NULL AND fecha >= UTC_TIMESTAMP() - INTERVAL 150 DAY`;

// Una sesión no puede ser anterior al registro: alcanza con mirar 30 días.
const REGLA_A = `
  SELECT p.id_terapeuta AS tid, p.id_login AS pid, lp.creacion AS ref
    FROM pacientes p
    JOIN login lp ON lp.id = p.id_login AND lp.tipo = 1
    JOIN login lt ON lt.id = p.id_terapeuta AND lt.tipo = 2 AND lt.paisDominio IN ('AR', 'UY')
    LEFT JOIN (
      SELECT DISTINCT s.id_paciente, s.id_terapeuta
        FROM sesiones s
        LEFT JOIN (${CANCELADAS}) c ON c.idSesion = s.id
       WHERE s.fecha >= UTC_TIMESTAMP() - INTERVAL 30 DAY AND c.idSesion IS NULL
    ) a ON a.id_paciente = p.id_login AND a.id_terapeuta = p.id_terapeuta
   WHERE lp.creacion >= UTC_TIMESTAMP() - INTERVAL 30 DAY
     AND lp.creacion <  UTC_TIMESTAMP() - INTERVAL 48 HOUR
     AND a.id_paciente IS NULL`;

const REGLA_B = `
  SELECT pr.id_terapeuta AS tid, pr.id_paciente AS pid, pr.primera AS ref
    FROM (
      SELECT id_paciente, id_terapeuta, MIN(fecha) AS primera
        FROM sesiones
       WHERE realizada = 1
       GROUP BY id_paciente, id_terapeuta
      HAVING primera >= UTC_TIMESTAMP() - INTERVAL 35 DAY
         AND primera <  UTC_TIMESTAMP() - INTERVAL 5 DAY
    ) pr
    JOIN pacientes p ON p.id_login = pr.id_paciente AND p.id_terapeuta = pr.id_terapeuta
    JOIN login lt ON lt.id = pr.id_terapeuta AND lt.tipo = 2 AND lt.paisDominio IN ('AR', 'UY')
    LEFT JOIN (
      SELECT s.id_paciente, s.id_terapeuta, MAX(s.fecha) AS ultima
        FROM sesiones s
        LEFT JOIN (${CANCELADAS}) c ON c.idSesion = s.id
       WHERE s.fecha >= UTC_TIMESTAMP() - INTERVAL 35 DAY AND c.idSesion IS NULL
       GROUP BY s.id_paciente, s.id_terapeuta
    ) u ON u.id_paciente = pr.id_paciente AND u.id_terapeuta = pr.id_terapeuta
   WHERE u.ultima IS NULL OR u.ultima <= pr.primera`;

export type FilaAlerta = {
  regla: 'A' | 'B';
  therapist_id: string;
  paciente_id: number;
  fecha_referencia: string;
  vista_ultima: string;
};

// MySQL devuelve 'YYYY-MM-DD HH:MM:SS' en UTC (dateStrings: true).
const isoUtc = (v: unknown) => `${String(v).replace(' ', 'T')}Z`;

export async function leerAlertas(conn: Connection, hoy: string): Promise<FilaAlerta[]> {
  // Por clave: si `pacientes` tuviera dos filas del mismo paciente, el upsert
  // fallaría al tocar la misma fila dos veces en una tanda.
  const filas = new Map<string, FilaAlerta>();
  for (const [regla, sql] of [['A', REGLA_A], ['B', REGLA_B]] as const) {
    const [rows] = await conn.query<RowDataPacket[]>(sql);
    for (const r of rows) {
      filas.set(`${regla}|${r.tid}|${r.pid}|${r.ref}`, {
        regla,
        therapist_id: String(r.tid),
        paciente_id: Number(r.pid),
        fecha_referencia: isoUtc(r.ref),
        vista_ultima: hoy,
      });
    }
  }
  return [...filas.values()];
}

/** Upsert en tandas; devuelve cuántas filas mandó. */
export async function guardarAlertas(sb: SupabaseClient, filas: FilaAlerta[]): Promise<number> {
  const TANDA = 500;
  for (let i = 0; i < filas.length; i += TANDA) {
    const { error } = await sb
      .from('alertas_vivo')
      .upsert(filas.slice(i, i + TANDA), { onConflict: 'regla,therapist_id,paciente_id,fecha_referencia' });
    if (error) throw new Error(`Supabase alertas: ${error.message}`);
  }
  return filas.length;
}
