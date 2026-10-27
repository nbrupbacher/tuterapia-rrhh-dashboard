import type { Connection, RowDataPacket } from 'mysql2/promise';

/**
 * Lectura diaria de MySQL para la solapa En vivo.
 *
 * Todo se agrega del lado de MySQL y vuelve ya reducido: la función tiene 60
 * segundos y `sesiones` no tiene índices fuera de la clave primaria.
 *
 * Definiciones (acordadas con el dueño el 2026-10-27, medidas con
 * /api/cron/probe):
 *
 * - La base guarda UTC; el día del negocio es UTC−3. Los rangos se filtran en
 *   UTC corridos 3 horas y se agrupa por DATE(fecha − 3 h).
 * - Realizada: `sesiones.realizada = 1`. Coincide con el evento 4
 *   ("confirmó") de `terapeutas_log`, ~6.500 por mes en las dos fuentes.
 * - Agendada: `realizada = 0`, fecha futura y no cancelada.
 * - Sin confirmar: `realizada = 0`, fecha pasada y no cancelada. Son sesiones
 *   que el terapeuta todavía no marcó como dadas; no son no-shows.
 * - Cancelada: evento 2 de `terapeutas_log`, por la fecha del evento. Solo las
 *   del terapeuta, como el CSV mensual; las del paciente (evento 2 de
 *   `pacientes_log`) no suman en la barra. Va por el log y no por `sesiones`
 *   porque el 41% de las canceladas se borra de `sesiones`.
 * - Las canceladas que NO se borran siguen en `sesiones` con `realizada = 0`.
 *   Sin excluirlas, inflarían agendadas y sin confirmar; por eso el join
 *   contra los eventos de cancelación, del terapeuta y del paciente.
 * - Chile queda afuera en todo el proyecto: solo AR y UY.
 */

export const LOCAL_OFFSET_HOURS = 3;
const DIAS_PROXIMOS = 7;
// Una sesión se cancela antes de su fecha, a veces con semanas de
// anticipación. Se miran eventos desde bastante antes de la ventana.
const DIAS_EVENTOS_CANCELACION = 120;

export type FilaDiario = {
  therapist_id: string;
  dia: string;
  realizadas: number;
  agendadas: number;
  sin_confirmar: number;
  canceladas: number;
};

export type FilaTerapeuta = {
  therapist_id: string;
  pais: string;
  pacientes_activos: number;
  registros_mes: number;
  registros_con_1ra: number;
  agendadas_7d: number;
  ultima_sesion: string | null;
  horas_disp: number | null;
};

export type Ventana = {
  /** Primer día del mes anterior, local. */
  desde: string;
  /** Hoy + 7 días, local. */
  hasta: string;
  /** Primer día del mes en curso, local. */
  inicioMes: string;
};

/** 'YYYY-MM-DD' del día local (UTC−3) de un instante. */
export function diaLocal(d: Date): string {
  return new Date(d.getTime() - LOCAL_OFFSET_HOURS * 3_600_000).toISOString().slice(0, 10);
}

export function calcularVentana(ahora = new Date()): Ventana {
  const hoy = diaLocal(ahora);
  const [y, m] = hoy.split('-').map(Number);
  const inicioMes = `${y}-${String(m).padStart(2, '0')}-01`;
  const prev = new Date(Date.UTC(y, m - 2, 1));
  const desde = prev.toISOString().slice(0, 10);
  const fin = new Date(Date.UTC(y, m - 1, Number(hoy.slice(8, 10)) + DIAS_PROXIMOS));
  const hasta = fin.toISOString().slice(0, 10);
  return { desde, hasta, inicioMes };
}

/** Inicio UTC (como datetime de MySQL) del día local `dia`. */
function inicioUtc(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, LOCAL_OFFSET_HOURS)).toISOString().slice(0, 19).replace('T', ' ');
}

/** Inicio UTC del día local siguiente a `dia`: fin abierto de un rango. */
function finUtc(dia: string): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1, LOCAL_OFFSET_HOURS)).toISOString().slice(0, 19).replace('T', ' ');
}

/** Primer día local del mes siguiente al de `inicioMes`. */
function inicioMesSiguiente(inicioMes: string): string {
  const [y, m] = inicioMes.split('-').map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
}

