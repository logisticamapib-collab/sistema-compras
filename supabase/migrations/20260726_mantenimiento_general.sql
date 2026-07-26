-- Mantenimiento general (ordenes generales / de maquinas). Aplicado via MCP 2026-07-26.
create table if not exists mtto_gen_ordenes (
  id serial primary key, empresa_id integer not null references empresas(id) on delete cascade, folio text not null,
  objeto text not null default 'general' check (objeto in ('general','maquina')), maquina_id integer references maquinas(id),
  tipo_trabajo text not null default 'reparacion' check (tipo_trabajo in ('problema','mejora','reparacion','creacion','preventivo','otro')),
  prioridad text not null default 'media' check (prioridad in ('baja','media','alta','urgente')),
  titulo text, descripcion text, motivo text, solicitante_id uuid,
  es_externo boolean not null default false, proveedor_id integer references proveedores(id), asignado_a uuid, costo_externo numeric,
  estatus text not null default 'abierta' check (estatus in ('abierta','asignada','en_proceso','realizada','cerrada','cancelada')),
  conforme_ok boolean, conforme_por uuid, conforme_at timestamptz, conforme_comentario text,
  fecha_inicio timestamptz, fecha_fin timestamptz, fecha_cierre timestamptz, creado_por uuid, created_at timestamptz default now());
create index if not exists idx_mttogen_empresa on mtto_gen_ordenes(empresa_id);
create table if not exists mtto_gen_insumos (
  id serial primary key, orden_id integer not null references mtto_gen_ordenes(id) on delete cascade,
  articulo_id integer references articulos(id), descripcion text, cantidad numeric not null default 0,
  costo_unitario numeric not null default 0, costo_total numeric not null default 0,
  lote_id integer references lotes(id), almacen_id integer references almacenes(id), created_at timestamptz default now());
create index if not exists idx_mttogenins_orden on mtto_gen_insumos(orden_id);
grant all on mtto_gen_ordenes, mtto_gen_insumos to anon, authenticated, service_role;
grant usage, select on sequence mtto_gen_ordenes_id_seq, mtto_gen_insumos_id_seq to anon, authenticated, service_role;
insert into modulos (clave, nombre, orden) values
  ('mantenimiento','Mantenimiento (grupo)',100),('man_ordenes','Ordenes de Mantenimiento',101),('man_kpis','KPIs de Mantenimiento',102)
  on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, true, r.crear, r.editar, false, false
  from (values ('solicitante',true,false),('produccion',true,false),('calidad',true,false),
     ('gerente_produccion',true,true),('gerente_ingenieria',true,true),('ingeniero_nuevos_proyectos',true,true),
     ('gerente_planta',true,true),('gerente_calidad',true,false),('gerente_logistica',true,false),
     ('gerente_administrativo',true,false),('direccion',true,false),('customer_service',true,false)
  ) as r(rol, crear, editar)
  cross join (select id from modulos where clave in ('mantenimiento','man_ordenes')) m on conflict do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, true, false, false, false, false
  from (values ('gerente_produccion'),('gerente_ingenieria'),('gerente_planta'),('direccion'),('gerente_administrativo')) as r(rol)
  cross join (select id from modulos where clave='man_kpis') m on conflict do nothing;
