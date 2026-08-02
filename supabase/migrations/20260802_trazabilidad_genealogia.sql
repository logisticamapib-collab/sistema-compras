-- =====================================================================
-- Trazabilidad completa de lote (genealogia hacia atras e impacto hacia
-- adelante). Requisito IATF 16949 para atencion de recall / contencion.
-- =====================================================================

-- Vista unificada: que lote(s) produjo cada reporte de OT.
-- ot_reportes.lote_id cubre el caso de un solo articulo; ot_reporte_articulos
-- cubre los moldes familiares (varios articulos por disparo).
create or replace view ot_reporte_lotes as
select distinct on (reporte_id, lote_id)
       reporte_id, ot_id, lote_id, articulo_id,
       cantidad_ok, cantidad_scrap, turno, fecha, reportado_por
from (
  select r.id as reporte_id, r.ot_id, r.lote_id, l.articulo_id,
         r.cantidad_ok, r.cantidad_scrap, r.turno, r.fecha, r.reportado_por
  from ot_reportes r
  join lotes l on l.id = r.lote_id
  where r.lote_id is not null
  union all
  select ra.reporte_id, r.ot_id, ra.lote_id, l.articulo_id,
         ra.cantidad_ok, ra.cantidad_scrap, r.turno, r.fecha, r.reportado_por
  from ot_reporte_articulos ra
  join ot_reportes r on r.id = ra.reporte_id
  join lotes l on l.id = ra.lote_id
  where ra.lote_id is not null
) u
order by reporte_id, lote_id, fecha;


-- ---------------------------------------------------------------------
-- Resolver la entrada del usuario: acepta folio de caja/tarima, codigo de
-- lote, folio de embarque o folio de OT y devuelve los lotes candidatos.
-- ---------------------------------------------------------------------
create or replace function traza_buscar(p_empresa_id int, p_texto text)
returns table (
  tipo text, lote_id int, codigo_lote text,
  articulo_codigo text, articulo_desc text, detalle text
)
language sql stable as $$
  with q as (select upper(trim(coalesce(p_texto,''))) as t)
  select 'Caja / tarima'::text, c.lote_id, l.codigo_lote,
         a.codigo_interno, a.descripcion,
         ('Folio ' || c.folio || ' - ' || coalesce(c.tipo,'caja') || ' - ' || coalesce(c.cantidad,0)::text || ' pz')::text
  from contenedores c
  join q on upper(c.folio) = q.t
  join lotes l on l.id = c.lote_id
  join articulos a on a.id = l.articulo_id
  where c.empresa_id = p_empresa_id

  union all
  select 'Lote'::text, l.id, l.codigo_lote, a.codigo_interno, a.descripcion,
         ('Origen ' || coalesce(l.origen,'-') || ' - ' || coalesce(l.estatus_calidad,'-'))::text
  from lotes l
  join q on upper(l.codigo_lote) = q.t
  join articulos a on a.id = l.articulo_id
  where l.empresa_id = p_empresa_id

  union all
  select 'Embarque'::text, el.lote_id, l.codigo_lote, a.codigo_interno, a.descripcion,
         ('Embarque ' || e.folio || ' - ' || coalesce(cl.nombre,'-') || ' - ' || coalesce(el.cantidad,0)::text || ' pz')::text
  from embarques e
  join q on upper(e.folio) = q.t
  join embarque_lineas el on el.embarque_id = e.id
  join lotes l on l.id = el.lote_id
  join articulos a on a.id = l.articulo_id
  left join clientes cl on cl.id = e.cliente_id
  where e.empresa_id = p_empresa_id

  union all
  select 'Orden de trabajo'::text, rl.lote_id, l.codigo_lote, a.codigo_interno, a.descripcion,
         ('OT ' || o.folio || ' - ' || coalesce(rl.cantidad_ok,0)::text || ' pz OK')::text
  from ordenes_trabajo o
  join q on upper(o.folio) = q.t
  join ot_reporte_lotes rl on rl.ot_id = o.id
  join lotes l on l.id = rl.lote_id
  join articulos a on a.id = l.articulo_id
  where o.empresa_id = p_empresa_id;
$$;


-- ---------------------------------------------------------------------
-- GENEALOGIA (hacia atras): de una caja/lote embarcado hasta la resina y
-- el proveedor. Recorre lote padre y consumos de cada nivel productivo.
-- Nota: Postgres solo admite UNA referencia recursiva, por eso las dos
-- aristas (lote padre y consumo) se resuelven en un solo lateral.
-- ---------------------------------------------------------------------
create or replace function traza_genealogia(p_lote_id int)
returns table (
  nivel int, ruta int[], relacion text,
  lote_id int, codigo_lote text, lote_origen text, estatus_calidad text, fecha_lote date,
  articulo_id int, articulo_codigo text, articulo_desc text, unidad text, tipo_proceso text,
  cantidad numeric,
  ot_id int, ot_folio text, maquina text, molde text, molde_clave text, cavidades int,
  turno text, fecha_produccion timestamptz, operador text,
  recibo_folio text, proveedor text, certificado_ref text, certificado_url text,
  ppap_estado text, fecha_recibo timestamptz
)
language sql stable as $$
with recursive arbol as (
  select 0 as nivel, array[l.id] as ruta, 'raiz'::text as relacion,
         l.id as lote_id, null::numeric as cantidad
  from lotes l where l.id = p_lote_id

  union all

  select a.nivel + 1, a.ruta || e.lote_id, e.relacion, e.lote_id, e.cantidad
  from arbol a
  join lateral (
    -- arista 1: el lote hijo (-Q cuarentena, -R remanente, split) hereda
    -- la genealogia de su lote padre
    select l.lote_padre_id as lote_id, 'lote_padre'::text as relacion,
           null::numeric as cantidad
    from lotes l
    where l.id = a.lote_id and l.lote_padre_id is not null

    union all

    -- arista 2: materia prima y componentes consumidos para producirlo
    select c.lote_id, 'consumo'::text, c.cantidad
    from lotes lp
    join ot_reporte_lotes rl on rl.lote_id = lp.id
    join ot_consumos c on c.reporte_id = rl.reporte_id
         and (c.articulo_producto_id is null or c.articulo_producto_id = lp.articulo_id)
    where lp.id = a.lote_id and c.lote_id is not null
  ) e on true
  where not (e.lote_id = any(a.ruta))
)
select a.nivel, a.ruta, a.relacion,
       l.id, l.codigo_lote, l.origen, l.estatus_calidad, l.fecha,
       art.id, art.codigo_interno, art.descripcion, art.unidad_medida, art.tipo_proceso,
       a.cantidad,
       ot.id, ot.folio, mq.nombre, mo.nombre, mo.clave, mo.num_cavidades,
       rep.turno, rep.fecha, us.nombre,
       rec.folio, rec.proveedor, rec.certificado_ref, rec.certificado_url,
       rec.ppap_estado, rec.fecha
