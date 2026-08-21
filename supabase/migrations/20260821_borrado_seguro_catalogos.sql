-- Borrado seguro de catalogos (clientes y proveedores) + RFC/email en clientes.
--
-- Por que asi:
-- Eliminar un cliente o un proveedor que ya tiene historia rompe la trazabilidad
-- que exige IATF: un embarque sin cliente o una orden de compra sin proveedor
-- dejan de ser auditables. Pero tampoco sirve prohibir el borrado siempre,
-- porque entonces cada error de captura vive para siempre en el catalogo.
--
-- Regla: se puede eliminar mientras NADIE lo referencie. En cuanto exista
-- una sola referencia -- movimiento o configuracion -- solo queda Desactivar.
--
-- El candado vive aqui, no en la pantalla. Las llaves foraneas ya impedian el
-- borrado, pero con un mensaje de Postgres que el usuario no entiende y sin
-- decir donde esta el estorbo. Esto lo dice en español y lo cuenta.
--
-- referencias_de() es generica a proposito: recorre el catalogo de Postgres en
-- vez de una lista escrita a mano. Una tabla nueva con llave foranea a clientes
-- queda cubierta sola, sin tocar este archivo. Esa lista escrita a mano fue
-- justo lo que desfaso los permisos del admin antes.

-- ---------------------------------------------------------------------------
-- 1. Campos que le faltaban a clientes
-- ---------------------------------------------------------------------------
-- La exportacion a Excel y PDF ya pedia rfc y email desde hace tiempo y salian
-- dos columnas vacias, porque las columnas nunca existieron. Ademas el email
-- hace falta para EDI (avisos de embarque) y el RFC para facturacion.
alter table clientes add column if not exists rfc text;
alter table clientes add column if not exists email text;

-- Sin esto, la carga masiva duplica catalogo alegremente: hoy no hay ninguna
-- restriccion de unicidad mas alla de la llave primaria. Parciales, porque la
-- clave y el RFC son opcionales (un cliente extranjero no tiene RFC).
create unique index if not exists clientes_empresa_clave_uq
  on clientes (empresa_id, upper(clave)) where coalesce(clave, '') <> '';
create unique index if not exists proveedores_empresa_rfc_uq
  on proveedores (empresa_id, upper(rfc)) where coalesce(rfc, '') <> '';

-- ---------------------------------------------------------------------------
-- 2. Quien referencia a este registro
-- ---------------------------------------------------------------------------
create or replace function referencias_de(p_tabla text, p_id bigint)
returns table (tabla text, columna text, etiqueta text, filas bigint)
language plpgsql
stable
as $fn$
declare
  r record;
  n bigint;
begin
  -- El nombre de la tabla se busca en el catalogo antes de usarse. Si no
  -- existe ahi, no se arma ningun SQL: no hay forma de inyectar por p_tabla.
  perform 1
  from pg_class c
  join pg_namespace ns on ns.oid = c.relnamespace
  where ns.nspname = 'public' and c.relname = p_tabla and c.relkind = 'r';
  if not found then
    raise exception 'La tabla % no existe', p_tabla;
  end if;

  for r in
    select src.relname::text as tabla_origen,
           att.attname::text as col
    from pg_constraint con
    join pg_class src on src.oid = con.conrelid
    join pg_class tgt on tgt.oid = con.confrelid
    join pg_namespace nss on nss.oid = src.relnamespace
    join pg_namespace nst on nst.oid = tgt.relnamespace
    join lateral unnest(con.conkey) as k(attnum) on true
    join pg_attribute att on att.attrelid = src.oid and att.attnum = k.attnum
    where con.contype = 'f'
      and nss.nspname = 'public'
      and nst.nspname = 'public'
      and tgt.relname = p_tabla
      -- Las ON DELETE CASCADE no estorban: son hijos propios del registro
      -- (la politica de molido de un cliente se va con el cliente).
      and con.confdeltype <> 'c'
      and array_length(con.conkey, 1) = 1
    order by 1, 2
  loop
    execute format('select count(*) from public.%I where %I = $1', r.tabla_origen, r.col)
      into n using p_id;

    if n > 0 then
      tabla   := r.tabla_origen;
      columna := r.col;
      filas   := n;
      -- Cosmetico. Si aparece una tabla nueva, el initcap de abajo da un
      -- nombre legible sin que nadie tenga que venir a editar este CASE.
      etiqueta := case r.tabla_origen || '.' || r.col
        when 'embarques.cliente_id'                  then 'Embarques'
        when 'release_lineas.cliente_id'             then 'Lineas de release'
        when 'releases_cargas.cliente_id'            then 'Cargas de releases'
        when 'molienda.cliente_id'                   then 'Molienda'
        when 'articulo_cliente.cliente_id'           then 'Articulos ligados'
        when 'consigna_autorizaciones.cliente_id'    then 'Autorizaciones de consigna'
        when 'molde_mtto.cliente_id'                 then 'Moldes'
        when 'no_conformidades.cliente_id'           then 'No conformidades'
        when 'registros_archivados.cliente_id'       then 'Registros archivados'
        when 'ordenes_compra.proveedor_id'           then 'Ordenes de compra'
        when 'recibos.proveedor_id'                  then 'Recibos'
        when 'ordenes_maquila.maquilador_id'         then 'Ordenes de maquila'
        when 'articulo_proveedor.proveedor_id'       then 'Articulos ligados'
        when 'articulos.maquilador_id'               then 'Articulos que maquila'
        when 'requisicion_lineas.proveedor_sugerido_id' then 'Lineas de requisicion (sugerido)'
        when 'desviaciones_ppap.proveedor_id'        then 'Desviaciones PPAP'
        when 'mtto_gen_ordenes.proveedor_id'         then 'Ordenes de mantenimiento'
        when 'molde_mtto.proveedor_id'               then 'Moldes'
        when 'delegaciones_autoridad.proveedor_id'   then 'Delegaciones de autoridad'
        when 'no_conformidades.proveedor_id'         then 'No conformidades'
        else initcap(replace(r.tabla_origen, '_', ' '))
      end;
      return next;
    end if;
  end loop;
