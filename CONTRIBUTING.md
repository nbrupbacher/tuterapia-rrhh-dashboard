# Cómo sumarse al proyecto

Guía para alguien que entra por primera vez. Si sabés programar y si no
también: la mayor parte del trabajo acá se hace conversando con Claude Code.

## Qué es esto

El dashboard que usa el equipo de RRHH para decidir a qué terapeutas
acompañar cada mes. Está en producción y lo usa gente todos los días.

---

## Paso 1 — Los accesos

Estos no los podés conseguir solo. Pediéselos al dueño del proyecto:

| Dónde | Qué pedir | Para qué |
|---|---|---|
| **GitHub** | Collaborator en el repo `tuterapia-rrhh-dashboard` | Ver el código, crear ramas, abrir PRs |
| **Supabase** | Miembro del proyecto | Ver los datos y las API keys |

**Vercel no hace falta.** El plan actual no permite sumar gente, y tampoco lo
necesitás: más abajo está cómo ver tu cambio funcionando sin eso.

Usá una cuenta de GitHub **personal**, no una casilla compartida del equipo.
Si tres personas entran con el mismo usuario, después no se sabe quién hizo
qué.

## Paso 2 — Conectar GitHub con Claude

Este paso se olvida siempre y es el que hace que Claude Code pueda ver el
repo. Ser collaborator **no alcanza**.

Entrá a **https://claude.ai/connect-github** y conectá tu cuenta. Si el repo
no aparece, puede faltar que un owner de la organización instale la app de
Claude sobre el repositorio, desde esa misma página.

## Paso 3 — Elegí cómo vas a trabajar

**Opción A — Claude Code en la web** (recomendada si no programás)

No instalás nada. Entrás a claude.ai/code, elegís el repo y listo. Claude
tiene el proyecto clonado y puede correr comandos.

Las tres variables de entorno se cargan una sola vez en la configuración del
entorno — menú del entorno en la barra de título de la sesión, Edit — y las
sesiones nuevas las toman solas. **Nunca pegues una API key en el chat.**

**Opción B — Local**

Necesitás Node 20 o superior.

```bash
git clone https://github.com/nbrupbacher/tuterapia-rrhh-dashboard.git
cd tuterapia-rrhh-dashboard
npm install
cp .env.example .env.local    # completar con las claves de Supabase
npm run dev
```

Abrís http://localhost:3000. Para entrar necesitás un usuario creado en
Supabase Auth: pedilo también.

> Si corrés `npm run build` sin `.env.local`, falla en el prerender de `/` y
> `/login`. No está roto: esas páginas crean el cliente de Supabase en build
> time y necesitan las variables.

---

## Las cuatro reglas

**1. No hay base de staging.** Local, los previews y producción pegan contra
el mismo Supabase. Una migración se ve en producción apenas se aplica, antes
de cualquier merge. Antes de aplicar algo que toque datos, mostrá cuántas
filas cambiarían y esperá el OK.

**2. Los datos son reales y nominales.** Nombres, emails y teléfonos de ~480
terapeutas. No salen del proyecto.

**3. El código lo mergeás vos; la base, no.** Podés mergear tu propio PR a
`main` si CI está en verde. Se revierte en un click si algo sale mal. Lo que
sí necesita el OK del dueño es todo lo que escribe en Supabase: migraciones y
recálculos de meses, porque eso no se revierte.

**4. La `SUPABASE_SERVICE_ROLE_KEY` saltea todos los permisos.** Solo va en
`.env.local` y en la configuración del entorno. Nunca en el código, nunca en
un chat, nunca en una variable `NEXT_PUBLIC_`.

---

## El flujo de trabajo

1. Rama nueva desde `main`.
2. Cambios.
3. **Lo probás corriendo la app**: `npm run dev`, entrás con tu usuario y
   mirás que haga lo que esperabas. Esto reemplaza al preview de Vercel y es
   mejor, porque iterás sin esperar un deploy.
4. Push y PR. CI corre typecheck y build solo.
5. Con CI en verde, mergeás. Vercel deploya `main` a producción.

Si el cambio además necesita una migración o recalcular un mes, eso va
aparte y lo aprueba el dueño. Primero se mergea el código, después se toca la
base.

### Si CI está en rojo

El error que ves en GitHub es el mismo que te da `npm run build` local. Casi
siempre es un error de TypeScript. Arreglalo, pusheá de nuevo y CI se vuelve a
correr solo.

### Si algo falla ya en producción

Los errores de runtime se ven en la consola del navegador (F12): la app es
casi toda cliente. Si hay que volver atrás, avisá al dueño, que tiene el
rollback de Vercel.

## Por dónde empezar a leer

Si querés entender el proyecto antes de tocarlo, en este orden:

1. **`CLAUDE.md`** — el contexto completo, las trampas y los pendientes. Es lo
   que Claude lee solo al abrir el repo, y lo que más rápido te pone al día.
2. **`README.md`** — qué hace cada parte.
3. **`lib/scoring.ts`** — cómo se calcula el score y el cuadrante de cada
   terapeuta. Es el corazón del producto.
4. **`lib/growth-templates.ts`** — cómo se escriben los insights mensuales.
   Si querés cambiar qué dice una tarjeta, está todo acá.

## Cosas fáciles para arrancar

- Cambiar el texto de una tarjeta de Growth: `lib/growth-templates.ts`.
- Ajustar un umbral sin tocar código: la tabla `growth_config` en Supabase.
- Encender un generador apagado: cambiar `enabled` en esa misma tabla.

## Si algo se rompe

Un cambio de código se revierte en un click: `git revert` del PR, o el
rollback en el historial de deploys de Vercel. Por eso podés mergear tranquilo.

**Los cambios en la base no se revierten.** Por eso la regla 1 y por eso las
migraciones las aprueba el dueño.
