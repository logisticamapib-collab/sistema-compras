-- Imputacion en cascada. Nadie teclea el centro de costo: baja del objeto
-- que consume. Si el molde no lo tiene, se busca en su maquina; si la maquina
-- tampoco, en su area. Se devuelve tambien de donde salio, para poder decir
-- en pantalla por que quedo ese y no otro.
create or replace function toolcrib_imputacion(
  p_empresa_id integer, p_destino_tipo text,
  p_molde_id integer default null, p_maquina_id integer default null,
  p_area_id integer default null, p_ot_id integer default null
) returns table(centro_costo_id integer, origen text)
language plpgsql stable as $$
DECLARE v_cc int; v_maq int; v_area int;
BEGIN
  if p_destino_tipo = 'molde' and p_molde_id is not null then
    select m.centro_costo_id, m.maquina_asignada_id into v_cc, v_maq
    from moldes m where m.id = p_molde_id;
    if v_cc is not null then
      return query select v_cc, 'del molde'::text; return;
    end if;
    if v_maq is not null then
      select mq.centro_costo_id, mq.area_id into v_cc, v_area from maquinas mq where mq.id = v_maq;
      if v_cc is not null then return query select v_cc, 'de la maquina asignada al molde'::text; return; end if;
      if v_area is not null then
        select a.centro_costo_id into v_cc from areas a where a.id = v_area;
        if v_cc is not null then return query select v_cc, 'del area de la maquina'::text; return; end if;
      end if;
    end if;
    return query select null::int, 'el molde no tiene centro de costo y no se pudo deducir'::text; return;
  end if;

  if p_destino_tipo in ('maquina','ot') then
    v_maq := p_maquina_id;
    if v_maq is null and p_ot_id is not null then
      select o.maquina_id into v_maq from ordenes_trabajo o where o.id = p_ot_id;
    end if;
    if v_maq is not null then
      select mq.centro_costo_id, mq.area_id into v_cc, v_area from maquinas mq where mq.id = v_maq;
      if v_cc is not null then return query select v_cc, 'de la maquina'::text; return; end if;
      if v_area is not null then
        select a.centro_costo_id into v_cc from areas a where a.id = v_area;
        if v_cc is not null then return query select v_cc, 'del area de la maquina'::text; return; end if;
      end if;
    end if;
    return query select null::int, 'la maquina no tiene centro de costo'::text; return;
  end if;

  if p_destino_tipo = 'area' and p_area_id is not null then
    select a.centro_costo_id into v_cc from areas a where a.id = p_area_id;
    return query select v_cc,
      case when v_cc is null then 'el area no tiene centro de costo' else 'del area' end::text;
    return;
  end if;

  return query select null::int, 'sin destino con centro de costo'::text;
END $$;

-- La cuenta de gasto sale del tipo de material, o sea de la categoria del
-- articulo. Una refaccion no se contabiliza igual que un consumible.
create or replace function toolcrib_cuenta_articulo(p_articulo_id integer)
returns integer language sql stable as $$
  select c.cuenta_gasto_id from articulos a
  join categorias c on c.id = a.categoria_id
  where a.id = p_articulo_id;
$$;

-- Crear el vale. Llega con la imputacion ya resuelta.
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
                             mtto_molde_id, mtto_gen_id, centro_costo_id,
                             motivo, solicitado_por, notas)
  values (p_empresa_id, p_site_id, v_folio, p_turno, p_almacen_id, p_destino_tipo,
          p_molde_id, p_maquina_id, p_area_id, p_ot_id,
          p_mtto_molde_id, p_mtto_gen_id, imp.centro_costo_id,
          coalesce(p_motivo,'rutina'), p_usuario, p_notas)
  returning id into v_id;

  return v_id;
END $$;

-- Surtir: aqui se mueve el inventario y se escribe el insumo en la orden de
-- mantenimiento, en un solo paso. Ese es el punto de que el vale sustituya la
-- captura manual: el dato se escribe una vez y llega igual a los dos lados.
--
-- La autorizacion se comprueba por la FECHA, no por el usuario: si el id de
-- usuario llega nulo por lo que sea, el vale quedaria autorizado en apariencia
-- pero el candado seguiria disparando. La fecha siempre se escribe.
create or replace function surtir_vale_toolcrib(
  p_empresa_id integer, p_vale_id integer,
  p_usuario uuid default null, p_recibido_por text default null
) returns numeric language plpgsql as $$
DECLARE
  v record; l record; r record; par record;
  v_total numeric := 0; v_falta numeric; v_toma numeric; v_cu numeric;
  v_disp numeric; v_n int := 0; v_lote int;
