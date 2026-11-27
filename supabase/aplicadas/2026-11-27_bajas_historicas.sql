-- ============================================================
-- APLICADA el 2026-11-27 (migración "bajas_historicas"), con OK de Talent.
-- Solo crea una tabla nueva, no toca ninguna existente ni sus datos (acuerdo
-- del 2026-11-05).
--
-- Reclutamiento: quienes se fueron de la plataforma ANTES de que existiera el
-- dashboard. `therapists` arranca con los CSV mensuales (abril 2026): quien se
-- fue antes no está, y si se vuelve a postular el cruce no lo ve. Pasó con
-- bajas nuestras que se volvieron a postular con otro mail.
--
-- Dos fuentes:
-- - 'form': el form de desvinculación ("Desvi post 2024"), desde enero 2024.
--   Lo escribe app/api/talent/form-desvinculacion con cada fila que le manda
--   el Apps Script de esa planilla, así las bajas nuevas entran solas.
-- - 'planilla_previa': la planilla "Desv. previo 2024" (2022-2023), cargada
--   una sola vez el 2026-11-27 (167 filas). Solo tiene nombres: ahí el cruce
--   es solo por nombre.
--
-- No se guardan los datos de pacientes que pide el form.
-- ============================================================

create table public.bajas_historicas (
  id          uuid primary key default gen_random_uuid(),
  -- form: marca temporal + mail (la misma clave que usa desvinculaciones).
  -- planilla_previa: 'previa|' + país + nombre.
  clave       text not null unique,
  fuente      text not null check (fuente in ('form', 'planilla_previa')),
  pais        text check (pais in ('AR', 'UY', 'CL')),
  nombre      text not null,
  -- Mail de la persona. Null si el form lo completó alguien de Tu Terapia
  -- (ahí el mail es el nuestro y no sirve para cruzar).
  email       text,
  -- Solo dígitos. El form lo pide desde octubre 2026.
  cuit        text,
  -- Fecha de aviso (o de la respuesta, si no la pusieron). Null si la
  -- planilla previa no la tiene: en ese caso vale `anio`.
  fecha       date,
  anio        int,
  -- Quién pidió la baja: 'nuestra' (Tu Terapia), 'propia' (el psicólogo/a)
  -- o 'ambos'. Null si no está claro.
  quien       text check (quien in ('nuestra', 'propia', 'ambos')),
  motivo      text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index bajas_historicas_email on public.bajas_historicas (lower(email)) where email is not null;
create index bajas_historicas_cuit  on public.bajas_historicas (cuit) where cuit is not null;

create trigger bajas_historicas_updated_at before update on public.bajas_historicas
  for each row execute function public.set_updated_at();

alter table public.bajas_historicas enable row level security;
create policy "Authenticated users can read bajas_historicas"
  on public.bajas_historicas for select to authenticated using (true);
