-- =====================================================================
-- SEGURIDAD 4 de 8 — La contrasena que dio el administrador se devuelve.
--
-- El alta de usuarios tiene dos caminos: invitacion por correo, donde la
-- persona pone su propia contrasena y nadie mas la conoce, y contrasena
-- temporal, que el administrador escribe y le pasa.
--
-- El segundo camino existe porque en piso hay gente sin correo. Pero una
-- contrasena que conoce el administrador y que normalmente viaja por mensaje
-- no es una contrasena: es un permiso prestado. Esta bandera obliga a
-- devolverlo en el primer ingreso -- el sistema no muestra ninguna pantalla
-- hasta que la persona ponga la suya.
--
-- El alta por invitacion NO la prende: en ese camino nunca hubo una
-- contrasena que devolver.
-- =====================================================================

alter table usuarios add column if not exists debe_cambiar_password boolean not null default false;

comment on column usuarios.debe_cambiar_password is
  'Se prende cuando el administrador da de alta al usuario con una contrasena '
  'temporal que el escribio. Mientras este prendida, el sistema no deja pasar a '
  'ninguna pantalla hasta que la persona ponga la suya.';
