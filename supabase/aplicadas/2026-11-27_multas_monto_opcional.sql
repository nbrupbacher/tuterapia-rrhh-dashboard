-- ============================================================
-- APLICADA el 2026-11-27 (migración "multas_monto_opcional"), con OK de Talent.
-- Multas: el monto pasa a ser opcional, para registrar la multa primero y
-- calcular los montos después.
--
-- Solo saca el NOT NULL de `monto`. No borra ni cambia datos.
-- - `saldo` es una columna calculada (GREATEST(monto - retenido, 0)): queda
--   vacía mientras la multa no tenga monto.
-- - `multas_monto_check` (monto > 0) sigue valiendo cuando hay monto.
-- - `retenido` sigue con default 0.
-- ============================================================

alter table public.multas alter column monto drop not null;
