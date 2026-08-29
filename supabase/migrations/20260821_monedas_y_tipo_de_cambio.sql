-- Monedas, moneda principal y tipo de cambio.
--
-- Hasta hoy las monedas vivian en un CHECK escrito a mano -- MXN, USD, EUR --
-- y agregar otra exigia tocar la base. El precio que se le captura a cada
-- proveedor no traia moneda, la orden de compra arrancaba fija en MXN sin
-- mirar ni el articulo ni el proveedor, y no habia tipo de cambio en ninguna
-- parte del sistema. Con articulos ya capturados en dolares, eso significa que
-- el costeo y el valor del inventario mezclan pesos con dolares sin avisar.
--
-- La tasa se define SIEMPRE como: cuantas unidades de la moneda principal vale
-- UNA unidad de la moneda extranjera. Si la principal es MXN y el dolar esta a
-- 17.20, la tasa del USD es 17.20. Definirla al reves es el error clasico y por
-- eso se dice aqui, se repite en la pantalla, y la pantalla ademas muestra la
-- equivalencia calculada mientras se captura.
--
-- La principal no lleva tipo de cambio: su tasa es 1 por definicion.
--
-- Sin tipo de cambio capturado, convertir_a_principal devuelve NULO en vez de
-- inventar una tasa. Un numero inventado se ve igual de bien que uno correcto.
--
-- Aplicada via apply_migration.

create table if not exists monedas (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  clave text not null,
  nombre text not null,
  simbolo text,
  decimales int not null default 2,
  activo boolean not null default true,
  unique (empresa_id, clave)
);

alter table empresas add column if not exists moneda_principal text not null default 'MXN';
alter table empresas add column if not exists dias_vigencia_tipo_cambio int not null default 1;

create table if not exists tipos_cambio (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  moneda text not null,
  fecha date not null default current_date,
  tasa numeric not null check (tasa > 0),
  notas text,
  capturado_por uuid references usuarios(id),
  created_at timestamptz default now(),
  unique (empresa_id, moneda, fecha)
);

alter table articulo_proveedor add column if not exists moneda text;

-- El CHECK a mano sale y en su lugar queda una validacion contra el catalogo,
-- para que dar de alta una moneda nueva la habilite sola.
alter table articulos drop constraint if exists articulos_tipo_moneda_check;

-- Funciones: tipo_cambio_vigente(empresa, moneda) y convertir_a_principal.
-- Modulo config_monedas y sus permisos.
