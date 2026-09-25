-- =====================================================================
-- Correr el MRP fallaba con "DELETE requires a WHERE clause".
--
-- EL SINTOMA
--
-- Desde la pantalla Planeacion -> Correr MRP, la corrida fallaba con ese
-- mensaje y la lista quedaba vacia. Desde el editor de SQL, la MISMA funcion
-- con los MISMOS parametros corria sin problema. Esa diferencia era la pista.
--
-- LA CAUSA
--
-- El rol con el que se conecta la API trae precargada una extension:
--
--   authenticator: session_preload_libraries = supautils, safeupdate
--
-- safeupdate prohibe DELETE y UPDATE sin WHERE. Dentro de mrp_correr habia
-- tres, sobre tablas temporales:
--
--   DELETE FROM _req;   INSERT INTO _req  SELECT * FROM _tmp_req;
--   DELETE FROM _rcpt;  INSERT INTO _rcpt SELECT * FROM _tmp_rcpt;
--   DELETE FROM _onh;   INSERT INTO _onh  SELECT * FROM _tmp_onh;
--
-- Son legales en PostgreSQL y por eso pasaron desapercibidos: el editor de SQL
-- no carga safeupdate, la aplicacion si. Un error que solo aparece por el
-- camino del usuario.
--
-- Y solo se ejecutaban cuando existen PARTES EQUIVALENTES. Mientras no hubiera
-- articulos con parte y codigo principal distinto, ese bloque no corria y la
-- falla no se veia. Al dar de alta las variantes aparecieron 5 y el MRP se cayo.
--
-- LA CORRECCION
--
-- TRUNCATE en vez de DELETE. Hace lo mismo sobre una tabla temporal, es mas
-- rapido, y no cae en la regla de safeupdate.
--
-- Se reviso el resto del sistema: ninguna otra funcion tiene un DELETE o un
-- UPDATE sin WHERE.
--
-- PENDIENTE RELACIONADO, NO ES ESTE ARCHIVO
--
-- El mismo rol trae statement_timeout = 8s. El MRP recorre articulos por cubos
-- de tiempo, asi que con mas datos puede pasarse de 8 segundos y morir cortado.
-- Si eso ocurre, hay que medirlo y decidir: subir el limite para ese rol, o
-- mover la corrida a una tarea en segundo plano.
-- =====================================================================

do $$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
  where ns.nspname = 'public' and p.proname = 'mrp_correr';

  if def is null then
    raise exception 'No existe public.mrp_correr';
  end if;

  -- Si ya esta corregida, no se hace nada.
  if (select count(*) from regexp_matches(def, 'DELETE FROM _req;', 'g')) = 0 then
    raise notice 'mrp_correr ya usa TRUNCATE, no se toca.';
    return;
  end if;

  -- Cada ancla tiene que aparecer exactamente una vez.
  if (select count(*) from regexp_matches(def, 'DELETE FROM _req;',  'g')) <> 1
  or (select count(*) from regexp_matches(def, 'DELETE FROM _rcpt;', 'g')) <> 1
  or (select count(*) from regexp_matches(def, 'DELETE FROM _onh;',  'g')) <> 1 then
    raise exception 'Alguna ancla no aparece exactamente una vez; no se modifica la funcion.';
  end if;

  def := replace(def, 'DELETE FROM _req;',  'TRUNCATE _req;');
  def := replace(def, 'DELETE FROM _rcpt;', 'TRUNCATE _rcpt;');
  def := replace(def, 'DELETE FROM _onh;',  'TRUNCATE _onh;');

  execute def;
end $$;
