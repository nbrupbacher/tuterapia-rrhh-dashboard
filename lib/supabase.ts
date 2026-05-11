// Cliente de Supabase para el navegador.
// Lee las claves de variables de entorno (Vercel las inyecta en build time).
//
// IMPORTANTE: NEXT_PUBLIC_* significa que la variable se expone al frontend.
// Eso es OK para la anon key (es pública por diseño, RLS la regula).
// NUNCA poner aquí la service_role key.

import { createBrowserClient } from '@supabase/ssr';

export function createSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Faltan variables de entorno: NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_ANON_KEY. ' +
      'Verificá la configuración en Vercel → Settings → Environment Variables.'
    );
  }

  return createBrowserClient(url, key);
}

// Singleton para evitar crear múltiples clientes
let _client: ReturnType<typeof createSupabaseClient> | null = null;

export function getSupabase() {
  if (typeof window === 'undefined') {
    // En el servidor (durante el build de Next.js), creamos uno temporal
    return createSupabaseClient();
  }
  if (!_client) {
    _client = createSupabaseClient();
  }
  return _client;
}
