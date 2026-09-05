-- =====================================================================
-- SEGURIDAD 3 de 8 — Cerrar al propio guardian.
--
-- La funcion del archivo 02 nacio ANTES de que existiera el disparador que la
-- habria cerrado, asi que se quedo con EXECUTE a PUBLIC. La verificacion la
-- encontro: de 113 funciones, 112 cerradas y una abierta, justo la nueva.
--
-- Es SECURITY DEFINER. Llamarla fuera de un contexto de disparador de eventos
-- falla, asi que no era explotable, pero una funcion SECURITY DEFINER
-- ejecutable por cualquiera es exactamente lo que marca una auditoria.
--
-- La leccion queda anotada: el guardian no se cubre a si mismo. Cuando se
-- agregue otra funcion de infraestructura antes de que corra el disparador,
-- hay que cerrarla a mano.
-- =====================================================================

revoke all on function public.trg_objeto_nuevo_no_nace_abierto() from anon, public;
grant execute on function public.trg_objeto_nuevo_no_nace_abierto() to postgres;
