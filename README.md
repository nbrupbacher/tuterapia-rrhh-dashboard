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

## Pestaña Growth

Genera insights mensuales accionables para el equipo de RRHH, escritos desde la
oportunidad y con botones Sirve / Descarto para aprender qué tipo de insight es
útil.

### Cómo funciona

1. **Los números los calcula la base.** Una función SQL por generador
   (`growth_gen_<slug>(p_month, p_pais)`), que devuelve un jsonb con los datos y
   la lista de terapeutas afectados.
2. **La redacción vive en TypeScript** (`lib/growth-templates.ts`), con una
   plantilla fija por generador. Sin LLM.
3. **El recálculo** (`lib/growth-recalc.ts`) corre los generadores, rankea y hace
   upsert en `growth_insights`. Se dispara al final de cada carga de CSV y con el
   botón "Recalcular mes".

Si un generador no llega a su mínimo de casos, no genera insight: mejor nada que
ruido.

### Qué se muestra

La tarjeta no muestra plata: muestra cuánto puede crecer el país, en porcentaje
de sus sesiones mensuales (`potencial_pct`). `impacto_usd` se sigue calculando y
queda guardado en el payload, pero no se muestra ni rankea.

Los largos son límites duros, validados en `lib/growth-templates.ts`: título 60
caracteres, cuerpo 220 y 2 frases, acción 100 y con un número. Si un texto se
pasa, el insight no se publica y el error sale en la respuesta del recálculo:
una tarjeta larga es peor que una tarjeta que falta.

Hoy corren tres generadores: `reclutamiento`, `demanda_redirigible` y
`concentracion`. Los otros nueve quedan en `enabled = false` en `growth_config`,
con su código y sus umbrales intactos, para encenderlos sin reescribirlos.

### Ranking

`score = potencial_pct normalizado × penalización × peso de feedback`

- **Penalización 0.5** si el mismo generador y país salió el mes anterior y su
  número principal se movió menos de 15%.
- **Peso de feedback** según el histórico del generador, con piso 0.3 para que
  nunca desaparezca del todo.
- Los insights sin potencial estimable usan un valor base configurable.

### Tablas

- `growth_valor_sesion` — valor por sesión con vigencia mensual (`pais`,
  `vigente_desde`, `valor`, `costo_registro`). Para un mes se usa la fila más
  reciente con `vigente_desde <= month`. Es la fuente de verdad de
  `TARIFAS_VIGENCIA` en `lib/scoring.ts`.
- `growth_config` — key/value con tasas de activación, LTV, umbrales y el flag
  `enabled` de cada generador.
- `growth_insights` — un insight por `(month, pais, generator)`. Recalcular hace
  upsert sin tocar las columnas de feedback, así lo ya marcado se conserva.

### Cosas a tener en cuenta con los datos

- Las comparaciones entre meses se hacen **en sesiones, no en USD**: el valor por
  sesión cambia con el tiempo y en USD aparecerían saltos que no son reales. Los
  USD solo se usan para estimar el impacto del mes actual.
- `hs_disponibles` son horas **por semana**. La capacidad mensual es
  `hs × 4.3`. Los terapeutas sin horas cargadas quedan fuera de los cálculos de
  capacidad y se informan en el propio insight.
- `pct_caida_1ra_sesion` es un acumulado histórico de un único snapshot, no un
  dato del mes. Los textos nunca dicen "este mes" sobre ese número.
- Los terapeutas con `inicio` en el futuro se excluyen de los análisis por
  antigüedad y se listan en el payload de `crecimiento_pais` para corregirlos.
- Que un terapeuta salga del CSV equivale a una baja: la descomposición del
  crecimiento usa la presencia en `monthly_metrics`.
