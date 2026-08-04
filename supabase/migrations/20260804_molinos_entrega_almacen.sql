-- Entrega de Molinos al almacen de resguardo.
--
-- El almacen de Molinos es de transito: el material se muele ahi y se entrega
-- al almacen para su resguardo. La entrega se hace en dos tiempos a proposito.
-- Molinos arma el paquete y lo firma; el almacen lo recibe y lo firma. Hasta
-- que el almacen no recibe, el material sigue contado en Molinos, que es
-- quien responde por el. Asi un faltante se ubica de un lado o del otro.

create unique index if not exists molino_entregas_folio_uq
  on molino_entregas(empresa_id, folio);
create index if not exists molienda_entrega_idx on molienda(entrega_id);

-- Arma la entrega y la deja firmada por Molinos, pendiente de recibir.
create or replace function crear_entrega_molinos(
  p_empresa_id integer, p_site_id integer, p_fecha date,
  p_almacen_destino_id integer, p_molienda_ids integer[],
  p_usuario uuid default null, p_notas text default null
) returns integer language plpgsql as $$
DECLARE v_alm int; v_id int; v_folio text; v_n int; v_seq int;
BEGIN
  if p_molienda_ids is null or array_length(p_molienda_ids,1) is null then
    raise exception 'No se selecciono ninguna molienda para entregar';
  end if;
  if p_almacen_destino_id is null then
    raise exception 'Falta indicar el almacen que va a resguardar el material';
  end if;

  select almacen_molinos_id into v_alm from molino_parametros where empresa_id = p_empresa_id;
  if v_alm is null then
    raise exception 'Falta configurar el almacen de Molinos en los parametros del modulo';
  end if;
  if v_alm = p_almacen_destino_id then
    raise exception 'El almacen destino no puede ser el mismo almacen de Molinos';
  end if;

  select count(*) into v_n from molienda
  where empresa_id = p_empresa_id and id = any(p_molienda_ids) and entrega_id is null;
  if v_n <> array_length(p_molienda_ids,1) then
    raise exception 'Alguna de las moliendas seleccionadas ya fue entregada o no pertenece a esta empresa';
  end if;

  select coalesce(max(substring(folio from '[0-9]+$')::int), 0) + 1 into v_seq
  from molino_entregas
  where empresa_id = p_empresa_id and folio like 'ME-' || to_char(p_fecha,'YYYYMM') || '-%';
  v_folio := 'ME-' || to_char(p_fecha,'YYYYMM') || '-' || lpad(v_seq::text, 4, '0');

  insert into molino_entregas(empresa_id, site_id, folio, fecha,
                              almacen_origen_id, almacen_destino_id, estatus,
                              entregado_por, notas)
  values (p_empresa_id, p_site_id, v_folio, p_fecha, v_alm, p_almacen_destino_id,
          'abierta', p_usuario, p_notas)
  returning id into v_id;

  update molienda set entrega_id = v_id
  where empresa_id = p_empresa_id and id = any(p_molienda_ids) and entrega_id is null;

  return v_id;
END $$;

