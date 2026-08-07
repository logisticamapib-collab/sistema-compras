-- AREAS Y EJES DE IMPUTACION
--
-- Para poder preguntar "que molde, que maquina o que area consume mas" hace
-- falta que el consumo sepa contra que se hizo, y que el centro de costo y la
-- cuenta de gasto lleguen resueltos en lugar de que alguien los teclee. Un
-- eje que se captura a mano se captura mal, y un reporte armado sobre eso no
-- sirve para decidir nada.
--
-- "Area" ya existia como texto libre en cuatro tablas distintas (alertas de
-- calidad, no conformidades, equipos de medicion y retencion de registros).
-- Con texto libre "Inyeccion", "INYECCION" e "Inyeccion 1" son tres areas, y
-- cualquier agrupacion sale rota. Aqui queda el catalogo.

create table if not exists areas (
  id              serial primary key,
  empresa_id      integer not null references empresas(id) on delete cascade,
  site_id         integer references sites(id),
  clave           text not null,
  nombre          text not null,
  centro_costo_id integer references centros_costos(id),
  responsable_id  uuid references usuarios(id),
  activo          boolean not null default true,
  created_at      timestamptz not null default now()
);
create unique index if not exists areas_clave_uq on areas(empresa_id, upper(clave));

-- El centro de costo baja del objeto que consume, no del que captura.
alter table moldes    add column if not exists centro_costo_id integer references centros_costos(id);
alter table maquinas  add column if not exists centro_costo_id integer references centros_costos(id);
alter table maquinas  add column if not exists area_id integer references areas(id);

-- La cuenta de gasto baja del tipo de material: una refaccion no se
-- contabiliza igual que un consumible ni que una herramienta de corte.
alter table categorias add column if not exists cuenta_gasto_id integer references cuentas_gastos(id);

-- Toolcrib no es una tabla nueva: es un almacen marcado. Entradas, traspasos
-- y salidas ya funcionan y no hay por que duplicarlos.
alter table almacenes add column if not exists es_toolcrib boolean not null default false;

comment on column almacenes.es_toolcrib is
  'Almacen de herramental y refacciones. Sus salidas se hacen por vale para poder imputarlas.';

-- El consumo de mantenimiento se venia grabando como ajuste_negativo, asi que
-- en el historial se ve igual que un descuadre de inventario. Con un tipo
-- propio se pueden separar, que es lo que permite medir consumo de verdad y
-- deja de ensuciar el analisis de ajustes del inventario ciclico.
alter table movimientos drop constraint if exists movimientos_tipo_check;
alter table movimientos add constraint movimientos_tipo_check check (tipo = any (array[
  'entrada_inicial','ajuste_positivo','ajuste_negativo','traspaso','liberacion_calidad',
  'rechazo_calidad','consumo_produccion','entrada_produccion','salida_embarque',
  'salida_maquila','entrada_maquila','consumo_maquila','cuarentena','scrap','retrabajo',
  'surtido_produccion','retorno_suministro','molienda','entrega_molinos','retorno_cliente',
  'consumo_mantenimiento'
]));

insert into areas(empresa_id, clave, nombre)
select e.id, x.clave, x.nombre
from empresas e
cross join (values
  ('INY',   'Inyeccion'),
  ('ENS',   'Ensamble'),
  ('MOL',   'Molinos'),
  ('MTTO',  'Mantenimiento'),
  ('TOOL',  'Toolcrib'),
  ('CAL',   'Calidad'),
  ('ALM',   'Almacen'),
  ('ING',   'Ingenieria'),
  ('LOG',   'Logistica'),
  ('SERV',  'Servicios generales')
) as x(clave, nombre)
where not exists (
  select 1 from areas a where a.empresa_id = e.id and upper(a.clave) = upper(x.clave)
);
