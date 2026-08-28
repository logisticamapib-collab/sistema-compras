-- Eliminar un molde.
--
-- Diez tablas apuntan a un molde y no todas significan lo mismo:
--
--   MOVIMIENTOS -- vida del molde. Avisos, ordenes de mantenimiento,
--   transferencias entre plantas, ordenes de trabajo, maquilas, solicitudes de
--   maquina alterna, vales de toolcrib y contenedores. Borrarlo dejaria esa
--   historia colgando y en automotriz eso es trazabilidad perdida. Bloquean.
--
--   ASIGNACION -- solo dicen con que molde se fabrica algo. Las cavidades se
--   van en cascada y las rutas se desligan poniendo su molde en nulo. No
--   bloquean: tener articulos asignados no es haber operado.
--
-- El candado va en un disparador, no en la pantalla. La funcion eliminar_molde
-- existe para que la pantalla pueda decir, ANTES de borrar, que articulos van
-- a quedarse sin molde, y para que el desligue de rutas y el borrado ocurran
-- juntos o no ocurran: si el disparador levanta, ni las rutas se tocan.
--
-- Aplicada via apply_migration junto con las etiquetas de referencias_de para
-- las tablas que cuelgan de moldes.

create or replace function trg_bloquea_borrado_molde()
returns trigger
language plpgsql
as $fn$
declare
  v_motivos text;
begin
  select string_agg(d.etiqueta || ' (' || d.filas || ')', ', ' order by d.etiqueta)
    into v_motivos
    from referencias_de('moldes', OLD.id) d
   where d.tabla || '.' || d.columna <> 'rutas_fabricacion.molde_id';

  if v_motivos is not null then
    raise exception
      'No se puede eliminar el molde "%": ya tiene movimientos registrados en %. Desactivalo en lugar de eliminarlo; borrarlo dejaria esa historia sin molde.',
      OLD.clave, v_motivos
      using errcode = '23503';
  end if;

  return OLD;
end;
$fn$;

drop trigger if exists tg_moldes_borrado_seguro on moldes;
create trigger tg_moldes_borrado_seguro
  before delete on moldes
  for each row execute function trg_bloquea_borrado_molde();

create or replace function eliminar_molde(p_empresa_id int, p_molde_id int)
returns table (codigo_interno text)
language plpgsql
as $fn$
begin
  -- Los articulos se leen ANTES de borrar: las cavidades se van en cascada y
  -- despues ya no habria como saber cuales eran.
  return query
    select a.codigo_interno
    from articulos a
    where a.id in (
      select mc.articulo_id from molde_cavidades mc
      where mc.molde_id = p_molde_id and mc.articulo_id is not null
    )
    order by a.codigo_interno;

  -- La ruta apunta al molde para decir con cual se fabrica; se desliga, no se
  -- borra, porque el resto de la ruta -- maquina, tiempo estandar, secuencia --
  -- sigue siendo valido.
  update rutas_fabricacion set molde_id = null where molde_id = p_molde_id;

  delete from moldes where id = p_molde_id and empresa_id = p_empresa_id;
end;
$fn$;

grant execute on function eliminar_molde(int, int) to anon, authenticated, service_role;
