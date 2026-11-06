-- ============================================================
-- APLICADA el 2026-11-06 (migración "regla_c_y_respuestas_cx"), con OK de Talent.
-- Matrix en vivo: regla C (tuvo la 4ª sesión y no volvió a la 5ª en 14 días).
-- Cambia una tabla existente (alertas_vivo): solo amplía la lista de reglas
-- permitidas. No modifica ni borra filas (había solo A y B).
-- ============================================================

alter table public.alertas_vivo drop constraint alertas_vivo_regla_check;
alter table public.alertas_vivo add constraint alertas_vivo_regla_check
  check (regla in ('A', 'B', 'C'));
