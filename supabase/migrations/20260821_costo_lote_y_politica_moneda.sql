-- Costo por lote con su tipo de cambio congelado, y la politica que decide
-- cuando se congela.
--
-- El hueco de fondo: los lotes no guardaban costo. El inventario se valuaba
-- con el costo estandar del articulo, en la moneda del articulo, asi que no
-- habia donde congelar una tasa ni forma de saber a que tipo de cambio entro
-- cada lote. Con articulos en dolares eso significa que el valor del
-- inventario mezclaba monedas sin avisar.
--
-- Ahora el lote guarda: en que moneda se compro, a cuanto, que tasa se uso,
-- de que fecha era esa tasa, si esa tasa no era la del dia, y el costo ya
-- convertido a la moneda principal. Ese ultimo numero es el que valua el
-- inventario y ya no cambia: es costo historico. La diferencia por tipo de
-- cambio se reconoce cuando el material se consume o se vende, no revaluando
-- el inventario cada vez que alguien abre un reporte.
--
-- La politica es de cada empresa porque es una decision contable, no tecnica:
--   congela_en  recibo | factura | periodo
--   sin_tasa    ultima | sin_convertir
--
-- Cambiar la politica NO re-expresa lo ya congelado. Re-expresar el pasado
-- cada vez que cambia una politica hace que un mismo mes valga distinto segun
-- cuando se consulte.
--
-- valor_inventario usa el costo congelado del lote; si el lote no lo trae,
-- cae al costo estandar del articulo convertido y lo REPORTA APARTE en la
-- columna origen_costo. Mezclar los dos criterios sin decirlo es justo lo que
-- hace que un numero se vea bien y no lo sea.
--
-- Aplicada via apply_migration.

create table if not exists politica_moneda (
  empresa_id int primary key references empresas(id) on delete cascade,
  congela_en text not null default 'recibo' check (congela_en in ('recibo','factura','periodo')),
  sin_tasa text not null default 'ultima' check (sin_tasa in ('ultima','sin_convertir')),
  revalua_inventario boolean not null default false,
  updated_at timestamptz default now(),
  updated_by uuid references usuarios(id)
);

create table if not exists tipos_cambio_periodo (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  moneda text not null,
  anio int not null,
  mes int not null check (mes between 1 and 12),
  tasa numeric not null check (tasa > 0),
  notas text,
  capturado_por uuid references usuarios(id),
  unique (empresa_id, moneda, anio, mes)
);

alter table lotes add column if not exists moneda text;
alter table lotes add column if not exists costo_unitario numeric;
alter table lotes add column if not exists tasa_cambio numeric;
alter table lotes add column if not exists tasa_fecha date;
alter table lotes add column if not exists tasa_estimada boolean not null default false;
alter table lotes add column if not exists costo_unitario_principal numeric;

-- Funciones: tasa_para_movimiento, congelar_costo_lote y valor_inventario.
