# Tu Terapia — RRHH Dashboard

Dashboard de performance de terapeutas, conectado a Supabase.

## Estado

- ✅ Frontend Next.js completo
- ✅ Login con email + password
- ✅ Auth guard (redirige a /login si no estás logueado)
- ✅ Conexión a Supabase para leer therapists / therapist_state / monthly_metrics
- ⏳ Importación de datos desde el HTML actual (próximo paso)
- ⏳ Upload de CSV mensual (siguiente sprint)

## Stack

- Next.js 14 (App Router)
- React + TypeScript
- Supabase (auth + DB)
- Vercel (hosting)

## Variables de entorno

Necesitás dos:

```
NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJI...
```

En **Vercel**: Project Settings → Environment Variables.
En **local** (opcional): crear `.env.local` con esos dos valores.

## Estructura

```
app/
  layout.tsx          # Wrapper global
  page.tsx            # Dashboard principal (auth-guarded)
  login/page.tsx      # Página de login
  globals.css         # CSS global

components/
  Header.tsx          # Logo + toggles + logout
  KpiSection.tsx      # Tarjetas de KPI
  TableTabs.tsx       # Tabs (Todos, Irrecuperables, etc.)
  TableFilters.tsx    # Search + selects
  DashboardTable.tsx  # Tabla con sort y paginación

lib/
  types.ts            # Tipos TypeScript
  helpers.ts          # Funciones puras
  supabase.ts         # Cliente de Supabase
```

## Flujo de auth

1. Usuario entra a `/`
2. La página verifica si hay sesión activa
3. Si no hay → redirect a `/login`
4. Login → email + password (vía Supabase Auth)
5. Si OK → redirect a `/`
6. Dashboard carga datos de Supabase

## Próximos pasos

1. Importar los 426 terapeutas del HTML actual a Supabase
2. Implementar página de upload de CSV mensual
3. Recalcular state automáticamente al subir un mes nuevo
4. Modal de detalle del terapeuta
5. Notas y videollamadas (capa humana)
6. Pestaña Progreso con gráficos
