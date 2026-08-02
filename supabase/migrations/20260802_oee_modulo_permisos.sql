insert into modulos (clave, nombre, orden)
values ('prod_oee', 'OEE', 47)
on conflict (clave) do nothing;

-- ver: quien consulta el indicador. editar: quien ajusta metas y la
-- clasificacion de causas en las seis grandes perdidas.
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r.rol, m.id, true, false, r.edita, false, false
from modulos m
cross join (values
  ('admin', true), ('direccion', false), ('gerente_planta', true),
  ('gerente_administrativo', false), ('gerente_produccion', true),
  ('produccion', false), ('ingenieria', true), ('gerente_calidad', false),
  ('gerente_logistica', false), ('mantenimiento', false)
) as r(rol, edita)
where m.clave = 'prod_oee'
and not exists (
  select 1 from permisos_rol p where p.rol = r.rol and p.modulo_id = m.id
);
