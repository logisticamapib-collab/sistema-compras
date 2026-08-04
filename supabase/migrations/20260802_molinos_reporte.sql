-- =====================================================================
-- Reporte de molinos: que se genero, cuanto se recupero, cuanto se vendio
-- y cuanto se retorno al cliente, en kilos y en dinero.
--
--   GENERADO   lo que registro molinos en el periodo
--   RECUPERADO el molido que volvio al proceso (consumido en una OT)
--   VENDIDO    el molido que salio en un embarque
--   RETORNADO  el molido de consigna devuelto al cliente
--   EN PISO    lo que sigue en existencia hoy
-- =====================================================================
create or replace function molino_reporte(
  p_empresa_id int, p_desde date, p_hasta date, p_site_id int default null
)
returns table (
  articulo_id int, codigo_interno text, descripcion text, tipo_material text,
  virgen_codigo text, es_consigna boolean, cliente text,
  costo_unitario numeric,
  kg_generado numeric, monto_generado numeric,
  kg_recuperado numeric, monto_recuperado numeric,
  kg_vendido numeric, kg_retornado numeric,
  kg_en_piso numeric, pct_recuperado numeric
)
language sql stable as $$
with base as (
  select a.id, a.codigo_interno, a.descripcion, a.tipo_material,
         v.codigo_interno virgen, a.es_consigna,
         costo_molido(p_empresa_id, a.id) costo_u
  from articulos a
  left join articulos v on v.id = a.articulo_virgen_id
  where a.empresa_id = p_empresa_id
    and a.tipo_material in ('molido','barredura')
),
gen as (
  select m.articulo_molido_id aid, sum(m.kg) kg, sum(coalesce(m.costo_total,0)) monto,
         max(c.nombre) cliente
  from molienda m
  left join clientes c on c.id = m.cliente_id
  where m.empresa_id = p_empresa_id
    and m.fecha between p_desde and p_hasta
    and (p_site_id is null or m.site_id is null or m.site_id = p_site_id)
  group by 1
),
rec as (
  select cs.articulo_id aid, sum(cs.cantidad) kg
  from ot_consumos cs
  join ot_reportes r on r.id = cs.reporte_id
  join ordenes_trabajo o on o.id = r.ot_id
  where o.empresa_id = p_empresa_id
    and turno_fecha(p_empresa_id, r.fecha, coalesce(r.turno, o.turno)) between p_desde and p_hasta
    and (p_site_id is null or o.site_id is null or o.site_id = p_site_id)
  group by 1
),
ven as (
  select el.articulo_id aid, sum(el.cantidad) kg
  from embarque_lineas el
  join embarques e on e.id = el.embarque_id
  where e.empresa_id = p_empresa_id
    and e.fecha between p_desde and p_hasta
    and e.estatus = 'embarcado'
    and (p_site_id is null or e.site_id is null or e.site_id = p_site_id)
  group by 1
),
ret as (
  select mv.articulo_id aid, sum(mv.cantidad) kg
  from movimientos mv
  where mv.empresa_id = p_empresa_id
    and mv.tipo = 'retorno_cliente'
    and mv.fecha::date between p_desde and p_hasta
  group by 1
),
piso as (
  select l.articulo_id aid, sum(ex.cantidad) kg
  from existencias ex
  join lotes l on l.id = ex.lote_id
  left join almacenes al on al.id = ex.almacen_id
  where l.empresa_id = p_empresa_id
    and (p_site_id is null or al.site_id is null or al.site_id = p_site_id)
  group by 1
)
select b.id, b.codigo_interno, b.descripcion, b.tipo_material,
       b.virgen, b.es_consigna, gen.cliente, b.costo_u,
       coalesce(gen.kg,0), coalesce(gen.monto,0),
       coalesce(rec.kg,0), round(coalesce(rec.kg,0) * b.costo_u, 2),
       coalesce(ven.kg,0), coalesce(ret.kg,0), coalesce(piso.kg,0),
       case when coalesce(gen.kg,0) > 0
            then round(100.0 * coalesce(rec.kg,0) / gen.kg, 1) else null end
from base b
left join gen  on gen.aid  = b.id
left join rec  on rec.aid  = b.id
left join ven  on ven.aid  = b.id
left join ret  on ret.aid  = b.id
left join piso on piso.aid = b.id
where coalesce(gen.kg,0) > 0 or coalesce(rec.kg,0) > 0
   or coalesce(ven.kg,0) > 0 or coalesce(ret.kg,0) > 0 or coalesce(piso.kg,0) > 0
order by b.tipo_material, b.codigo_interno;
$$;

grant execute on function molino_reporte(int, date, date, int) to anon, authenticated, service_role;

insert into modulos (clave, nombre, orden)
values ('log_molinos', 'Molinos', 58) on conflict (clave) do nothing;

insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r.rol, m.id, true, r.captura, r.captura, false, r.aprueba
from modulos m
cross join (values
  ('admin', true, true), ('gerente_logistica', true, true), ('logistica', true, false),
  ('gerente_planta', false, true), ('gerente_produccion', false, false),
  ('produccion', true, false), ('direccion', false, false),
  ('gerente_administrativo', false, false), ('gerente_calidad', false, false)
) as r(rol, captura, aprueba)
where m.clave = 'log_molinos'
and not exists (select 1 from permisos_rol p where p.rol = r.rol and p.modulo_id = m.id);
