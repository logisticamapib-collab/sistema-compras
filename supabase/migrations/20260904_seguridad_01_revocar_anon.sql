-- =====================================================================
-- SEGURIDAD 1 de 8 — La llave publica deja de ser una llave maestra.
--
-- QUE ESTABA MAL
--
-- La llave `anon` viaja dentro del JavaScript que descarga el navegador:
-- esta publicada por diseno y no es un secreto. Lo que la vuelve inofensiva
-- en un sistema bien armado es que no tenga permisos. Aqui los tenia todos:
-- 154 tablas con SELECT/INSERT/UPDATE/DELETE, 132 secuencias con USAGE y
-- 112 funciones con EXECUTE.
--
-- Sin iniciar sesion, desde una pestana del navegador, se podia leer la
-- nomina de correos, los precios de cada proveedor y las facturas, darse rol
-- de admin, o borrar las existencias. Verificado asumiendo el rol anon antes
-- del cambio: leer usuarios SI, escribir usuarios SI, borrar moldes SI,
-- borrar existencias SI, ejecutar RPC SI.
--
-- LA TRAMPA QUE CASI SE ESCAPA
--
-- Las funciones no tenian el EXECUTE otorgado a `anon` sino a PUBLIC:
--
--   valor_inventario -> =X/postgres | anon=X | authenticated=X | service_role=X
--                       ^^ este es PUBLIC
--
-- Revocarle solo a `anon` habria dejado las 112 funciones ejecutables por
-- cualquiera, heredando el permiso de PUBLIC, y el reporte habria dicho que
-- la puerta quedo cerrada. Por eso se revoca tambien a PUBLIC y se devuelve
-- EXPLICITAMENTE a quien si debe tenerlo.
--
-- QUE NO HACE ESTE ARCHIVO
--
-- No enciende RLS. Despues de esto, cualquier usuario CON SESION sigue
-- pudiendo leer y escribir todo sin importar su rol; eso es el paso 8 y es
-- aceptable mientras son ocho personas de confianza en pruebas. Lo que muere
-- hoy es el acceso de un desconocido sin sesion.
--
-- Tampoco toca el esquema `storage`: ahi si hay politicas activas y los
-- buckets publicos se cierran en el paso 3.
--
-- PARA REVERTIR:
--   grant usage on schema public to anon;
--   grant all on all tables    in schema public to anon;
--   grant all on all sequences in schema public to anon;
--   grant all on all functions in schema public to anon;
-- =====================================================================

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon;
revoke usage on schema public from anon;

-- El permiso de las funciones venia de PUBLIC, no de anon.
revoke all on all functions in schema public from public;

-- Se devuelve a quien si debe ejecutarlas. Incluye las funciones de extension
-- que viven en public (gen_random_uuid y companía), usadas en valores por
-- omision de columnas: sin EXECUTE, los INSERT de un usuario con sesion truenan.
grant execute on all functions in schema public to authenticated;
grant execute on all functions in schema public to service_role;
grant execute on all functions in schema public to postgres;

-- Que los objetos NUEVOS no nazcan abiertos.
alter default privileges for role postgres in schema public revoke all     on tables    from anon;
alter default privileges for role postgres in schema public revoke all     on sequences from anon;
alter default privileges for role postgres in schema public revoke all     on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public;

-- supabase_admin tambien crea objetos en public y el rol que aplica las
-- migraciones no es miembro suyo, asi que esto no se puede cambiar desde aqui.
-- Se avisa en vez de fallar callado. El archivo 02 lo cubre por otra via.
do $$
begin
  execute 'alter default privileges for role supabase_admin in schema public revoke all     on tables    from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all     on sequences from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke all     on functions from anon';
  execute 'alter default privileges for role supabase_admin in schema public revoke execute on functions from public';
exception when others then
  raise warning 'No se pudieron cerrar los privilegios por omision de supabase_admin (%). Lo cubre el archivo 02.', sqlerrm;
end $$;
