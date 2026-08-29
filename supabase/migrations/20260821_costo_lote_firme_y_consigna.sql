-- Dos cosas que faltaban para que el congelamiento sirva de verdad.
--
-- 1) COSTO FIRME vs PROVISIONAL. Si la politica dice que la tasa se congela
--    con la factura del proveedor, el lote no puede quedarse sin costo hasta
--    que la factura llegue: el inventario tendria un hueco. Se congela al
--    recibir con la tasa del dia, pero marcado como PROVISIONAL. Cuando exista
--    la pantalla de facturas, congelar_costo_lote se vuelve a llamar con el
--    precio de la factura y lo pasa a firme. Asi el numero existe desde el
--    primer dia y se sabe cual todavia puede moverse.
--
-- 2) CONSIGNA. El material que el cliente suministra no es nuestro y entra a
--    costo cero. Si el lote se quedara sin costo congelado, valor_inventario
--    caeria al costo estandar del articulo y estaria inflando el inventario
--    con material ajeno. Congelar en cero no es un detalle de forma: es lo que
--    impide ese error. Con 500 kg de un articulo a 3.00 USD y tasa 17.40, la
--    diferencia son 26,100 pesos de inventario que no existen.
--
-- valor_inventario reporta ahora tambien si el costo es provisional, para que
-- un reporte no presente como definitivo un numero que todavia puede moverse.
--
-- Aplicada via apply_migration.

alter table lotes add column if not exists costo_firme boolean not null default true;

-- congelar_costo_lote gana el parametro p_firme: si no se dice, lo decide la
-- politica de la empresa.
-- valor_inventario gana la columna costo_firme y distingue el origen
-- 'consigna: costo cero, no es nuestro'.
