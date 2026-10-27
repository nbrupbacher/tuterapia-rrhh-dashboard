import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { withMysql } from '@/lib/mysql';
import { isCronAuthorized } from '@/lib/cron-auth';
import { calcularVentana, leerEnVivo } from '@/lib/en-vivo-sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Sincronización diaria de la solapa En vivo: MySQL → Supabase.
 *
 * La dispara Vercel Cron una vez por día (vercel.json, 10:00 UTC = 07:00 en
 * Uruguay y Argentina). También se puede llamar a mano con el mismo
 * `Authorization: Bearer <CRON_SECRET>`.
 *
 * Reescribe la ventana entera (mes anterior, mes en curso y próximos 7 días)
 * en cada corrida: una sesión agendada pasa a realizada o a sin confirmar con
 * los días, así que ningún día de la ventana queda congelado. El reemplazo lo
 * hace `en_vivo_reemplazar` en una sola transacción.
 *
 * Cada corrida, buena o mala, deja una fila en `en_vivo_sync`: de ahí sale el
 * "Datos al" de la pantalla.
 */
export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const t0 = Date.now();
  // El cliente se crea adentro del handler: CI compila sin la service key.
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  try {
    const ventana = calcularVentana();
    const { diario, terapeutas } = await withMysql((conn) => leerEnVivo(conn, ventana));

    const { error } = await sb.rpc('en_vivo_reemplazar', {
      p_desde: ventana.desde,
      p_hasta: ventana.hasta,
      p_diario: diario,
      p_terapeutas: terapeutas,
    });
    if (error) throw new Error(`Supabase: ${error.message}`);

    const ms = Date.now() - t0;
    await sb.from('en_vivo_sync').insert({ ok: true, filas_diario: diario.length, terapeutas: terapeutas.length, ms });

    return NextResponse.json({ ok: true, ventana, filas_diario: diario.length, terapeutas: terapeutas.length, ms });
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'error desconocido';
    console.error('[cron/en-vivo] falló', error);
    await sb.from('en_vivo_sync').insert({ ok: false, ms: Date.now() - t0, error: mensaje });
    return NextResponse.json({ ok: false, error: mensaje }, { status: 500 });
  }
}
