-- Cuarentena de material con causa obligatoria; salida a causa cerrada (liberar) o scrap.
alter table lotes drop constraint if exists lotes_estatus_calidad_check;
alter table lotes add constraint lotes_estatus_calidad_check
  check (estatus_calidad = any (array['retenido','liberado','rechazado','cuarentena','scrap']));
alter table movimientos drop constraint if exists movimientos_tipo_check;
alter table movimientos add constraint movimientos_tipo_check
  check (tipo = any (array['entrada_inicial','ajuste_positivo','ajuste_negativo','traspaso','liberacion_calidad',
    'rechazo_calidad','consumo_produccion','entrada_produccion','salida_embarque',
    'salida_maquila','entrada_maquila','consumo_maquila','cuarentena','scrap']));
create table if not exists cuarentena_eventos (
  id serial primary key, empresa_id integer not null references empresas(id) on delete cascade,
  lote_id integer not null references lotes(id), articulo_id integer references articulos(id), cantidad numeric,
  causa_id integer references causas_scrap(id), causa text not null, enviado_por uuid, enviado_at timestamptz default now(),
  estatus text not null default 'en_cuarentena' check (estatus in ('en_cuarentena','liberada','scrap')),
  salida_decision text check (salida_decision in ('cerrada','scrap')), salida_nota text, salida_por uuid, salida_at timestamptz);
create index if not exists idx_cuarentena_lote on cuarentena_eventos(lote_id);
create index if not exists idx_cuarentena_empresa on cuarentena_eventos(empresa_id);
grant all on cuarentena_eventos to anon, authenticated, service_role;
grant usage, select on sequence cuarentena_eventos_id_seq to anon, authenticated, service_role;
insert into modulos (clave, nombre, orden) values ('cal_cuarentena','Cuarentena',64),('prod_terminal','Terminal de Operador',77) on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, true, r.crear, r.editar, false, false
  from (values ('calidad',true,true),('gerente_calidad',true,true),('sgc',true,true),('produccion',true,true),('gerente_produccion',true,false),('direccion',true,false)) as r(rol,crear,editar)
  cross join (select id from modulos where clave='cal_cuarentena') m on conflict do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, true, true, false, false, false
  from (values ('produccion'),('gerente_produccion'),('gerente_planta')) as r(rol)
  cross join (select id from modulos where clave='prod_terminal') m on conflict do nothing;
