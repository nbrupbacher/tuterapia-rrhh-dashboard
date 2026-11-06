-- ============================================================
-- PROPUESTA · NO APLICADA · NECESITA EL OK DE NICO
-- Matrix en vivo: nuevas opciones de "Respuesta CX" (pedido de Talent, 2026-11-06).
-- Cambia la lista de respuestas permitidas en respuestas_cx. La tabla está
-- vacía: no modifica ni borra filas.
-- ============================================================

alter table public.respuestas_cx drop constraint respuestas_cx_respuesta_check;
alter table public.respuestas_cx add constraint respuestas_cx_respuesta_check
  check (respuesta in (
    'no_responde',
    'pide_derivacion',
    'va_a_agendar',
    'motivos_economicos',
    'siguio_por_fuera'));
