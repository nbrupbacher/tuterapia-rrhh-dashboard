-- ============================================================
-- APLICADA el 2026-11-06 (migración "cx_planilla_clientes"), con OK de Talent.
-- Planilla "Rescate CX": qué scripts de Google pueden hablar con
-- app/api/cx/planilla. Tabla nueva; no toca ninguna existente.
--
-- client_id es el cliente OAuth del Apps Script de la planilla (lo devuelve
-- Google al validar el token). No es un secreto: solo dice "este script sí".
-- Sin políticas de RLS: la lee únicamente el endpoint con la service key.
-- ============================================================

create table public.cx_planilla_clientes (
  client_id      text primary key,
  nota           text,
  habilitado_por text not null,
  created_at     timestamptz not null default now()
);

alter table public.cx_planilla_clientes enable row level security;
