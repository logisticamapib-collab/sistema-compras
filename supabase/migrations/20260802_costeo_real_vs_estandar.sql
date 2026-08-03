-- =====================================================================
-- Costeo real vs estandar por OT.
--   Estandar ganado = piezas OK x costo estandar unitario (material de la
--                     BOM explotada + mano de obra y overhead de la ruta)
--   Real            = consumo real de MP + horas hombre y maquina reales
--   Variacion       = Real - Estandar, desglosada en material, MO y overhead
-- Las horas reales de maquina se toman del mismo tiempo operativo que usa el
-- OEE y se reparten entre las OT del turno segun las piezas que produjo cada
-- una, para que costeo y OEE siempre reconcilien.
-- =====================================================================

-- Tarifas por maquina / centro de costo
alter table maquinas add column if not exists costo_hora_hombre numeric not null default 0;
alter table maquinas add column if not exists costo_hora_maquina numeric not null default 0;

create table if not exists costeo_prod_parametros (
  empresa_id int primary key references empresas(id) on delete cascade,
  costo_hora_hombre_default numeric not null default 0,
  costo_hora_maquina_default numeric not null default 0,
  moneda text not null default 'MXN',
  updated_at timestamptz default now(),
  updated_by uuid references usuarios(id)
);
insert into costeo_prod_parametros (empresa_id)
select id from empresas on conflict (empresa_id) do nothing;


-- ---------------------------------------------------------------------
-- Fecha de produccion real de un timestamp segun su turno. El 3er turno
-- cruza medianoche: lo reportado a las 02:00 pertenece al dia anterior.
-- ---------------------------------------------------------------------
create or replace function turno_fecha(p_empresa_id int, p_ts timestamptz, p_turno text)
returns date language sql stable as $$
  select coalesce(
    (select case when t.hora_fin < t.hora_inicio
                  and ((p_ts at time zone e.zona_horaria)::time) < t.hora_fin
                 then ((p_ts at time zone e.zona_horaria)::date - 1)
                 else ((p_ts at time zone e.zona_horaria)::date) end
     from turnos t
     join empresas e on e.id = p_empresa_id
     where t.empresa_id = p_empresa_id and t.clave = p_turno
     limit 1),
    (p_ts at time zone coalesce(
       (select zona_horaria from empresas where id = p_empresa_id),
       'America/Mexico_City'))::date
  );
$$;


-- ---------------------------------------------------------------------
-- Costo estandar unitario de un articulo.
--   material : BOM explotada hasta articulos sin BOM (comprados) x su costo
--   mo / oh  : ciclo de la ruta de CADA nivel fabricado x tarifas de su maquina
-- El ciclo por pieza es el tiempo de disparo entre las cavidades del molde.
-- ---------------------------------------------------------------------
create or replace function costo_std_unitario(p_empresa_id int, p_articulo_id int)
returns table (material numeric, mo numeric, overhead numeric, total numeric)
language sql stable as $$
with recursive
par as (
  select coalesce(costo_hora_hombre_default, 0) as th,
         coalesce(costo_hora_maquina_default, 0) as tm
  from costeo_prod_parametros where empresa_id = p_empresa_id
),
-- explosion de la BOM: cantidad acumulada de cada componente por pieza del padre
exp as (
  select p_articulo_id as art_id, 1::numeric as qty, 0 as nivel,
         array[p_articulo_id] as ruta
  union all
  select b.componente_articulo_id, e.qty * coalesce(b.cantidad_por_unidad, 0),
         e.nivel + 1, e.ruta || b.componente_articulo_id
  from exp e
  join bom b on b.articulo_padre_id = e.art_id
  where b.componente_articulo_id is not null
    and not (b.componente_articulo_id = any(e.ruta))
    and e.nivel < 10
),
-- un nodo es HOJA (material que se compra) si no tiene BOM propia
nodos as (
  select e.art_id, sum(e.qty) as qty,
         not exists (select 1 from bom b where b.articulo_padre_id = e.art_id) as es_hoja
  from exp e group by e.art_id
),
mat as (
  select coalesce(sum(n.qty * coalesce(a.costo, 0)), 0) as monto
  from nodos n join articulos a on a.id = n.art_id
  where n.es_hoja and n.art_id <> p_articulo_id
),
-- mano de obra y overhead de cada nivel que se fabrica (tiene ruta)
proc as (
  select coalesce(sum(n.qty * (rt.ciclo_seg / 3600.0)
           * coalesce(nullif(mq.costo_hora_hombre, 0), (select th from par))
           * greatest(coalesce(rt.personal, 1), 1)), 0) as mo,
         coalesce(sum(n.qty * (rt.ciclo_seg / 3600.0)
           * coalesce(nullif(mq.costo_hora_maquina, 0), (select tm from par))), 0) as oh
  from nodos n
  join lateral (
    select (rf.tiempo_estandar_seg / greatest(coalesce(mo2.num_cavidades, 1), 1)::numeric) as ciclo_seg,
           rf.personal_requerido as personal, rf.maquina_principal_id
    from rutas_fabricacion rf
    left join moldes mo2 on mo2.id = rf.molde_id
    where rf.articulo_id = n.art_id and coalesce(rf.tiempo_estandar_seg, 0) > 0
    order by rf.secuencia limit 1
  ) rt on true
  left join maquinas mq on mq.id = rt.maquina_principal_id
)
select m.monto, p.mo, p.oh, m.monto + p.mo + p.oh
from mat m, proc p;
$$;


