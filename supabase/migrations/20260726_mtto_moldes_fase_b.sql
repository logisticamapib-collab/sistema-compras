-- Mtto Moldes Fase B + override OT. Aplicado via MCP 2026-07-26.
alter table ordenes_trabajo add column if not exists liberacion_fuera_proc boolean not null default false;
alter table ordenes_trabajo add column if not exists liberado_fuera_por uuid;
alter table ordenes_trabajo add column if not exists liberado_fuera_motivo text;

create table if not exists molde_avisos (
  id serial primary key, empresa_id integer not null references empresas(id) on delete cascade,
  folio text not null, molde_id integer not null references moldes(id),
  area_reporta text not null default 'produccion' check (area_reporta in ('produccion','calidad')),
  reportado_por uuid, fecha date default (now() at time zone 'America/Mexico_City')::date,
  defecto_id integer references causas_scrap(id), descripcion text,
  maquina_id integer references maquinas(id), ot_id integer references ordenes_trabajo(id),
  turno_id integer references turnos(id), operador_id uuid,
  causa_probable text check (causa_probable in ('molde','parametros_maquina','reparacion_previa_inefectiva','otro')),
  estatus text not null default 'abierto' check (estatus in ('abierto','en_atencion','convertido','cerrado','descartado')),
  mtto_id integer references molde_mtto(id), created_at timestamptz default now());
create index if not exists idx_moldeavisos_molde on molde_avisos(molde_id);
create index if not exists idx_moldeavisos_empresa on molde_avisos(empresa_id);

grant all on molde_avisos to anon, authenticated, service_role;
grant usage, select on sequence molde_avisos_id_seq to anon, authenticated, service_role;

insert into modulos (clave, nombre, orden) values ('mol_avisos','Avisos de Mantenimiento de Molde',94) on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, r.ver, r.crear, r.editar, false, false
  from (values ('produccion',true,true,false),('gerente_produccion',true,true,true),('calidad',true,true,false),
     ('gerente_calidad',true,true,true),('gerente_ingenieria',true,false,true),('ingeniero_nuevos_proyectos',true,false,false),('direccion',true,false,false)
  ) as r(rol, ver, crear, editar)
  cross join (select id from modulos where clave='mol_avisos') m on conflict do nothing;
