-- CORRECCION. El disparador que valida la moneda leia NEW.empresa_id directo,
-- y articulo_proveedor no tiene esa columna: cuelga del articulo. PL/pgSQL
-- levanta 'record "new" has no field "empresa_id"' al evaluar esa linea, asi
-- que el respaldo que estaba escrito debajo -- buscar la empresa por el
-- articulo -- nunca se alcanzaba. Asignar un proveedor a un articulo tronaba
-- siempre, con cualquier moneda.
--
-- La lectura ahora va por to_jsonb(NEW), que devuelve nulo cuando la columna
-- no existe en vez de reventar. Asi el mismo disparador sirve para cualquier
-- tabla sin tener que saber de antemano que columnas tiene.
--
-- Por que se colo: la prueba original verifico que una moneda invalida se
-- rechazara EN ARTICULOS, y que el respaldo de datos hubiera llenado la
-- columna en articulo_proveedor, pero nunca inserto un renglon en
-- articulo_proveedor. Un disparador se prueba escribiendo en CADA tabla a la
-- que se le cuelga, no solo en una.
--
-- Aplicada via apply_migration.

create or replace function trg_valida_moneda()
returns trigger
language plpgsql
as $fn$
declare
  j jsonb := to_jsonb(NEW);
  v_emp int;
  v_val text;
begin
  v_val := j ->> TG_ARGV[0];
  if v_val is null or v_val = '' then
    return NEW;
  end if;

  -- to_jsonb devuelve nulo si la columna no existe, en vez de levantar.
  v_emp := nullif(j ->> 'empresa_id', '')::int;

  -- Si la fila no trae empresa, se busca por el articulo del que cuelga.
  if v_emp is null and (j ? 'articulo_id') then
    select a.empresa_id into v_emp from articulos a
    where a.id = nullif(j ->> 'articulo_id', '')::int;
  end if;

  if not exists (
    select 1 from monedas mo
    where mo.clave = v_val and mo.activo
      and (v_emp is null or mo.empresa_id = v_emp)
  ) then
    raise exception 'La moneda "%" no esta dada de alta o esta inactiva. Capturala en Configuracion, Monedas y tipo de cambio.', v_val
      using errcode = '23514';
  end if;
  return NEW;
end;
$fn$;
