import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { calcScore, type MonthData } from '@/lib/scoring';
import type { CsvRow } from '@/lib/csvParser';
import type { Pais } from '@/lib/types';
import { recalcGrowthMonth } from '@/lib/growth-recalc';

// IMPORTANTE: Esta API usa el service_role key de Supabase
// que tiene permisos de admin. Solo accesible desde el servidor.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

interface UploadPayload {
  month: string;       // YYYY-MM
  rows: CsvRow[];
  jwt: string;          // del usuario logueado (para auth)
}

export async function POST(request: Request) {
  let body: UploadPayload;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { month, rows, jwt } = body;

  // Validaciones básicas
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Mes inválido (YYYY-MM)' }, { status: 400 });
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: 'CSV vacío' }, { status: 400 });
  }
  if (!jwt) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // Cliente con anon key + JWT del usuario (verifica auth)
  const sbUser = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } }
  });
  const { data: userData, error: authErr } = await sbUser.auth.getUser(jwt);
  if (authErr || !userData?.user) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }
  const userEmail = userData.user.email;

  // Cliente con service_role para hacer escrituras masivas
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  // 1. Cargar terapeutas existentes
  const { data: existing } = await sb.from('therapists').select('id, activo').limit(5000);
  const existingMap = new Map<string, boolean>((existing || []).map((t: any) => [t.id, t.activo]));

  const csvIds = new Set(rows.map(r => r.id));

  // 2. Detectar deltas
  const nuevos = rows.filter(r => !existingMap.has(r.id));
  const reactivados = rows.filter(r => existingMap.get(r.id) === false);
  const bajas = Array.from(existingMap.entries()).filter(([id, activo]) => activo && !csvIds.has(id)).map(([id]) => id);
  const actualizados = rows.filter(r => existingMap.get(r.id) === true);

  // 3. Upsert therapists (nuevos + reactivados + actualizados)
  const therapistRows = rows.map(r => ({
    id: r.id,
    pais: r.pais,
    nombre: r.nombre,
    email: r.email,
    telefono: r.telefono,
    corriente: r.corriente,
    edad: r.edad,
    inicio: r.inicio,
    activo: true,
    fecha_baja: null,
    motivo_baja: null,
  }));
  const { error: thErr } = await sb.from('therapists').upsert(therapistRows, { onConflict: 'id' });
  if (thErr) return NextResponse.json({ error: `Error upsert therapists: ${thErr.message}` }, { status: 500 });

  // 4. Marcar bajas
  const firstDayOfMonth = `${month}-01`;
  if (bajas.length > 0) {
    const { error: bajaErr } = await sb.from('therapists')
      .update({ activo: false, fecha_baja: firstDayOfMonth, motivo_baja: `No aparece en CSV de ${month}` })
      .in('id', bajas);
    if (bajaErr) return NextResponse.json({ error: `Error bajas: ${bajaErr.message}` }, { status: 500 });
  }

  // 5. Insertar monthly_metrics
  const metricsRows = rows.map(r => ({
    therapist_id: r.id,
    month,
    ses_creadas: r.ses_creadas,
    ses_aprobadas: r.ses_aprobadas,
    ses_confirmadas: r.ses_confirmadas,
    ses_canceladas: r.ses_canceladas,
    aprob_pendientes: r.aprob_pendientes,
    pacientes_unicos: r.pacientes_unicos,
    sesiones_totales: r.sesiones_totales,
    registros_mes: r.registros_mes,
    hs_disponibles: r.hs_disponibles,
    ultimo_registro: r.ultimo_registro,
    ultima_sesion: r.ultima_sesion,
  }));
  const { error: mmErr } = await sb.from('monthly_metrics').upsert(metricsRows, { onConflict: 'therapist_id,month' });
  if (mmErr) return NextResponse.json({ error: `Error monthly_metrics: ${mmErr.message}` }, { status: 500 });

  // 6. Calcular y popular therapist_state
  // Necesitamos los 2 meses anteriores para la ventana 3m
  const [yy, mm] = month.split('-').map(Number);
  const prevMonth1 = new Date(yy, mm - 2, 1);
  const prevMonth2 = new Date(yy, mm - 3, 1);
  const prev1Str = `${prevMonth1.getFullYear()}-${String(prevMonth1.getMonth() + 1).padStart(2, '0')}`;
  const prev2Str = `${prevMonth2.getFullYear()}-${String(prevMonth2.getMonth() + 1).padStart(2, '0')}`;

  const { data: prevMetrics } = await sb.from('monthly_metrics')
    .select('therapist_id, month, pacientes_unicos, sesiones_totales, registros_mes, hs_disponibles, ses_creadas, ses_canceladas')
    .in('month', [prev1Str, prev2Str])
    .limit(5000);

  const prev1Map = new Map<string, MonthData>();
  const prev2Map = new Map<string, MonthData>();
  (prevMetrics || []).forEach((m: any) => {
    const d: MonthData = {
      sm: m.sesiones_totales ?? 0,
      pm: m.pacientes_unicos ?? 0,
      rm: m.registros_mes ?? 0,
      hs: m.hs_disponibles ?? undefined,
      ses_canc: m.ses_canceladas ?? undefined,
      ses_creadas: m.ses_creadas ?? undefined,
    };
    if (m.month === prev1Str) prev1Map.set(m.therapist_id, d);
    else if (m.month === prev2Str) prev2Map.set(m.therapist_id, d);
  });

  // NUEVO: Cargar meses_en_situacion del mes anterior por terapeuta
  // (para la lógica temporal de Fantasmear y Evaluar continuidad)
  const { data: prevStates } = await sb.from('therapist_state')
    .select('therapist_id, meses_en_situacion')
    .eq('month', prev1Str)
    .limit(5000);

  const prevMesesEnSituacion = new Map<string, Record<string, number>>();
  (prevStates || []).forEach((s: any) => {
    prevMesesEnSituacion.set(s.therapist_id, s.meses_en_situacion ?? {});
  });

  const targetDate = new Date(yy, mm - 1, 1);
  // En UTC para alinear con las fechas del CSV, que se parsean como
  // YYYY-MM-DD (medianoche UTC). Si no, el offset del server corre un día.
  const lastDayOfMonthMs = Date.UTC(yy, mm, 0);

  const stateRows = rows.map(r => {
    // Días en plataforma al inicio del mes target
    const inicioDate = r.inicio ? new Date(r.inicio) : null;
    const dias = inicioDate
      ? Math.floor((targetDate.getTime() - inicioDate.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    // Días sin sesión al fin del mes target.
    // El CSV se exporta unos días después del cierre, así que puede traer
    // sesiones posteriores al último día del mes (ej: mes 08 con última
    // sesión el 01/09). Eso daba negativos ("-1d"): si la última sesión es
    // igual o posterior al corte, el terapeuta está activo → 0 días.
    let diasSinSesion: number | null = null;
    if (r.ultima_sesion) {
      const diff = Math.floor((lastDayOfMonthMs - Date.parse(r.ultima_sesion)) / 86400000);
      diasSinSesion = Math.max(0, diff);
    }

    const cur: MonthData = {
      sm: r.sesiones_totales,
      pm: r.pacientes_unicos,
      rm: r.registros_mes,
      hs: r.hs_disponibles,
      ses_canc: r.ses_canceladas,
      ses_creadas: r.ses_creadas,
    };

    const mesesPrevios = prevMesesEnSituacion.get(r.id) ?? {};

    const result = calcScore(
      r.pais as Pais,
      dias,
      cur,
      prev1Map.get(r.id) || null,
      prev2Map.get(r.id) || null,
      mesesPrevios,
      diasSinSesion,
      month,
    );

    return {
      therapist_id: r.id,
      month,
      score: result.score,
      zona: result.zona,
      cuadrante: result.cuadrante,
      tendencia: result.tendencia,
      // NUEVO modelo Matrix
      situaciones: result.situaciones,
      accion: result.accion,
      acciones_pendientes: result.acciones_pendientes,
      meses_en_situacion: result.meses_en_situacion,
      // Métricas
      ses_paciente_3m: result.ses_paciente_3m,
      gan_mes: result.gan_mes,
      reg_3m: result.reg_3m,
      tasa_cancel: result.tasa_cancel,
      videollamada: result.videollamada,
      dias_sin_sesion: result.dias_sin_sesion,
    };
  });

  const { error: stErr } = await sb.from('therapist_state').upsert(stateRows, { onConflict: 'therapist_id,month' });
  if (stErr) return NextResponse.json({ error: `Error therapist_state: ${stErr.message}` }, { status: 500 });

  // 7. Regenerar los insights de Growth del mes recién cargado.
  // Si falla, la carga igual fue exitosa: se avisa y se puede reintentar con
  // el botón "Recalcular mes" de la pestaña.
  let growth: { insights: number } | null = null;
  let growthError: string | undefined;
  try {
    growth = await recalcGrowthMonth(sb, month);
  } catch (e: any) {
    growthError = e?.message || 'No se pudieron generar los insights de Growth';
  }

  return NextResponse.json({
    ok: true,
    month,
    user: userEmail,
    growth: growth ? { insights: growth.insights } : null,
    growthError,
    stats: {
      total_csv: rows.length,
      nuevos: nuevos.length,
      reactivados: reactivados.length,
      bajas: bajas.length,
      actualizados: actualizados.length,
    },
  });
}
