-- ============================================================
-- PROPUESTA · NO APLICADA · NECESITA EL OK DE NICO
-- Matrix en vivo: regla C (tuvo la 4ª sesión y no volvió a la 5ª en 14 días).
-- Cambia una tabla existente (alertas_vivo): solo amplía la lista de reglas
-- permitidas. No modifica ni borra filas.
-- ============================================================

alter table public.alertas_vivo drop constraint alertas_vivo_regla_check;
alter table public.alertas_vivo add constraint alertas_vivo_regla_check
  check (regla in ('A', 'B', 'C'));
