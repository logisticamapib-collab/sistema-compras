-- Ruteo de maquila desde el MRP: marca por articulo. El motor mrp_correr NO se
-- modifica; la Bandeja MRP enruta los fabricados con se_maquila a Orden de Maquila.
alter table articulos add column if not exists se_maquila boolean not null default false;
alter table articulos add column if not exists maquilador_id integer references proveedores(id);