end;
$fn$;

comment on function referencias_de(text, bigint) is
  'Cuenta, tabla por tabla, quien referencia a un registro. Recorre pg_constraint, '
  'no una lista escrita a mano, para que una tabla nueva quede cubierta sola. '
  'Ignora las llaves ON DELETE CASCADE porque esas son hijos propios del registro.';

-- ---------------------------------------------------------------------------
-- 3. Resumen para la pantalla: una sola llamada para toda la lista
-- ---------------------------------------------------------------------------
-- Preguntar registro por registro serian N viajes al servidor y la lista se
-- sentiria lenta. Esto devuelve solo los ids que NO se pueden eliminar; lo que
-- no viene en la respuesta, se puede.
create or replace function referencias_resumen(p_tabla text, p_ids bigint[])
returns table (id bigint, motivos text, total bigint)
language plpgsql
stable
as $fn$
declare
  v_id bigint;
  v_motivos text;
  v_total bigint;
begin
  foreach v_id in array coalesce(p_ids, '{}'::bigint[])
  loop
    select string_agg(d.etiqueta || ' (' || d.filas || ')', ', ' order by d.etiqueta),
           sum(d.filas)
      into v_motivos, v_total
      from referencias_de(p_tabla, v_id) d;

    if v_motivos is not null then
      id := v_id; motivos := v_motivos; total := v_total;
      return next;
    end if;
  end loop;
end;
$fn$;

-- ---------------------------------------------------------------------------
-- 4. El candado
-- ---------------------------------------------------------------------------
-- Bloquea captura, no produccion: nadie deja de embarcar porque no se pueda
-- borrar un cliente. Lo unico que obliga es a usar Desactivar.
create or replace function trg_bloquea_borrado_referenciado()
returns trigger
language plpgsql
as $fn$
declare
  v_motivos text;
begin
  select string_agg(d.etiqueta || ' (' || d.filas || ')', ', ' order by d.etiqueta)
    into v_motivos
    from referencias_de(TG_TABLE_NAME, OLD.id) d;

  if v_motivos is not null then
    raise exception
      'No se puede eliminar "%": ya tiene registros asociados en %. Desactivalo en lugar de eliminarlo.',
      OLD.nombre, v_motivos
      using errcode = '23503';
  end if;

  return OLD;
end;
$fn$;

drop trigger if exists tg_clientes_borrado_seguro on clientes;
create trigger tg_clientes_borrado_seguro
  before delete on clientes
  for each row execute function trg_bloquea_borrado_referenciado();

drop trigger if exists tg_proveedores_borrado_seguro on proveedores;
create trigger tg_proveedores_borrado_seguro
  before delete on proveedores
  for each row execute function trg_bloquea_borrado_referenciado();
