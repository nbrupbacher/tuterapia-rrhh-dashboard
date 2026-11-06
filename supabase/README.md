# Cambios de base (Supabase)

Los cambios de base no se revierten como el código, por eso quedan escritos
acá: qué se aplicó y qué espera el OK.

- `aplicadas/`: ya están en la base. Quedan como registro de qué se creó y por qué.
- `pendientes/`: propuestas que todavía no se aplicaron. Cada archivo dice
  arriba quién tiene que dar el OK.

Acuerdo del 2026-11-05: Talent puede aprobar tablas nuevas que solo agregan.
Cambiar tablas existentes, reescribir datos o recalcular sigue necesitando el
OK de Nico.

Al aplicar una pendiente, se mueve a `aplicadas/` con la fecha adelante del
nombre y se cambia el encabezado a "APLICADA".
