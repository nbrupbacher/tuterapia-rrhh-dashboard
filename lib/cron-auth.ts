import { timingSafeEqual } from 'node:crypto';

/**
 * Guarda de las rutas de cron.
 *
 * Las rutas de `app/api/upload` y `app/api/growth` se autentican con el JWT
 * del usuario logueado. Un cron no tiene usuario, así que su única puerta es
 * el `CRON_SECRET`: Vercel Cron lo manda solo como
 * `Authorization: Bearer <CRON_SECRET>`. La URL es pública.
 *
 * Sin la variable cargada no pasa nadie, en vez de pasar todos.
 */
export function isCronAuthorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');

  return expected.length === received.length && timingSafeEqual(expected, received);
}
