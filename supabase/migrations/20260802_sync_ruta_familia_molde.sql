-- =====================================================================
-- Sincronizacion garantizada de la ruta por familia de molde.
--
-- El ciclo de inyeccion es una propiedad del MOLDE y la MAQUINA, no del
-- codigo de articulo: el mismo disparo produce el izquierdo y el derecho, y
-- con las variantes de color un solo molde puede tener muchos codigos.
--
-- Hasta ahora la replica se hacia una sola vez, al guardar desde la pantalla
-- de Rutas. Si la familia crecia despues (se asignaba otro articulo a una
-- cavidad, o se daba de alta un color nuevo) ese articulo se quedaba SIN
-- RUTA, y eso arrastra a todo lo calculado: duracion 0 en el plan de
-- capacidad (se podia encimar sin limite), desempeno 0 en el OEE y costo
-- estandar sin mano de obra ni overhead.
--
-- Ahora la sincronizacion vive en la base, asi que cubre todas las vias de
-- entrada: la pantalla, la carga masiva y cualquier script.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Al guardar una ruta CON molde, se propaga a los demas articulos que
--    salen de ese molde. El color no importa: el ciclo es el mismo.
-- ---------------------------------------------------------------------
create or replace function sync_ruta_familia()
returns trigger language plpgsql as $$
DECLARE
  v_art int; v_id int;
BEGIN
  -- la propagacion vuelve a disparar el trigger; se corta la recursion
  if pg_trigger_depth() > 1 then return null; end if;
  if NEW.molde_id is null then return null; end if;

  for v_art in
    select distinct mc.articulo_id
    from molde_cavidades mc
    where mc.molde_id = NEW.molde_id and mc.activa
      and mc.articulo_id is not null
      and mc.articulo_id <> NEW.articulo_id
  loop
    select id into v_id from rutas_fabricacion
    where articulo_id = v_art and secuencia = NEW.secuencia;

    if v_id is null then
      insert into rutas_fabricacion(articulo_id, site_id, secuencia, tipo_operacion,
                                    maquina_principal_id, molde_id, personal_requerido,
                                    tiempo_estandar_seg, aplica_familia)
      values (v_art, NEW.site_id, NEW.secuencia, NEW.tipo_operacion,
              NEW.maquina_principal_id, NEW.molde_id, NEW.personal_requerido,
              NEW.tiempo_estandar_seg, true)
      returning id into v_id;
    else
      update rutas_fabricacion set
        site_id = NEW.site_id, tipo_operacion = NEW.tipo_operacion,
        maquina_principal_id = NEW.maquina_principal_id, molde_id = NEW.molde_id,
        personal_requerido = NEW.personal_requerido,
        tiempo_estandar_seg = NEW.tiempo_estandar_seg, aplica_familia = true
      where id = v_id;
    end if;

    -- las maquinas alternas tambien son del molde, no del codigo
    delete from ruta_maquinas_alternas where ruta_id = v_id;
    insert into ruta_maquinas_alternas(ruta_id, maquina_id, aprobada_por_cliente)
    select v_id, rma.maquina_id, rma.aprobada_por_cliente
    from ruta_maquinas_alternas rma where rma.ruta_id = NEW.id;
  end loop;

  update rutas_fabricacion set aplica_familia = true
  where id = NEW.id and coalesce(aplica_familia, false) = false
    and exists (select 1 from molde_cavidades mc
                where mc.molde_id = NEW.molde_id and mc.activa
                  and mc.articulo_id is not null and mc.articulo_id <> NEW.articulo_id);
  return null;
END $$;

drop trigger if exists trg_sync_ruta_familia on rutas_fabricacion;
create trigger trg_sync_ruta_familia
after insert or update on rutas_fabricacion
for each row execute function sync_ruta_familia();


-- ---------------------------------------------------------------------
-- 2) Al asignar un articulo NUEVO a una cavidad, hereda la ruta que ya
--    tiene el molde. Es el caso que dejaba articulos sin ruta.
--    Si el articulo ya tenia una ruta propia, NO se pisa.
-- ---------------------------------------------------------------------
create or replace function sync_ruta_nueva_cavidad()
returns trigger language plpgsql as $$
DECLARE
  v_ruta record; v_id int;
BEGIN
  if pg_trigger_depth() > 1 then return null; end if;
  if NEW.articulo_id is null or not coalesce(NEW.activa, true) then return null; end if;

  select rf.* into v_ruta
  from rutas_fabricacion rf
  join molde_cavidades mc on mc.articulo_id = rf.articulo_id and mc.molde_id = NEW.molde_id and mc.activa
  where rf.molde_id = NEW.molde_id and rf.articulo_id <> NEW.articulo_id
    and coalesce(rf.tiempo_estandar_seg, 0) > 0
  order by rf.secuencia
  limit 1;

  if v_ruta.id is null then return null; end if;

  select id into v_id from rutas_fabricacion
  where articulo_id = NEW.articulo_id and secuencia = v_ruta.secuencia;
  if v_id is not null then return null; end if;

  insert into rutas_fabricacion(articulo_id, site_id, secuencia, tipo_operacion,
                                maquina_principal_id, molde_id, personal_requerido,
                                tiempo_estandar_seg, aplica_familia)
  values (NEW.articulo_id, v_ruta.site_id, v_ruta.secuencia, v_ruta.tipo_operacion,
          v_ruta.maquina_principal_id, v_ruta.molde_id, v_ruta.personal_requerido,
          v_ruta.tiempo_estandar_seg, true)
  returning id into v_id;

  insert into ruta_maquinas_alternas(ruta_id, maquina_id, aprobada_por_cliente)
  select v_id, rma.maquina_id, rma.aprobada_por_cliente
  from ruta_maquinas_alternas rma where rma.ruta_id = v_ruta.id;

  return null;
END $$;

drop trigger if exists trg_sync_ruta_nueva_cavidad on molde_cavidades;
create trigger trg_sync_ruta_nueva_cavidad
after insert or update of articulo_id on molde_cavidades
for each row execute function sync_ruta_nueva_cavidad();


-- ---------------------------------------------------------------------
-- 3) Backfill: re-guarda las rutas que ya existen y comparten molde, para
--    que el trigger las propague a los articulos que quedaron sin ruta.
-- ---------------------------------------------------------------------
update rutas_fabricacion rf
set aplica_familia = coalesce(aplica_familia, false)
where rf.molde_id is not null
  and exists (
    select 1 from molde_cavidades mc
    where mc.molde_id = rf.molde_id and mc.activa and mc.articulo_id is not null
      and mc.articulo_id <> rf.articulo_id
  );
