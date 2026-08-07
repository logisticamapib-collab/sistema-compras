-- ACCESO TOTAL COMO BANDERA, NO COMO LISTA QUE HAY QUE MANTENER
--
-- El admin tenia 32 de 91 modulos, y de esos solo 9 con todos los permisos:
-- ni siquiera veia lo que en teoria administraba. La causa no fue un olvido
-- puntual, es estructural: cada modulo nuevo se le da a los roles que uno se
-- acuerda, y el admin se fue quedando atras modulo tras modulo.
--
-- Arreglarlo llenando los 91 renglones de hoy solo aplaza el problema al
-- proximo modulo. Por eso la bandera va en el rol y un disparador la sostiene:
-- cuando se cree un modulo, los roles de acceso total lo reciben solos.

alter table roles add column if not exists acceso_total boolean not null default false;

comment on column roles.acceso_total is
  'El rol recibe automaticamente todos los permisos de todos los modulos, incluidos los que se creen despues.';

update roles set acceso_total = true where clave = 'admin';

-- Otorgar y completar lo que falte. Se hace en dos pasos porque hay modulos
-- que el rol no tiene y otros que tiene a medias.
insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r.clave, m.id, true, true, true, true, true
from roles r cross join modulos m
where r.acceso_total
  and not exists (select 1 from permisos_rol p where p.rol = r.clave and p.modulo_id = m.id);

update permisos_rol p
set puede_ver = true, puede_crear = true, puede_editar = true,
    puede_eliminar = true, puede_aprobar = true
from roles r
where r.clave = p.rol and r.acceso_total
  and not (p.puede_ver and p.puede_crear and p.puede_editar and p.puede_eliminar and p.puede_aprobar);

-- Un modulo nuevo llega completo a los roles de acceso total.
create or replace function trg_modulo_acceso_total() returns trigger language plpgsql as $$
BEGIN
  insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.clave, new.id, true, true, true, true, true
  from roles r
  where r.acceso_total
    and not exists (select 1 from permisos_rol p where p.rol = r.clave and p.modulo_id = new.id);
  return new;
END $$;

drop trigger if exists modulo_acceso_total on modulos;
create trigger modulo_acceso_total
  after insert on modulos
  for each row execute function trg_modulo_acceso_total();

-- Y si a alguien se le marca acceso total despues, tambien se le completa.
create or replace function trg_rol_acceso_total() returns trigger language plpgsql as $$
BEGIN
  if new.acceso_total and not coalesce(old.acceso_total, false) then
    insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
    select new.clave, m.id, true, true, true, true, true
    from modulos m
    where not exists (select 1 from permisos_rol p where p.rol = new.clave and p.modulo_id = m.id);

    update permisos_rol
    set puede_ver = true, puede_crear = true, puede_editar = true,
        puede_eliminar = true, puede_aprobar = true
    where rol = new.clave;
  end if;
  return new;
END $$;

drop trigger if exists rol_acceso_total on roles;
create trigger rol_acceso_total
  after update of acceso_total on roles
  for each row execute function trg_rol_acceso_total();