from arbol a
join lotes l on l.id = a.lote_id
join articulos art on art.id = l.articulo_id
left join lateral (
  select rl.* from ot_reporte_lotes rl
  where rl.lote_id = a.lote_id order by rl.fecha limit 1
) rep on true
left join ordenes_trabajo ot on ot.id = rep.ot_id
left join maquinas mq on mq.id = ot.maquina_id
left join moldes mo on mo.id = ot.molde_id
left join usuarios us on us.id = rep.reportado_por
left join lateral (
  select rc.folio, p.nombre as proveedor, rl2.certificado_ref, rl2.certificado_url,
         rl2.ppap_estado, rc.fecha
  from recibo_lineas rl2
  join recibos rc on rc.id = rl2.recibo_id
  left join proveedores p on p.id = rc.proveedor_id
  where rl2.lote_id = a.lote_id order by rc.fecha limit 1
) rec on true
order by a.ruta;
$$;


-- ---------------------------------------------------------------------
-- IMPACTO (hacia adelante): de un lote de MP sospechoso hacia todo lo que
-- se produjo con el y a que cliente se embarco. Base para contencion.
-- ---------------------------------------------------------------------
create or replace function traza_impacto(p_lote_id int)
returns table (
  nivel int, ruta int[], relacion text,
  lote_id int, codigo_lote text, estatus_calidad text,
  articulo_id int, articulo_codigo text, articulo_desc text, tipo_proceso text,
  cantidad numeric,
  ot_id int, ot_folio text, maquina text, molde text,
  turno text, fecha_produccion timestamptz,
  embarque_id int, embarque_folio text, cliente text, fecha_embarque date,
  contenedor_folio text, cantidad_embarcada numeric
)
language sql stable as $$
with recursive arbol as (
  select 0 as nivel, array[l.id] as ruta, 'raiz'::text as relacion,
         l.id as lote_id, null::numeric as cantidad
  from lotes l where l.id = p_lote_id

  union all

  select a.nivel + 1, a.ruta || e.lote_id, e.relacion, e.lote_id, e.cantidad
  from arbol a
  join lateral (
    -- arista 1: lotes hijos (cuarentena, remanente, split): mismo material
    select l.id as lote_id, 'lote_hijo'::text as relacion, null::numeric as cantidad
    from lotes l
    where l.lote_padre_id = a.lote_id

    union all

    -- arista 2: lotes producidos por los reportes que consumieron este lote
    select rl.lote_id, 'produccion'::text, c.cantidad
    from ot_consumos c
    join ot_reporte_lotes rl on rl.reporte_id = c.reporte_id
         and (c.articulo_producto_id is null or c.articulo_producto_id = rl.articulo_id)
    where c.lote_id = a.lote_id
  ) e on true
  where not (e.lote_id = any(a.ruta))
)
select a.nivel, a.ruta, a.relacion,
       l.id, l.codigo_lote, l.estatus_calidad,
       art.id, art.codigo_interno, art.descripcion, art.tipo_proceso,
       a.cantidad,
       ot.id, ot.folio, mq.nombre, mo.nombre,
       rep.turno, rep.fecha,
       e.id, e.folio, cl.nombre, e.fecha,
       ct.folio, el.cantidad
from arbol a
join lotes l on l.id = a.lote_id
join articulos art on art.id = l.articulo_id
left join lateral (
  select rl.* from ot_reporte_lotes rl
  where rl.lote_id = a.lote_id order by rl.fecha limit 1
) rep on true
left join ordenes_trabajo ot on ot.id = rep.ot_id
left join maquinas mq on mq.id = ot.maquina_id
left join moldes mo on mo.id = ot.molde_id
-- un lote puede haber salido en varios embarques: una fila por cada uno
left join embarque_lineas el on el.lote_id = a.lote_id
left join embarques e on e.id = el.embarque_id
left join clientes cl on cl.id = e.cliente_id
left join contenedores ct on ct.id = el.contenedor_id
order by a.ruta, e.fecha;
$$;

grant select on ot_reporte_lotes to anon, authenticated, service_role;
grant execute on function traza_buscar(int, text) to anon, authenticated, service_role;
grant execute on function traza_genealogia(int) to anon, authenticated, service_role;
grant execute on function traza_impacto(int) to anon, authenticated, service_role;
