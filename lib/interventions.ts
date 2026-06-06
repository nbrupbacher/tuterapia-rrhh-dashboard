import { getSupabase } from './supabase';
import type { Intervention } from './types';

function addMonths(yyyyMM: string, n: number): string {
  const [y, m] = yyyyMM.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export async function fetchActiveInterventions(currentMonth: string): Promise<Intervention[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('get_active_interventions', { p_current_month: currentMonth });
  if (error) { console.error('fetchActiveInterventions', error); return []; }
  return (data || []) as Intervention[];
}

export async function markIntervention(
  therapistId: string,
  type: 'meet' | 'whatsapp',
  currentMonth: string,
  scoreNow: number,
  userEmail?: string,
): Promise<Intervention | null> {
  const supabase = getSupabase();
  const respectUntilMonth = addMonths(currentMonth, type === 'meet' ? 2 : 1);
  const { data, error } = await supabase
    .from('interventions')
    .insert({
      therapist_id: therapistId,
      type,
      marked_in_month: currentMonth,
      respect_until_month: respectUntilMonth,
      score_at_intervention: scoreNow,
      marked_by: userEmail || null,
    })
    .select()
    .single();
  if (error) { console.error('markIntervention', error); return null; }
  return data as Intervention;
}

export async function unmarkIntervention(interventionId: string): Promise<boolean> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('interventions')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', interventionId);
  if (error) { console.error('unmarkIntervention', error); return false; }
  return true;
}

export async function fetchTherapistInterventions(therapistId: string): Promise<Intervention[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('interventions')
    .select('*')
    .eq('therapist_id', therapistId)
    .eq('active', true)
    .order('intervention_date', { ascending: false });
  if (error) { console.error('fetchTherapistInterventions', error); return []; }
  return (data || []) as Intervention[];
}
