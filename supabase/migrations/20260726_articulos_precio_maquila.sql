-- Precio de compra al maquilador (se habilita en Articulos cuando el PT va a maquila).
alter table articulos add column if not exists precio_maquila numeric;
