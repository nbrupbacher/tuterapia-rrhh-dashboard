// Growth — motor de recálculo de un mes.
//
// Corre las 10 funciones SQL por país, redacta con las plantillas, rankea y
// hace upsert en growth_insights. Lo usan dos lugares: el botón "Recalcular
// mes" de la pestaña y el final de cada carga de CSV.
//
// Recibe el cliente de Supabase ya creado (con service_role) para no duplicar
// credenciales ni la verificación de sesión, que hace cada llamador.

import type { SupabaseClient } from '@supabase/supabase-js';
import { GENERADORES, type GeneratorPayload } from './growth';
import {
  redactar, calcularScore, pesoFeedback, penalizacionRepetido,
  RANKING_DEFAULT, type DraftInsight, type RankingCfg,
} from './growth-templates';

const PAISES = ['AR', 'UY'] as const;

export interface RecalcResult {
  insights: number;
  borrados: number;
  errores: string[];
}

export async function recalcGrowthMonth(
  sb: SupabaseClient,
  month: string,
): Promise<RecalcResult> {
  const errores: string[] = [];

  // ===== 1. Config: flags, umbrales y parámetros del ranking =====
  const { data: cfgRows, error: cfgErr } = await sb
    .from('growth_config')
    .select('key, pais, value');
  if (cfgErr) throw new Error(`Error leyendo growth_config: ${cfgErr.message}`);

  const cfg = new Map<string, any>((cfgRows || []).map((r: any) => [`${r.key}|${r.pais}`, r.value]));
  const ranking: RankingCfg = { ...RANKING_DEFAULT, ...(cfg.get('ranking|ALL') || {}) };

  function genCfg(gen: string): { enabled: boolean; min_casos: number } {
    const v = cfg.get(`gen:${gen}|ALL`) || {};
    return { enabled: v.enabled !== false, min_casos: Number(v.min_casos ?? 1) };
  }

  // ===== 2. Correr generadores y redactar =====
  const drafts: { pais: string; draft: DraftInsight }[] = [];

  for (const pais of PAISES) {
    for (const gen of GENERADORES) {
      const { enabled, min_casos } = genCfg(gen);
      if (!enabled) continue;

      const { data, error } = await sb.rpc(`growth_gen_${gen}`, { p_month: month, p_pais: pais });
      if (error) { errores.push(`${gen}/${pais}: ${error.message}`); continue; }

      const draft = redactar(gen, data as GeneratorPayload | null, { month, pais, minCasos: min_casos });
      if (draft) drafts.push({ pais, draft });
    }
  }

  // ===== 3. Ranking =====
  // Mes anterior: para penalizar el insight que repite el número del mes pasado.
  const [yy, mm] = month.split('-').map(Number);
  const prev = new Date(yy, mm - 2, 1);
  const prevMonth = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, '0')}`;

  const { data: prevRows } = await sb
    .from('growth_insights')
    .select('pais, generator, payload')
    .eq('month', prevMonth);
  const prevNumero = new Map<string, number>();
  (prevRows || []).forEach((r: any) => {
    const v = r.payload?.numero_principal;
    if (typeof v === 'number') prevNumero.set(`${r.pais}|${r.generator}`, v);
  });

  // Feedback histórico por generador (todos los meses y países).
  const { data: fbRows } = await sb
    .from('growth_insights')
    .select('generator, feedback')
    .not('feedback', 'is', null);
  const fb = new Map<string, { sirve: number; descarto: number }>();
  (fbRows || []).forEach((r: any) => {
    const e = fb.get(r.generator) || { sirve: 0, descarto: 0 };
    if (r.feedback === 'sirve') e.sirve++;
    else if (r.feedback === 'descarto') e.descarto++;
    fb.set(r.generator, e);
  });

  // Normalización sobre el mes completo (los dos países), así el orden se
  // mantiene coherente cuando la vista "Todos" los muestra juntos.
  const impactoMax = Math.max(
    ranking.impacto_base_usd,
    ...drafts.map(d => d.draft.impacto_usd ?? ranking.impacto_base_usd),
  );

  const rows = drafts.map(({ pais, draft }) => {
    const hist = fb.get(draft.generator) || { sirve: 0, descarto: 0 };
    const peso = pesoFeedback(hist.sirve, hist.descarto, ranking);
    const penal = penalizacionRepetido(
      draft.numero_principal,
      prevNumero.get(`${pais}|${draft.generator}`) ?? null,
      ranking,
    );
    return {
      month,
      pais,
      generator: draft.generator,
      titulo: draft.titulo,
      que_pasa: draft.que_pasa,
      oportunidad: draft.oportunidad,
      accion: draft.accion,
      impacto_usd: draft.impacto_usd,
      score: calcularScore(draft.impacto_usd, impactoMax, penal, peso, ranking),
      // numero_principal viaja en el payload: el mes que viene se compara
      // contra él para saber si el insight está repitiendo lo mismo.
      payload: { ...draft.payload, numero_principal: draft.numero_principal },
    };
  });

  // ===== 4. Guardar =====
  // El upsert no incluye feedback/feedback_by/feedback_at, así que esas
  // columnas no entran en el SET del ON CONFLICT y lo ya marcado se conserva.
  if (rows.length > 0) {
    const { error: upErr } = await sb
      .from('growth_insights')
      .upsert(rows, { onConflict: 'month,pais,generator' });
    if (upErr) throw new Error(`Error guardando insights: ${upErr.message}`);
  }

  // Los generadores que esta vez no llegaron al mínimo no deben quedar como
  // tarjetas viejas colgadas del mes.
  const vigentes = new Set(rows.map(r => `${r.pais}|${r.generator}`));
  const { data: existentes } = await sb
    .from('growth_insights')
    .select('id, pais, generator')
    .eq('month', month);
  const aBorrar = (existentes || [])
    .filter((r: any) => !vigentes.has(`${r.pais}|${r.generator}`))
    .map((r: any) => r.id);
  if (aBorrar.length > 0) {
    await sb.from('growth_insights').delete().in('id', aBorrar);
  }

  return { insights: rows.length, borrados: aBorrar.length, errores };
}
