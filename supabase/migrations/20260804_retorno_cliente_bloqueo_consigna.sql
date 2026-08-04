-- Retorno de molido al cliente y candado real sobre el material en consigna.
--
-- El aviso en pantalla no es un control: quien tiene prisa lo ignora. El
-- candado vive en la base de datos, de modo que ninguna pantalla, ninguna
-- carga masiva y ningun script pueda embarcar molido de un cliente que no
-- autorizo su venta, ni meter barredura a la mezcla.

-- ---------- Retorno al cliente ----------
create or replace function registrar_retorno_cliente(
  p_empresa_id integer, p_articulo_id integer, p_kg numeric,
  p_almacen_id integer default null, p_cliente_id integer default null,
  p_usuario uuid default null, p_referencia text default null
) returns numeric language plpgsql as $$
DECLARE
  v_a record; r record; v_falta numeric; v_toma numeric; v_disp numeric;
BEGIN
  if coalesce(p_kg,0) <= 0 then raise exception 'Los kilos deben ser mayores a cero'; end if;

  select id, codigo_interno, tipo_material, es_consigna into v_a
  from articulos where id = p_articulo_id and empresa_id = p_empresa_id;
  if v_a.id is null then raise exception 'No existe el articulo indicado'; end if;
  if coalesce(v_a.tipo_material,'virgen') not in ('molido','barredura') then
    raise exception 'El retorno a cliente es solo para molido o barredura; % no lo es', v_a.codigo_interno;
  end if;
  if not coalesce(v_a.es_consigna,false) then
    raise exception 'El articulo % no esta marcado como consigna: es material propio y no se retorna, se vende o se desecha', v_a.codigo_interno;
  end if;

  select coalesce(sum(ex.cantidad),0) into v_disp
  from existencias ex join lotes l on l.id = ex.lote_id
  where l.empresa_id = p_empresa_id and l.articulo_id = p_articulo_id
    and (p_almacen_id is null or ex.almacen_id = p_almacen_id);
  if v_disp < p_kg then
    raise exception 'Solo hay % kg de % disponibles y se intentan retornar %', v_disp, v_a.codigo_interno, p_kg;
  end if;

  -- FIFO por lote: primero sale el molido mas viejo
  v_falta := p_kg;
  for r in
    select ex.id ex_id, ex.lote_id, ex.almacen_id, ex.cantidad, l.fecha
    from existencias ex join lotes l on l.id = ex.lote_id
    where l.empresa_id = p_empresa_id and l.articulo_id = p_articulo_id
      and ex.cantidad > 0
      and (p_almacen_id is null or ex.almacen_id = p_almacen_id)
    order by l.fecha nulls last, l.id
  loop
    exit when v_falta <= 0;
    v_toma := least(r.cantidad, v_falta);

    if r.cantidad = v_toma then delete from existencias where id = r.ex_id;
    else update existencias set cantidad = cantidad - v_toma where id = r.ex_id; end if;

    insert into movimientos(empresa_id, articulo_id, lote_id, tipo,
                            almacen_origen_id, cantidad, motivo, usuario_id)
    values (p_empresa_id, p_articulo_id, r.lote_id, 'retorno_cliente',
            r.almacen_id, v_toma,
            'Retorno de material en consigna al cliente'
              || coalesce(' (' || p_referencia || ')', ''), p_usuario);

    v_falta := v_falta - v_toma;
  end loop;

  return p_kg - v_falta;
END $$;

-- ---------- Candado: no vender material del cliente ----------
create or replace function trg_bloquea_venta_molido() returns trigger language plpgsql as $$
DECLARE v_tipo text; v_cod text; p record;
BEGIN
  select a.tipo_material, a.codigo_interno into v_tipo, v_cod
  from articulos a where a.id = new.articulo_id;

  if coalesce(v_tipo,'virgen') not in ('molido','barredura') then return new; end if;

  select * into p from molido_politica(
    (select e.empresa_id from embarques e where e.id = new.embarque_id),
    new.articulo_id);

  if not p.permite_venta then
    raise exception 'No se puede embarcar %: %. Si el contrato si lo permite, capturalo en Molinos / Configuracion antes de embarcar.',
      v_cod, p.motivo
      using errcode = 'check_violation';
  end if;
  return new;
END $$;

drop trigger if exists bloquea_venta_molido on embarque_lineas;
create trigger bloquea_venta_molido
  before insert or update of articulo_id, cantidad on embarque_lineas
  for each row execute function trg_bloquea_venta_molido();

-- ---------- Candado: no meter a proceso lo que no se puede mezclar ----------
create or replace function trg_bloquea_mezcla_molido() returns trigger language plpgsql as $$
DECLARE v_tipo text; v_cod text; v_emp int; p record;
BEGIN
  select a.tipo_material, a.codigo_interno, a.empresa_id into v_tipo, v_cod, v_emp
  from articulos a where a.id = new.articulo_id;

  if coalesce(v_tipo,'virgen') not in ('molido','barredura') then return new; end if;

  select * into p from molido_politica(v_emp, new.articulo_id);

  if not p.permite_mezcla then
    if v_tipo = 'barredura' then
      raise exception 'La barredura % no entra a proceso: es resina de piso o de limpieza de tolvas y contamina el lote',
        v_cod using errcode = 'check_violation';
    else
      raise exception 'No se puede consumir % en produccion: %',
        v_cod, p.motivo using errcode = 'check_violation';
    end if;
  end if;
  return new;
END $$;

drop trigger if exists bloquea_mezcla_molido on ot_consumos;
create trigger bloquea_mezcla_molido
  before insert or update of articulo_id, cantidad on ot_consumos
  for each row execute function trg_bloquea_mezcla_molido();
