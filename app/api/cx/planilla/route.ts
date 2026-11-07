import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { RowDataPacket } from 'mysql2/promise';
import { withMysql } from '@/lib/mysql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Puente con la planilla "Rescate CX" de Google Sheets.
 *
 * La planilla tiene un Apps Script que llama acá cada hora (o con el menú
 * "Tu Terapia → Sincronizar"):
 * - GET devuelve las alertas derivadas a CX de los últimos 60 días, con el
 *   nombre del paciente, y si el paciente ya agendó o venció.
 * - POST recibe las respuestas que completó CX y las guarda en
 *   `respuestas_cx`, que es lo que la bandeja ya muestra.
 *
 * Autenticación sin secretos nuevos: el script manda el token de Google de
 * quien la usa. Se valida con Google y se exige (1) cuenta @tuterapia.com.uy
 * y (2) que el token lo haya pedido un script habilitado en
 * `cx_planilla_clientes`. Lo segundo evita que cualquier otra app con un
 * token de una cuenta de Tu Terapia pueda leer nombres de pacientes.
 *
 * Supabase se usa con la service key (la planilla no tiene sesión del
 * dashboard), pero solo para estas dos tablas y solo para alertas derivadas.
 */

const DOMINIO = '@tuterapia.com.uy';
const DIAS_HISTORIA = 60;
const LOCAL_OFFSET_MS = 3 * 3_600_000;
const TANDA = 300;
const MAX_RESPUESTAS = 1000;

type CodRegla = 'A' | 'B' | 'C';

// Mismo tope que la bandeja (components/AlertasVivo.tsx): si una alerta deja
// de aparecer cerca del final de la ventana de su regla, venció; si no, agendó.
const VENTANA_DIAS: Record<CodRegla, number> = { A: 30, B: 35, C: 45 };

const MOTIVO: Record<CodRegla, string> = {
  A: 'Se registró y no agendó',
  B: 'Tuvo la 1ª sesión y no agendó la 2ª',
  C: 'Tuvo la 4ª sesión y no volvió a la 5ª',
};

// Clave en la base → texto en la planilla. Mismo orden que la bandeja.
const RESPUESTAS: Record<string, string> = {
  no_responde: 'No responde',
  pide_derivacion: 'Pide derivación',
  va_a_agendar: 'Va a agendar',
  motivos_economicos: 'Motivos económicos',
  terapeuta_externo: 'Terapeuta externo',
  atiende_por_fuera: 'Atiende por fuera',
};

type Alerta = {
  id: string;
  regla: CodRegla;
  therapist_id: string;
  paciente_id: number;
  fecha_referencia: string;
  vista_ultima: string;
  estado_at: string | null;
};

function diaLocal(d: Date): string {
  return new Date(d.getTime() - LOCAL_OFFSET_MS).toISOString().slice(0, 10);
}

function ddmm(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

function error(mensaje: string, status: number) {
  return NextResponse.json({ error: mensaje }, { status });
}

/** Devuelve el email de quien llama, o la respuesta de error. */
async function autenticar(request: Request, sb: SupabaseClient): Promise<string | NextResponse> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return error('Falta el token de Google', 401);

  // Por POST y no en la URL, para que el token no quede en ningún log.
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }),
    cache: 'no-store',
  });
  if (!r.ok) return error('Token de Google inválido o vencido', 401);
  const info = (await r.json()) as { email?: string; email_verified?: string | boolean; azp?: string; aud?: string };

  const email = String(info.email ?? '').toLowerCase();
  if (!email.endsWith(DOMINIO) || String(info.email_verified) !== 'true') {
    return error(`Solo cuentas ${DOMINIO}`, 403);
  }

  const cliente = String(info.azp ?? info.aud ?? '');
  const { data, error: e } = await sb.from('cx_planilla_clientes').select('client_id').eq('client_id', cliente).maybeSingle();
  if (e) return error(`Supabase: ${e.message}`, 500);
  if (!data) return error(`Esta planilla no está habilitada todavía (cliente ${cliente}). Pedile a Talent que la habilite.`, 403);
  return email;
}

