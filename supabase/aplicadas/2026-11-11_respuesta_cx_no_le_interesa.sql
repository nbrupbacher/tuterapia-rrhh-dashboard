-- Aplicada el 2026-11-11: nueva respuesta CX "No le interesa".
alter table public.respuestas_cx drop constraint respuestas_cx_respuesta_check;
alter table public.respuestas_cx add constraint respuestas_cx_respuesta_check check (respuesta = any (array['no_responde','pide_derivacion','va_a_agendar','no_le_interesa','motivos_economicos','terapeuta_externo','atiende_por_fuera','siguio_por_fuera']));
