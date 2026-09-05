-- =====================================================================
-- SEGURIDAD 6 de 8 — Entrar sin correo, sin regalar la identidad.
--
-- EL PROBLEMA
--
-- El modulo de Recursos Humanos va a necesitar que la gente de piso entre a
-- pedir un permiso. Muchos no tienen correo corporativo. La salida obvia --
-- usar su correo personal -- resuelve el acceso y crea tres problemas peores:
--
--   1. En un ERP la cuenta ES la firma. Quien aprueba un permiso, una
--      requisicion o una liberacion queda registrado por su cuenta. Si esa
--      cuenta vive en un buzon que la empresa no controla, el dia que la
--      persona se va no se puede tomar posesion de ella.
--   2. Los avisos con numeros de parte, volumenes y precios se quedan para
--      siempre en una bandeja personal. Con un cliente automotriz que exige
--      confidencialidad, eso es un tema de contrato.
--   3. El dia que exista "olvide mi contrasena", el ex-empleado recupera el
--      acceso desde un buzon que nadie puede cerrar.
--
-- LA SEPARACION
--
-- Hasta hoy usuarios.email hacia dos trabajos: con que entras, y a donde te
-- escribe el sistema. Se separan:
--
--   email               IDENTIDAD. Corporativo, o uno interno que nunca recibe
--                       nada: 10432@interno.syntia
--   numero_empleado     lo que la persona teclea en el login
--   acceso_interno      su identidad es interna, no se le puede mandar enlace
--   email_notificacion  A DONDE ESCRIBIRLE. Opcional.
--
-- Si email_notificacion esta vacio, esa persona no se pierde de nada: ve todo
-- dentro de la aplicacion, y quienes aprueban si reciben su aviso.
--
-- El dominio interno vive en el codigo (frontend/src/lib/accesoInterno.js y la
-- Edge Function crear-usuario), no aqui, porque el login tiene que armarlo
-- ANTES de iniciar sesion, y sin sesion ya no se puede leer ninguna tabla.
-- Ponerlo en la base obligaria a reabrirle una tabla al publico, que es justo
-- lo que se cerro en el archivo 01.
-- =====================================================================

alter table usuarios add column if not exists numero_empleado    text;
alter table usuarios add column if not exists acceso_interno     boolean not null default false;
alter table usuarios add column if not exists email_notificacion text;

comment on column usuarios.email is
  'IDENTIDAD: con esto inicia sesion. Puede ser un correo interno que nunca '
  'recibe nada. Para escribirle usa email_notificacion.';
comment on column usuarios.numero_empleado is
  'Lo que teclea en el login quien entra con cuenta interna. La aplicacion le '
  'agrega el dominio interno para armar la identidad.';
comment on column usuarios.acceso_interno is
  'Su identidad es interna: no se le puede mandar invitacion ni recuperacion '
  'por correo. Si pierde la contrasena, el administrador le pone una temporal.';
comment on column usuarios.email_notificacion is
  'A donde le escribe el sistema. Nulo = no se le escribe, ve todo en la '
  'aplicacion. Separado de la identidad a proposito: cambiar a donde te llegan '
  'los avisos no deberia cambiar quien eres.';

create unique index if not exists usuarios_numero_empleado_unico
  on usuarios (empresa_id, numero_empleado)
  where numero_empleado is not null;

update usuarios set email_notificacion = email
where email_notificacion is null and email not like '%@interno.syntia';
