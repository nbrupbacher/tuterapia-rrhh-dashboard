import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Solapa En vivo → Registros (Talent, 2026-11-17). Lee MySQL en el momento.
 *
 * Registros de un psicólogo/a = histórico total: los pacientes asignados hoy
 * (`pacientes.id_terapeuta`) más los que alguna vez tuvieron una sesión con
 * él/ella, aunque hoy estén con otro. `pacientes` no guarda las asignaciones
 * viejas, así que un paciente reasignado sin ninguna sesión no se cuenta.
 * Atendidos = registros con al menos una sesión realizada (dato informativo).
 *
 * Cada registro cae en una sola división (suman el total):
 * - sin_1ra: ninguna sesión realizada con él/ella.
 * - solo_1ra: exactamente una realizada (primera sin segunda).
 * - activo: 2 o más, y una realizada en los últimos 30 días o una agendada.
 * - dejo: 2 o más, sin realizada en 30 días ni agendada.
 *
 * Tasas "maduras", para no castigar al que recibió mucho hace poco:
 * - llegada: de los registros de hace más de 30 días, % con 1ra sesión.
 * - continuidad: de los que tuvieron la 1ra hace más de 35 días, % con 2da
 *   (las mismas ventanas que las reglas A y B de Alertas).
 *
 * Hitos: fecha en que llegó a 50 y a 100 REGISTROS (Talent, 2026-11-19: el
 * hito es de registros, no de pacientes atendidos). La fecha de cada registro
 * es su primer turno con él/ella (realizado o no) o, si no tuvo ninguno, la
 * fecha en que se registró el paciente.
 *
 * Con ?tid=ID devuelve además los pacientes de ese psicólogo/a con su nombre,
 * leído en el momento y no guardado en ningún lado (igual que Reseñas).
 */

const DIAS_ACTIVO = 30;
const DIAS_MADURO_REGISTRO = 30;
const DIAS_MADURO_PRIMERA = 35;
const HITOS = [50, 100] as const;

const CANCELADAS = `
  SELECT idSesion FROM terapeutas_log
   WHERE accion = 2 AND idSesion IS NOT NULL AND fecha >= UTC_TIMESTAMP() - INTERVAL 150 DAY
  UNION
  SELECT idSesion FROM pacientes_log
   WHERE accion = 2 AND idSesion IS NOT NULL AND fecha >= UTC_TIMESTAMP() - INTERVAL 150 DAY`;

type Division = 'sin_1ra' | 'solo_1ra' | 'activo' | 'dejo';

type Par = {
  tid: string;
  pid: number;
  pais: string;
  creacion: string | null;
  realizadas: number;
  primera: string | null;
  ultima: string | null;
  primer_turno: string | null;
  futuras: number;
};

// MySQL devuelve 'YYYY-MM-DD HH:MM:SS' en UTC (dateStrings: true).
const ms = (v: string | null) => (v ? Date.parse(`${v.replace(' ', 'T')}Z`) : NaN);

function division(p: Par, ahora: number): Division {
  if (p.realizadas === 0) return 'sin_1ra';
  if (p.realizadas === 1) return 'solo_1ra';
  const reciente = ahora - ms(p.ultima) <= DIAS_ACTIVO * 86_400_000;
  return reciente || p.futuras > 0 ? 'activo' : 'dejo';
}

/** Fecha en que el registro quedó con este psicólogo/a. */
function vinculo(p: Par, ahora: number): number {
  const t = ms(p.primer_turno);
  if (!Number.isNaN(t) && t <= ahora) return t;
  const c = ms(p.creacion);
  return Number.isNaN(c) ? ahora : c;
}

