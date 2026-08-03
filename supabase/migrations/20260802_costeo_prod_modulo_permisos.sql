insert into modulos (clave, nombre, orden)
values ('dir_costeo_prod', 'Costeo Real vs Estandar', 46)
on conflict (clave) do nothing;

insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r.rol, m.id, true, false, r.edita, false, false
from modulos m
cross join (values
  ('admin', true), ('direccion', true), ('gerente_planta', true),
  ('gerente_administrativo', true), ('gerente_produccion', false),
  ('gerente_compras', false), ('ingenieria', false)
) as r(rol, edita)
where m.clave = 'dir_costeo_prod'
and not exists (
  select 1 from permisos_rol p where p.rol = r.rol and p.modulo_id = m.id
);
