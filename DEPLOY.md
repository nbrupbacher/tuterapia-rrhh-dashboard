# Cómo deployar este proyecto

Guía paso a paso. Sin terminal. ~15 minutos.

## Pre-requisitos (que ya tenés)

- ✅ Cuenta de GitHub
- ✅ Proyecto de Supabase creado
- ✅ Schema corrido (5 tablas + RLS policies)
- ✅ Tu cuenta de usuario creada en Supabase Auth
- ✅ Project URL y anon key anotadas

## Paso 1 — Crear el repo en GitHub

1. Ir a https://github.com/new
2. Repository name: `tuterapia-rrhh-dashboard`
3. Description: "Dashboard de RRHH de Tu Terapia"
4. **Visibility: Private** (importante, datos sensibles)
5. NO marcar "Add README" ni gitignore ni licencia (vacío)
6. Click **Create repository**

## Paso 2 — Subir los archivos

En la página del repo vacío, click en **"uploading an existing file"** (link en el centro).

1. Abrí la carpeta `tuterapia-rrhh` que descargaste
2. Seleccioná TODO su contenido (no la carpeta, sino los archivos adentro: `app/`, `components/`, `lib/`, `package.json`, `next.config.js`, `tsconfig.json`, `.gitignore`, `.env.example`, `README.md`, `DEPLOY.md`)
3. Arrastrar todo al área de drop
4. Esperá que termine la subida (1-2 min)
5. Abajo, commit message: `Initial commit with Supabase integration`
6. Click **Commit changes**

### Si el drag-and-drop falla con carpetas

Usá GitHub Desktop (https://desktop.github.com/):
1. Instalalo y logueate
2. File → Clone Repository → seleccioná el repo vacío
3. Copiá los archivos en la carpeta clonada
4. En GitHub Desktop: commit + push

## Paso 3 — Conectar a Vercel

1. Ir a https://vercel.com/
2. Sign Up con GitHub si no tenés cuenta
3. **Add New... → Project**
4. Buscar `tuterapia-rrhh-dashboard` → **Import**
5. En la pantalla de configuración, **NO hagas Deploy todavía**. Antes:

### Paso 3.1 — CRÍTICO: agregar las variables de entorno

Hacia el final de la página, abrí la sección **Environment Variables**.

Agregá DOS variables:

**Variable 1:**
- Name: `NEXT_PUBLIC_SUPABASE_URL`
- Value: tu Project URL de Supabase (algo como `https://abcdef.supabase.co`)
- Environments: dejá las 3 marcadas (Production, Preview, Development)
- Click **Add**

**Variable 2:**
- Name: `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Value: tu anon key de Supabase (la cadena larga que empieza con `eyJ...`)
- Environments: las 3
- Click **Add**

**Importante**: los nombres tienen que ser EXACTOS (mayúsculas, guiones bajos). Si te equivocás, el deploy va a fallar.

### Paso 3.2 — Deploy

Ahora sí, click en **Deploy** (botón abajo).

Vercel va a:
1. Clonar el repo
2. Correr `npm install` (descargar dependencias)
3. Correr `npm run build` (compilar)
4. Servir el sitio

Toma 2-4 minutos la primera vez.

## Paso 4 — Probar

Cuando termine el deploy, vas a ver una URL tipo `https://tuterapia-rrhh-dashboard.vercel.app`.

1. Click en la URL
2. Te tendría que redirigir automáticamente a `/login`
3. Ingresá con tu mail @tuterapia.com.uy y la contraseña que pusiste en Supabase
4. Click **Entrar**
5. Vas a ver el dashboard con un mensaje "No hay datos cargados todavía"

**Eso está OK**. Significa que el frontend está conectado a Supabase pero las tablas están vacías. El próximo paso es importar los 426 terapeutas.

## Si algo falla

**Error "Faltan variables de entorno"** al cargar la página:
- Las env vars no se configuraron bien
- Volvé a Vercel → Settings → Environment Variables y verificá los nombres

**"Invalid login credentials"** al intentar entrar:
- La contraseña que ingresaste no coincide con la que pusiste en Supabase
- Volvé a Supabase → Authentication → Users → tu usuario → opciones → "Send password reset"

**Página en blanco**:
- Abrí la consola del browser (F12 → Console)
- Si ves errores rojos, copiámelos

**Build fails** en Vercel:
- Click en el deployment fallido → "View Build Logs"
- Copiame el error

## Próximos pasos

Una vez que esté deployado y puedas loguearte:

1. **Importar los datos** del HTML actual (los 426 terapeutas con su historia)
2. **Implementar el upload de CSV** para meses futuros
3. **Modal de detalle** del terapeuta
4. **Pestaña Progreso**
