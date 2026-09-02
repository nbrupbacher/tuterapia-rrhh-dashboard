import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { PrimeraSesionRow } from '@/lib/csvParser';

// Carga del acumulado histórico de "% de caída en 1ra sesión".
// Independiente de /api/upload: no toca therapists.activo, monthly_metrics
// ni therapist_state — solo las columnas propias de esta métrica.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface UploadPayload {
  month: string;              // YYYY-MM — fecha de corte del acumulado
  rows: PrimeraSesionRow[];
  jwt: string;
}

export async function POST(request: Request) {
  let body: UploadPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { month, rows, jwt } = body;

  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Mes inválido (YYYY-MM)' }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'CSV vacío' }, { status: 400 });
  }
  if (!jwt) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  const sbUser = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: userData, error: authErr } = await sbUser.auth.getUser(jwt);
  if (authErr || !userData?.user) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  const userEmail = userData.user.email;

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  // 1. Matching por id_terapeuta contra therapists.id (mismo criterio que /api/upload)
  const { data: existing, error: exErr } = await sb
    .from('therapists')
    .select('id, nombre, pacientes_1ra_sesion')
    .limit(5000);
  if (exErr) {
    return NextResponse.json({ error: `Error leyendo therapists: ${exErr.message}` }, { status: 500 });
  }

  const existingIds = new Set<string>((existing || []).map((t: any) => t.id));
  const csvIds = new Set(rows.map(r => r.id));

  const matched = rows.filter(r => existingIds.has(r.id));
  const sinMatch = rows.filter(r => !existingIds.has(r.id));

  // 2. Terapeutas que YA tenían dato y no vienen en este CSV.
  // Al ser acumulado el n solo puede crecer, así que desaparecer es señal
  // de error en la carga (no "sin datos"). Se reporta, no se borra nada.
  const desaparecidos = (existing || [])
    .filter((t: any) => t.pacientes_1ra_sesion != null && !csvIds.has(t.id))
    .map((t: any) => ({ id: t.id, nombre: t.nombre }));

  if (matched.length === 0) {
    return NextResponse.json({
      error: `Ningún id_terapeuta del CSV coincide con la Matrix (${sinMatch.length} sin match). Verificá que sea el CSV correcto.`
    }, { status: 400 });
  }

  // 3. Valor VIGENTE por terapeuta (reemplaza el anterior).
  // Una sola llamada para todas las filas — evita cientos de round-trips.
  const { error: upErr } = await sb.rpc('apply_primera_sesion_bulk', {
    p_month: month,
    p_rows: matched.map(r => ({
      id: r.id,
      pct_caida_1ra_sesion: r.pct_caida_1ra_sesion,
      pacientes_1ra_sesion: r.pacientes_1ra_sesion,
      pacientes_sin_2da: r.pacientes_sin_2da,
    })),
  });
  if (upErr) {
    return NextResponse.json({ error: `Error actualizando terapeutas: ${upErr.message}` }, { status: 500 });
  }

  // 4. Snapshot histórico de esta carga (para graficar evolución del acumulado)
  const snapshotRows = matched.map(r => ({
    therapist_id: r.id,
    month,
    pct_caida_1ra_sesion: r.pct_caida_1ra_sesion,
    pacientes_1ra_sesion: r.pacientes_1ra_sesion,
    pacientes_sin_2da: r.pacientes_sin_2da,
    uploaded_by: userEmail,
  }));
  const { error: snapErr } = await sb
    .from('primera_sesion_snapshots')
    .upsert(snapshotRows, { onConflict: 'therapist_id,month' });
  if (snapErr) {
    return NextResponse.json({ error: `Error snapshots: ${snapErr.message}` }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    month,
    user: userEmail,
    stats: {
      total_csv: rows.length,
      actualizados: matched.length,
      sin_match: sinMatch.length,
      sin_match_ids: sinMatch.slice(0, 20).map(r => `${r.id} (${r.nombre})`),
      desaparecidos: desaparecidos.length,
      desaparecidos_nombres: desaparecidos.slice(0, 20).map((t: any) => `${t.nombre} (${t.id})`),
    },
  });
}
