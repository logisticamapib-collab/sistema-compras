-- 1) El derivado hereda la familia de resina de su virgen.
create or replace function crear_articulo_molido(
  p_empresa_id integer, p_articulo_virgen_id integer, p_tipo text default 'molido'
) returns integer language plpgsql as $$
DECLARE v_v record; v_id int; v_pref text; v_cod text;
BEGIN
  select * into v_v from articulos where id = p_articulo_virgen_id and empresa_id = p_empresa_id;
  if v_v.id is null then raise exception 'No existe la resina virgen indicada'; end if;

  v_pref := case when p_tipo = 'barredura' then 'B-' else 'M-' end;
  v_cod  := v_pref || v_v.codigo_interno;

  select id into v_id from articulos where empresa_id = p_empresa_id and codigo_interno = v_cod;
  if v_id is not null then
    -- si ya existia pero sin familia, se le hereda ahora
    update articulos set familia_resina_id = coalesce(familia_resina_id, v_v.familia_resina_id)
    where id = v_id;
    return v_id;
  end if;

  insert into articulos(
    empresa_id, categoria_id, codigo_interno, descripcion, unidad_medida,
    tipo_moneda, activo, origen, es_consigna, site_id,
    tipo_material, articulo_virgen_id, permite_venta, admite_molido, costo,
    familia_resina_id
  ) values (
    p_empresa_id, v_v.categoria_id, v_cod,
    case when p_tipo = 'barredura' then 'Barredura de ' else 'Molido de ' end
      || coalesce(v_v.descripcion, v_v.codigo_interno),
    v_v.unidad_medida, v_v.tipo_moneda, true, 'fabricado', v_v.es_consigna, v_v.site_id,
    p_tipo, v_v.id,
    -- el material en consigna no se marca vendible por default: es del cliente
    case when v_v.es_consigna then false else true end,
    false, 0,
    v_v.familia_resina_id
  ) returning id into v_id;

  update articulos set tipo_material = coalesce(tipo_material, 'virgen')
  where id = p_articulo_virgen_id;

  return v_id;
END $$;

-- Herencia para los derivados que ya existian
update articulos d
set familia_resina_id = v.familia_resina_id
from articulos v
where d.articulo_virgen_id = v.id
  and d.familia_resina_id is null
  and v.familia_resina_id is not null;

-- 2) Politica efectiva de un molido: que se puede hacer con el.
--
-- El material en consigna es propiedad del cliente. Mezclarlo, venderlo o
-- retornarlo no lo decide la planta, lo decide el contrato. Esta funcion es
-- la unica fuente de esa respuesta para que la pantalla, el embarque y el
-- disparador de la base de datos digan exactamente lo mismo.
--
-- Ante la duda se niega: si el material es de un cliente y nadie capturo su
-- politica, no se vende. Equivocarse hacia el lado de vender material ajeno
-- es un problema legal; equivocarse hacia el lado de no venderlo solo obliga
-- a capturar la politica.
create or replace function molido_politica(p_empresa_id integer, p_articulo_id integer)
returns table(permite_mezcla boolean, permite_venta boolean, retorna_cliente boolean, motivo text)
language plpgsql stable as $$
DECLARE
  v_a record; v_n int; v_sin int;
  v_mez boolean; v_ven boolean; v_ret boolean;
BEGIN
  select a.id, a.tipo_material, a.es_consigna, a.permite_venta
    into v_a
  from articulos a where a.id = p_articulo_id and a.empresa_id = p_empresa_id;

  if v_a.id is null then
    return query select false, false, false, 'El articulo no existe'::text; return;
  end if;

  if coalesce(v_a.tipo_material,'virgen') not in ('molido','barredura') then
    return query select true, true, false, 'No es material de molino'::text; return;
  end if;

  -- La barredura nunca entra a proceso: viene del piso o de limpiar tolvas.
  if v_a.tipo_material = 'barredura' then
    v_mez := false;
  else
    v_mez := true;
  end if;

  if not coalesce(v_a.es_consigna, false) then
    return query select v_mez, coalesce(v_a.permite_venta, true), false,
      'Material propio: lo decide la planta'::text;
    return;
  end if;

  -- Consigna: manda el contrato de cada cliente que aporto material.
  select count(*), count(*) filter (where p.cliente_id is null)
    into v_n, v_sin
  from (select distinct m.cliente_id from molienda m
        where m.empresa_id = p_empresa_id and m.articulo_molido_id = p_articulo_id
          and m.cliente_id is not null) c
  left join cliente_molido_politica p
    on p.empresa_id = p_empresa_id and p.cliente_id = c.cliente_id;

  if v_n = 0 then
    return query select false, false, true,
      'Material en consigna sin cliente identificado: no se vende hasta aclararlo'::text;
    return;
  end if;

  if v_sin > 0 then
    return query select false, false, true,
      'Falta capturar la politica de molido de ' || v_sin || ' cliente(s)'::text;
    return;
  end if;

  -- Basta que un cliente lo prohiba para que el codigo quede prohibido,
  -- porque el material de todos esta revuelto en el mismo lote.
  select bool_and(p.permite_mezcla), bool_and(p.permite_venta), bool_or(p.retorna_cliente)
    into v_mez, v_ven, v_ret
  from (select distinct m.cliente_id from molienda m
        where m.empresa_id = p_empresa_id and m.articulo_molido_id = p_articulo_id
          and m.cliente_id is not null) c
  join cliente_molido_politica p
    on p.empresa_id = p_empresa_id and p.cliente_id = c.cliente_id;

  if v_a.tipo_material = 'barredura' then v_mez := false; end if;

  return query select coalesce(v_mez,false), coalesce(v_ven,false), coalesce(v_ret,true),
    case when coalesce(v_ven,false) then 'Consigna: el contrato permite la venta'
         else 'Consigna: el contrato no permite la venta' end::text;
END $$;
