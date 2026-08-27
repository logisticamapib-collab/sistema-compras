-- =====================================================================
-- El reloj del calendario deja de colgar del reinicio de disparos.
--
-- El preventivo de un molde tiene dos gatillos independientes: los disparos
-- acumulados y el calendario. Los disparos miden desgaste por uso; el
-- calendario cubre lo que se degrada aunque el molde no corra -- corrosion,
-- grasa seca, correderas y resortes pegados, o-rings del enfriamiento. Un
-- molde parado seis meses no acumula un solo disparo y de todas formas
-- necesita servicio antes de volver a montarse.
--
-- El problema: al cerrar una orden, las dos cosas colgaban de la MISMA
-- casilla.
--
--   if (reinicia_contador) { shots_acumulados = 0; fecha_ultimo_mtto = hoy }
--
-- Son decisiones distintas. Un correctivo menor -- destapar un enfriamiento,
-- cambiar un o-ring -- no tiene por que borrar los disparos acumulados, pero
-- si es un mantenimiento y podria mover el reloj del calendario. Al reves
-- tambien: una reparacion mayor reinicia los disparos sin que eso signifique
-- que ya se hizo la inspeccion preventiva completa.
--
-- Ahora son dos banderas. Se arranca con reinicia_calendario = reinicia_contador
-- para que el comportamiento de hoy no cambie de golpe: lo que ya movia el
-- reloj lo sigue moviendo, y de ahi cada quien ajusta sus tipos.
--
-- La bandera se copia a la ORDEN cuando se crea, no se lee del tipo al
-- cerrarla. Si alguien cambia el tipo a media orden, la orden debe cerrarse
-- con la regla que tenia cuando se abrio.
-- =====================================================================

alter table mtto_tipos  add column if not exists reinicia_calendario boolean not null default false;
alter table molde_mtto  add column if not exists reinicia_calendario boolean not null default false;

comment on column mtto_tipos.reinicia_calendario is
  'Al cerrar una orden de este tipo, se actualiza moldes.fecha_ultimo_mtto y '
  'con eso arranca de nuevo la cuenta de periodicidad_mtto_dias. Independiente '
  'de reinicia_contador, que borra los disparos acumulados.';

-- Arranque sin sorpresas: lo que hoy mueve el reloj lo sigue moviendo.
update mtto_tipos set reinicia_calendario = reinicia_contador
where reinicia_calendario is distinct from reinicia_contador;

update molde_mtto set reinicia_calendario = reinicia_contador
where estatus <> 'cerrada' and reinicia_calendario is distinct from reinicia_contador;
