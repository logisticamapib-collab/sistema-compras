-- Reportes/KPIs de produccion: parametro de scrap global + modulo.
create table if not exists produccion_parametros (
  empresa_id integer primary key references empresas(id) on delete cascade,
  pct_scrap_default numeric not null default 3, updated_at timestamptz default now());
insert into produccion_parametros (empresa_id) values (4) on conflict (empresa_id) do nothing;
grant all on produccion_parametros to anon, authenticated, service_role;
insert into modulos (clave, nombre, orden) values ('prod_kpis','Reportes de Produccion / KPIs',78) on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, true, false, r.editar, false, false
  from (values ('gerente_produccion',true),('produccion',false),('gerente_planta',true),('gerente_ingenieria',false),('direccion',false),('gerente_administrativo',false)) as r(rol,editar)
  cross join (select id from modulos where clave='prod_kpis') m on conflict do nothing;
