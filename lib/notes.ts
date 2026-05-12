import { getSupabase } from './supabase';

export interface Note {
  id: string;
  therapist_id: string;
  tipo: string;
  contenido: { text: string };
  month_aplica: string | null;
  autor: string | null;
  created_at: string;
  updated_at: string;
}

export async function fetchNotes(therapistId: string): Promise<Note[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('therapist_actions')
    .select('*')
    .eq('therapist_id', therapistId)
    .eq('tipo', 'nota')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('Error fetching notes:', error);
    return [];
  }
  return (data || []) as Note[];
}

export async function addNote(therapistId: string, text: string, autor?: string): Promise<Note | null> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('therapist_actions')
    .insert({
      therapist_id: therapistId,
      tipo: 'nota',
      contenido: { text },
      autor: autor || null,
    })
    .select()
    .single();
  if (error) {
    console.error('Error adding note:', error);
    return null;
  }
  return data as Note;
}

export async function deleteNote(noteId: string): Promise<boolean> {
  const sb = getSupabase();
  const { error } = await sb.from('therapist_actions').delete().eq('id', noteId);
  if (error) {
    console.error('Error deleting note:', error);
    return false;
  }
  return true;
}
