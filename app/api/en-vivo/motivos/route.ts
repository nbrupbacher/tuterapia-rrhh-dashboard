import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';
import { autenticarScript } from '@/lib/google-script-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Motivos que cargan los psicólogos/as en la plataforma sobre sus pacientes
 * (tabla `encuesta_motivos`): por qué se canceló una sesión o por qué un
 * paciente quedó inactivo. Base de los botones Cancelaciones / Pacientes
 * inactivos de En vivo.
 *
 * Cancelación o inactividad: las de cancelar o mover una sesión traen la
 * sesión en `data` (idSesion); la de "Motivo de inactividad" (cuando el
 * psicólogo/a pasa al paciente a inactivos) no. Al 2026-11-09 todas las
 * respuestas eran de sesiones: la encuesta empezó el 2026-11-05.
 *
 * Dos usos:
 * - Dashboard (sesión del usuario): el resumen y las respuestas de los
 *   últimos DIAS días, con el texto de "otro motivo".
 * - Apps Script de Talent (ver lib/google-script-auth): SOLO el resumen
 *   (opciones y cuántas veces se eligió cada una, y qué claves trae `data`).
 *   Sirve para entender la tabla sin leer lo que escribió nadie.
 */

const DIAS = 365;

function admin() {
  // Adentro del handler: CI compila sin la service key.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

/** 'usuario' (dashboard), 'script' (solo resumen) o la respuesta de error. */
async function quienLlama(request: Request): Promise<'usuario' | 'script' | NextResponse> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { data } = await sb.auth.getUser(token);
  if (data?.user) return 'usuario';
  const email = await autenticarScript(request, admin());
  return typeof email === 'string' ? 'script' : email;
}

export async function GET(request: Request) {
  const quien = await quienLlama(request);
  if (quien instanceof NextResponse) return quien;

  try {
    const resultado = await withMysql(async (conn) => {
      const [opciones] = await conn.query<RowDataPacket[]>(
        `SELECT e.tipo, e.accion, e.motivo, e.motivoTitulo AS titulo, COUNT(*) AS n,
                SUM(CHAR_LENGTH(TRIM(COALESCE(e.otroMotivoTxt, ''))) > 0) AS con_texto,
                SUM(l.tipo = 2) AS cargado_por_psicologo,
                SUM(l.tipo = 1) AS cargado_por_paciente,
                MIN(e.fecha) AS primera, MAX(e.fecha) AS ultima
           FROM encuesta_motivos e
           LEFT JOIN login l ON l.id = e.idLogin
          GROUP BY e.tipo, e.accion, e.motivo, e.motivoTitulo
          ORDER BY e.tipo, e.accion, n DESC`,
      );
      // Solo los nombres de las claves del JSON, no los valores.
      const [claves] = await conn.query<RowDataPacket[]>(
        `SELECT tipo, accion, JSON_KEYS(data) AS claves, COUNT(*) AS n
           FROM encuesta_motivos
          WHERE JSON_VALID(data)
          GROUP BY tipo, accion, claves
          ORDER BY n DESC
          LIMIT 30`,
      );
      const resumen = { opciones, claves_data: claves };
      if (quien === 'script') return { resumen };

      const [filas] = await conn.query<RowDataPacket[]>(
        `SELECT e.idEncuestaMotivo AS id, e.idLogin AS login_id, l.tipo AS tipo_login, l.paisDominio AS pais,
                e.tipo, e.accion, e.motivo, e.motivoTitulo AS titulo, e.otroMotivoTxt AS texto,
                CASE WHEN JSON_VALID(e.data) THEN JSON_UNQUOTE(JSON_EXTRACT(e.data, '$.idPaciente')) END AS paciente_id,
                CASE WHEN JSON_VALID(e.data) THEN JSON_UNQUOTE(JSON_EXTRACT(e.data, '$.idSesion')) END AS sesion_id,
                CASE WHEN JSON_VALID(e.data) THEN JSON_UNQUOTE(JSON_EXTRACT(e.data, '$.fecha')) END AS sesion_fecha,
                CASE WHEN JSON_VALID(e.data) THEN JSON_UNQUOTE(JSON_EXTRACT(e.data, '$.horaIni')) END AS sesion_hora,
                e.fecha
           FROM encuesta_motivos e
           LEFT JOIN login l ON l.id = e.idLogin
          WHERE e.fecha >= UTC_TIMESTAMP() - INTERVAL ${DIAS} DAY
          ORDER BY e.fecha DESC`,
      );
      // Nombres de los pacientes de las respuestas (como en Alertas y Reseñas):
      // se leen en el momento y no se guardan.
      const nombres: Record<string, string> = {};
      const idsPac = [...new Set(filas.map((f) => Number(f.paciente_id)).filter((n) => Number.isInteger(n) && n > 0))];
      if (idsPac.length) {
        const [cols] = await conn.query<RowDataPacket[]>(
          `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pacientes'
              AND COLUMN_NAME IN ('apellido', 'apellidos')`,
        );
        const apellido = cols[0]?.c ? String(cols[0].c) : null;
        const [rows] = await conn.query<RowDataPacket[]>(
          `SELECT id_login AS id, nombre${apellido ? `, ${apellido} AS apellido` : ''}
             FROM pacientes
            WHERE id_login IN (?)`,
          [idsPac],
        );
        for (const r of rows) {
          const completo = [r.nombre, r.apellido].map((x) => (x == null ? '' : String(x).trim())).filter(Boolean).join(' ');
          if (completo) nombres[String(r.id)] = completo;
        }
      }

      return {
        resumen,
        filas: filas.map((f) => ({
          id: Number(f.id),
          login_id: String(f.login_id),
          tipo_login: f.tipo_login == null ? null : Number(f.tipo_login),
          pais: f.pais ?? null,
          tipo: f.tipo == null ? null : Number(f.tipo),
          accion: f.accion == null ? null : Number(f.accion),
          motivo: f.motivo ?? '',
          titulo: f.titulo ?? '',
          texto: f.texto ? String(f.texto).trim() : '',
          clase: f.sesion_id && f.sesion_id !== 'null' ? 'cancelacion' : 'inactividad',
          paciente_id: f.paciente_id && f.paciente_id !== 'null' ? String(f.paciente_id) : null,
          paciente: f.paciente_id ? nombres[String(f.paciente_id)] ?? '' : '',
          sesion_fecha: f.sesion_fecha && f.sesion_fecha !== 'null' ? String(f.sesion_fecha) : null,
          sesion_hora: f.sesion_hora && f.sesion_hora !== 'null' ? String(f.sesion_hora) : null,
          fecha: f.fecha,
        })),
      };
    });
    return NextResponse.json(resultado);
  } catch (e) {
    console.error('[en-vivo/motivos] falló', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error desconocido' }, { status: 500 });
  }
}
