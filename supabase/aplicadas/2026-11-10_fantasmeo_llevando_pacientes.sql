-- ============================================================
-- APLICADA el 2026-11-10 (migración "fantasmeo_llevando_pacientes"), con OK de Talent.
-- Fantasmeos: motivo nuevo "Se está llevando pacientes". Solo agrega una
-- opción a la lista permitida; no cambia ninguna fila.
-- ============================================================

alter table public.fantasmeos drop constraint fantasmeos_motivo_check;
alter table public.fantasmeos add constraint fantasmeos_motivo_check
  check (motivo in ('salida_nuestra', 'salida_psicologo', 'llevando_pacientes', 'conversion_baja', 'pausa', 'otro'));