BEGIN
  select * into v from toolcrib_vales where id = p_vale_id and empresa_id = p_empresa_id;
  if v.id is null then raise exception 'No existe el vale indicado'; end if;
  if v.estatus = 'surtido' then raise exception 'El vale % ya fue surtido', v.folio; end if;
  if v.estatus = 'cancelado' then raise exception 'El vale % esta cancelado', v.folio; end if;

  select count(*) into v_n from toolcrib_vale_lineas where vale_id = p_vale_id;
  if v_n = 0 then raise exception 'El vale % no tiene renglones', v.folio; end if;

  select * into par from toolcrib_parametros where empresa_id = p_empresa_id;

  -- Costear y validar existencia antes de mover nada.
  for l in select * from toolcrib_vale_lineas where vale_id = p_vale_id loop
    v_cu := coalesce(l.costo_unitario, (select costo from articulos where id = l.articulo_id), 0);
    v_total := v_total + v_cu * l.cantidad;

    select coalesce(sum(ex.cantidad),0) into v_disp
    from existencias ex join lotes lo on lo.id = ex.lote_id
    where lo.articulo_id = l.articulo_id and ex.almacen_id = v.almacen_id;
    if v_disp < l.cantidad then
      raise exception 'Solo hay % de % en el almacen y el vale pide %',
        v_disp, (select codigo_interno from articulos where id = l.articulo_id), l.cantidad;
    end if;
  end loop;

  -- La autorizacion solo frena si la empresa la activo a proposito.
  if coalesce(par.requiere_autorizacion, false)
     and v_total >= coalesce(par.monto_autorizacion, 0)
     and v.autorizado_at is null then
    raise exception 'El vale % suma % y su autorizacion esta activada a partir de %. Falta que lo autorice %',
      v.folio, round(v_total,2), coalesce(par.monto_autorizacion,0),
      coalesce(par.rol_autoriza, 'un gerente');
  end if;

  -- Ahora si, mover.
  for l in select * from toolcrib_vale_lineas where vale_id = p_vale_id loop
    v_cu := coalesce(l.costo_unitario, (select costo from articulos where id = l.articulo_id), 0);
    v_falta := l.cantidad;
    v_lote := null;

    for r in
      select ex.id ex_id, ex.lote_id, ex.cantidad, lo.fecha
      from existencias ex join lotes lo on lo.id = ex.lote_id
      where lo.articulo_id = l.articulo_id and ex.almacen_id = v.almacen_id and ex.cantidad > 0
      order by lo.fecha nulls last, lo.id
    loop
      exit when v_falta <= 0;
      v_toma := least(r.cantidad, v_falta);
      if r.cantidad = v_toma then delete from existencias where id = r.ex_id;
      else update existencias set cantidad = cantidad - v_toma where id = r.ex_id; end if;

      insert into movimientos(empresa_id, articulo_id, lote_id, tipo, almacen_origen_id,
                              cantidad, motivo, usuario_id)
      values (p_empresa_id, l.articulo_id, r.lote_id, 'consumo_mantenimiento', v.almacen_id,
              v_toma, 'Vale de toolcrib ' || v.folio, p_usuario);

      v_lote := r.lote_id;
      v_falta := v_falta - v_toma;
    end loop;

    update toolcrib_vale_lineas
    set costo_unitario = v_cu, costo_total = round(v_cu * cantidad, 2),
        lote_id = coalesce(lote_id, v_lote),
        cuenta_gasto_id = coalesce(cuenta_gasto_id, toolcrib_cuenta_articulo(l.articulo_id))
    where id = l.id;

    -- El insumo llega solo a la orden de mantenimiento. Antes se capturaba
    -- aparte y por eso los dos numeros nunca coincidian.
    if v.mtto_molde_id is not null then
      insert into molde_mtto_insumos(mtto_id, articulo_id, descripcion, cantidad,
                                     costo_unitario, costo_total, lote_id, almacen_id)
      values (v.mtto_molde_id, l.articulo_id,
              (select descripcion from articulos where id = l.articulo_id),
              l.cantidad, v_cu, round(v_cu * l.cantidad, 2), v_lote, v.almacen_id);
    elsif v.mtto_gen_id is not null then
      insert into mtto_gen_insumos(orden_id, articulo_id, descripcion, cantidad,
                                   costo_unitario, costo_total, lote_id, almacen_id)
      values (v.mtto_gen_id, l.articulo_id,
              (select descripcion from articulos where id = l.articulo_id),
              l.cantidad, v_cu, round(v_cu * l.cantidad, 2), v_lote, v.almacen_id);
    end if;
  end loop;

  update toolcrib_vales
  set estatus = 'surtido', monto_total = round(v_total, 2),
      surtido_por = p_usuario, surtido_at = now(),
      recibido_por = coalesce(p_recibido_por, recibido_por)
  where id = p_vale_id;

  return round(v_total, 2);
END $$;

create or replace function autorizar_vale_toolcrib(
  p_empresa_id integer, p_vale_id integer, p_usuario uuid
) returns void language plpgsql as $$
DECLARE v record;
BEGIN
  select * into v from toolcrib_vales where id = p_vale_id and empresa_id = p_empresa_id;
  if v.id is null then raise exception 'No existe el vale indicado'; end if;
  if v.estatus <> 'borrador' then raise exception 'El vale % ya no esta en borrador', v.folio; end if;
  update toolcrib_vales set autorizado_por = p_usuario, autorizado_at = now() where id = p_vale_id;
END $$;

create or replace function cancelar_vale_toolcrib(
  p_empresa_id integer, p_vale_id integer
) returns void language plpgsql as $$
DECLARE v record;
BEGIN
  select * into v from toolcrib_vales where id = p_vale_id and empresa_id = p_empresa_id;
  if v.id is null then raise exception 'No existe el vale indicado'; end if;
  if v.estatus = 'surtido' then
    raise exception 'El vale % ya se surtio y movio inventario. Hay que devolver el material con una entrada, no cancelando el vale', v.folio;
  end if;
  update toolcrib_vales set estatus = 'cancelado' where id = p_vale_id;
END $$;
