// Growth — tipos compartidos y acceso a Supabase.
//
// Los números los calculan funciones SQL (growth_gen_*), una por generador.
// La redacción vive en lib/growth-templates.ts. Acá solo van los tipos y las
// lecturas/escrituras que hace la pestaña.

import { getSupabase } from './supabase';
import type { PaisFilter } from './types';

export type GrowthPais = 'AR' | 'UY' | 'Total';
export type Feedback = 'sirve' | 'descarto' | null;

/** Un terapeuta listado dentro de un insight, con la métrica que lo explica. */
export interface TerapeutaRef {
  id: string;
  nombre: string;
  pais: string;
  valor: number;
  metrica: string;
  metrica_label: string;
}

/** Lo que devuelve una función growth_gen_*: números sueltos + terapeutas. */
export interface GeneratorPayload {
  terapeutas?: TerapeutaRef[];
  [key: string]: unknown;
}

export interface GrowthInsight {
  id: string;
  month: string;
  pais: GrowthPais;
  generator: string;
  titulo: string;
  que_pasa: string;
  oportunidad: string | null;
  accion: string;
  impacto_usd: number | null;
  score: number;
  payload: GeneratorPayload;
  feedback: Feedback;
  feedback_by: string | null;
  feedback_at: string | null;
  created_at: string;
}

/** Los 10 generadores de la v1, en el orden en que se documentaron. */
export const GENERADORES = [
  'crecimiento_pais',
  'nuevos_destacados',
  'demanda_redirigible',
  'primera_sesion',
  'cancelaciones_foco',
  'foco_acompanamiento',
  'top_a_recuperar',
  'perfil_que_crece',
  'lugar_en_buenos_terapeutas',
  'terapeutas_completos',
] as const;

export type Generador = (typeof GENERADORES)[number];

export const PAIS_NOMBRE: Record<string, string> = {
  AR: 'Argentina',
  UY: 'Uruguay',
  Total: 'los dos países',
};

const MESES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** '2026-08' → 'agosto' */
export function mesNombre(month: string): string {
  const m = Number(month.split('-')[1]);
  return MESES[m - 1] ?? month;
}

/** '2026-08' → 'agosto 2026' */
export function mesLargo(month: string): string {
  const [y, m] = month.split('-');
  return `${MESES[Number(m) - 1] ?? month} ${y}`;
}

// ===== Lecturas =====

/** Meses con datos cargados, del más nuevo al más viejo. */
export async function fetchGrowthMeses(): Promise<string[]> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('growth_meses');
  if (error) { console.error('fetchGrowthMeses', error); return []; }
  return ((data || []) as { month: string }[]).map(r => r.month);
}

/**
 * Insights de un mes. Para el filtro "Todos" se traen los de los dos países:
 * los insights se generan por país porque el valor por sesión es distinto en
 * cada uno y mezclar los USD daría un número que no significa nada.
 */
export async function fetchGrowthInsights(
  month: string,
  pais: PaisFilter,
): Promise<GrowthInsight[]> {
  const sb = getSupabase();
  let q = sb.from('growth_insights').select('*').eq('month', month);
  if (pais !== 'T') q = q.eq('pais', pais);
  const { data, error } = await q.order('score', { ascending: false }).limit(200);
  if (error) { console.error('fetchGrowthInsights', error); return []; }
  return (data || []) as GrowthInsight[];
}

/** Marca o desmarca el feedback de un insight. Devuelve la fila actualizada. */
export async function setGrowthFeedback(
  id: string,
  feedback: Feedback,
  by?: string,
): Promise<GrowthInsight | null> {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('growth_set_feedback', {
    p_id: id,
    p_feedback: feedback,
    p_by: by ?? null,
  });
  if (error) { console.error('setGrowthFeedback', error); return null; }
  return (Array.isArray(data) ? data[0] : data) as GrowthInsight;
}

/** Dispara el recálculo de un mes en el servidor. */
export async function recalcularMes(month: string): Promise<{ ok: boolean; error?: string; insights?: number }> {
  const sb = getSupabase();
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return { ok: false, error: 'Sesión vencida. Entrá de nuevo.' };

  const res = await fetch('/api/growth/recalc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ month, jwt: session.access_token }),
  });
  const json = await res.json();
  if (!res.ok) return { ok: false, error: json.error || 'No se pudo recalcular' };
  return { ok: true, insights: json.insights };
}
