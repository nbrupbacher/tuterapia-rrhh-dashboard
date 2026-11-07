-- ============================================================
-- APLICADA el 2026-11-06 (migración "respuestas_cx_separar_por_fuera"), con OK de Talent.
-- "Siguió por fuera" se separa en dos respuestas de CX:
--   terapeuta_externo → el paciente consiguió otro terapeuta afuera.
--   atiende_por_fuera → sigue con su psicólogo/a de TT fuera de la plataforma
--                       (el dashboard lo marca como posible desvinculación).
-- siguio_por_fuera sigue permitida para no romper el dashboard viejo mientras se
-- publica el nuevo; la tabla no tenía filas, así que no se cambió ningún dato.
-- ============================================================

alter table public.respuestas_cx drop constraint respuestas_cx_respuesta_check;
alter table public.respuestas_cx add constraint respuestas_cx_respuesta_check
  check (respuesta in (
    'no_responde',
    'pide_derivacion',
    'va_a_agendar',
    'motivos_economicos',
    'terapeuta_externo',
    'atiende_por_fuera',
    'siguio_por_fuera'));
