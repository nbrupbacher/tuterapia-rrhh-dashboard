-- ============================================================
-- APLICADA el 2026-11-27 (migración "multas_notificada_opcional"), pedido de
-- Talent: todos los datos de la multa opcionales, para registrarla primero y
-- completar después.
--
-- Solo saca el NOT NULL de `notificada_el` (fecha en que se mandó el mail).
-- No borra ni cambia datos. Sin fecha, la multa queda "Sin notificar" y sin
-- vencimiento hasta que se cargue.
-- ============================================================

alter table public.multas alter column notificada_el drop not null;