function admin() {
  // Adentro del handler: CI compila sin la service key.
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

async function nombresPacientes(ids: number[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  return withMysql(async (conn) => {
    // Igual que /api/en-vivo/pacientes: el apellido puede no existir.
    const [cols] = await conn.query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pacientes'
          AND COLUMN_NAME IN ('apellido', 'apellidos')`,
    );
    const apellido = cols[0]?.c ? String(cols[0].c) : null;
    const out: Record<string, string> = {};
    for (let i = 0; i < ids.length; i += 1000) {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT id_login AS id, nombre${apellido ? `, ${apellido} AS apellido` : ''}
           FROM pacientes
          WHERE id_login IN (?)`,
        [ids.slice(i, i + 1000)],
      );
      for (const r of rows) {
        const completo = [r.nombre, r.apellido].map((s) => (s == null ? '' : String(s).trim())).filter(Boolean).join(' ');
        if (completo) out[String(r.id)] = completo;
      }
    }
    return out;
  });
}

export async function GET(request: Request) {
  const sb = admin();
  const email = await autenticar(request, sb);
  if (typeof email !== 'string') return email;

  try {
    const { data: sync } = await sb
      .from('en_vivo_sync')
      .select('corrida_en')
      .eq('ok', true)
      .order('corrida_en', { ascending: false })
      .limit(1)
      .maybeSingle();
    const diaCorrida = sync?.corrida_en ? diaLocal(new Date(sync.corrida_en)) : null;

    const desde = diaLocal(new Date(Date.now() - DIAS_HISTORIA * 86_400_000));
    const alertas: Alerta[] = [];
    for (let i = 0; ; i += 1000) {
      const { data, error: e } = await sb
        .from('alertas_vivo')
        .select('id, regla, therapist_id, paciente_id, fecha_referencia, vista_ultima, estado_at')
        .eq('estado', 'derivada_cx')
        .gte('vista_ultima', desde)
        .order('fecha_referencia', { ascending: true })
        .range(i, i + 999);
      if (e) throw new Error(e.message);
      alertas.push(...((data ?? []) as Alerta[]));
      if (!data || data.length < 1000) break;
    }

    const tids = [...new Set(alertas.map((a) => a.therapist_id))];
    const psicologos = new Map<string, { nombre: string; pais: string }>();
    for (let i = 0; i < tids.length; i += TANDA) {
      const { data, error: e } = await sb.from('therapists').select('id, nombre, pais').in('id', tids.slice(i, i + TANDA));
      if (e) throw new Error(e.message);
      for (const t of data ?? []) psicologos.set(String(t.id), { nombre: t.nombre ?? '', pais: t.pais ?? '' });
    }

    const pids = [...new Set(alertas.map((a) => Number(a.paciente_id)))];
    // Última respuesta de CX por paciente, para mostrar en la planilla lo que
    // ya se cargó desde el dashboard o desde otra fila.
    const respuestas = new Map<number, { respuesta: string; fecha: string }>();
    for (let i = 0; i < pids.length; i += TANDA) {
      const { data, error: e } = await sb
        .from('respuestas_cx')
        .select('paciente_id, respuesta, fecha_reporte')
        .in('paciente_id', pids.slice(i, i + TANDA))
        .order('fecha_reporte', { ascending: false });
      if (e) throw new Error(e.message);
      for (const r of data ?? []) {
        const p = Number(r.paciente_id);
        if (!respuestas.has(p)) respuestas.set(p, { respuesta: r.respuesta, fecha: r.fecha_reporte });
      }
    }

    const nombres = await nombresPacientes(pids);
    const ahora = Date.now();

    const filas = alertas.map((a) => {
      const vigente = !diaCorrida || a.vista_ultima >= diaCorrida;
      const edad = (Date.parse(a.vista_ultima) - Date.parse(a.fecha_referencia)) / 86_400_000;
      const vencida = !vigente && edad >= (VENTANA_DIAS[a.regla] ?? 30) - 2;
      const derivadaEl = a.estado_at ? diaLocal(new Date(a.estado_at)) : null;
      const r = respuestas.get(Number(a.paciente_id));
      // Solo cuenta la respuesta cargada después de derivar esta alerta.
      const resp = r && (!derivadaEl || r.fecha >= derivadaEl) ? r : null;
      const ps = psicologos.get(a.therapist_id);
      return {
        alerta_id: a.id,
        paciente_id: Number(a.paciente_id),
        paciente: nombres[String(a.paciente_id)] ?? '',
        psicologo: ps?.nombre || `Terapeuta #${a.therapist_id}`,
        pais: ps?.pais ?? '',
        regla: a.regla,
        motivo: MOTIVO[a.regla] ?? '',
        dias: Math.max(0, Math.floor((ahora - Date.parse(a.fecha_referencia)) / 86_400_000)),
        fecha_referencia: ddmm(diaLocal(new Date(a.fecha_referencia))),
        derivada_el: derivadaEl ? ddmm(derivadaEl) : '',
        situacion: vigente ? 'Esperando' : vencida ? 'Venció sin agendar' : 'Agendó',
        respuesta: resp ? RESPUESTAS[resp.respuesta] ?? resp.respuesta : '',
      };
    });

    return NextResponse.json({ opciones: Object.values(RESPUESTAS), filas });
  } catch (e) {
    console.error('[cx/planilla] GET falló', e);
    return error(e instanceof Error ? e.message : 'error desconocido', 500);
  }
}

