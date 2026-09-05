-- =====================================================================
-- SEGURIDAD 5 de 8 — Correccion: al invitado tambien hay que pedirle su
-- contrasena.
--
-- QUE ESTABA MAL
--
-- La bandera debe_cambiar_password solo se prendia en el camino de contrasena
-- temporal. En el de invitacion no se prendia nunca, con el razonamiento de
-- que "ahi el usuario elige su contrasena desde el enlace".
--
-- Eso era falso. El enlace de invitacion de Supabase NO pide contrasena: lo
-- unico que hace es confirmar la cuenta y abrir sesion. Si la aplicacion no
-- pregunta, nadie pregunta. El invitado entraba sin haber definido una
-- contrasena que el conociera, y la siguiente vez se quedaba afuera para
-- siempre, porque en el login no hay "olvide mi contrasena".
--
-- Se probo con un usuario real y fue exactamente lo que paso.
--
-- POR QUE UN TEXTO Y NO UN BOOLEANO
--
-- Las dos situaciones necesitan que la persona ponga una contrasena, pero no
-- se le explican igual: al invitado hay que decirle "define la tuya", y a
-- quien recibio una temporal hay que decirle "la que te dieron la conoce otra
-- persona, cambiala". Un booleano no alcanza para saber cual de las dos frases
-- toca.
-- =====================================================================

alter table usuarios add column if not exists password_pendiente text
  check (password_pendiente in ('invitacion','temporal'));

comment on column usuarios.password_pendiente is
  'Nulo = nada pendiente. invitacion = lo invitaron y todavia no define su '
  'contrasena. temporal = entro con una que le dio el administrador y tiene que '
  'cambiarla. Mientras no sea nulo, el sistema no muestra ninguna pantalla.';

update usuarios set password_pendiente = 'temporal'
where debe_cambiar_password and password_pendiente is null;

alter table usuarios drop column if exists debe_cambiar_password;

-- Los invitados que quedaron a medias por la falla.
update usuarios u set password_pendiente = 'invitacion'
from auth.users a
where a.id = u.id and a.invited_at is not null and u.password_pendiente is null;
