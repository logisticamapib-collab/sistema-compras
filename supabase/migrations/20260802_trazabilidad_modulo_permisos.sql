-- Modulo de Trazabilidad. Vive en Calidad (es quien atiende recall y
-- contencion) pero lo consultan tambien Logistica, Ingenieria y Direccion.
insert into modulos (clave, nombre, orden)
values ('cal_trazabilidad', 'Trazabilidad de Lote', 69)
on conflict (clave) do nothing;

insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r.rol, m.id, true, false, false, false, false
from modulos m
cross join (values
  ('admin'),('direccion'),('gerente_planta'),('gerente_administrativo'),
  ('gerente_calidad'),('calidad'),('gerente_logistica'),('logistica'),
  ('ingenieria'),('gerente_produccion'),('produccion')
) as r(rol)
where m.clave = 'cal_trazabilidad'
and not exists (
  select 1 from permisos_rol p where p.rol = r.rol and p.modulo_id = m.id
);