-- ---------------------------------------------------------------------
-- Costeo real vs estandar por OT en un rango de fechas.
-- ---------------------------------------------------------------------
create or replace function costeo_ot(
  p_empresa_id int, p_desde date, p_hasta date, p_site_id int default null
)
returns table (
  ot_id int, ot_folio text, fecha date, site_id int,
  articulo_id int, articulo_codigo text, articulo_desc text,
  maquina text, molde text,
  piezas_ok numeric, piezas_scrap numeric,
  min_maquina_real numeric, min_hombre_real numeric,
  min_maquina_std numeric, min_hombre_std numeric,
  material_real numeric, material_std numeric,
  mo_real numeric, mo_std numeric,
  oh_real numeric, oh_std numeric,
  costo_real numeric, costo_std numeric,
  costo_unit_real numeric, costo_unit_std numeric,
  precio_venta numeric
)
language sql stable as $$
with
par as (
  select coalesce(costo_hora_hombre_default,0) th, coalesce(costo_hora_maquina_default,0) tm
  from costeo_prod_parametros where empresa_id = p_empresa_id
),
-- cada reporte ubicado en su celda maquina/fecha/turno
rep as (
  select r.id as reporte_id, r.ot_id, ot.maquina_id,
         turno_fecha(p_empresa_id, r.fecha, coalesce(r.turno, ot.turno)) as fecha,
         coalesce(r.turno, ot.turno) as turno,
         coalesce(r.cantidad_ok,0) as ok, coalesce(r.cantidad_scrap,0) as scrap
  from ot_reportes r
  join ordenes_trabajo ot on ot.id = r.ot_id
  where ot.empresa_id = p_empresa_id
    and (p_site_id is null or ot.site_id = p_site_id)
),
rep_rango as (select * from rep where fecha between p_desde and p_hasta),
-- minutos operativos de cada celda, los mismos que usa el OEE
celda as (
  select o.maquina_id, o.fecha, o.turno, o.min_operativo
  from oee_detalle(p_empresa_id, p_desde, p_hasta, p_site_id, 'programadas') o
),
-- piezas totales por celda, para repartir el tiempo entre las OT
celda_pz as (
  select maquina_id, fecha, turno, sum(ok + scrap) as pz
  from rep_rango group by 1,2,3
),
-- tiempo de maquina real atribuido a cada reporte
rep_min as (
  select rr.reporte_id, rr.ot_id,
         case when coalesce(cp.pz,0) > 0
              then coalesce(c.min_operativo,0) * (rr.ok + rr.scrap) / cp.pz
              else 0 end as min_maq
  from rep_rango rr
  left join celda    c  on c.maquina_id = rr.maquina_id and c.fecha = rr.fecha and c.turno = rr.turno
  left join celda_pz cp on cp.maquina_id = rr.maquina_id and cp.fecha = rr.fecha and cp.turno = rr.turno
),
-- materia prima realmente consumida, valuada al costo del articulo
mat_real as (
  select rr.ot_id, coalesce(sum(cs.cantidad * coalesce(a.costo,0)),0) as monto
  from rep_rango rr
  join ot_consumos cs on cs.reporte_id = rr.reporte_id
  join articulos a on a.id = cs.articulo_id
  group by 1
),
base as (
  select rr.ot_id,
         sum(rr.ok) as ok, sum(rr.scrap) as scrap,
         min(rr.fecha) as fecha,
         sum(rm.min_maq) as min_maq
  from rep_rango rr
  join rep_min rm on rm.reporte_id = rr.reporte_id
  group by 1
)
select
  ot.id, ot.folio, b.fecha, ot.site_id,
  ot.articulo_id, a.codigo_interno, a.descripcion,
  mq.nombre, mo.nombre,
  b.ok, b.scrap,
  round(b.min_maq, 1),
  round(b.min_maq * greatest(coalesce(rt.personal,1),1), 1),
  round((b.ok + b.scrap) * coalesce(rt.ciclo_seg,0) / 60.0, 1),
  round((b.ok + b.scrap) * coalesce(rt.ciclo_seg,0) / 60.0 * greatest(coalesce(rt.personal,1),1), 1),
  round(coalesce(mr.monto,0), 2),
  round(b.ok * coalesce(std.material,0), 2),
  round(b.min_maq / 60.0 * greatest(coalesce(rt.personal,1),1)
        * coalesce(nullif(mq.costo_hora_hombre,0), (select th from par)), 2),
  round(b.ok * coalesce(std.mo,0), 2),
  round(b.min_maq / 60.0
        * coalesce(nullif(mq.costo_hora_maquina,0), (select tm from par)), 2),
  round(b.ok * coalesce(std.overhead,0), 2),
  round(coalesce(mr.monto,0)
        + b.min_maq / 60.0 * greatest(coalesce(rt.personal,1),1)
          * coalesce(nullif(mq.costo_hora_hombre,0), (select th from par))
        + b.min_maq / 60.0
          * coalesce(nullif(mq.costo_hora_maquina,0), (select tm from par)), 2),
  round(b.ok * coalesce(std.total,0), 2),
  case when b.ok > 0 then round((coalesce(mr.monto,0)
        + b.min_maq / 60.0 * greatest(coalesce(rt.personal,1),1)
          * coalesce(nullif(mq.costo_hora_hombre,0), (select th from par))
        + b.min_maq / 60.0
          * coalesce(nullif(mq.costo_hora_maquina,0), (select tm from par))) / b.ok, 4) else 0 end,
  round(coalesce(std.total,0), 4),
  coalesce(pv.precio, 0)
