import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Nombres de los pacientes de la bandeja de Alertas.
 *
 * `alertas_vivo` guarda solo el número de paciente de la plataforma, para no
 * tener una segunda copia de datos personales en Supabase. El nombre se lee
 * acá, en el momento, de MySQL.
 *
 * Dos candados: el usuario tiene que estar logueado en el dashboard, y solo
 * se devuelven nombres de pacientes que tienen una alerta. Así este endpoint
 * no sirve para pedir el nombre de cualquier paciente de la plataforma.
 */
const MAX_IDS = 3000;
const TANDA_SUPABASE = 300;

export async function POST(request: Request) {
  const jwt = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!jwt) return NextResponse.json({ error: 'No autenticado' }, { status: 401 });

  let ids: number[];
  try {
    const body = await request.json();
    ids = Array.isArray(body?.ids) ? body.ids : [];
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }
  ids = [...new Set(ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, MAX_IDS);
  if (ids.length === 0) return NextResponse.json({ nombres: {} });

  // Cliente con el JWT del usuario: verifica la sesión y lee alertas_vivo con
  // su RLS, igual que la pantalla.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false },
  });
  const { data: userData, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !userData?.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });

  const conAlerta = new Set<number>();
  for (let i = 0; i < ids.length; i += TANDA_SUPABASE) {
    const { data, error } = await sb
      .from('alertas_vivo')
      .select('paciente_id')
      .in('paciente_id', ids.slice(i, i + TANDA_SUPABASE));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) conAlerta.add(Number(r.paciente_id));
  }
  const pedidos = ids.filter((id) => conAlerta.has(id));
  if (pedidos.length === 0) return NextResponse.json({ nombres: {} });

  try {
    const nombres = await withMysql(async (conn) => {
      // El esquema de `pacientes` no está documentado: el apellido puede no
      // existir o llamarse distinto. Se pregunta antes para no romper la
      // consulta si no está.
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
        [pedidos],
      );
      const out: Record<string, string> = {};
      for (const r of rows) {
        const completo = [r.nombre, r.apellido].map((s) => (s == null ? '' : String(s).trim())).filter(Boolean).join(' ');
        if (completo) out[String(r.id)] = completo;
      }
      return out;
    });
    return NextResponse.json({ nombres });
  } catch (e) {
    console.error('[en-vivo/pacientes] falló', e);
    return NextResponse.json({ error: e instanceof Error ? e.message : 'error desconocido' }, { status: 500 });
  }
}
