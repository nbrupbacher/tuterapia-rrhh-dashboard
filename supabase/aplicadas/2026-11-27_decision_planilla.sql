-- ============================================================
-- APLICADA el 2026-11-27 (migración "decision_planilla"), con OK de Talent.
-- Agrega dos columnas vacías. No cambia datos existentes.
--
-- Reclutamiento: la decisión de cada postulación se toma en un solo lugar,
-- sincronizada con la columna ESTADO de la planilla de Requisitos (APTO,
-- NO CUMPLE, REVISAR), que es donde Talent decide hoy:
-- - planilla → Matrix: el Apps Script manda ESTADO al editarlo y cada hora.
--   `estado_planilla_at` guarda cuándo vio el dashboard el último cambio.
-- - Matrix → planilla: lo que se decide en la solapa Reclutamiento queda
--   pendiente hasta que el Apps Script lo escribe en ESTADO (cada 5 minutos).
--   `planilla_escrita_at` marca que ya se escribió.
-- Si las dos cambian, vale la más nueva.
-- ============================================================

alter table public.postulaciones add column estado_planilla_at timestamptz;
alter table public.postulacion_decisiones add column planilla_escrita_at timestamptz;

create index postulacion_decisiones_pendientes
  on public.postulacion_decisiones (created_at) where planilla_escrita_at is null;
