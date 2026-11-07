import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Autenticación de los Apps Script de las planillas de Google (Rescate CX,
 * form de desvinculación) que le hablan al dashboard.
 *
 * Sin secretos nuevos: el script manda el token de Google de quien lo usa. Se
 * valida con Google y se exige (1) cuenta de Tu Terapia y (2) que el token lo
 * haya pedido un script habilitado en `cx_planilla_clientes`. Lo segundo evita
 * que cualquier otra app con un token de una cuenta de Tu Terapia pueda leer o
 * escribir datos de pacientes y psicólogos.
 */

const DOMINIO = '@tuterapia.com.uy';

export function errorJson(mensaje: string, status: number) {
  return NextResponse.json({ error: mensaje }, { status });
}

/** Devuelve el email de quien llama, o la respuesta de error. */
export async function autenticarScript(request: Request, sb: SupabaseClient): Promise<string | NextResponse> {
  const token = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return errorJson('Falta el token de Google', 401);

  // Por POST y no en la URL, para que el token no quede en ningún log.
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ access_token: token }),
    cache: 'no-store',
  });
  if (!r.ok) return errorJson('Token de Google inválido o vencido', 401);
  const info = (await r.json()) as { email?: string; email_verified?: string | boolean; azp?: string; aud?: string };

  const email = String(info.email ?? '').toLowerCase();
  if (!email.endsWith(DOMINIO) || String(info.email_verified) !== 'true') {
    return errorJson(`Solo cuentas ${DOMINIO}`, 403);
  }

  const cliente = String(info.azp ?? info.aud ?? '');
  const { data, error: e } = await sb.from('cx_planilla_clientes').select('client_id').eq('client_id', cliente).maybeSingle();
  if (e) return errorJson(`Supabase: ${e.message}`, 500);
  if (!data) return errorJson(`Esta planilla no está habilitada todavía (cliente ${cliente}). Pedile a Talent que la habilite.`, 403);
  return email;
}
