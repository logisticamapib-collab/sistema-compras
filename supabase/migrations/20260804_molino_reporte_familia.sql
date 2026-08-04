-- Molino visto por tipo de material, no por articulo.
--
-- Al comprador de scrap y al cliente que reclama su consigna les importa la
-- resina, no de que pieza salio: "cuanto polipropileno tengo, cuanto puedo
-- vender y cuanto tengo que regresar". Este reporte se arma sobre la misma
-- funcion molino_reporte para que los numeros por articulo y por familia
-- nunca se contradigan.
--
-- kg_en_piso se parte en tres y la suma de las tres da el total:
--   vendible     -> la politica permite venderlo
--   por_retornar -> es de un cliente y se le regresa
--   sin_salida   -> no se puede vender ni esta marcado para retorno; casi
--                   siempre significa que falta capturar la politica
create or replace function molino_reporte_familia(
  p_empresa_id integer, p_desde date, p_hasta date, p_site_id integer default null
) returns table(
  familia_id integer, clave text, nombre text, tipo_material text,
  codigos integer,
  kg_generado numeric, monto_generado numeric,
  kg_recuperado numeric, monto_recuperado numeric,
  kg_vendido numeric, kg_retornado numeric,
  kg_en_piso numeric, monto_en_piso numeric,
  kg_vendible numeric, kg_por_retornar numeric, kg_sin_salida numeric,
  pct_recuperado numeric
) language sql stable as $$
with r as (
  select * from molino_reporte(p_empresa_id, p_desde, p_hasta, p_site_id)
),
d as (
  select r.*, a.familia_resina_id, f.clave, f.nombre, f.orden,
         pol.permite_venta, pol.retorna_cliente
  from r
  join articulos a on a.id = r.articulo_id
  left join familias_resina f on f.id = a.familia_resina_id
  cross join lateral molido_politica(p_empresa_id, r.articulo_id) pol
)
select
  d.familia_resina_id,
  coalesce(d.clave, 'SIN')::text,
  coalesce(d.nombre, 'Sin familia de resina asignada')::text,
  d.tipo_material,
  count(*)::int,
  sum(d.kg_generado), sum(d.monto_generado),
  sum(d.kg_recuperado), sum(d.monto_recuperado),
  sum(d.kg_vendido), sum(d.kg_retornado),
  sum(d.kg_en_piso),
  round(sum(d.kg_en_piso * coalesce(d.costo_unitario,0)), 2),
  sum(case when d.permite_venta then d.kg_en_piso else 0 end),
  sum(case when not d.permite_venta and d.retorna_cliente then d.kg_en_piso else 0 end),
  sum(case when not d.permite_venta and not d.retorna_cliente then d.kg_en_piso else 0 end),
  case when sum(d.kg_generado) > 0
       then round(100.0 * sum(d.kg_recuperado) / sum(d.kg_generado), 1) end
from d
group by d.familia_resina_id, d.clave, d.nombre, d.orden, d.tipo_material
order by coalesce(d.orden, 9999), coalesce(d.clave, 'ZZZ'), d.tipo_material;
$$;