-- El almacen recibe y firma: aqui es donde el material cambia de almacen.
create or replace function recibir_entrega_molinos(
  p_empresa_id integer, p_entrega_id integer, p_usuario uuid default null
) returns integer language plpgsql as $$
DECLARE v_e record; r record; v_ex record; v_n int := 0;
BEGIN
  select * into v_e from molino_entregas
  where id = p_entrega_id and empresa_id = p_empresa_id;
  if v_e.id is null then raise exception 'No existe la entrega indicada'; end if;
  if v_e.estatus = 'entregada' then raise exception 'La entrega % ya fue recibida', v_e.folio; end if;
  if v_e.estatus = 'cancelada' then raise exception 'La entrega % esta cancelada', v_e.folio; end if;

  for r in
    select m.id, m.lote_id, m.kg, m.articulo_molido_id
    from molienda m
    where m.empresa_id = p_empresa_id and m.entrega_id = p_entrega_id
  loop
    select * into v_ex from existencias
    where lote_id = r.lote_id and almacen_id = v_e.almacen_origen_id and ubicacion_id is null;

    if v_ex.id is null or v_ex.cantidad < r.kg then
      raise exception 'El lote de la molienda % ya no tiene los % kg en el almacen de Molinos; revisa si se consumio o se movio antes de entregar',
        r.id, r.kg;
    end if;

    -- se saca de Molinos
    if v_ex.cantidad = r.kg then
      delete from existencias where id = v_ex.id;
    else
      update existencias set cantidad = cantidad - r.kg where id = v_ex.id;
    end if;

    -- y se suma en el almacen de resguardo, respetando la existencia unica
    insert into existencias(lote_id, almacen_id, ubicacion_id, cantidad)
    values (r.lote_id, v_e.almacen_destino_id, null, r.kg)
    on conflict (lote_id, almacen_id, ubicacion_id)
    do update set cantidad = existencias.cantidad + excluded.cantidad;

    insert into movimientos(empresa_id, articulo_id, lote_id, tipo,
                            almacen_origen_id, almacen_destino_id, cantidad, motivo, usuario_id)
    values (p_empresa_id, r.articulo_molido_id, r.lote_id, 'entrega_molinos',
            v_e.almacen_origen_id, v_e.almacen_destino_id, r.kg,
            'Entrega de Molinos ' || v_e.folio, p_usuario);

    v_n := v_n + 1;
  end loop;

  if v_n = 0 then raise exception 'La entrega % no tiene moliendas asociadas', v_e.folio; end if;

  update molino_entregas
  set estatus = 'entregada', recibido_por = p_usuario, recibido_at = now()
  where id = p_entrega_id;

  return v_n;
END $$;

-- Cancelar solo antes de recibir: despues ya hay movimiento de inventario.
create or replace function cancelar_entrega_molinos(
  p_empresa_id integer, p_entrega_id integer
) returns void language plpgsql as $$
DECLARE v_est text; v_folio text;
BEGIN
  select estatus, folio into v_est, v_folio from molino_entregas
  where id = p_entrega_id and empresa_id = p_empresa_id;
  if v_est is null then raise exception 'No existe la entrega indicada'; end if;
  if v_est = 'entregada' then
    raise exception 'La entrega % ya fue recibida por el almacen y no se puede cancelar; hay que hacer un traspaso de regreso', v_folio;
  end if;
  update molienda set entrega_id = null where empresa_id = p_empresa_id and entrega_id = p_entrega_id;
  update molino_entregas set estatus = 'cancelada' where id = p_entrega_id;
END $$;

-- Lo que Molinos tiene listo para entregar y lo que ya va en camino.
create or replace function molinos_pendiente_entrega(
  p_empresa_id integer, p_site_id integer default null
) returns table(
  molienda_id integer, fecha date, turno text, articulo_id integer,
  codigo_interno text, descripcion text, tipo_material text,
  familia text, kg numeric, costo_total numeric, lote text,
  cliente text, es_consigna boolean, kg_disponible numeric
) language sql stable as $$
  select m.id, m.fecha, m.turno, m.articulo_molido_id,
         a.codigo_interno, a.descripcion, a.tipo_material,
         coalesce(f.clave,'SIN'), m.kg, m.costo_total, l.codigo_lote,
         c.nombre, m.es_consigna,
         coalesce((select ex.cantidad from existencias ex
                   join molino_parametros mp on mp.empresa_id = p_empresa_id
                   where ex.lote_id = m.lote_id and ex.almacen_id = mp.almacen_molinos_id
                     and ex.ubicacion_id is null), 0)
  from molienda m
  join articulos a on a.id = m.articulo_molido_id
  left join familias_resina f on f.id = a.familia_resina_id
  left join lotes l on l.id = m.lote_id
  left join clientes c on c.id = m.cliente_id
  where m.empresa_id = p_empresa_id
    and m.entrega_id is null
    and (p_site_id is null or m.site_id is null or m.site_id = p_site_id)
  order by m.fecha, m.turno, a.codigo_interno;
$$;
