-- Mtto Moldes: trabajos externos / fuera de planta.
alter table molde_mtto add column if not exists es_externo boolean not null default false;
alter table molde_mtto add column if not exists proveedor_id integer references proveedores(id);
alter table molde_mtto add column if not exists costo_externo numeric;
alter table molde_mtto add column if not exists fecha_envio_ext date;
alter table molde_mtto add column if not exists fecha_retorno_ext date;
