-- Consumo agrupado por el eje que se pida. Una sola funcion para que todos
-- los cortes salgan de la misma base y no se contradigan entre pantallas.
--
-- Al agrupar por un eje, los vales que fueron a otro destino se siguen
-- contando (si no, el total no cuadraria con el gasto real), pero se etiquetan
-- como "otro destino" y no como "sin asignar": no es un dato faltante, es un
-- consumo que simplemente no fue a un molde cuando estas viendo moldes.
create or replace function toolcrib_consumo(
  p_empresa_id integer, p_desde date, p_hasta date,
  p_agrupar text default 'molde', p_site_id integer default null
) returns table(
  clave text, nombre text, vales integer, renglones integer,
  piezas numeric, monto numeric, pct numeric
) language sql stable as $$
  with base as (
    select v.id vale_id, l.id linea_id, l.cantidad, coalesce(l.costo_total, 0) monto,
           v.destino_tipo, v.molde_id, v.maquina_id, v.area_id,
           v.centro_costo_id, l.cuenta_gasto_id, l.articulo_id
    from toolcrib_vales v
    join toolcrib_vale_lineas l on l.vale_id = v.id
    where v.empresa_id = p_empresa_id
      and v.estatus = 'surtido'
      and v.fecha::date between p_desde and p_hasta
      and (p_site_id is null or v.site_id is null or v.site_id = p_site_id)
  ),
  etiquetado as (
    select case p_agrupar
             when 'molde'        then mo.clave
             when 'maquina'      then mq.clave
             when 'area'         then ar.clave
             when 'articulo'     then a.codigo_interno
             when 'centro_costo' then cc.codigo
             when 'cuenta'       then cg.codigo
             else b.destino_tipo
           end cl,
           case p_agrupar
             when 'molde'        then mo.nombre
             when 'maquina'      then mq.nombre
             when 'area'         then ar.nombre
             when 'articulo'     then a.descripcion
             when 'centro_costo' then cc.nombre
             when 'cuenta'       then cg.nombre
             else b.destino_tipo
           end nb,
           b.*
    from base b
    left join moldes mo         on mo.id = b.molde_id
    left join maquinas mq       on mq.id = b.maquina_id
    left join areas ar          on ar.id = b.area_id
    left join articulos a       on a.id  = b.articulo_id
    left join centros_costos cc on cc.id = b.centro_costo_id
    left join cuentas_gastos cg on cg.id = b.cuenta_gasto_id
  ),
  tot as (select nullif(sum(monto), 0) t from etiquetado)
  select coalesce(e.cl,
           case when p_agrupar in ('molde','maquina','area') then 'otro destino'
                else 'sin asignar' end)::text,
         coalesce(e.nb,
           case when p_agrupar = 'molde'   then 'Consumo que no fue a un molde'
                when p_agrupar = 'maquina' then 'Consumo que no fue a una maquina'
                when p_agrupar = 'area'    then 'Consumo que no fue a un area'
                else 'Sin asignar' end)::text,
         count(distinct e.vale_id)::int,
         count(*)::int,
         sum(e.cantidad),
         round(sum(e.monto), 2),
         round(100.0 * sum(e.monto) / (select t from tot), 1)
  from etiquetado e, tot
  group by 1, 2
  order by sum(e.monto) desc;
$$;

-- Reincidencia: la misma refaccion consumida una y otra vez en el mismo
-- objeto. Eso no es gasto, es un sintoma, y no se ve mirando el gasto por mes
-- porque ahi cada consumo es chico y se pierde entre los demas.
create or replace function toolcrib_reincidencia(
  p_empresa_id integer, p_desde date, p_hasta date,
  p_min_veces integer default 3, p_site_id integer default null
) returns table(
  destino_tipo text, destino text, articulo text, descripcion text,
  veces integer, piezas numeric, monto numeric,
  primera date, ultima date, dias_entre numeric
) language sql stable as $$
  select v.destino_tipo,
         coalesce(mo.clave, mq.clave, ar.clave, 'general')::text,
         a.codigo_interno, a.descripcion,
         count(*)::int, sum(l.cantidad), round(sum(coalesce(l.costo_total,0)), 2),
         min(v.fecha)::date, max(v.fecha)::date,
         case when count(*) > 1
              then round((max(v.fecha)::date - min(v.fecha)::date)::numeric / (count(*) - 1), 1) end
  from toolcrib_vales v
  join toolcrib_vale_lineas l on l.vale_id = v.id
  join articulos a on a.id = l.articulo_id
  left join moldes mo   on mo.id = v.molde_id
  left join maquinas mq on mq.id = v.maquina_id
  left join areas ar    on ar.id = v.area_id
  where v.empresa_id = p_empresa_id
    and v.estatus = 'surtido'
    and v.fecha::date between p_desde and p_hasta
    and v.destino_tipo in ('molde','maquina')
    and (p_site_id is null or v.site_id is null or v.site_id = p_site_id)
  group by v.destino_tipo, coalesce(mo.clave, mq.clave, ar.clave, 'general'),
           a.codigo_interno, a.descripcion, v.molde_id, v.maquina_id
  having count(*) >= greatest(coalesce(p_min_veces, 3), 2)
  order by count(*) desc, sum(coalesce(l.costo_total,0)) desc;
