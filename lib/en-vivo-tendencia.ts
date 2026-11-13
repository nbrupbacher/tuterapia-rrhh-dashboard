/**
 * Tendencia de sesiones de cada psicólogo/a (En vivo → Todos los psicólogos y
 * el perfil). Acordado con Talent el 2026-11-12:
 *
 * - Se comparan las sesiones realizadas de las últimas 4 semanas contra las 4
 *   anteriores. Las semanas terminan ayer: hoy todavía no está completo.
 * - Sube o baja solo si cambia al menos 15% Y al menos 3 sesiones. Si no,
 *   está estable. Así un "+100%" de 2 a 4 sesiones no cuenta como subida.
 * - Si no tuvo sesiones en las 4 semanas anteriores, es "Nuevo/a" (recién
 *   empieza o vuelve).
 * - Cada sesión es de un paciente "nuevo" (está en sus primeras 4 semanas con
 *   ese psicólogo/a) o de uno que "sigue". Lo calcula el sync
 *   (`realizadas_nuevos` en lib/en-vivo-sync.ts).
 * - El "por qué" es la parte que más se movió: si baja más lo de los que
 *   siguen, "Pierde continuidad"; si bajan más los nuevos, "Le llegan menos
 *   nuevos". Al subir, "Crece con nuevos" o "Más sesiones con los mismos".
 */

export const SEMANAS_TENDENCIA = 4;
export const UMBRAL_PCT = 15;
export const UMBRAL_SESIONES = 3;

export type TipoTendencia = 'sube' | 'estable' | 'baja' | 'nuevo' | 'sin';

export const TEXTO_TENDENCIA: Record<TipoTendencia, string> = {
  sube: 'Subiendo',
  estable: 'Estable',
  baja: 'Bajando',
  nuevo: 'Nuevo/a',
  sin: 'Sin sesiones',
};

export type Porque =
  | 'pierde_continuidad'
  | 'menos_nuevos'
  | 'crece_nuevos'
  | 'mas_mismos'
  | 'primeras_semanas';

export const TEXTO_PORQUE: Record<Porque, string> = {
  pierde_continuidad: 'Pierde continuidad',
  menos_nuevos: 'Le llegan menos nuevos',
  crece_nuevos: 'Crece con nuevos',
  mas_mismos: 'Más sesiones con los mismos',
  primeras_semanas: 'Primeras semanas',
};

/** Una frase para el perfil, que explica el porqué con los números. */
export function explicarPorque(t: Tendencia): string | null {
  const s = (n: number) => (n === 1 ? 'sesión' : 'sesiones');
  switch (t.porque) {
    case 'pierde_continuidad':
      return `Los pacientes que siguen pasaron de ${t.sigAntes} a ${t.sigAhora} ${s(t.sigAhora)}.`;
    case 'menos_nuevos':
      return `Los pacientes nuevos pasaron de ${t.nueAntes} a ${t.nueAhora} ${s(t.nueAhora)}; los que siguen, de ${t.sigAntes} a ${t.sigAhora}.`;
    case 'crece_nuevos':
      return `Los pacientes nuevos pasaron de ${t.nueAntes} a ${t.nueAhora} ${s(t.nueAhora)}.`;
    case 'mas_mismos':
      return `Los pacientes que siguen pasaron de ${t.sigAntes} a ${t.sigAhora} ${s(t.sigAhora)}.`;
    case 'primeras_semanas':
      return 'No tuvo sesiones en las 4 semanas anteriores.';
    default:
      return null;
  }
}

export type SemanaTendencia = {
  /** Primer día de la semana, 'YYYY-MM-DD'. */
  desde: string;
  /** Sesiones de pacientes que siguen. */
  sig: number;
  /** Sesiones de pacientes nuevos (primeras 4 semanas). */
  nue: number;
};

export type Tendencia = {
  /** 8 semanas, la más vieja primero; las últimas 4 son "ahora". */
  semanas: SemanaTendencia[];
  antes: number;
  ahora: number;
  sigAntes: number;
  sigAhora: number;
  nueAntes: number;
  nueAhora: number;
  /** % de cambio; null si antes fue 0. */
  pct: number | null;
  tipo: TipoTendencia;
  porque: Porque | null;
};

type FilaDia = { dia: string; realizadas: number; realizadas_nuevos?: number | null };

function sumarDias(dia: string, n: number): string {
  const [y, m, d] = dia.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Primer día que hace falta leer de `en_vivo_diario` para la tendencia. */
export function desdeTendencia(hoy: string): string {
  return sumarDias(hoy, -7 * SEMANAS_TENDENCIA * 2);
}

export function calcularTendencia(filas: FilaDia[], hoy: string): Tendencia {
  const n = SEMANAS_TENDENCIA * 2;
  const inicio = desdeTendencia(hoy);
  const semanas: SemanaTendencia[] = Array.from({ length: n }, (_, i) => ({
    desde: sumarDias(inicio, i * 7),
    sig: 0,
    nue: 0,
  }));
  for (const f of filas) {
    if (f.dia < inicio || f.dia >= hoy) continue;
    const i = Math.floor((Date.parse(f.dia) - Date.parse(inicio)) / (7 * 86_400_000));
    if (i < 0 || i >= n) continue;
    const nue = Math.min(f.realizadas, f.realizadas_nuevos ?? 0);
    semanas[i].nue += nue;
    semanas[i].sig += f.realizadas - nue;
  }
  const suma = (desde: number, hasta: number, k: 'sig' | 'nue') =>
    semanas.slice(desde, hasta).reduce((a, s) => a + s[k], 0);
  const sigAntes = suma(0, SEMANAS_TENDENCIA, 'sig');
  const nueAntes = suma(0, SEMANAS_TENDENCIA, 'nue');
  const sigAhora = suma(SEMANAS_TENDENCIA, n, 'sig');
  const nueAhora = suma(SEMANAS_TENDENCIA, n, 'nue');
  const antes = sigAntes + nueAntes;
  const ahora = sigAhora + nueAhora;
  const pct = antes > 0 ? Math.round(((ahora - antes) / antes) * 100) : null;

  let tipo: TipoTendencia;
  if (antes === 0) tipo = ahora > 0 ? 'nuevo' : 'sin';
  else if (Math.abs(ahora - antes) >= UMBRAL_SESIONES && Math.abs(pct!) >= UMBRAL_PCT) tipo = ahora > antes ? 'sube' : 'baja';
  else tipo = 'estable';

  const dSig = sigAhora - sigAntes;
  const dNue = nueAhora - nueAntes;
  let porque: Porque | null = null;
  if (tipo === 'baja') porque = dSig <= dNue ? 'pierde_continuidad' : 'menos_nuevos';
  else if (tipo === 'sube') porque = dNue >= dSig ? 'crece_nuevos' : 'mas_mismos';
  else if (tipo === 'nuevo') porque = 'primeras_semanas';

  return { semanas, antes, ahora, sigAntes, sigAhora, nueAntes, nueAhora, pct, tipo, porque };
}
