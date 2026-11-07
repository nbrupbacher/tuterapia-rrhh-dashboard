-- ============================================================
-- APLICADA el 2026-11-07 (migración "desactivacion_multas_form"), con OK de Talent.
-- Fantasmeos y salidas, para dejar de usar la hoja "Monitorear":
--   1. Fecha en que se desactivó el perfil en el back.
--   2. Datos del form de desvinculación, que ahora se lee solo.
--   3. Multas por incumplimiento de contrato.
-- Solo agrega columnas y una tabla nueva. La vista se recrea porque
-- `d.*` no toma columnas nuevas; ningún otro objeto depende de ella.
-- ============================================================

-- ===== 1 y 2. DESVINCULACIONES =====
alter table public.desvinculaciones
  -- Antes "Baja confirmada" esperaba al CSV del mes siguiente. Cuando Talent
  -- desvincula, desactiva el perfil el mismo día: con esta fecha alcanza.
  add column desactivado_at  timestamptz,
  add column desactivado_por text,
  -- Fila del form que originó o completó la salida: marca temporal + mail.
  -- Es la clave para que leer el form varias veces no duplique salidas.
  add column form_clave      text unique,
  -- Quién completó el form: si es un mail de Tu Terapia, lo completó Talent.
  add column form_email      text;

drop view public.desvinculaciones_estado;
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
    when d.desvinculado_at is not null
         and (d.desactivado_at is not null or not t.activo) then 'baja_confirmada'
    when d.desvinculado_at is not null                   then 'falta_desactivar'
    when d.motivo = 'a_definir'                          then 'salida_a_definir'
    when d.liquidacion_ok_at is null                     then 'esperando_liquidacion'
    else                                                      'lista_para_desvincular'
  end as estado
from public.desvinculaciones d
join public.therapists t on t.id = d.therapist_id;


-- ===== 3. MULTAS =====
-- Una fila por multa. Hoy se avisan por mail ("Actualización sobre tu
-- continuidad en Tu Terapia"): la multa, lo que se retiene de honorarios y
-- el saldo a transferir. El pago lo informa el psicólogo/a y lo confirma
-- Administración: son dos fechas distintas a propósito.
create table public.multas (
  id                  uuid primary key default gen_random_uuid(),
  therapist_id        text not null references public.therapists(id),
  desvinculacion_id   uuid references public.desvinculaciones(id),
  moneda              text not null check (moneda in ('ARS', 'UYU', 'USD')),
  monto               numeric(12, 2) not null check (monto > 0),
  -- Honorarios pendientes que se imputan a la multa (cláusula 8.2).
  retenido            numeric(12, 2) not null default 0 check (retenido >= 0),
  saldo               numeric(12, 2) generated always as (greatest(monto - retenido, 0)) stored,
  notificada_el       date not null,
  vence_el            date,
  pago_informado_el   date,
  pago_confirmado_el  date,
  pago_confirmado_por text,
  -- Si se deja sin efecto (acuerdo, error), no se borra.
  anulada_el          date,
  mail_url            text,
  nota                text,
  cargado_por         text not null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index multas_therapist on public.multas (therapist_id, notificada_el desc);

create trigger multas_updated_at before update on public.multas
  for each row execute function public.set_updated_at();

alter table public.multas enable row level security;
create policy "Authenticated users can read multas"
  on public.multas for select to authenticated using (true);
create policy "Authenticated users can write multas"
  on public.multas for all to authenticated using (true) with check (true);
