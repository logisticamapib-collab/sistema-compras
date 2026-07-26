-- Mtto Moldes Fase D: modulos de calendario preventivo y KPIs.
insert into modulos (clave, nombre, orden) values
  ('mol_calendario','Calendario / Programa de Mantenimiento',95),
  ('mol_kpis','KPIs de Mantenimiento de Molde',96) on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, r.ver, r.crear, r.editar, false, false
  from (values ('gerente_produccion',true,true,true),('produccion',true,true,false),
     ('gerente_ingenieria',true,true,true),('gerente_calidad',true,false,false),
     ('direccion',true,false,false),('gerente_administrativo',true,false,false)
  ) as r(rol, ver, crear, editar)
  cross join (select id from modulos where clave in ('mol_calendario','mol_kpis')) m on conflict do nothing;