from base b
join ordenes_trabajo ot on ot.id = b.ot_id
join articulos a on a.id = ot.articulo_id
left join maquinas mq on mq.id = ot.maquina_id
left join moldes mo on mo.id = ot.molde_id
left join mat_real mr on mr.ot_id = b.ot_id
left join lateral costo_std_unitario(p_empresa_id, ot.articulo_id) std on true
left join lateral (
  select (rf.tiempo_estandar_seg / greatest(coalesce(m2.num_cavidades,1),1)::numeric) as ciclo_seg,
         rf.personal_requerido as personal
  from rutas_fabricacion rf
  left join moldes m2 on m2.id = coalesce(ot.molde_id, rf.molde_id)
  where rf.articulo_id = ot.articulo_id and coalesce(rf.tiempo_estandar_seg,0) > 0
  order by (rf.maquina_principal_id = ot.maquina_id) desc nulls last, rf.secuencia
  limit 1
) rt on true
left join lateral (
  select ac.precio from articulo_cliente ac
  where ac.articulo_id = ot.articulo_id and ac.activo and coalesce(ac.precio,0) > 0
  order by ac.id limit 1
) pv on true
order by b.fecha, ot.folio;
$$;

grant execute on function turno_fecha(int, timestamptz, text) to anon, authenticated, service_role;
grant execute on function costo_std_unitario(int, int) to anon, authenticated, service_role;
grant execute on function costeo_ot(int, date, date, int) to anon, authenticated, service_role;
grant select, insert, update on costeo_prod_parametros to anon, authenticated, service_role;
