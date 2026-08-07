-- CORRECCION: la cuenta de gasto de la SALIDA sale del destino, no del articulo.
--
-- Una cosa es donde se COMPRA y otra donde se CONSUME. El mismo buje se
-- compra bajo Logistica / Toolcrib y se consume bajo Produccion / Maquina 1.
-- Son dos asientos distintos.
--
-- La version anterior sacaba la cuenta de la categoria del articulo, que es
-- justamente la clasificacion de compra: el buje catalogado como "Refacciones"
-- se imputaba como "Refacciones" sin importar en que maquina se puso. El lado
-- de compra sigue viviendo en las lineas de requisicion y no se toca.
--
-- El catalogo de cuentas lleva una entrada por objeto (Maquina 1, Molde 001),
-- asi que la cuenta baja sola del destino y no se teclea.

alter table moldes   add column if not exists cuenta_gasto_id integer references cuentas_gastos(id);
alter table maquinas add column if not exists cuenta_gasto_id integer references cuentas_gastos(id);
alter table areas    add column if not exists cuenta_gasto_id integer references cuentas_gastos(id);

comment on column maquinas.cuenta_gasto_id is
  'Cuenta de gasto del objeto, para imputar lo que se CONSUME en el. No confundir con la cuenta de compra del articulo.';

drop function if exists toolcrib_imputacion(integer, text, integer, integer, integer, integer);

create or replace function toolcrib_imputacion(
  p_empresa_id integer, p_destino_tipo text,
  p_molde_id integer default null, p_maquina_id integer default null,
  p_area_id integer default null, p_ot_id integer default null
) returns table(
  centro_costo_id integer, origen_cc text,
  cuenta_gasto_id integer, origen_cg text
) language plpgsql stable as $$
DECLARE
  v_cc int; v_cg int; v_org_cc text; v_org_cg text;
  v_maq int; v_area int; m record; mq record; a record;
BEGIN
  if p_destino_tipo = 'molde' and p_molde_id is not null then
    select mo.centro_costo_id, mo.cuenta_gasto_id, mo.maquina_asignada_id
      into m from moldes mo where mo.id = p_molde_id;
    v_cc := m.centro_costo_id; v_cg := m.cuenta_gasto_id;
    if v_cc is not null then v_org_cc := 'del molde'; end if;
    if v_cg is not null then v_org_cg := 'del molde'; end if;
    v_maq := m.maquina_asignada_id;

    if (v_cc is null or v_cg is null) and v_maq is not null then
      select mq2.centro_costo_id, mq2.cuenta_gasto_id, mq2.area_id
        into mq from maquinas mq2 where mq2.id = v_maq;
      if v_cc is null and mq.centro_costo_id is not null then
        v_cc := mq.centro_costo_id; v_org_cc := 'de la maquina asignada al molde';
      end if;
      if v_cg is null and mq.cuenta_gasto_id is not null then
        v_cg := mq.cuenta_gasto_id; v_org_cg := 'de la maquina asignada al molde';
      end if;
      v_area := mq.area_id;
    end if;

  elsif p_destino_tipo in ('maquina','ot') then
    v_maq := p_maquina_id;
    if v_maq is null and p_ot_id is not null then
      select o.maquina_id into v_maq from ordenes_trabajo o where o.id = p_ot_id;
    end if;
    if v_maq is not null then
      select mq2.centro_costo_id, mq2.cuenta_gasto_id, mq2.area_id
        into mq from maquinas mq2 where mq2.id = v_maq;
      v_cc := mq.centro_costo_id; v_cg := mq.cuenta_gasto_id; v_area := mq.area_id;
      if v_cc is not null then v_org_cc := 'de la maquina'; end if;
      if v_cg is not null then v_org_cg := 'de la maquina'; end if;
    end if;

  elsif p_destino_tipo = 'area' then
    v_area := p_area_id;
  end if;

  -- El area cierra la cascada para lo que siga faltando.
  if (v_cc is null or v_cg is null) and v_area is not null then
    select ar.centro_costo_id, ar.cuenta_gasto_id into a from areas ar where ar.id = v_area;
    if v_cc is null and a.centro_costo_id is not null then
      v_cc := a.centro_costo_id;
      v_org_cc := case when p_destino_tipo = 'area' then 'del area' else 'del area del objeto' end;
    end if;
    if v_cg is null and a.cuenta_gasto_id is not null then
      v_cg := a.cuenta_gasto_id;
      v_org_cg := case when p_destino_tipo = 'area' then 'del area' else 'del area del objeto' end;
    end if;
  end if;

  return query select
    v_cc, coalesce(v_org_cc, 'el destino no tiene centro de costo y no se pudo deducir'),
    v_cg, coalesce(v_org_cg, 'el destino no tiene cuenta de gasto y no se pudo deducir');
