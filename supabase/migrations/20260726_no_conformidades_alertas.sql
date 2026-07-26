-- No conformidades + acciones + alertas de calidad. Aplicado via MCP 2026-07-26.
create table if not exists no_conformidades (
  id serial primary key, empresa_id integer not null references empresas(id) on delete cascade, folio text not null,
  origen text not null default 'interno' check (origen in ('interno','cliente','proveedor','auditoria')),
  fecha date default (now() at time zone 'America/Mexico_City')::date, detectado_por uuid, area text,
  articulo_id integer references articulos(id), lote_id integer references lotes(id), cantidad_afectada numeric,
  defecto_id integer references causas_scrap(id), descripcion text, maquina_id integer references maquinas(id),
  ot_id integer references ordenes_trabajo(id), proveedor_id integer references proveedores(id), cliente_id integer references clientes(id),
  severidad text not null default 'menor' check (severidad in ('menor','mayor','critica')),
  disposicion text not null default 'pendiente' check (disposicion in ('pendiente','retrabajo','scrap','uso_como_esta','devolucion','clasificar')),
  contencion text, causa_raiz text, accion_correctiva text, responsable_id uuid,
  estatus text not null default 'abierta' check (estatus in ('abierta','en_analisis','contenida','en_accion','cerrada','cancelada')),
  fecha_cierre timestamptz, cerrada_por uuid, creado_por uuid, created_at timestamptz default now());
create index if not exists idx_nc_empresa on no_conformidades(empresa_id);
create table if not exists nc_acciones (
  id serial primary key, nc_id integer not null references no_conformidades(id) on delete cascade,
  tipo text not null default 'correctiva' check (tipo in ('contencion','correctiva','preventiva')),
  descripcion text, responsable_id uuid, fecha_compromiso date, fecha_cierre date,
  estatus text not null default 'abierta' check (estatus in ('abierta','cerrada')), created_at timestamptz default now());
create index if not exists idx_ncacc_nc on nc_acciones(nc_id);
create table if not exists calidad_alertas (
  id serial primary key, empresa_id integer not null references empresas(id) on delete cascade, folio text not null, titulo text not null,
  articulo_id integer references articulos(id), defecto_id integer references causas_scrap(id), mensaje text,
  severidad text not null default 'mayor' check (severidad in ('menor','mayor','critica')), area text, vigente boolean not null default true,
  nc_id integer references no_conformidades(id), vence date, creado_por uuid, created_at timestamptz default now());
create index if not exists idx_calalertas_empresa on calidad_alertas(empresa_id);
grant all on no_conformidades, nc_acciones, calidad_alertas to anon, authenticated, service_role;
grant usage, select on sequence no_conformidades_id_seq, nc_acciones_id_seq, calidad_alertas_id_seq to anon, authenticated, service_role;
insert into modulos (clave, nombre, orden) values ('cal_nc','No Conformidades',65),('cal_alertas','Alertas de Calidad',66) on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, true, r.crear, r.editar, false, false
  from (values ('calidad',true,true),('gerente_calidad',true,true),('sgc',true,true),('produccion',true,true),
     ('gerente_produccion',true,false),('gerente_ingenieria',true,false),('direccion',true,false),('gerente_planta',true,false)
  ) as r(rol, crear, editar)
  cross join (select id from modulos where clave in ('cal_nc','cal_alertas')) m on conflict do nothing;
