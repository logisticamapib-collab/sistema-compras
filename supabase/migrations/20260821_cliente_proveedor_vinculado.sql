-- Un cliente puede ser tambien proveedor.
--
-- Pasa en automotriz: el cliente vende la materia prima con la que se le
-- fabrica, o la consigna sin costo y solo se le cobra la transformacion. La
-- consigna ya estaba resuelta -- el recibo se hace contra la autorizacion, a
-- costo cero, sin proveedor. Lo que no habia forma de hacer era COMPRARLE al
-- cliente: la orden de compra exige un proveedor, y la unica salida era
-- capturar la misma empresa dos veces.
--
-- Por que un enlace y no una tabla de contrapartes unificada:
-- son 21 llaves foraneas apuntando a clientes o proveedores. Unificarlas es
-- reescribir medio sistema para resolver un caso que una columna cubre igual
-- de bien. Las ordenes de compra, los recibos y las maquilas siguen apuntando
-- a proveedores.id como siempre; nada de lo que ya funciona se entera.
--
-- El enlace es UNO A UNO y vive en una sola columna. Dos banderas -- una en
-- cada tabla -- terminan contradiciendose el dia que alguien escriba una y no
-- la otra.

-- ---------------------------------------------------------------------------
-- 1. Razon social en clientes
-- ---------------------------------------------------------------------------
-- Hace falta para que la sincronia tenga sentido: el nombre COMERCIAL de cada
-- ficha es legitimamente distinto (asi le dice Ventas vs. asi le dice Compras),
-- pero la razon social es una sola, la que va en la factura.
alter table clientes add column if not exists razon_social text;

-- Hasta hoy el campo "nombre" del cliente era la razon social (asi lo pedia la
-- pantalla). Se copia para no dejar el dato fiscal vacio en lo ya capturado.
update clientes set razon_social = nombre where razon_social is null;
update proveedores set razon_social = nombre where razon_social is null;

-- ---------------------------------------------------------------------------
-- 2. El enlace
-- ---------------------------------------------------------------------------
alter table clientes add column if not exists proveedor_id integer references proveedores(id);

-- Un proveedor no puede quedar colgado de dos clientes. Sin esto, la sincronia
-- de datos fiscales tendria dos origenes peleandose por el mismo destino.
create unique index if not exists clientes_proveedor_vinculado_uq
  on clientes (proveedor_id) where proveedor_id is not null;

comment on column clientes.proveedor_id is
  'Ficha de proveedor de la MISMA empresa, cuando el cliente tambien nos vende '
  '(materia prima, por ejemplo). Uno a uno. Los datos fiscales se sincronizan '
  'en los dos sentidos; los comerciales no.';

-- ---------------------------------------------------------------------------
-- 3. Sincronia de datos fiscales
-- ---------------------------------------------------------------------------
-- Viajan RFC, razon social y direccion. NO viajan contacto, email, telefono ni
-- condiciones de pago: el contacto de compras no es el de ventas y los dias de
-- credito que nos dan no son los que damos.
--
-- Como no entra en ciclo: cada disparador solo escribe si el destino REALMENTE
-- difiere (el "is distinct from" del where). Cuando el eco regresa, ya no hay
-- diferencia, ningun renglon coincide, el UPDATE no toca nada y ningun
-- disparador se vuelve a encender. Termina siempre en dos saltos.

create or replace function trg_sincroniza_fiscales_desde_cliente()
returns trigger
language plpgsql
as $fn$
begin
  if NEW.proveedor_id is null then
    return NEW;
  end if;

  update proveedores p
     set razon_social = NEW.razon_social,
         rfc          = NEW.rfc,
         direccion    = NEW.direccion
   where p.id = NEW.proveedor_id
     and (p.razon_social is distinct from NEW.razon_social
       or p.rfc          is distinct from NEW.rfc
       or p.direccion    is distinct from NEW.direccion);

  return NEW;
exception
  when unique_violation then
    raise exception
      'No se pudo sincronizar con la ficha de proveedor: ya existe otro proveedor con el RFC %. Corrige ese duplicado antes de cambiar el RFC aqui.',
      NEW.rfc;
end;
$fn$;

create or replace function trg_sincroniza_fiscales_desde_proveedor()
returns trigger
language plpgsql
as $fn$
begin
  update clientes c
     set razon_social = NEW.razon_social,
         rfc          = NEW.rfc,
         direccion    = NEW.direccion
   where c.proveedor_id = NEW.id
     and (c.razon_social is distinct from NEW.razon_social
       or c.rfc          is distinct from NEW.rfc
       or c.direccion    is distinct from NEW.direccion);

  return NEW;
exception
  when unique_violation then
    raise exception
      'No se pudo sincronizar con la ficha de cliente: ya existe otro cliente con el RFC %. Corrige ese duplicado antes de cambiar el RFC aqui.',
      NEW.rfc;
end;
$fn$;

-- En el alta tambien, porque vincular desde Proveedores crea la ficha de
-- cliente ya con el enlace puesto.
drop trigger if exists tg_clientes_sincroniza_fiscales on clientes;
create trigger tg_clientes_sincroniza_fiscales
  after insert or update of razon_social, rfc, direccion, proveedor_id on clientes
  for each row execute function trg_sincroniza_fiscales_desde_cliente();

drop trigger if exists tg_proveedores_sincroniza_fiscales on proveedores;
create trigger tg_proveedores_sincroniza_fiscales
  after insert or update of razon_social, rfc, direccion on proveedores
  for each row execute function trg_sincroniza_fiscales_desde_proveedor();

-- ---------------------------------------------------------------------------
-- 4. El borrado seguro ya se entero solo
-- ---------------------------------------------------------------------------
-- referencias_de() recorre pg_constraint, asi que la columna nueva quedo
-- cubierta sin tocarla: borrar un proveedor vinculado ya esta bloqueado. Lo
-- unico que falta es que el mensaje diga algo util en vez de "Clientes (1)".
create or replace function referencias_de(p_tabla text, p_id bigint)
returns table (tabla text, columna text, etiqueta text, filas bigint)
language plpgsql
stable
as $fn$
declare
  r record;
  n bigint;
begin
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
        when 'clientes.proveedor_id'                 then 'Ficha de cliente vinculada'
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
