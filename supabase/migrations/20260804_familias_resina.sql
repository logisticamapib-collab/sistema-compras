-- Familia de resina: el material base del que esta hecho el articulo.
-- Es independiente del codigo: dos resinas de proveedores distintos y diez
-- moldeados distintos pueden ser todos polipropileno. Sirve para ver el
-- molino por tipo de material, que es como se vende y como se retorna:
-- al comprador de scrap le importa que sea PP, no de que pieza salio.

create table if not exists familias_resina (
  id            serial primary key,
  empresa_id    integer not null references empresas(id) on delete cascade,
  clave         text not null,
  nombre        text not null,
  orden         integer not null default 100,
  activo        boolean not null default true,
  notas         text,
  created_at    timestamptz not null default now()
);

create unique index if not exists familias_resina_clave_uq
  on familias_resina(empresa_id, upper(clave));

alter table articulos add column if not exists familia_resina_id integer references familias_resina(id);
create index if not exists articulos_familia_resina_idx on articulos(familia_resina_id);

comment on column articulos.familia_resina_id is
  'Material base (PP, PA6, ABS...). El molido y la barredura lo heredan de su resina virgen.';

-- Catalogo inicial: las familias que se usan en inyeccion automotriz.
-- Se siembra por empresa y es editable; no se borra nada si ya existe.
insert into familias_resina(empresa_id, clave, nombre, orden)
select e.id, x.clave, x.nombre, x.orden
from empresas e
cross join (values
  ('PP',      'Polipropileno',                      10),
  ('PP-TD',   'Polipropileno con talco',            15),
  ('PE',      'Polietileno',                        20),
  ('PA6',     'Poliamida 6 (Nylon 6)',              30),
  ('PA66',    'Poliamida 6.6 (Nylon 6.6)',          35),
  ('ABS',     'Acrilonitrilo butadieno estireno',   40),
  ('PC',      'Policarbonato',                      50),
  ('PC/ABS',  'Aleacion policarbonato / ABS',       55),
  ('POM',     'Poliacetal',                         60),
  ('PBT',     'Politereftalato de butileno',        70),
  ('PET',     'Politereftalato de etileno',         75),
  ('ASA',     'Acrilonitrilo estireno acrilato',    80),
  ('SAN',     'Estireno acrilonitrilo',             85),
  ('PS',      'Poliestireno',                       90),
  ('PMMA',    'Acrilico',                           95),
  ('TPE',     'Elastomero termoplastico',          100),
  ('TPO',     'Poliolefina termoplastica',         105),
  ('TPU',     'Poliuretano termoplastico',         110),
  ('PPS',     'Sulfuro de polifenileno',           120),
  ('PPA',     'Poliftalamida',                     125),
  ('PVC',     'Policloruro de vinilo',             130)
) as x(clave, nombre, orden)
where not exists (
  select 1 from familias_resina f
  where f.empresa_id = e.id and upper(f.clave) = upper(x.clave)
);
