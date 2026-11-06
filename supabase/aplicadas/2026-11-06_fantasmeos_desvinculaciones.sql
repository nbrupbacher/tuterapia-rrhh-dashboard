-- ============================================================
-- APLICADA el 2026-11-06 (migración "fantasmeos_desvinculaciones"), con OK de Talent.
-- Matrix en vivo, fase 0: fantasmeos y desvinculaciones.
-- Solo crea tablas nuevas; no toca ninguna existente ni sus datos.
-- La puede aprobar Talent (acuerdo con Nico del 2026-11-05: tablas nuevas
-- que solo agregan). Los datos iniciales se cargaron de la hoja Monitorear y del
-- form de desvinculación (cargado_por = "importado de ...").
-- ============================================================

-- ===== FANTASMEOS =====
-- Reemplaza la hoja "Monitorear". Una fila por período fantasmeado:
-- si alguien vuelve a fantasmearse, es una fila nueva y queda el historial.
-- El fantasmeo real se sigue haciendo a mano en el back ("Mostrar en los
-- listados"); esta tabla solo lo registra, porque hoy la base de Talent no
-- puede leer ese interruptor.
create table public.fantasmeos (
  id              uuid primary key default gen_random_uuid(),
  therapist_id    text not null references public.therapists(id),
  desde           date not null default current_date,
  -- null = sigue fantasmeado
  hasta           date,
  motivo          text not null check (motivo in (
                    'salida_nuestra',
                    'salida_psicologo',
                    'conversion_baja',
                    'pausa',
                    'otro')),
  -- Para "pausa": cuándo vuelve. Alimenta la sugerencia de desfantasmear.
  vuelve_previsto date,
  nota            text,
  cargado_por     text not null,
  cerrado_por     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check (hasta is null or hasta >= desde)
);

-- Un solo fantasmeo abierto por terapeuta: evita dos filas "vigentes" que
-- después den días y estados distintos según cuál se lea.
create unique index fantasmeos_uno_abierto
  on public.fantasmeos (therapist_id) where hasta is null;
create index fantasmeos_therapist on public.fantasmeos (therapist_id, desde desc);

create trigger fantasmeos_updated_at before update on public.fantasmeos
  for each row execute function public.set_updated_at();

alter table public.fantasmeos enable row level security;
create policy "Authenticated users can read fantasmeos"
  on public.fantasmeos for select to authenticated using (true);
create policy "Authenticated users can write fantasmeos"
  on public.fantasmeos for all to authenticated using (true) with check (true);


-- ===== DESVINCULACIONES =====
-- Guarda la baja ANTES de que el terapeuta deje de aparecer en el CSV.
-- Se guardan los hitos con fecha y el estado se deriva en la vista de abajo:
-- así no hay un campo "estado" que alguien olvide actualizar.
create table public.desvinculaciones (
  id                  uuid primary key default gen_random_uuid(),
  therapist_id        text not null references public.therapists(id),
  motivo              text not null check (motivo in ('por_el_psicologo', 'nuestra', 'a_definir')),
  -- De dónde salió: un fantasmeo con motivo de salida, o el form de desvinculación.
  fantasmeo_id        uuid references public.fantasmeos(id),
  form_enviado_at     timestamptz,
  -- La liquidación la confirma Admin por fuera; acá el equipo la tilda.
  liquidacion_ok_at   timestamptz,
  liquidacion_ok_por  text,
  desvinculado_at     timestamptz,
  desvinculado_por    text,
  -- Si se frena la salida (el psicólogo se queda), se cancela en vez de borrar.
  cancelada_at        timestamptz,
  nota                text,
  cargado_por         text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index desvinculaciones_una_abierta
  on public.desvinculaciones (therapist_id)
  where desvinculado_at is null and cancelada_at is null;

create trigger desvinculaciones_updated_at before update on public.desvinculaciones
  for each row execute function public.set_updated_at();

alter table public.desvinculaciones enable row level security;
create policy "Authenticated users can read desvinculaciones"
  on public.desvinculaciones for select to authenticated using (true);
create policy "Authenticated users can write desvinculaciones"
  on public.desvinculaciones for all to authenticated using (true) with check (true);


-- ===== ESTADO DERIVADO =====
-- "Baja confirmada" sale de therapists.activo = false, que hoy se marca al
-- cargar el CSV del mes siguiente (motivo_baja = 'No aparece en CSV de ...').
-- Por eso "Falta desactivar en el back" se puede detectar recién con el CSV
-- siguiente, no a los 2 días como dice el mockup. Con datos diarios se ajusta.
create view public.desvinculaciones_estado
with (security_invoker = true) as
select
  d.*,
  t.nombre,
  t.pais,
  t.activo,
  t.fecha_baja,
  case
    when d.cancelada_at is not null                      then 'cancelada'
    when d.desvinculado_at is not null and not t.activo  then 'baja_confirmada'
    when d.desvinculado_at is not null                   then 'falta_desactivar'
    when d.motivo = 'a_definir'                          then 'salida_a_definir'
    when d.liquidacion_ok_at is null                     then 'esperando_liquidacion'
    else                                                      'lista_para_desvincular'
  end as estado
from public.desvinculaciones d
join public.therapists t on t.id = d.therapist_id;
