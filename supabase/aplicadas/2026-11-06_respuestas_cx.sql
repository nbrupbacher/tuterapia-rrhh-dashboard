-- ============================================================
-- APLICADA el 2026-11-06 (migración "respuestas_cx"), con OK de Talent.
-- Matrix en vivo: respuestas de CX a las alertas derivadas.
-- Solo crea una tabla nueva; no toca ninguna existente ni sus datos.
-- La aprueba Talent (acuerdo con Nico del 2026-11-05: tablas nuevas
-- que solo agregan).
-- ============================================================

-- Una fila por paciente y por reporte de CX. CX devuelve la planilla de
-- "Descargar para CX" con la columna "Respuesta CX" completa; Talent la pasa
-- y se carga acá cruzando por número de paciente.
--
-- Si el mismo paciente aparece en dos reportes (por ejemplo, primero "No
-- respondió" y la semana siguiente "Va a agendar"), quedan las dos filas: la
-- bandeja muestra la última y se puede ver el historial.
create table public.respuestas_cx (
  id            uuid primary key default gen_random_uuid(),
  paciente_id   bigint not null,
  -- La alerta a la que responde. Null si al cargar no se encontró (no
  -- debería pasar, pero no se pierde la respuesta por eso).
  alerta_id     uuid references public.alertas_vivo(id) on delete set null,
  respuesta     text not null check (respuesta in (
                  'no_respondio',
                  'va_a_agendar',
                  'cambio_psicologo',
                  'no_sigue_precio',
                  'no_sigue_otro',
                  'contacto_erroneo')),
  comentario    text,
  -- Fecha del reporte de CX (la que dice el archivo o el día que se cargó).
  fecha_reporte date not null,
  cargado_por   text not null,
  created_at    timestamptz not null default now(),
  -- Mismo paciente dos veces en un mismo reporte = error de la planilla.
  unique (paciente_id, fecha_reporte)
);

create index respuestas_cx_paciente on public.respuestas_cx (paciente_id, fecha_reporte desc);

-- El equipo logueado solo lee. Las cargas se hacen desde Claude Code con el
-- archivo que pasa Talent, no desde la pantalla.
alter table public.respuestas_cx enable row level security;
create policy "Authenticated users can read respuestas_cx"
  on public.respuestas_cx for select to authenticated using (true);
