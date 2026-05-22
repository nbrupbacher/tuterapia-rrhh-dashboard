'use client';

import { useState, useEffect } from 'react';
import { getSupabase } from '@/lib/supabase';
import type { PaisFilter } from '@/lib/types';
import type { SituacionId } from '@/lib/constants-matrix';

interface MonthSummary {
  month: string;
  label: string;
  A: number; B: number; C: number; D: number;
  irr: number;  // ahora derivado de situaciones críticas
  gan: number;
  sp: number;
}

const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MESES_CORTOS[m-1]} ${String(y).slice(-2)}`;
}

// Considera "irrecuperable" (para la línea histórica) a quien está en
// las situaciones rojas del Matrix
function esCriticoRojo(situaciones: SituacionId[] | null): boolean {
  if (!situaciones) return false;
  return situaciones.includes('sin_actividad_sostenida') || situaciones.includes('en_abandono');
}

interface Props { pais: PaisFilter; }

export function ProgressView({ pais }: Props) {
  const [data, setData] = useState<MonthSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function load() {
      const sb = getSupabase();
      const { data: months } = await sb
        .from('therapist_state')
        .select('month')
        .order('month', { ascending: true })
        .limit(10000);
      if (!months || !mounted) return;
      const uniqueMonths = Array.from(new Set(months.map((m: any) => m.month))) as string[];

      let countryIds: Set<string> | null = null;
      if (pais !== 'T') {
        const { data: th } = await sb.from('therapists').select('id').eq('pais', pais).limit(2000);
        countryIds = new Set((th || []).map((t: any) => t.id));
      }

      const results: MonthSummary[] = [];
      for (const m of uniqueMonths) {
        const { data: rows } = await sb
          .from('therapist_state')
          .select('cuadrante, situaciones, gan_mes, ses_paciente_3m, therapist_id')
          .eq('month', m)
          .limit(2000);
        if (!rows) continue;
        const filtered = countryIds ? rows.filter((r: any) => countryIds!.has(r.therapist_id)) : rows;

        results.push({
          month: m,
          label: monthLabel(m),
          A: filtered.filter((r: any) => r.cuadrante === 'A').length,
          B: filtered.filter((r: any) => r.cuadrante === 'B').length,
          C: filtered.filter((r: any) => r.cuadrante === 'C').length,
          D: filtered.filter((r: any) => r.cuadrante === 'D').length,
          irr: filtered.filter((r: any) => esCriticoRojo(r.situaciones)).length,
          gan: filtered.reduce((s: number, r: any) => s + (Number(r.gan_mes) || 0), 0),
          sp: (() => {
            const valid = filtered.filter((r: any) => r.ses_paciente_3m != null && r.ses_paciente_3m > 0);
            if (!valid.length) return 0;
            return valid.reduce((s: number, r: any) => s + Number(r.ses_paciente_3m), 0) / valid.length;
          })(),
        });
      }
      if (mounted) {
        setData(results);
        setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [pais]);
