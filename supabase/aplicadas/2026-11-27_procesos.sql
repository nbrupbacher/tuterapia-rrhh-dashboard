-- ============================================================
-- APLICADA el 2026-11-27 (migración "procesos"), con OK de Talent.
-- Solo crea una tabla nueva, no toca ninguna existente ni sus datos (acuerdo
-- del 2026-11-05).
--
-- Reclutamiento: en qué etapa está cada persona. Es un espejo de la planilla
-- "Proceso y Contratos" (solapas ARG y URU), donde Talent cambia el estado y
-- de donde salen los mails automáticos (Entrevista → Próximos pasos → Últimos
-- pasos → Envío de contrato → Comienza la experiencia, o No avanza). La
-- planilla sigue mandando: el dashboard solo la lee, para que la etapa se vea
-- en la misma fila de la postulación sin abrir la planilla.
--
-- La escribe app/api/talent/procesos con lo que le manda un Apps Script
-- (apps-script/procesos): cada envío es la foto entera de la planilla, así
-- que una fila borrada allá se borra acá.
--
-- No se guardan teléfono, ubicación ni links de la planilla: no hacen falta
-- para saber la etapa.
-- ============================================================

create table public.procesos (
  id            uuid primary key default gen_random_uuid(),
  -- País + número de fila en la planilla. Cada envío reemplaza la foto
  -- entera, así que si se insertan filas allá no queda nada desfasado.
  clave         text not null unique,
  pais          text not null check (pais in ('AR', 'UY')),
  fila          int not null,
  -- Tal cual la planilla ("Noviembre"). No tiene año.
  mes           text,
  nombre        text not null,
  -- Todos los mails que haya en la celda (a veces hay dos, o una nota).
  emails        text[] not null default '{}',
  recruiter     text,
  -- entrevista · proximos_pasos · ultimos_pasos · contrato · comienza ·
  -- no_avanza · otro (texto libre: queda en estado_texto).
  estado        text not null,
  estado_texto  text,
  fecha_ingreso text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index procesos_emails on public.procesos using gin (emails);

create trigger procesos_updated_at before update on public.procesos
  for each row execute function public.set_updated_at();

alter table public.procesos enable row level security;
create policy "Authenticated users can read procesos"
  on public.procesos for select to authenticated using (true);