const DIA_LOCAL = (col: string) =>
  `DATE_FORMAT(DATE_SUB(${col}, INTERVAL ${LOCAL_OFFSET_HOURS} HOUR), '%Y-%m-%d')`;

/** Sesiones canceladas, por quien sea, para excluirlas de agendadas y sin confirmar. */
const CANCELADAS = `
  SELECT idSesion FROM terapeutas_log
   WHERE accion = 2 AND idSesion IS NOT NULL AND fecha >= ? - INTERVAL ${DIAS_EVENTOS_CANCELACION} DAY
  UNION
  SELECT idSesion FROM pacientes_log
   WHERE accion = 2 AND idSesion IS NOT NULL AND fecha >= ? - INTERVAL ${DIAS_EVENTOS_CANCELACION} DAY`;

const TERAPEUTA_AR_UY = `l.tipo = 2 AND l.paisDominio IN ('AR', 'UY')`;

export async function leerEnVivo(
  conn: Connection,
  ventana: Ventana,
): Promise<{ diario: FilaDiario[]; terapeutas: FilaTerapeuta[] }> {
  const desdeUtc = inicioUtc(ventana.desde);
  const hastaUtc = finUtc(ventana.hasta);
  const mesUtc = inicioUtc(ventana.inicioMes);
  const mesFinUtc = inicioUtc(inicioMesSiguiente(ventana.inicioMes));

  // 1. Sesiones por terapeuta y día.
  const [sesiones] = await conn.query<RowDataPacket[]>(
    `SELECT s.id_terapeuta AS tid,
            ${DIA_LOCAL('s.fecha')} AS dia,
            SUM(s.realizada = 1) AS realizadas,
            SUM(s.realizada <> 1 AND c.idSesion IS NULL AND s.fecha >  UTC_TIMESTAMP()) AS agendadas,
            SUM(s.realizada <> 1 AND c.idSesion IS NULL AND s.fecha <= UTC_TIMESTAMP()) AS sin_confirmar
       FROM sesiones s
       JOIN login l ON l.id = s.id_terapeuta AND ${TERAPEUTA_AR_UY}
       LEFT JOIN (${CANCELADAS}) c ON c.idSesion = s.id
      WHERE s.fecha >= ? AND s.fecha < ?
      GROUP BY tid, dia`,
    [desdeUtc, desdeUtc, desdeUtc, hastaUtc],
  );

  // 2. Cancelaciones del terapeuta, por el día en que canceló.
  const [cancelaciones] = await conn.query<RowDataPacket[]>(
    `SELECT t.idLogin AS tid,
            ${DIA_LOCAL('t.fecha')} AS dia,
            COUNT(*) AS canceladas
       FROM terapeutas_log t
       JOIN login l ON l.id = t.idLogin AND ${TERAPEUTA_AR_UY}
      WHERE t.accion = 2 AND t.fecha >= ? AND t.fecha < ?
      GROUP BY tid, dia`,
    [desdeUtc, hastaUtc],
  );

  // 3. Terapeutas activos, con horas por semana.
  const [base] = await conn.query<RowDataPacket[]>(
    `SELECT l.id AS tid, l.paisDominio AS pais, t.horas_disp
       FROM login l
       JOIN terapeutas t ON t.id_login = l.id
      WHERE ${TERAPEUTA_AR_UY} AND l.active = 1`,
  );

  // 4. Pacientes activos del mes y agenda de los próximos 7 días.
  const [mes] = await conn.query<RowDataPacket[]>(
    `SELECT s.id_terapeuta AS tid,
            COUNT(DISTINCT CASE WHEN s.realizada = 1 AND s.fecha >= ? AND s.fecha < ? THEN s.id_paciente END) AS activos,
            SUM(s.realizada <> 1 AND c.idSesion IS NULL
                AND s.fecha > UTC_TIMESTAMP()
                AND s.fecha <= UTC_TIMESTAMP() + INTERVAL ${DIAS_PROXIMOS} DAY) AS agendadas_7d
       FROM sesiones s
       LEFT JOIN (${CANCELADAS}) c ON c.idSesion = s.id
      WHERE s.fecha >= ?
      GROUP BY tid`,
    [mesUtc, mesFinUtc, mesUtc, mesUtc, mesUtc],
  );

  // 5. Última sesión realizada, sin límite de fecha: un terapeuta que no
  //    atiende hace tres meses es justo el que hay que ver.
  const [ultima] = await conn.query<RowDataPacket[]>(
    `SELECT id_terapeuta AS tid, MAX(fecha) AS ultima
       FROM sesiones
      WHERE realizada = 1
      GROUP BY id_terapeuta`,
  );

  // 6. Registros del mes asignados a cada terapeuta y cuántos ya tuvieron una
  //    sesión realizada con él. `pacientes.id_terapeuta` no tiene fecha: es la
  //    asignación de hoy, así que el número madura a lo largo del mes.
  //    La sesión se busca desde el inicio del mes porque un registro del mes
  //    no puede haber tenido sesión antes de registrarse.
  const [registros] = await conn.query<RowDataPacket[]>(
    `SELECT p.id_terapeuta AS tid,
            COUNT(*) AS registros,
            COUNT(r.id_paciente) AS con_1ra
       FROM pacientes p
       JOIN login lp ON lp.id = p.id_login AND lp.tipo = 1
       LEFT JOIN (
         SELECT DISTINCT id_paciente, id_terapeuta
           FROM sesiones
          WHERE realizada = 1 AND fecha >= ?
       ) r ON r.id_paciente = p.id_login AND r.id_terapeuta = p.id_terapeuta
      WHERE lp.creacion >= ? AND lp.creacion < ?
        AND p.id_terapeuta IS NOT NULL AND p.id_terapeuta <> 0
      GROUP BY p.id_terapeuta`,
    [mesUtc, mesUtc, mesFinUtc],
  );

  // Armado del diario: una fila por (terapeuta, día) con algo distinto de cero.
  const diario = new Map<string, FilaDiario>();
  const fila = (tid: unknown, dia: unknown): FilaDiario => {
    const key = `${tid}|${dia}`;
    let f = diario.get(key);
    if (!f) {
      f = { therapist_id: String(tid), dia: String(dia), realizadas: 0, agendadas: 0, sin_confirmar: 0, canceladas: 0 };
      diario.set(key, f);
    }
    return f;
  };
  for (const r of sesiones) {
    const f = fila(r.tid, r.dia);
    f.realizadas += Number(r.realizadas);
    f.agendadas += Number(r.agendadas);
    f.sin_confirmar += Number(r.sin_confirmar);
  }
  for (const r of cancelaciones) {
    fila(r.tid, r.dia).canceladas += Number(r.canceladas);
  }

  const porTid = <T>(rows: RowDataPacket[], pick: (r: RowDataPacket) => T) =>
    new Map(rows.map((r) => [String(r.tid), pick(r)]));
  const mesPor = porTid(mes, (r) => ({ activos: Number(r.activos), agendadas7: Number(r.agendadas_7d) }));
  const ultimaPor = porTid(ultima, (r) => (r.ultima ? String(r.ultima) : null));
  const regPor = porTid(registros, (r) => ({ registros: Number(r.registros), con1ra: Number(r.con_1ra) }));

  const terapeutas: FilaTerapeuta[] = base.map((b) => {
    const tid = String(b.tid);
    const m = mesPor.get(tid);
    const reg = regPor.get(tid);
    const u = ultimaPor.get(tid) ?? null;
    return {
      therapist_id: tid,
      pais: String(b.pais),
      pacientes_activos: m?.activos ?? 0,
      registros_mes: reg?.registros ?? 0,
      registros_con_1ra: reg?.con1ra ?? 0,
      agendadas_7d: m?.agendadas7 ?? 0,
      // MySQL devuelve 'YYYY-MM-DD HH:MM:SS' en UTC (dateStrings: true).
      ultima_sesion: u ? `${u.replace(' ', 'T')}Z` : null,
      horas_disp: b.horas_disp == null ? null : Number(b.horas_disp),
    };
  });

  const filasDiario = [...diario.values()].filter(
    (f) => f.realizadas + f.agendadas + f.sin_confirmar + f.canceladas > 0,
  );

  return { diario: filasDiario, terapeutas };
}