export async function POST(request: Request) {
  const sb = admin();
  const email = await autenticar(request, sb);
  if (typeof email !== 'string') return email;

  type Entrada = { alerta_id?: unknown; respuesta?: unknown; comentario?: unknown };
  let entradas: Entrada[];
  try {
    const body = await request.json();
    entradas = Array.isArray(body?.respuestas) ? body.respuestas.slice(0, MAX_RESPUESTAS) : [];
  } catch {
    return error('JSON inválido', 400);
  }

  const porTexto = new Map(Object.entries(RESPUESTAS).map(([k, v]) => [v.toLowerCase(), k]));
  const errores: Record<string, string> = {};
  const pedidas = new Map<string, { respuesta: string; comentario: string | null }>();
  for (const x of entradas) {
    const id = String(x.alerta_id ?? '');
    if (!id) continue;
    const txt = String(x.respuesta ?? '').trim();
    const clave = RESPUESTAS[txt] ? txt : porTexto.get(txt.toLowerCase());
    if (!clave) {
      errores[id] = `Respuesta no válida: "${txt}"`;
      continue;
    }
    const com = String(x.comentario ?? '').trim().slice(0, 2000);
    pedidas.set(id, { respuesta: clave, comentario: com || null });
  }

  try {
    // Solo se aceptan respuestas de alertas que de verdad se derivaron a CX.
    const ids = [...pedidas.keys()];
    const alertas = new Map<string, number>();
    for (let i = 0; i < ids.length; i += TANDA) {
      const { data, error: e } = await sb
        .from('alertas_vivo')
        .select('id, paciente_id')
        .eq('estado', 'derivada_cx')
        .in('id', ids.slice(i, i + TANDA));
      if (e) throw new Error(e.message);
      for (const a of data ?? []) alertas.set(String(a.id), Number(a.paciente_id));
    }

    // Una respuesta por paciente y por día (así es la tabla): si CX corrige
    // en el día, se pisa. Si el mismo paciente tiene dos alertas, gana la última.
    const hoy = diaLocal(new Date());
    const porPaciente = new Map<number, { alertaIds: string[]; fila: Record<string, unknown> }>();
    for (const [id, r] of pedidas) {
      const pid = alertas.get(id);
      if (pid === undefined) {
        errores[id] = 'La alerta no está derivada a CX';
        continue;
      }
      const prev = porPaciente.get(pid);
      porPaciente.set(pid, {
        alertaIds: [...(prev?.alertaIds ?? []), id],
        fila: { paciente_id: pid, alerta_id: id, respuesta: r.respuesta, comentario: r.comentario, fecha_reporte: hoy, cargado_por: email },
      });
    }

    const guardadas: string[] = [];
    const lista = [...porPaciente.values()];
    for (let i = 0; i < lista.length; i += TANDA) {
      const tanda = lista.slice(i, i + TANDA);
      const { error: e } = await sb
        .from('respuestas_cx')
        .upsert(tanda.map((t) => t.fila), { onConflict: 'paciente_id,fecha_reporte' });
      if (e) {
        for (const t of tanda) for (const id of t.alertaIds) errores[id] = `Supabase: ${e.message}`;
      } else {
        for (const t of tanda) guardadas.push(...t.alertaIds);
      }
    }

    return NextResponse.json({ guardadas, errores });
  } catch (e) {
    console.error('[cx/planilla] POST falló', e);
    return error(e instanceof Error ? e.message : 'error desconocido', 500);
  }
}