$$;

-- Lo que de verdad decide si un molde conviene repararlo o reemplazarlo:
-- cuanto lleva costando en refacciones contra cuantos shots ha dado. El gasto
-- absoluto engana, porque un molde que produce el triple gasta mas y esta bien.
create or replace function toolcrib_costo_molde(
  p_empresa_id integer, p_desde date default null, p_hasta date default null
) returns table(
  molde_id integer, clave text, nombre text, cavidades integer,
  shots_acumulados numeric, estado text,
  vales integer, monto_refacciones numeric,
  costo_por_mil_shots numeric,
  mttos integer, ultimo_mtto date
) language sql stable as $$
  select m.id, m.clave, m.nombre, m.num_cavidades,
         m.shots_acumulados, m.estado,
         count(distinct v.id)::int,
         round(coalesce(sum(l.costo_total), 0), 2),
         case when coalesce(m.shots_acumulados, 0) > 0
              then round(coalesce(sum(l.costo_total), 0) * 1000.0 / m.shots_acumulados, 2) end,
         (select count(*)::int from molde_mtto mm
          where mm.molde_id = m.id and mm.estatus = 'cerrada'),
         m.fecha_ultimo_mtto
  from moldes m
  left join toolcrib_vales v
    on v.molde_id = m.id and v.estatus = 'surtido'
    and (p_desde is null or v.fecha::date >= p_desde)
    and (p_hasta is null or v.fecha::date <= p_hasta)
  left join toolcrib_vale_lineas l on l.vale_id = v.id
  where m.empresa_id = p_empresa_id and m.activo
  group by m.id, m.clave, m.nombre, m.num_cavidades, m.shots_acumulados, m.estado, m.fecha_ultimo_mtto
  order by coalesce(sum(l.costo_total), 0) desc;
$$;

-- Lo que Toolcrib tiene y como va de existencia, para el almacen marcado.
create or replace function toolcrib_existencias(
  p_empresa_id integer, p_almacen_id integer default null
) returns table(
  articulo_id integer, codigo_interno text, descripcion text, unidad text,
  categoria text, existencia numeric, costo numeric, valor numeric,
  stock_minimo numeric, bajo_minimo boolean,
  consumo_90d numeric, ultima_salida date
) language sql stable as $$
  select a.id, a.codigo_interno, a.descripcion, a.unidad_medida, c.nombre,
         coalesce(sum(ex.cantidad), 0), a.costo,
         round(coalesce(sum(ex.cantidad), 0) * coalesce(a.costo, 0), 2),
         a.stock_minimo,
         coalesce(a.stock_minimo, 0) > 0 and coalesce(sum(ex.cantidad), 0) < a.stock_minimo,
         (select coalesce(sum(l2.cantidad), 0) from toolcrib_vale_lineas l2
          join toolcrib_vales v2 on v2.id = l2.vale_id
          where l2.articulo_id = a.id and v2.estatus = 'surtido'
            and v2.fecha >= now() - interval '90 days'),
         (select max(v3.fecha)::date from toolcrib_vale_lineas l3
          join toolcrib_vales v3 on v3.id = l3.vale_id
          where l3.articulo_id = a.id and v3.estatus = 'surtido')
  from articulos a
  left join categorias c on c.id = a.categoria_id
  left join lotes lo on lo.articulo_id = a.id
  left join existencias ex on ex.lote_id = lo.id
    and (p_almacen_id is null or ex.almacen_id = p_almacen_id)
    and ex.almacen_id in (select id from almacenes where empresa_id = p_empresa_id and es_toolcrib)
  where a.empresa_id = p_empresa_id and a.activo
  group by a.id, a.codigo_interno, a.descripcion, a.unidad_medida, c.nombre, a.costo, a.stock_minimo
  having coalesce(sum(ex.cantidad), 0) > 0 or coalesce(a.stock_minimo, 0) > 0
  order by a.codigo_interno;
$$;
