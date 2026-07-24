-- Costeo de articulos comprados: metodo configurable por empresa.
-- Metodos: estandar (default), ultima_compra, promedio_ponderado (movil), promedio_simple.
-- Dispara al insertar recibo_lineas contra OC (oc_linea_id no nulo). Consigna se ignora.
-- Aplicado via MCP el 2026-07-24. Ver traspaso v3.

create table if not exists costeo_parametros (
  empresa_id integer primary key references empresas(id) on delete cascade,
  metodo text not null default 'estandar'
    check (metodo in ('estandar','ultima_compra','promedio_ponderado','promedio_simple')),
  incluir_descuento boolean not null default false,
  updated_at timestamptz default now(),
  updated_by uuid
);

create table if not exists costeo_historial (
  id serial primary key,
  empresa_id integer,
  articulo_id integer references articulos(id) on delete cascade,
  recibo_linea_id integer,
  metodo text,
  costo_anterior numeric,
  costo_nuevo numeric,
  precio_recibo numeric,
  cantidad_recibida numeric,
  existencia_previa numeric,
  fecha timestamptz default now()
);
create index if not exists idx_costeo_historial_articulo on costeo_historial(articulo_id);

create or replace function aplicar_costeo_recibo() returns trigger as $$
declare
  v_empresa integer; v_metodo text; v_incluir_desc boolean; v_es_consigna boolean;
  v_costo_actual numeric; v_precio numeric; v_descuento numeric; v_costo_unit numeric;
  v_qprev numeric := null; v_nuevo numeric;
begin
  if new.oc_linea_id is null then return new; end if;
  select a.empresa_id, coalesce(a.es_consigna,false), coalesce(a.costo,0)
    into v_empresa, v_es_consigna, v_costo_actual from articulos a where a.id = new.articulo_id;
  if v_es_consigna then return new; end if;
  select metodo, incluir_descuento into v_metodo, v_incluir_desc
    from costeo_parametros where empresa_id = v_empresa;
  v_metodo := coalesce(v_metodo,'estandar'); v_incluir_desc := coalesce(v_incluir_desc,false);
  if v_metodo = 'estandar' then return new; end if;
  select precio_unitario, coalesce(descuento,0) into v_precio, v_descuento
    from oc_lineas where id = new.oc_linea_id;
  if v_precio is null or v_precio <= 0 then return new; end if;
  v_costo_unit := case when v_incluir_desc then v_precio*(1-v_descuento/100.0) else v_precio end;
  if v_metodo = 'ultima_compra' then
    v_nuevo := v_costo_unit;
  elsif v_metodo = 'promedio_simple' then
    select avg(ol.precio_unitario*(case when v_incluir_desc then (1-coalesce(ol.descuento,0)/100.0) else 1 end))
      into v_nuevo from recibo_lineas rl join oc_lineas ol on ol.id = rl.oc_linea_id
      where rl.articulo_id = new.articulo_id and rl.oc_linea_id is not null and coalesce(ol.precio_unitario,0) > 0;
    if v_nuevo is null then v_nuevo := v_costo_unit; end if;
  elsif v_metodo = 'promedio_ponderado' then
    select coalesce(sum(e.cantidad),0) into v_qprev from existencias e join lotes lo on lo.id = e.lote_id
      where lo.articulo_id = new.articulo_id and lo.empresa_id = v_empresa;
    v_qprev := v_qprev - coalesce(new.cantidad,0);
    if v_qprev <= 0 then v_nuevo := v_costo_unit;
    else v_nuevo := (v_qprev*v_costo_actual + new.cantidad*v_costo_unit)/(v_qprev+new.cantidad); end if;
  else return new; end if;
  update articulos set costo = round(v_nuevo,6) where id = new.articulo_id;
  insert into costeo_historial(empresa_id, articulo_id, recibo_linea_id, metodo,
      costo_anterior, costo_nuevo, precio_recibo, cantidad_recibida, existencia_previa)
    values (v_empresa, new.articulo_id, new.id, v_metodo,
      v_costo_actual, round(v_nuevo,6), v_costo_unit, new.cantidad, v_qprev);
  return new;
end;
$$ language plpgsql security definer set search_path = public, pg_temp;

drop trigger if exists trg_aplicar_costeo_recibo on recibo_lineas;
create trigger trg_aplicar_costeo_recibo after insert on recibo_lineas
  for each row execute function aplicar_costeo_recibo();

grant all on costeo_parametros to anon, authenticated, service_role;
grant all on costeo_historial to anon, authenticated, service_role;
grant usage, select on sequence costeo_historial_id_seq to anon, authenticated, service_role;
grant execute on function aplicar_costeo_recibo() to anon, authenticated, service_role;

insert into modulos (clave, nombre, orden) values ('com_costeo','Parametros de Costeo',20)
  on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, r.ver, false, r.editar, false, false
  from (values ('gerente_compras',true,true),('direccion',true,true),
               ('gerente_logistica',true,false),('gerente_administrativo',true,false)) as r(rol,ver,editar)
  cross join (select id from modulos where clave='com_costeo') m
  on conflict do nothing;
