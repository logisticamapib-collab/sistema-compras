-- El mismo candado de borrado que ya cuida clientes y proveedores, ahora en
-- los dos ejes que separan corridas de un mismo molde. Borrar una variante o
-- un color que algun articulo esta usando lo dejaria sin el dato que decide
-- si sale del mismo disparo que otro, y eso se traduce en shots mal
-- calculados sin que nada lo delate.
--
-- La funcion recorre pg_constraint, asi que no hubo que ensenarle nada nuevo:
-- solo colgarle el disparador y ponerle etiqueta legible al motivo. La
-- definicion completa de referencias_de vive en la migracion de variantes de
-- codigo; aqui solo se agregan las etiquetas nuevas.

drop trigger if exists tg_variantes_codigo_borrado_seguro on variantes_codigo;
create trigger tg_variantes_codigo_borrado_seguro
  before delete on variantes_codigo
  for each row execute function trg_bloquea_borrado_referenciado();

drop trigger if exists tg_colores_borrado_seguro on colores;
create trigger tg_colores_borrado_seguro
  before delete on colores
  for each row execute function trg_bloquea_borrado_referenciado();

-- Etiquetas nuevas en referencias_de:
--   articulos.variante_codigo_id  -> 'Articulos con esta variante'
--   articulos.color_id            -> 'Articulos de este color'
--   color_cambios.*               -> 'Cambios de color capturados'
-- (aplicadas via apply_migration con la definicion completa de la funcion)
