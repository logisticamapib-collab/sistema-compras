-- =====================================================================
-- Un articulo pertenece a UN SOLO molde.
--
-- Un codigo puede ocupar varias cavidades del mismo molde -- de hecho es el
-- caso normal: si las cuatro cavidades sacan el mismo codigo, ese codigo va
-- en las cuatro lineas. Lo que no puede es vivir en dos moldes distintos.
--
-- Por que: de las cavidades asignadas a un articulo sale cuantas piezas
-- entrega cada disparo, y de ahi salen los shots que necesita una orden. Si
-- el mismo codigo aparece en dos moldes, esa cuenta deja de tener un solo
-- significado y el plan de maquina se vuelve indefendible.
--
-- Cuando dos moldes fabrican la misma pieza, en automotriz llevan codigos
-- distintos justamente para saber de cual salio cada una, y para decir que
-- son intercambiables ya existe el catalogo de PARTES equivalentes, que
-- arrastra el neteo del MRP y el FIFO cruzado. Ese es el camino, no repetir
-- el mismo codigo en dos moldes.
--
-- La pantalla ya no ofrece los articulos que viven en otro molde, pero el
-- candado va aqui: un filtro de pantalla lo brinca cualquier carga o
-- cualquier version vieja de la interfaz.
-- =====================================================================

create or replace function trg_articulo_un_solo_molde()
returns trigger
language plpgsql
as $fn$
declare
  v_molde text;
  v_codigo text;
begin
  if NEW.articulo_id is null then
    return NEW;
  end if;

  -- Las filas del MISMO molde no estorban: ahi es donde el codigo ocupa
  -- varias cavidades.
  select m.clave into v_molde
  from molde_cavidades mc
  join moldes m on m.id = mc.molde_id
  where mc.articulo_id = NEW.articulo_id
    and mc.molde_id is distinct from NEW.molde_id
  limit 1;

  if v_molde is not null then
    select a.codigo_interno into v_codigo from articulos a where a.id = NEW.articulo_id;
    raise exception
      'El articulo % ya esta asignado al molde %. Un articulo pertenece a un solo molde: quitalo de ese molde antes de asignarlo aqui. Si son dos moldes que hacen la misma pieza, cada uno debe llevar su propio codigo y se ligan por el catalogo de Partes equivalentes.',
      coalesce(v_codigo, NEW.articulo_id::text), v_molde
      using errcode = '23505';
  end if;

  return NEW;
end;
$fn$;

drop trigger if exists tg_molde_cavidades_un_solo_molde on molde_cavidades;
create trigger tg_molde_cavidades_un_solo_molde
  before insert or update of articulo_id, molde_id on molde_cavidades
  for each row execute function trg_articulo_un_solo_molde();

comment on function trg_articulo_un_solo_molde() is
  'Impide que un articulo quede asignado a cavidades de dos moldes distintos. '
  'Varias cavidades del MISMO molde si estan permitidas.';
