-- ============================================================
-- APLICADA el 2026-11-09 (migración "resenas_revision"), con OK de Talent.
-- Solapa En vivo → Reseñas. Tabla nueva; no toca ninguna existente.
--
-- Las reseñas viven en la plataforma (MySQL `rating`) y se leen en el
-- momento. Acá solo queda lo que hace el equipo con cada una: si la revisó,
-- una nota, y si la sumó al ticker de novedades. La aprobación o denegación
-- sigue en el back de la plataforma.
-- ============================================================

create table public.resenas_revision (
  -- rating.idRating de la plataforma
  resena_id     bigint primary key,
  therapist_id  text not null,
  tipo          text not null check (tipo in ('mirar', 'reconocer')),
  revisada_at   timestamptz,
  revisada_por  text,
  nota          text,
  -- Ticker: el texto se guarda armado (nombre + frase corta) porque el
  -- ticker lee solo de Supabase. Sale solo después de ticker_hasta.
  en_ticker     boolean not null default false,
  ticker_texto  text,
  ticker_hasta  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index resenas_revision_ticker on public.resenas_revision (ticker_hasta) where en_ticker;

create trigger resenas_revision_updated_at before update on public.resenas_revision
  for each row execute function public.set_updated_at();

alter table public.resenas_revision enable row level security;
create policy "Authenticated users can read resenas_revision"
  on public.resenas_revision for select to authenticated using (true);
create policy "Authenticated users can write resenas_revision"
  on public.resenas_revision for all to authenticated using (true) with check (true);
