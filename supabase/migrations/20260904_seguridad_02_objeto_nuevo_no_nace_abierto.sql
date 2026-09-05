-- =====================================================================
-- SEGURIDAD 2 de 8 — Que ningun objeto nuevo nazca abierto.
--
-- POR QUE HIZO FALTA ESTO
--
-- El archivo 01 cerro los privilegios por omision con ALTER DEFAULT
-- PRIVILEGES. Al verificarlo creando una tabla y una funcion de prueba, la
-- tabla nacio cerrada pero LA FUNCION NO:
--
--   tabla nueva   -> postgres=arwdDxtm | authenticated=arwdDxtm | service_role=arwdDxtm
--   funcion nueva -> =X/postgres | postgres=X | authenticated=X | service_role=X
--                    ^^ PUBLIC, otra vez
--
-- ALTER DEFAULT PRIVILEGES no logra quitarle el EXECUTE hardcodeado que
-- PostgreSQL le da a PUBLIC en cada funcion nueva. Y como anon hereda de
-- PUBLIC el USAGE del esquema, cada funcion que escribieramos de hoy en
-- adelante habria vuelto a quedar al alcance de cualquiera sin sesion.
--
-- Un disparador de eventos no depende de los privilegios por omision, asi que
-- cierra las dos cosas de un golpe: la funcion nueva, y tambien los objetos
-- creados por supabase_admin, cuyos privilegios por omision no se pueden
-- alterar desde el rol que aplica las migraciones.
--
-- Falla en silencio a proposito (warning, no error): un disparador de eventos
-- que aborta un CREATE TABLE deja las migraciones muertas. Es preferible un
-- aviso que revisar, a una migracion que no corre.
--
-- PARA REVERTIR:
--   drop event trigger objeto_nuevo_no_nace_abierto;
-- =====================================================================

create or replace function public.trg_objeto_nuevo_no_nace_abierto()
returns event_trigger language plpgsql security definer set search_path = public, pg_temp as $b$
declare r record;
begin
  for r in select * from pg_event_trigger_ddl_commands() loop
    if r.schema_name = 'public' then
      begin
        if r.object_type in ('table','view','materialized view','foreign table','sequence') then
          execute format('revoke all on %s from anon, public', r.object_identity);
        elsif r.object_type in ('function','procedure','aggregate') then
          execute format('revoke all on function %s from anon, public', r.object_identity);
        end if;
      exception when others then
        raise warning 'No se pudo cerrar % (%): %', r.object_identity, r.object_type, sqlerrm;
      end;
    end if;
  end loop;
end $b$;

comment on function public.trg_objeto_nuevo_no_nace_abierto() is
  'Cierra a anon y a PUBLIC cada objeto nuevo del esquema public. Existe porque '
  'ALTER DEFAULT PRIVILEGES no logra quitarle EXECUTE a PUBLIC en funciones nuevas: '
  'la tabla nueva si nace cerrada, la funcion nueva nace con =X/postgres.';

drop event trigger if exists objeto_nuevo_no_nace_abierto;
create event trigger objeto_nuevo_no_nace_abierto on ddl_command_end
when tag in ('CREATE TABLE','CREATE VIEW','CREATE MATERIALIZED VIEW','CREATE SEQUENCE',
             'CREATE FUNCTION','CREATE PROCEDURE','CREATE AGGREGATE','CREATE FOREIGN TABLE')
execute function public.trg_objeto_nuevo_no_nace_abierto();
