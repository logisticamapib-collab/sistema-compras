-- =====================================================================
-- Molde principal de la parte y FIFO cruzado entre codigos equivalentes.
--
-- 1) PRINCIPAL: cuando dos moldes hacen la misma pieza hay que decir con
--    cual se planea y se programa por defecto. Los demas siguen siendo
--    validos para surtir, pero la produccion se dirige al principal.
--
-- 2) FIFO CRUZADO: el FIFO no puede ser por codigo, tiene que ser por
--    PARTE. Ejemplo real: se piden 1000 pz; el molde 001 tiene 500 (250
--    viejas y 250 nuevas) y el 002 tiene 500 intermedias. El orden correcto
--    es 250 del 001, luego las 500 del 002 y al final las 250 del 001. Con
--    el FIFO por codigo cada uno llevaba su propia fila y esto no se veia.
--
-- 3) La descripcion de la parte era redundante con la del articulo, y el
--    nombre pasa a ser opcional.
-- =====================================================================

alter table partes add column if not exists articulo_principal_id int references articulos(id);
alter table partes alter column nombre drop not null;


-- FIFO de la PARTE: todos los lotes de todos los codigos equivalentes,
-- ordenados por fecha sin importar de que molde salieron.
create or replace function fifo_parte(
  p_empresa_id int, p_articulo_id int, p_site_id int default null
)
returns table (
  orden int, lote_id int, codigo_lote text, fecha date,
  articulo_id int, codigo_interno text, molde_clave text,
  disponible numeric, es_el_mismo boolean, acumulado numeric
)
language sql stable as $$
  with eq as (select * from equivalentes_articulo(p_articulo_id)),
  lotes_disp as (
    select l.id lote_id, l.codigo_lote, l.fecha,
           e.articulo_id, e.codigo_interno, e.molde_clave, e.es_el_mismo,
           sum(ex.cantidad) qty
    from eq e
    join lotes l on l.articulo_id = e.articulo_id
         and l.empresa_id = p_empresa_id and l.estatus_calidad = 'liberado'
    join existencias ex on ex.lote_id = l.id
    left join almacenes al on al.id = ex.almacen_id
    where (p_site_id is null or al.site_id is null or al.site_id = p_site_id)
    group by l.id, l.codigo_lote, l.fecha, e.articulo_id, e.codigo_interno,
             e.molde_clave, e.es_el_mismo
    having sum(ex.cantidad) > 0
  )
  select (row_number() over w)::int, lote_id, codigo_lote, fecha,
         articulo_id, codigo_interno, molde_clave, qty, es_el_mismo,
         sum(qty) over w
  from lotes_disp
  window w as (order by fecha nulls first, lote_id)
  order by fecha nulls first, lote_id;
$$;

-- Sugerencia de surtido: recorre el FIFO de la parte y dice cuanto tomar de
-- cada lote hasta cubrir la cantidad pedida, cruzando codigos y moldes.
create or replace function sugerir_surtido_parte(
  p_empresa_id int, p_articulo_id int, p_cantidad numeric, p_site_id int default null
)
returns table (
  orden int, lote_id int, codigo_lote text, fecha date,
  articulo_id int, codigo_interno text, molde_clave text,
  disponible numeric, tomar numeric, es_el_mismo boolean
)
language sql stable as $$
  select f.orden, f.lote_id, f.codigo_lote, f.fecha,
         f.articulo_id, f.codigo_interno, f.molde_clave, f.disponible,
         least(f.disponible,
               greatest(p_cantidad - (f.acumulado - f.disponible), 0)) as tomar,
         f.es_el_mismo
  from fifo_parte(p_empresa_id, p_articulo_id, p_site_id) f
  where (f.acumulado - f.disponible) < p_cantidad
  order by f.orden;
$$;

grant execute on function fifo_parte(int, int, int) to anon, authenticated, service_role;
grant execute on function sugerir_surtido_parte(int, int, numeric, int) to anon, authenticated, service_role;