export async function GET(request: Request) {
  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data: userData, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !userData?.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });

  const tidParam = new URL(request.url).searchParams.get('tid');
  const tidDetalle = tidParam && /^\d+$/.test(tidParam) ? tidParam : null;

  try {
    const resultado = await withMysql(async (conn) => {
      // Un renglón por par psicólogo/a–paciente, ya agregado en MySQL.
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT x.tid, x.pid, lt.paisDominio AS pais, lp.creacion,
                COALESCE(a.realizadas, 0) AS realizadas, a.primera, a.ultima, a.primer_turno,
                COALESCE(a.futuras, 0) AS futuras
           FROM (
             SELECT id_terapeuta AS tid, id_login AS pid FROM pacientes WHERE id_terapeuta > 0
             UNION
             SELECT id_terapeuta, id_paciente FROM sesiones WHERE id_terapeuta > 0
           ) x
           JOIN login lt ON lt.id = x.tid AND lt.tipo = 2 AND lt.paisDominio IN ('AR', 'UY') AND lt.active = 1
           JOIN login lp ON lp.id = x.pid AND lp.tipo = 1
           LEFT JOIN (
             SELECT s.id_terapeuta, s.id_paciente,
                    SUM(s.realizada = 1) AS realizadas,
                    MIN(CASE WHEN s.realizada = 1 THEN s.fecha END) AS primera,
                    MAX(CASE WHEN s.realizada = 1 THEN s.fecha END) AS ultima,
                    MIN(s.fecha) AS primer_turno,
                    SUM(s.realizada <> 1 AND s.fecha > UTC_TIMESTAMP() AND c.idSesion IS NULL) AS futuras
               FROM sesiones s
               LEFT JOIN (${CANCELADAS}) c ON c.idSesion = s.id
              GROUP BY s.id_terapeuta, s.id_paciente
           ) a ON a.id_terapeuta = x.tid AND a.id_paciente = x.pid
          ${tidDetalle ? 'WHERE x.tid = ?' : ''}`,
        tidDetalle ? [tidDetalle] : [],
      );

      const ahora = Date.now();
      const pares: Par[] = rows.map((r) => ({
        tid: String(r.tid),
        pid: Number(r.pid),
        pais: String(r.pais),
        creacion: r.creacion ? String(r.creacion) : null,
        realizadas: Number(r.realizadas),
        primera: r.primera ? String(r.primera) : null,
        ultima: r.ultima ? String(r.ultima) : null,
        primer_turno: r.primer_turno ? String(r.primer_turno) : null,
        futuras: Number(r.futuras),
      }));

      const porTid = new Map<string, Par[]>();
      for (const p of pares) {
        const arr = porTid.get(p.tid);
        if (arr) arr.push(p);
        else porTid.set(p.tid, [p]);
      }

      // Promedio de la plataforma: todos los registros juntos.
      const prom = { reg_maduros: 0, llegaron: 0, primeras_maduras: 0, con_2da: 0 };
      const corteReg = ahora - DIAS_MADURO_REGISTRO * 86_400_000;
      const cortePrim = ahora - DIAS_MADURO_PRIMERA * 86_400_000;

      const psicologos = [...porTid.entries()].map(([tid, ps]) => {
        const div: Record<Division, number> = { sin_1ra: 0, solo_1ra: 0, activo: 0, dejo: 0 };
        let regMad = 0, lleg = 0, primMad = 0, con2 = 0, agendadosSin1ra = 0;
        for (const p of ps) {
          const d = division(p, ahora);
          div[d] += 1;
          if (d === 'sin_1ra' && p.futuras > 0) agendadosSin1ra += 1;
          if (vinculo(p, ahora) < corteReg) {
            regMad += 1;
            if (p.realizadas >= 1) lleg += 1;
          }
          if (p.primera && ms(p.primera) < cortePrim) {
            primMad += 1;
            if (p.realizadas >= 2) con2 += 1;
          }
        }
        prom.reg_maduros += regMad;
        prom.llegaron += lleg;
        prom.primeras_maduras += primMad;
        prom.con_2da += con2;

        // Hitos sobre registros: fecha del registro número 50 y 100.
        const fechas = ps.map((p) => vinculo(p, ahora)).sort((a, b) => a - b);
        const hitos: Record<string, string | null> = {};
        for (const h of HITOS) hitos[h] = fechas.length >= h ? new Date(fechas[h - 1]).toISOString() : null;

        return {
          therapist_id: tid,
          pais: ps[0].pais,
          registros: ps.length,
          atendidos: ps.length - div.sin_1ra,
          ...div,
          agendados_sin_1ra: agendadosSin1ra,
          registros_maduros: regMad,
          llegaron: lleg,
          primeras_maduras: primMad,
          con_2da: con2,
          hito_50: hitos[50],
          hito_100: hitos[100],
        };
      });

      let pacientes: unknown[] | undefined;
      if (tidDetalle) {
        const ps = porTid.get(tidDetalle) ?? [];
        const nombres: Record<string, string> = {};
        const ids = ps.map((p) => p.pid);
        if (ids.length) {
          const [cols] = await conn.query<RowDataPacket[]>(
            `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
              WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pacientes'
                AND COLUMN_NAME IN ('apellido', 'apellidos')`,
          );
          const apellido = cols[0]?.c ? String(cols[0].c) : null;
          const [nrows] = await conn.query<RowDataPacket[]>(
            `SELECT id_login AS id, nombre${apellido ? `, ${apellido} AS apellido` : ''}
               FROM pacientes WHERE id_login IN (?)`,
            [ids],
          );
          for (const r of nrows) {
            const completo = [r.nombre, r.apellido].map((s) => (s == null ? '' : String(s).trim())).filter(Boolean).join(' ');
            if (completo) nombres[String(r.id)] = completo;
          }
        }
        pacientes = ps
          .map((p) => ({
            paciente_id: p.pid,
            paciente: nombres[String(p.pid)] ?? '',
            division: division(p, ahora),
            realizadas: p.realizadas,
            agendada: p.futuras > 0,
            vinculo: new Date(vinculo(p, ahora)).toISOString(),
            primera: p.primera ? `${p.primera.replace(' ', 'T')}Z` : null,
            ultima: p.ultima ? `${p.ultima.replace(' ', 'T')}Z` : null,
          }))
          .sort((a, b) => b.vinculo.localeCompare(a.vinculo));
      }

      return {
        promedio: {
          llegada: prom.reg_maduros ? prom.llegaron / prom.reg_maduros : null,
          continuidad: prom.primeras_maduras ? prom.con_2da / prom.primeras_maduras : null,
        },
        psicologos: tidDetalle ? undefined : psicologos,
        psicologo: tidDetalle ? psicologos[0] ?? null : undefined,
        pacientes,
      };
    });
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[en-vivo/registros] falló', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error desconocido' }, { status: 500 });
  }
}
