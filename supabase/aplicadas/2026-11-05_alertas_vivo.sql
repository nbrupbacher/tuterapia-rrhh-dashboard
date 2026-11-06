-- ============================================================
-- APLICADA el 2026-11-05 (migración "alertas_vivo"), con OK de Talent.
-- Matrix en vivo: bandeja de alertas (reglas A y B).
-- Solo crea una tabla nueva; no toca ninguna existente ni sus datos.
-- La aprueba Talent (acuerdo con Nico del 2026-11-05: tablas nuevas
-- que solo agregan).
-- ============================================================

-- Una fila por caso detectado. El cron de las 07:00 la crea la primera vez
-- que ve el caso y después solo actualiza "vista_ultima". Si un día deja de
-- verlo (el paciente agendó), la fila queda y la bandeja la muestra como
-- "se resolvió sola": así se puede medir cuántas alertas se resuelven sin
-- intervención.
--
-- Del paciente se guarda solo el número de la plataforma (login.id). El
-- nombre y apellido se leen en vivo de MySQL al abrir la bandeja, para no
-- tener una segunda copia de datos personales en esta base.
create table public.alertas_vivo (
  id               uuid primary key default gen_random_uuid(),
  regla            text not null check (regla in ('A', 'B')),
  -- Sin foreign key a therapists: un terapeuta nuevo puede tener alertas
  -- antes de aparecer en el CSV mensual, y el cron no debe fallar por eso.
  therapist_id     text not null,
  paciente_id      bigint not null,
  -- A: fecha de registro del paciente. B: fecha de la primera sesión.
  -- Forma parte de la clave: si el mismo caso vuelve a pasar más adelante,
  -- es una alerta nueva y no reabre la vieja.
  fecha_referencia timestamptz not null,
  detectada_el     date not null default current_date,
  vista_ultima     date not null default current_date,
  -- Lo que hace el equipo con la alerta.
  estado           text not null default 'abierta' check (estado in (
                     'abierta',
                     'derivada_cx',
                     'resuelta',
                     'descartada')),
  estado_por       text,
  estado_at        timestamptz,
  nota             text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (regla, therapist_id, paciente_id, fecha_referencia)
);

create index alertas_vivo_bandeja on public.alertas_vivo (estado, vista_ultima desc);
create index alertas_vivo_therapist on public.alertas_vivo (therapist_id);

create trigger alertas_vivo_updated_at before update on public.alertas_vivo
  for each row execute function public.set_updated_at();

-- El cron escribe con service_role (salta RLS). El equipo logueado lee y
-- cambia el estado; no crea ni borra alertas a mano.
alter table public.alertas_vivo enable row level security;
create policy "Authenticated users can read alertas_vivo"
  on public.alertas_vivo for select to authenticated using (true);
create policy "Authenticated users can update alertas_vivo"
  on public.alertas_vivo for update to authenticated using (true) with check (true);
