-- VALES DE TOOLCRIB
--
-- El vale es el documento donde vive la respuesta a "contra que se consumio
-- esto". Sustituye la captura manual de insumos en las ordenes de
-- mantenimiento: si quedaran los dos caminos abiertos, la gente usaria el
-- facil y los numeros nunca cuadrarian.
--
-- Puede salir sin orden de mantenimiento, porque hay consumo de rutina
-- (guantes, brocas, aceite) que no amerita una orden. Obligarla haria que la
-- gente inventara ordenes falsas, que es peor que no tenerlas.

create table if not exists toolcrib_parametros (
  empresa_id            integer primary key references empresas(id) on delete cascade,
  -- Por default el sistema REGISTRA Y AVISA, no frena. Un tope de firma puede
  -- dejar una maquina parada a las 2 de la manana esperando a un gerente.
  requiere_autorizacion boolean not null default false,
  monto_autorizacion    numeric not null default 0,
  rol_autoriza          text,
  avisar_monto          numeric not null default 0,
  requiere_orden_mtto   boolean not null default false,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references usuarios(id)
);

create table if not exists toolcrib_vales (
  id                    serial primary key,
  empresa_id            integer not null references empresas(id) on delete cascade,
  site_id               integer references sites(id),
  folio                 text not null,
  fecha                 timestamptz not null default now(),
  turno                 text,
  almacen_id            integer not null references almacenes(id),
  -- Contra que se consume. Es el eje de todo el analisis posterior.
  destino_tipo          text not null default 'area'
                          check (destino_tipo in ('molde','maquina','area','ot','general')),
  molde_id              integer references moldes(id),
  maquina_id            integer references maquinas(id),
  area_id               integer references areas(id),
  ot_id                 integer references ordenes_trabajo(id),
  -- De donde salio, si salio de una orden de mantenimiento.
  mtto_molde_id         integer references molde_mtto(id),
  mtto_gen_id           integer references mtto_gen_ordenes(id),
  centro_costo_id       integer references centros_costos(id),
  cuenta_gasto_id       integer references cuentas_gastos(id),
  motivo                text not null default 'rutina'
                          check (motivo in ('mantenimiento','rutina','proyecto','emergencia','otro')),
  estatus               text not null default 'borrador'
                          check (estatus in ('borrador','surtido','cancelado')),
  monto_total           numeric not null default 0,
  requiere_autorizacion boolean not null default false,
  autorizado_por        uuid references usuarios(id),
  autorizado_at         timestamptz,
  solicitado_por        uuid references usuarios(id),
  surtido_por           uuid references usuarios(id),
  surtido_at            timestamptz,
  recibido_por          text,
  notas                 text,
  created_at            timestamptz not null default now(),

  -- El destino tiene que estar completo o el vale no sirve para analizar.
  constraint vale_destino_completo check (
    (destino_tipo = 'molde'   and molde_id   is not null) or
    (destino_tipo = 'maquina' and maquina_id is not null) or
    (destino_tipo = 'area'    and area_id    is not null) or
    (destino_tipo = 'ot'      and ot_id      is not null) or
    (destino_tipo = 'general')
  )
);
create unique index if not exists toolcrib_vales_folio_uq on toolcrib_vales(empresa_id, folio);
create index if not exists toolcrib_vales_fecha_idx on toolcrib_vales(fecha);
create index if not exists toolcrib_vales_molde_idx on toolcrib_vales(molde_id);
create index if not exists toolcrib_vales_maquina_idx on toolcrib_vales(maquina_id);

create table if not exists toolcrib_vale_lineas (
  id              serial primary key,
  vale_id         integer not null references toolcrib_vales(id) on delete cascade,
  articulo_id     integer not null references articulos(id),
  cantidad        numeric not null check (cantidad > 0),
  costo_unitario  numeric,
  costo_total     numeric,
  lote_id         integer references lotes(id),
  -- La cuenta de gasto va por renglon: el centro de costo dice QUIEN gasta y
  -- la cuenta dice EN QUE, y un mismo vale puede llevar una refaccion y un
  -- consumible, que no se contabilizan igual.
  cuenta_gasto_id integer references cuentas_gastos(id),
  notas           text
);
create index if not exists toolcrib_lineas_vale_idx on toolcrib_vale_lineas(vale_id);

insert into toolcrib_parametros(empresa_id) select id from empresas
on conflict (empresa_id) do nothing;

insert into modulos(clave, nombre, orden)
select 'log_toolcrib', 'Toolcrib', 46
where not exists (select 1 from modulos where clave = 'log_toolcrib');

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r, (select id from modulos where clave = 'log_toolcrib'), true, true, true, false,
       r in ('gerente_planta','gerente_administrativo','direccion','admin','gerente_logistica')
from unnest(array['admin','direccion','gerente_planta','gerente_administrativo','gerente_logistica',
                  'logistica','mantenimiento','gerente_produccion','produccion','ingenieria',
                  'gerente_ingenieria']) r
where not exists (
  select 1 from permisos_rol x
  where x.rol = r and x.modulo_id = (select id from modulos where clave = 'log_toolcrib')
);
