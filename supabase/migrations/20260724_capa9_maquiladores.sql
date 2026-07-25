-- Capa 9: Maquiladores / subcontratacion. Aplicado via MCP 2026-07-24.
-- Maquilador = proveedor.es_maquilador; su inventario "en maquila" vive en un
-- almacen virtual. OM -> envio (salida_maquila) -> recepcion (lote retenido) +
-- consumo por BOM (consumo_maquila) + shots al molde (mantenimiento).
alter table proveedores add column if not exists es_maquilador boolean not null default false;

create table if not exists ordenes_maquila (
  id serial primary key,
  empresa_id integer not null references empresas(id) on delete cascade,
  folio text not null,
  maquilador_id integer references proveedores(id),
  site_id integer,
  articulo_id integer references articulos(id),
  cantidad_esperada numeric not null default 0,
  molde_id integer references moldes(id),
  almacen_maquila_id integer references almacenes(id),
  estatus text not null default 'borrador'
    check (estatus in ('borrador','enviada','en_proceso','recibida_parcial','cerrada','cancelada')),
  fecha_creacion timestamptz default now(),
  fecha_envio timestamptz,
  notas text,
  creado_por uuid
);
create index if not exists idx_om_empresa on ordenes_maquila(empresa_id);

create table if not exists om_materiales (
  id serial primary key,
  om_id integer not null references ordenes_maquila(id) on delete cascade,
  articulo_id integer not null references articulos(id),
  cantidad_por_unidad numeric not null default 0,
  cantidad_plan numeric not null default 0,
  cantidad_enviada numeric not null default 0,
  unidad_medida text
);
create index if not exists idx_ommat_om on om_materiales(om_id);

create table if not exists om_recibos (
  id serial primary key,
  om_id integer not null references ordenes_maquila(id) on delete cascade,
  articulo_id integer not null references articulos(id),
  cantidad numeric not null default 0,
  lote_id integer references lotes(id),
  shots numeric not null default 0,
  fecha timestamptz default now(),
  recibido_por uuid
);
create index if not exists idx_omrec_om on om_recibos(om_id);

create or replace function maquila_sumar_shots() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_molde integer;
begin
  select molde_id into v_molde from ordenes_maquila where id = new.om_id;
  if v_molde is not null and coalesce(new.shots,0) > 0 then
    update moldes set shots_acumulados = coalesce(shots_acumulados,0) + new.shots where id = v_molde;
  end if;
  return new;
end $$;
drop trigger if exists trg_maquila_shots on om_recibos;
create trigger trg_maquila_shots after insert on om_recibos
  for each row execute function maquila_sumar_shots();

create or replace function maquila_saldo(p_om integer)
returns table(articulo_id integer, enviado numeric, consumo_teorico numeric, saldo numeric, existencia_virtual numeric)
language sql stable security definer set search_path = public, pg_temp as $$
  with rec as (select coalesce(sum(cantidad),0) tot from om_recibos where om_id = p_om),
       om as (select almacen_maquila_id from ordenes_maquila where id = p_om)
  select m.articulo_id,
         coalesce(m.cantidad_enviada,0),
         (select tot from rec) * coalesce(m.cantidad_por_unidad,0),
         coalesce(m.cantidad_enviada,0) - (select tot from rec) * coalesce(m.cantidad_por_unidad,0),
         coalesce((select sum(e.cantidad) from existencias e join lotes l on l.id = e.lote_id
                   where l.articulo_id = m.articulo_id
                     and e.almacen_id = (select almacen_maquila_id from om)),0)
  from om_materiales m where m.om_id = p_om;
$$;

grant all on ordenes_maquila, om_materiales, om_recibos to anon, authenticated, service_role;
grant usage, select on sequence ordenes_maquila_id_seq, om_materiales_id_seq, om_recibos_id_seq to anon, authenticated, service_role;
grant execute on function maquila_sumar_shots() to anon, authenticated, service_role;
grant execute on function maquila_saldo(integer) to anon, authenticated, service_role;

insert into modulos (clave, nombre, orden) values ('prod_maquila','Maquila / Subcontratacion',76) on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, r.ver, r.crear, r.editar, false, false
  from (values ('gerente_produccion',true,true,true),('produccion',true,true,false),
               ('gerente_logistica',true,false,false),('direccion',true,false,false)) as r(rol,ver,crear,editar)
  cross join (select id from modulos where clave='prod_maquila') m on conflict do nothing;
