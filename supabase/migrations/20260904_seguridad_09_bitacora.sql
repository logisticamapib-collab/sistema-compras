-- =====================================================================
-- SEGURIDAD 9 — Bitacora: quien toco que, y como estaba antes.
--
-- POR QUE
--
-- Si un costo amanecia distinto, no habia forma de saber quien lo movio ni que
-- decia antes. Con RLS apagado eso era peor: cualquiera con sesion podia
-- cambiar cualquier cosa sin dejar rastro.
--
-- Sirve doble. Es control de seguridad, y es la evidencia de control de
-- cambios y de autorizacion que IATF 16949 pide de todos modos. Por eso va
-- ANTES de encender RLS: asi queda registro del propio cambio.
--
-- COMO ESTA HECHA
--
-- Un solo disparador generico para todas las tablas. Usa to_jsonb(NEW) en vez
-- de nombrar columnas, asi que no hay que tocarlo cuando una tabla gane un
-- campo. Es la misma leccion que costo el error de "record new has no field
-- empresa_id": un disparador que nombra columnas se rompe con la siguiente
-- migracion.
--
-- En un UPDATE solo se guarda lo que CAMBIO. Guardar la fila entera convierte
-- la bitacora en una copia de la base y en un mes nadie la consulta porque no
-- se encuentra nada.
--
-- SE GUARDA EL NOMBRE, NO SOLO EL ID
--
-- El dia que se elimine un usuario, su bitacora apuntaria a un id que ya no
-- existe. Una bitacora que no puede decir quien fue no sirve, y justo el
-- usuario borrado es el que interesa.
--
-- ES DE SOLO AGREGAR
--
-- Nadie puede modificarla ni borrarla, ni el administrador: no se otorga
-- UPDATE ni DELETE a nadie. Las escrituras entran por el disparador, que corre
-- como su dueno. Una bitacora que el sospechoso puede editar no prueba nada.
--
-- SI LA BITACORA FALLA, NO SE CAE LA OPERACION
--
-- El disparador atrapa cualquier error y devuelve null. Perder una anotacion
-- es malo; impedir que se reciba material porque el registro tuvo un problema
-- es peor.
--
-- QUE NO SE VIGILA
--
-- Las tablas de mucho movimiento -- existencias, reportes de produccion,
-- consumos. Ahi el volumen ahogaria la bitacora y esconderia lo que importa.
-- Se vigila el dinero, los permisos y las autorizaciones. Para agregar otra:
-- select public.auditar('nombre_de_la_tabla');
-- =====================================================================

create table if not exists public.bitacora (
  id             bigserial primary key,
  momento        timestamptz not null default now(),
  usuario_id     uuid,
  usuario_nombre text,
  tabla          text        not null,
  operacion      text        not null check (operacion in ('alta','cambio','baja')),
  registro_id    text,
  cambios        jsonb,
  fila           jsonb
);

comment on table public.bitacora is
  'Quien toco que y como estaba antes. Solo se agrega: nadie tiene UPDATE ni '
  'DELETE, porque una bitacora que el sospechoso puede editar no prueba nada.';
comment on column public.bitacora.cambios is
  'En un cambio, solo los campos que se movieron: {"campo": {"antes": x, "despues": y}}.';
comment on column public.bitacora.fila is
  'La fila completa en altas y bajas. En los cambios no se guarda: para eso esta cambios.';

create index if not exists bitacora_momento on public.bitacora (momento desc);
create index if not exists bitacora_tabla   on public.bitacora (tabla, momento desc);
create index if not exists bitacora_usuario on public.bitacora (usuario_id, momento desc);

create or replace function public.trg_bitacora()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_antes jsonb; v_despues jsonb; v_cambios jsonb := '{}'::jsonb;
  v_clave text; v_uid uuid; v_nombre text; v_op text;
  v_ignorar text[] := array['updated_at', 'actualizado_en', 'created_at', 'creado_en'];
begin
  begin v_uid := auth.uid(); exception when others then v_uid := null; end;

  if v_uid is not null then
    select nombre into v_nombre from public.usuarios where id = v_uid;
  end if;
  -- Lo que hace una Edge Function con la llave de servicio no trae usuario.
  v_nombre := coalesce(v_nombre, case when v_uid is null then 'sistema' else 'usuario desconocido' end);

  if TG_OP = 'INSERT' then
    v_op := 'alta';   v_despues := to_jsonb(NEW);
  elsif TG_OP = 'UPDATE' then
    v_op := 'cambio'; v_antes := to_jsonb(OLD); v_despues := to_jsonb(NEW);
  else
    v_op := 'baja';   v_antes := to_jsonb(OLD);
  end if;

  if v_op = 'cambio' then
    for v_clave in select jsonb_object_keys(v_despues) loop
      if not (v_clave = any(v_ignorar))
         and (v_antes -> v_clave) is distinct from (v_despues -> v_clave) then
        v_cambios := v_cambios || jsonb_build_object(
          v_clave, jsonb_build_object('antes', v_antes -> v_clave, 'despues', v_despues -> v_clave));
      end if;
    end loop;
    if v_cambios = '{}'::jsonb then return null; end if;
  end if;

  insert into public.bitacora (usuario_id, usuario_nombre, tabla, operacion, registro_id, cambios, fila)
  values (
    v_uid, v_nombre, TG_TABLE_NAME, v_op,
    -- config_compras, politica_moneda y roles no tienen columna id. Ahi queda
    -- nulo y no se pierde nada: la fila completa se guarda.
    coalesce(v_despues ->> 'id', v_antes ->> 'id'),
    case when v_op = 'cambio' then v_cambios else null end,
    case when v_op = 'cambio' then null else coalesce(v_despues, v_antes) end
  );
  return null;

exception when others then
  return null;
end;
$$;

create or replace function public.auditar(p_tabla text)
returns void language plpgsql as $$
begin
  execute format('drop trigger if exists zz_bitacora on public.%I', p_tabla);
  execute format(
    'create trigger zz_bitacora after insert or update or delete on public.%I '
    'for each row execute function public.trg_bitacora()', p_tabla);
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'usuarios', 'permisos_rol', 'permisos_usuario', 'roles',
    'articulos', 'articulo_proveedor', 'articulo_cliente',
    'lotes', 'monedas', 'tipos_cambio', 'tipos_cambio_periodo', 'politica_moneda',
    'facturas_proveedor', 'factura_lineas', 'config_compras',
    'aprobaciones', 'ordenes_compra', 'oc_lineas', 'requisiciones',
    'empresas', 'sites', 'liberaciones_calidad'
  ] loop
    begin
      perform public.auditar(t);
    exception when others then
      raise warning 'No se pudo auditar % : %', t, sqlerrm;
    end;
  end loop;
end $$;

grant select on table public.bitacora to authenticated;
revoke insert, update, delete on table public.bitacora from authenticated, anon, public;

create or replace function public.purgar_bitacora(p_dias int default 1825)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  -- El minimo son 3 anos: IATF pide conservar registros, y una bitacora que se
  -- borra sola antes de la siguiente auditoria no sirve como evidencia.
  delete from public.bitacora where momento < now() - make_interval(days => greatest(p_dias, 1095));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.purgar_bitacora(int) from anon, public;
