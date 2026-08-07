-- Migrar el texto libre de puesto al catalogo, con el mismo criterio que se
-- uso con area: nada se descarta, lo que no exista se crea.
create or replace function puesto_resolver(
  p_empresa_id integer, p_texto text, p_nivel integer default 1
) returns integer language plpgsql as $$
DECLARE v_id int; v_clave text;
BEGIN
  if coalesce(trim(p_texto), '') = '' then return null; end if;
  select p.id into v_id from puestos p
  where p.empresa_id = p_empresa_id and area_normaliza(p.nombre) = area_normaliza(p_texto);
  if v_id is not null then return v_id; end if;

  v_clave := upper(regexp_replace(substring(trim(p_texto) from 1 for 8), '[^a-zA-Z0-9]', '', 'g'));
  if coalesce(v_clave,'') = '' then v_clave := 'PUESTO'; end if;
  while exists (select 1 from puestos p where p.empresa_id = p_empresa_id and upper(p.clave) = v_clave) loop
    v_clave := v_clave || '1';
  end loop;

  insert into puestos(empresa_id, clave, nombre, nivel)
  values (p_empresa_id, v_clave, trim(p_texto), p_nivel)
  returning id into v_id;
  return v_id;
END $$;

-- Puestos tipicos de una planta de inyeccion, con su nivel. Son sugerencia y
-- se editan; lo que importa es que dejen de escribirse a mano.
insert into puestos(empresa_id, clave, nombre, nivel)
select e.id, x.clave, x.nombre, x.nivel
from empresas e
cross join (values
  ('OPER','Operador',1), ('AYUD','Ayudante general',1), ('INSPEC','Inspector de calidad',1),
  ('ALMAC','Almacenista',1), ('TECMTTO','Tecnico de mantenimiento',1), ('TECMOL','Tecnico de moldes',1),
  ('LIDER','Lider',2), ('SUPERV','Supervisor',3), ('COORD','Coordinador',4),
  ('JEFEMOL','Jefe de Moldes',5), ('JEFEMTTO','Jefe de Mantenimiento',5),
  ('JEFEPROD','Jefe de Produccion',5), ('JEFECAL','Jefe de Calidad',5),
  ('GTEPROD','Gerente de Produccion',6), ('GTECAL','Gerente de Calidad',6),
  ('GTELOG','Gerente de Logistica',6), ('GTEING','Gerente de Ingenieria',6),
  ('GTECOM','Gerente de Compras',6), ('GTEMTTO','Gerente de Mantenimiento',6),
  ('GTERH','Gerente de Recursos Humanos',6), ('GTESEG','Gerente de Seguridad e Higiene',6),
  ('GTEPLANTA','Gerente de Planta',6), ('GTEADMIN','Gerente Administrativo',6),
  ('DIRECTOR','Director',7)
) as x(clave, nombre, nivel)
where not exists (
  select 1 from puestos p
  where p.empresa_id = e.id and area_normaliza(p.nombre) = area_normaliza(x.nombre)
);

do $mig$
declare r record;
begin
  for r in select id, empresa_id, puesto from usuarios where coalesce(trim(puesto),'') <> '' loop
    update usuarios set puesto_id = puesto_resolver(r.empresa_id, r.puesto) where id = r.id;
    insert into areas_migracion_respaldo(tabla, registro_id, texto, area_id)
    values ('usuarios.puesto', r.id::text, r.puesto, null);
  end loop;
end $mig$;

alter table usuarios drop column if exists puesto;

-- ---------- Permisos de los roles nuevos ----------
-- Se clonan de un rol parecido en lugar de dejarlos vacios, que obligaria a
-- palomear ochenta modulos a mano antes de que el rol sirva de algo.
insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select 'mantenimiento', pr.modulo_id, pr.puede_ver, pr.puede_crear, pr.puede_editar, false, false
from permisos_rol pr where pr.rol = 'produccion'
  and not exists (select 1 from permisos_rol x where x.rol='mantenimiento' and x.modulo_id=pr.modulo_id);

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select 'moldes', pr.modulo_id, pr.puede_ver, pr.puede_crear, pr.puede_editar, false, false
from permisos_rol pr where pr.rol = 'produccion'
  and not exists (select 1 from permisos_rol x where x.rol='moldes' and x.modulo_id=pr.modulo_id);

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select 'ingenieria', pr.modulo_id, pr.puede_ver, pr.puede_crear, pr.puede_editar, false, false
from permisos_rol pr where pr.rol = 'gerente_ingenieria'
  and not exists (select 1 from permisos_rol x where x.rol='ingenieria' and x.modulo_id=pr.modulo_id);

-- Recursos Humanos y Seguridad arrancan solo con lo que cualquiera necesita:
-- consultar el documento vigente. Lo demas se les da cuando exista su modulo.
insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r, (select id from modulos where clave = 'cal_documentos'), true, false, false, false, false
from unnest(array['recursos_humanos','seguridad_higiene']) r
where not exists (
  select 1 from permisos_rol x
  where x.rol = r and x.modulo_id = (select id from modulos where clave = 'cal_documentos')
);

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select g, pr.modulo_id, pr.puede_ver, pr.puede_crear, pr.puede_editar, pr.puede_eliminar, pr.puede_aprobar
from unnest(array['gerente_mantenimiento','gerente_rh']) g
cross join permisos_rol pr
where pr.rol = 'gerente_area'
  and not exists (select 1 from permisos_rol x where x.rol = g and x.modulo_id = pr.modulo_id);

alter table permisos_rol drop constraint if exists permisos_rol_rol_fk;
alter table permisos_rol add constraint permisos_rol_rol_fk
  foreign key (rol) references roles(clave) on update cascade on delete cascade;
