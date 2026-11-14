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
 * - Regla C: tiene exactamente 4 sesiones realizadas con su terapeuta actual,
 *   la 4ª fue hace entre 14 y 45 días, y no tiene ninguna sesión no cancelada
 *   después. 14 y no 5 como la B: a esa altura muchos van cada 15 días.
 *
 * Mismas definiciones de cancelada que lib/en-vivo-sync.ts. Del paciente sale
 * solo `login.id`: el nombre se lee en vivo al abrir la bandeja, para no
 * copiar datos personales a Supabase.
 *
 * Cada corrida hace upsert por (regla, terapeuta, paciente, fecha de
 * referencia) y solo toca `vista_ultima`: el estado que puso el equipo no se
 * pisa. Lo que deja de aparecer queda con `vista_ultima` vieja, que en la
 * bandeja es "se resolvió sola".
 *
 * Después, `derivarAutomaticas` pasa a CX las B y C nuevas del día (ver abajo).
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

// "Exactamente 4" hace que la 4ª sea la última realizada: con 5 o más ya
// volvió. Las agendadas a futuro después de la 4ª las excluye el LEFT JOIN.
const REGLA_C = `
  SELECT r.id_terapeuta AS tid, r.id_paciente AS pid, r.cuarta AS ref
    FROM (
      SELECT id_paciente, id_terapeuta, COUNT(*) AS n, MAX(fecha) AS cuarta
        FROM sesiones
       WHERE realizada = 1
       GROUP BY id_paciente, id_terapeuta
      HAVING n = 4
         AND cuarta >= UTC_TIMESTAMP() - INTERVAL 45 DAY
         AND cuarta <  UTC_TIMESTAMP() - INTERVAL 14 DAY
    ) r
    JOIN pacientes p ON p.id_login = r.id_paciente AND p.id_terapeuta = r.id_terapeuta
    JOIN login lt ON lt.id = r.id_terapeuta AND lt.tipo = 2 AND lt.paisDominio IN ('AR', 'UY')
    LEFT JOIN (
      SELECT s.id_paciente, s.id_terapeuta, MAX(s.fecha) AS ultima
        FROM sesiones s
        LEFT JOIN (${CANCELADAS}) c ON c.idSesion = s.id
       WHERE s.fecha >= UTC_TIMESTAMP() - INTERVAL 45 DAY AND c.idSesion IS NULL
       GROUP BY s.id_paciente, s.id_terapeuta
    ) u ON u.id_paciente = r.id_paciente AND u.id_terapeuta = r.id_terapeuta
   WHERE u.ultima IS NULL OR u.ultima <= r.cuarta`;

export type FilaAlerta = {
  regla: 'A' | 'B' | 'C';
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
  for (const [regla, sql] of [['A', REGLA_A], ['B', REGLA_B], ['C', REGLA_C]] as const) {
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

/**
 * Upsert en tandas, separado por regla: si una regla falla (por ejemplo la C
 * antes de que la base la acepte), las otras se guardan igual. Devuelve
 * cuántas filas guardó por regla, o el error de esa regla.
 */
export async function guardarAlertas(
  sb: SupabaseClient,
  filas: FilaAlerta[],
): Promise<Record<string, number | string>> {
  const TANDA = 500;
  const out: Record<string, number | string> = {};
  for (const regla of ['A', 'B', 'C'] as const) {
    const propias = filas.filter((f) => f.regla === regla);
    out[regla] = propias.length;
    for (let i = 0; i < propias.length; i += TANDA) {
      const { error } = await sb
        .from('alertas_vivo')
        .upsert(propias.slice(i, i + TANDA), { onConflict: 'regla,therapist_id,paciente_id,fecha_referencia' });
      if (error) {
        out[regla] = `Supabase: ${error.message}`;
        break;
      }
    }
  }
  return out;
}

/**
 * Reglas que pasan solas a CX cada mañana (Talent, 2026-11-14). Antes Talent
 * tocaba "Derivar a CX" todos los días con las B y C nuevas; ahora lo hace el
 * cron y la planilla Rescate CX las toma en su próxima sincronización (cada
 * hora). La A no: Talent no la deriva.
 */
export const REGLAS_AUTO_CX = ['B', 'C'] as const;

/** Lo que queda en `estado_por` cuando deriva el cron y no una persona. */
export const DERIVADA_POR_CRON = 'automático (07:00)';

/**
 * Deriva a CX las alertas B y C abiertas que se detectaron hoy y siguen
 * vigentes. Solo las de hoy: una alerta vieja que sigue abierta es porque
 * alguien la dejó así o la volvió a pendiente, y eso no se pisa. Devuelve
 * cuántas derivó, o el error.
 */
export async function derivarAutomaticas(sb: SupabaseClient, hoy: string): Promise<number | string> {
  const ahora = new Date().toISOString();
  const { data, error } = await sb
    .from('alertas_vivo')
    .update({ estado: 'derivada_cx', estado_por: DERIVADA_POR_CRON, estado_at: ahora, updated_at: ahora })
    .in('regla', [...REGLAS_AUTO_CX])
    .eq('estado', 'abierta')
    .eq('detectada_el', hoy)
    .eq('vista_ultima', hoy)
    .select('id');
  if (error) return `Supabase: ${error.message}`;
  return data?.length ?? 0;
}
