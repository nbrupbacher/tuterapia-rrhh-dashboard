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
| **Vercel** | Miembro del team | Ver deploys y leer errores cuando algo falla |

Usá una cuenta de GitHub **personal**, no una casilla compartida del equipo.
Si tres personas entran con el mismo usuario, después no se sabe quién hizo
qué.

Vercel es el menos urgente: los deploys salen solos. Lo vas a necesitar
cuando algo falle y haya que leer el log.

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

**3. El merge a `main` y las migraciones los aprueba el dueño.** Vos proponés
en una rama y lo mostrás funcionando con el preview de Vercel. Experimentá
todo lo que quieras ahí.

**4. La `SUPABASE_SERVICE_ROLE_KEY` saltea todos los permisos.** Solo va en
`.env.local` y en la configuración del entorno. Nunca en el código, nunca en
un chat, nunca en una variable `NEXT_PUBLIC_`.

---

## El flujo de trabajo

1. Rama nueva desde `main`.
2. Cambios. Si es código, `npm run build` antes de abrir el PR.
3. Push y PR. Vercel arma un preview automático de la rama.
4. Mirás el preview, confirmás que funciona.
5. El dueño mergea. Vercel deploya `main` a producción solo.

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

El historial de deploys de Vercel permite volver al anterior en un click. Los
cambios de código se revierten solos al hacer rollback; **los cambios en la
base no**. Por eso la regla 1.