END $$;

-- Crear el vale ahora guarda las dos imputaciones.
create or replace function crear_vale_toolcrib(
  p_empresa_id integer, p_site_id integer, p_almacen_id integer,
  p_destino_tipo text, p_molde_id integer default null, p_maquina_id integer default null,
  p_area_id integer default null, p_ot_id integer default null,
  p_mtto_molde_id integer default null, p_mtto_gen_id integer default null,
  p_motivo text default 'rutina', p_turno text default null,
  p_usuario uuid default null, p_notas text default null
) returns integer language plpgsql as $$
DECLARE v_id int; v_folio text; v_seq int; imp record; v_par record;
BEGIN
  if p_almacen_id is null then raise exception 'Falta indicar el almacen de donde sale el material'; end if;

  select * into v_par from toolcrib_parametros where empresa_id = p_empresa_id;
  if coalesce(v_par.requiere_orden_mtto, false)
     and p_mtto_molde_id is null and p_mtto_gen_id is null
     and p_motivo = 'mantenimiento' then
    raise exception 'La configuracion pide orden de mantenimiento para los vales de mantenimiento';
  end if;

  select coalesce(max(substring(folio from '[0-9]+$')::int), 0) + 1 into v_seq
  from toolcrib_vales
  where empresa_id = p_empresa_id and folio like 'VT-' || to_char(current_date,'YYYYMM') || '-%';
  v_folio := 'VT-' || to_char(current_date,'YYYYMM') || '-' || lpad(v_seq::text, 4, '0');

  select * into imp from toolcrib_imputacion(p_empresa_id, p_destino_tipo,
                                             p_molde_id, p_maquina_id, p_area_id, p_ot_id);

  insert into toolcrib_vales(empresa_id, site_id, folio, turno, almacen_id, destino_tipo,
                             molde_id, maquina_id, area_id, ot_id,
                             mtto_molde_id, mtto_gen_id,
                             centro_costo_id, cuenta_gasto_id,
                             motivo, solicitado_por, notas)
  values (p_empresa_id, p_site_id, v_folio, p_turno, p_almacen_id, p_destino_tipo,
          p_molde_id, p_maquina_id, p_area_id, p_ot_id,
          p_mtto_molde_id, p_mtto_gen_id,
          imp.centro_costo_id, imp.cuenta_gasto_id,
          coalesce(p_motivo,'rutina'), p_usuario, p_notas)
  returning id into v_id;

  return v_id;
END $$;

-- La imputacion se puede corregir mientras el vale este en borrador, pero no
-- despues: una vez surtido ya hay movimiento de inventario y un asiento que
-- cambiar de centro de costo dejaria descuadrado el mes cerrado.
create or replace function trg_vale_imputacion_congelada() returns trigger language plpgsql as $$
BEGIN
  if old.estatus = 'surtido'
     and (new.centro_costo_id is distinct from old.centro_costo_id
          or new.cuenta_gasto_id is distinct from old.cuenta_gasto_id) then
    raise exception 'El vale % ya se surtio: su centro de costo y su cuenta no se pueden cambiar', old.folio;
  end if;
  return new;
END $$;

drop trigger if exists vale_imputacion_congelada on toolcrib_vales;
create trigger vale_imputacion_congelada
  before update of centro_costo_id, cuenta_gasto_id on toolcrib_vales
  for each row execute function trg_vale_imputacion_congelada();

-- La cuenta del renglon toma primero la del VALE (que ya viene del destino) y
-- solo cae a la categoria del articulo si el destino no tiene cuenta propia.
DO $mig$
DECLARE
  v_def text;
  v_ancla text := 'cuenta_gasto_id = coalesce(cuenta_gasto_id, toolcrib_cuenta_articulo(l.articulo_id))';
  v_nuevo text := 'cuenta_gasto_id = coalesce(cuenta_gasto_id, v.cuenta_gasto_id, toolcrib_cuenta_articulo(l.articulo_id))';
BEGIN
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'surtir_vale_toolcrib';
  if v_def is null then raise exception 'No se encontro surtir_vale_toolcrib'; end if;
  if position(v_nuevo in v_def) > 0 then return; end if;
  if (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 then
    raise exception 'El ancla no es unica; abortado para no corromper la funcion';
  end if;
  v_def := replace(v_def, v_ancla, v_nuevo);
  execute v_def;
END $mig$;
