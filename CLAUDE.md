# Contexto del proyecto

Dashboard interno de RRHH de Tu Terapia. Mide la performance de ~480
terapeutas en Argentina y Uruguay, y le dice al equipo de RRHH a quién
acompañar cada mes y por qué.

Next.js 14 (App Router) + Supabase + Vercel. TypeScript. Sin framework de
estilos: CSS plano con variables en `app/globals.css`.

## Lo primero que hay que saber

**No hay base de staging.** Local, los previews de Vercel y producción pegan
contra el mismo proyecto de Supabase. Una migración se ve en producción en el
momento en que se aplica, antes de cualquier merge. Mostrá el impacto antes de
aplicar algo que toque datos, y esperá el OK.

**Los datos son nominales.** Nombres, emails y teléfonos de terapeutas reales.
No los saques del proyecto, no los pegues en servicios externos, no los uses
para armar ejemplos fuera de este repo.

**El código se mergea solo; la base, no.** Cualquiera del equipo puede
mergear su PR a `main` y eso deploya a producción. Es seguro porque se
revierte: `git revert` más el rollback de Vercel, un click. Lo que NO se
revierte es lo que se escribe en Supabase — migraciones y recálculos de meses
—, y eso necesita el OK del dueño del proyecto antes de aplicarse.

Si una tarea toca las dos cosas, el orden es: mergear el código primero,
después recalcular. Al revés, producción queda mostrando algo que el código
deployado no sabe regenerar.

## Cómo correrlo

```bash
npm install
cp .env.example .env.local   # completar las 3 variables
npm run dev
```

Son **tres** variables, no dos: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`. Sin la tercera
la app levanta, pero fallan la carga de CSV y el recálculo de Growth.

`npm run build` sin variables de entorno falla en el prerender de `/` y
`/login`. No está roto: esas páginas crean el cliente de Supabase en build
time. Con `.env.local` completo, compila.

## Las dos capas

El dashboard tiene dos sistemas que se confunden fácil:

**Matrix** (`lib/scoring.ts`, `lib/situations.ts`, `lib/actions.ts`) — por
terapeuta y por mes. Calcula score, zona, cuadrante, y de ahí las
*situaciones* y la *acción* (Meet, WhatsApp, Retención, Destacado…). Se
calcula entero al cargar el CSV del mes y se guarda en `therapist_state`.

**Growth** (`lib/growth*.ts`, `components/GrowthView.tsx`) — por país y por
mes. Insights accionables para RRHH. Los números los calculan funciones SQL
(`growth_gen_<slug>`), la redacción vive en TypeScript con plantillas fijas,
sin LLM.

## Trampas que ya costaron caro

**Las tarjetas de Growth salen de la base, no del código.** Viven en
`growth_insights`. Si cambiás un generador y recalculás un mes sin haber
mergeado, producción muestra algo que el código deployado no sabe regenerar:
el próximo "Recalcular mes" lo revierte. Mergeá y recalculá, en ese orden.

**Los umbrales que parecen constantes no siempre lo son.** El umbral de
ganancia del cuadrante es la mediana real del país en el mes que se calcula,
no un número fijo. Las constantes de `MED_FALLBACK` son solo el fallback.
Antes había constantes fijas y quedaron desfasadas: AR estaba en 16 contra una
mediana real de 39,75, y dos de cada tres argentinos contaban como "ganancia
alta".

**El valor por sesión tiene vigencia por mes** (`TARIFAS_VIGENCIA` en
`lib/scoring.ts`, espejo de la tabla `growth_valor_sesion`). AR pasó de 5,5 a
6,0 en 2026-08. Por eso las comparaciones entre meses se hacen **en sesiones,
no en USD**: en USD aparecería un salto que no es real.

**`pacientes_unicos` es un stock, no un flujo.** Medir "crecimiento neto de
pacientes" sobre una cartera estable da cero todos los meses. Eso metía a los
mejores terapeutas del país en la lista de Meet.

**`primera_sesion_snapshots` guarda el acumulado histórico, no el mes.** Ver
la sección de primera sesión en el README antes de tocar nada de ahí.

**`hs_disponibles` son horas por semana.** Capacidad mensual = `hs × 4.3`.

**Hay terapeutas con `inicio` en el futuro.** Son un error de carga. Se
excluyen de todo análisis por antigüedad y no se corrigen desde el código.

## Al recalcular un mes

`calcScore` recibe el mes del período (`'YYYY-MM'`), no el mes del sistema.
De ahí salen el valor por sesión vigente y el filtro estacional de
situaciones. Pasarle el mes equivocado deja el resultado corrido sin que nada
falle visiblemente.

La ventana 45-55 días se evalúa por **solapamiento** con el mes, no mirando un
solo día. Antes miraba el día 1 y perdía al 68% de la gente.

`auditoria_ventana_45_55(month)` verifica el resultado después de calcular un
mes, y corre sola al final de cada carga de CSV. Si devuelve filas que no sean
`proximo_mes`, algo falló.

## Estado de Growth

Generadores activos hoy: `crecimiento_pais` (va siempre primero, fuera del
ranking), `reclutamiento`, `demanda_redirigible`, `concentracion`.

Apagados, con su código y umbrales intactos, en `growth_config`:
`primera_sesion`, `nuevos_destacados`, `cancelaciones_foco`,
`foco_acompanamiento`, `top_a_recuperar`, `perfil_que_crece`,
`lugar_en_buenos_terapeutas`, `terapeutas_completos`.

Encender uno es cambiar `enabled` en `growth_config`. No hace falta tocar
código.

## Tono de los textos de Growth

Español rioplatense, de vos. Se lee en 10 segundos y dice qué hacer. Siempre
desde la oportunidad: nada de "problema", "fallan", "malo", "bajo
rendimiento". Se describe lo que muestran los datos sin suponer el motivo — el
motivo lo descubre el equipo hablando con cada terapeuta. Si el país cae, se
dice sin suavizar, pero la tarjeta igual termina en una acción.

Los largos son límites duros validados en `lib/growth-templates.ts`: título 60
caracteres, cuerpo 220 y 2 frases, acción 100 y con un número. Si un texto se
pasa, el insight no se publica y el error sale en la respuesta del recálculo.
Es a propósito: una tarjeta larga es peor que una tarjeta que falta.

## Pendientes abiertos

- **Primera sesión**: encender el generador cuando haya tres snapshots (con el
  de octubre 2026). La medición correcta —primera sesión en el mes y segunda
  dentro de los 30 días— sale de los datos crudos, no de los snapshots.
- **Ventana 45-55**: hoy la acción la define la situación más grave, así que
  alguien en la ventana puede salir como WhatsApp en vez de Meet o Destacado.
  Falta definir si dentro de la ventana la acción la fija la ventana.
- **Meet**: la exención por antigüedad (`MEET_EXIME_CAIDA_DIAS`, 180 días)
  está sosteniendo la mitad de la lista, incluidos terapeutas que sí tienen
  dato de primera sesión y retienen bien.

## Convenciones

Comentarios y textos de UI en español. Los comentarios explican **por qué**,
no qué hace la línea; varios de los de este repo documentan un bug que ya
ocurrió, así que no los borres al refactorizar.

Rama desde `main`, PR, merge. Vercel deploya `main` a producción.

Todo PR pasa por CI (`.github/workflows/ci.yml`): typecheck y build. Corre sin
secretos, con variables de Supabase de mentira, porque el build solo necesita
que existan. Si CI está en rojo, no se mergea.
