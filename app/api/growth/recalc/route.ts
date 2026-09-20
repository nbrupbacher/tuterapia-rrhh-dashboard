import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { recalcGrowthMonth } from '@/lib/growth-recalc';

// Usa el service_role key: corre las funciones SQL y escribe growth_insights.
// Solo accesible desde el servidor.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function POST(request: Request) {
  let body: { month?: string; jwt?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
  }

  const { month, jwt } = body;
  if (!month || !/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'Mes inválido (YYYY-MM)' }, { status: 400 });
  }
  if (!jwt) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 });
  }

  // Verificación de sesión con la anon key + JWT del usuario
  const sbUser = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: authErr } = await sbUser.auth.getUser(jwt);
  if (authErr || !userData?.user) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 });
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

  try {
    const res = await recalcGrowthMonth(sb, month);
    return NextResponse.json({
      ok: true,
      month,
      insights: res.insights,
      borrados: res.borrados,
      errores: res.errores.length ? res.errores : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'No se pudo recalcular' }, { status: 500 });
  }
}
