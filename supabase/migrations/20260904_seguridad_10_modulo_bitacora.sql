-- La bitacora tiene su propio permiso y no cuelga del de Usuarios.
--
-- Direccion y Calidad pueden necesitar consultarla para una auditoria sin que
-- eso signifique darles el manejo de altas y permisos de la gente. Meterla en
-- config_usuarios habria obligado a esa mezcla.
--
-- Solo lectura por naturaleza: la tabla no le otorga INSERT, UPDATE ni DELETE
-- a nadie, asi que los otros permisos del modulo no tienen efecto aunque se
-- marquen en la pantalla de Permisos por Rol.

insert into modulos (clave, nombre, orden)
select 'config_bitacora', 'Config: Bitacora de cambios',
       coalesce((select max(orden) from modulos), 0) + 1
where not exists (select 1 from modulos where clave = 'config_bitacora');

-- Arranca solo para admin. Quien mas la necesite se agrega desde la pantalla
-- de Permisos por Rol, que para eso existe.
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select 'admin', m.id, true, false, false, false, false
from modulos m
where m.clave = 'config_bitacora'
  and not exists (select 1 from permisos_rol p where p.rol = 'admin' and p.modulo_id = m.id);
