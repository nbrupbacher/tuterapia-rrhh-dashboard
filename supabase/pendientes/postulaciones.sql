-- ============================================================
-- PENDIENTE (migración "postulaciones"). La aprueba Talent: solo crea
-- tablas nuevas, no toca ninguna existente ni sus datos (acuerdo del
-- 2026-11-05).
--
-- Reclutamiento, etapa 1: las respuestas del form "Requisitos Psicos Tu
-- Terapia" y lo que Talent decide con cada una. Reemplaza la planilla
-- "Matriz Reclutamiento Psicólogos", que era el puente mientras no
-- existía esta solapa.
--
-- El cruce con quienes ya estuvieron en la plataforma (activos o dados de
-- baja, motivo, multas, fantasmeos) NO se guarda: se arma al leer, contra
-- `therapists`, `desvinculaciones`, `multas` y `fantasmeos`. Así, si cambia
-- una baja o se carga el CSV del mes, el cruce ya está al día.
-- ============================================================

-- ===== POSTULACIONES =====
-- Una fila por respuesta del form. Las escribe solo el endpoint
-- app/api/talent/postulaciones (service key), que recibe las filas de un
-- Apps Script en la planilla de respuestas. El equipo solo las lee.
create table public.postulaciones (
  id              uuid primary key default gen_random_uuid(),
  -- Marca temporal + mail: mandar la misma fila dos veces no la duplica.
  clave           text not null unique,
  postulado_at    timestamptz not null,
  -- AR / UY, u 'otro' (Chile cerró, pero alguien puede mudarse: se guarda
  -- igual y se ve aparte). pais_texto es lo que respondió.
  pais            text not null check (pais in ('AR', 'UY', 'otro')),
  pais_texto      text,
  nombre          text not null,
  email           text not null,
  -- Solo dígitos. El form lo pide como requisito excluyente; con esto se
  -- reconoce a quien se vuelve a postular con otro mail.
  cuit            text,
  -- Mínimos excluyentes, tal cual se respondieron ("Sí", "No", ...).
  titulo          text,
  proceso_personal text,
  experiencia_clinica text,
  supervision     text,
  diez_horas      text,
  -- El resto de las preguntas (disponibilidad, modalidad, zona, formación,
  -- CV, video, consultorio, cómo se enteró, LinkedIn, comentarios). En jsonb
  -- porque el form suma preguntas seguido y no hace falta migrar por eso.
  respuestas      jsonb not null default '{}'::jsonb,
  -- Columna ESTADO de la planilla de respuestas, si alguien la completó.
  estado_planilla text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index postulaciones_fecha on public.postulaciones (postulado_at desc);
create index postulaciones_email on public.postulaciones (lower(email));
create index postulaciones_cuit  on public.postulaciones (cuit) where cuit is not null;

create trigger postulaciones_updated_at before update on public.postulaciones
  for each row execute function public.set_updated_at();

alter table public.postulaciones enable row level security;
create policy "Authenticated users can read postulaciones"
  on public.postulaciones for select to authenticated using (true);


-- ===== DECISIONES =====
-- Lo que decide Talent con cada postulación. Una fila por decisión, nunca se
-- pisa: la vigente es la última, y queda el historial de quién cambió qué.
-- El motivo es obligatorio para que una próxima postulación de la misma
-- persona muestre por qué no avanzó.
create table public.postulacion_decisiones (
  id              uuid primary key default gen_random_uuid(),
  postulacion_id  uuid not null references public.postulaciones(id) on delete cascade,
  decision        text not null check (decision in ('avanza', 'no_avanza', 'en_espera')),
  motivo          text not null check (length(trim(motivo)) >= 10),
  decidido_por    text not null,
  created_at      timestamptz not null default now()
);

create index postulacion_decisiones_post
  on public.postulacion_decisiones (postulacion_id, created_at desc);

alter table public.postulacion_decisiones enable row level security;
create policy "Authenticated users can read postulacion_decisiones"
  on public.postulacion_decisiones for select to authenticated using (true);
-- Solo agregar: corregir una decisión es cargar otra.
create policy "Authenticated users can add postulacion_decisiones"
  on public.postulacion_decisiones for insert to authenticated with check (true);
