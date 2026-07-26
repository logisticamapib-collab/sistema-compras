-- Mantenimiento de Moldes - Fase A. Aplicado via MCP 2026-07-26.
alter table moldes add column if not exists estado text not null default 'disponible'
  check (estado in ('disponible','en_produccion','en_reparacion','en_mantenimiento','en_maquila','fuera_servicio'));
alter table moldes add column if not exists periodicidad_mtto_dias integer;

create table if not exists mtto_tipos (
  id serial primary key, empresa_id integer not null references empresas(id) on delete cascade,
  nombre text not null,
  clase text not null default 'correctivo' check (clase in ('preventivo_shots','preventivo_calendario','correctivo')),
  reinicia_contador boolean not null default false, activo boolean not null default true);

create table if not exists mtto_parametros (
  empresa_id integer primary key references empresas(id) on delete cascade,
  tryout_requiere_calidad boolean not null default true,
  tryout_requiere_produccion boolean not null default true,
  tryout_requiere_ingenieria boolean not null default true,
  updated_at timestamptz default now());

create table if not exists molde_mtto (
  id serial primary key, empresa_id integer not null references empresas(id) on delete cascade,
  folio text not null, molde_id integer not null references moldes(id), tipo_id integer references mtto_tipos(id),
  motivo_origen text not null default 'interno' check (motivo_origen in ('interno','cliente')),
  cliente_id integer references clientes(id), es_cobrable boolean not null default false,
  monto_cobrado numeric, facturado boolean not null default false, aviso_id integer,
  causa text check (causa in ('desgaste_shots','molde','parametros_maquina','reparacion_previa_inefectiva','otro')),
  maquina_id integer references maquinas(id), operador_id uuid, turno_id integer references turnos(id), supervisor_id uuid,
  descripcion text, reinicia_contador boolean not null default false, shots_al_abrir numeric,
  estatus text not null default 'programada' check (estatus in ('programada','en_proceso','tryout','cerrada','cancelada')),
  tryout_efectiva boolean, fecha_programada date, fecha_inicio timestamptz, fecha_fin timestamptz,
  creado_por uuid, created_at timestamptz default now());
create index if not exists idx_moldemtto_molde on molde_mtto(molde_id);
create index if not exists idx_moldemtto_empresa on molde_mtto(empresa_id);

create table if not exists molde_mtto_insumos (
  id serial primary key, mtto_id integer not null references molde_mtto(id) on delete cascade,
  articulo_id integer references articulos(id), descripcion text, cantidad numeric not null default 0,
  costo_unitario numeric not null default 0, costo_total numeric not null default 0,
  lote_id integer references lotes(id), almacen_id integer references almacenes(id), created_at timestamptz default now());
create index if not exists idx_moldemttoins_mtto on molde_mtto_insumos(mtto_id);

grant all on mtto_tipos, mtto_parametros, molde_mtto, molde_mtto_insumos to anon, authenticated, service_role;
grant usage, select on sequence mtto_tipos_id_seq, molde_mtto_id_seq, molde_mtto_insumos_id_seq to anon, authenticated, service_role;

insert into modulos (clave, nombre, orden) values
  ('moldes','Mantenimiento de Moldes (grupo)',90),('mol_estado','Moldes y estado',91),
  ('mol_ordenes','Ordenes de Mantenimiento de Molde',92),('mol_tipos','Tipos y parametros de mantenimiento',93)
  on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, r.ver, r.crear, r.editar, false, r.aprobar
  from (values ('gerente_produccion',true,true,true,true),('produccion',true,true,false,false),
     ('gerente_ingenieria',true,true,true,true),('ingeniero_nuevos_proyectos',true,true,false,false),
     ('gerente_calidad',true,false,false,true),('calidad',true,false,false,false),('direccion',true,false,false,true)
  ) as r(rol, ver, crear, editar, aprobar)
  cross join (select id from modulos where clave in ('moldes','mol_estado','mol_ordenes','mol_tipos')) m on conflict do nothing;

insert into mtto_parametros (empresa_id) values (4) on conflict (empresa_id) do nothing;
insert into mtto_tipos (empresa_id, nombre, clase, reinicia_contador) values
  (4,'Preventivo por shots','preventivo_shots', true),(4,'Preventivo por calendario','preventivo_calendario', true),
  (4,'Correctivo menor','correctivo', false),(4,'Reparacion mayor','correctivo', true) on conflict do nothing;
