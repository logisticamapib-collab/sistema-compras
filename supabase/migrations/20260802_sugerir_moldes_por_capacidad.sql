-- =====================================================================
-- Reparto entre moldes gemelos por capacidad contra la fecha del cliente.
--
-- El MRP ya planea sobre el codigo principal, pero saber CUANTO producir no
-- basta: hay que ver si el molde principal alcanza a hacerlo antes de la
-- fecha requerida. Si no alcanza, lo correcto es abrir tambien el molde
-- gemelo y repartir, no descubrirlo cuando ya se atraso.
--
-- Para cada codigo de la parte se comparan los minutos libres de su maquina
-- hasta la fecha requerida contra los minutos que necesita esa cantidad con
-- su propio ciclo y cavidades activas.
-- =====================================================================

-- Minutos productivos libres de una maquina de aqui a una fecha: la
-- capacidad del calendario menos lo que ya tiene comprometido en OT.
create or replace function capacidad_libre_maquina(
  p_empresa_id int, p_maquina_id int, p_hasta date
)
returns numeric language sql stable as $$
  select greatest(
    coalesce((
      select sum(v.min_prod) from ventanas_habiles(p_empresa_id, current_date, p_hasta) v
      where v.fin > now()
    ), 0)
    - coalesce((
      select sum(p.total_min)
      from plan_maquina(p_empresa_id, p_maquina_id, current_date, p_hasta) p
    ), 0)
  , 0);
$$;

-- Reparto sugerido entre los moldes de la parte. Un renglon por codigo
-- equivalente con su capacidad y cuanto conviene producir en el. El
-- principal va primero: es donde se produce salvo que no alcance.
create or replace function sugerir_moldes_parte(
  p_empresa_id int, p_articulo_id int, p_cantidad numeric,
  p_fecha_requerida date, p_site_id int default null
)
returns table (
  articulo_id int, codigo_interno text, molde_clave text,
  maquina_id int, maquina_clave text, es_principal boolean,
  min_libres numeric, ciclo_seg numeric, cavidades int, eficiencia numeric,
  capacidad_pz numeric, sugerido_pz numeric, alcanza boolean
)
language plpgsql stable as $$
DECLARE
  r record; v_prin int; v_resta numeric := p_cantidad; v_toma numeric;
BEGIN
  select p.articulo_principal_id into v_prin
  from articulos a join partes p on p.id = a.parte_id
  where a.id = p_articulo_id and p.activo;
  if v_prin is null then v_prin := p_articulo_id; end if;

  for r in
    select e.articulo_id, e.codigo_interno, e.molde_id, e.molde_clave,
           (e.articulo_id = v_prin) as principal,
           rt.maquina_principal_id, mq.clave maquina_clave,
           rt.tiempo_estandar_seg,
           greatest(coalesce(nullif(cavidades_activas_articulo(e.molde_id, e.articulo_id), 0), 1), 1) cav
    from equivalentes_articulo(p_articulo_id) e
    left join lateral (
      select rf.maquina_principal_id, rf.tiempo_estandar_seg
      from rutas_fabricacion rf
      where rf.articulo_id = e.articulo_id and coalesce(rf.tiempo_estandar_seg,0) > 0
      order by rf.secuencia limit 1
    ) rt on true
    left join maquinas mq on mq.id = rt.maquina_principal_id
    order by (e.articulo_id = v_prin) desc, e.codigo_interno
  loop
    articulo_id := r.articulo_id; codigo_interno := r.codigo_interno;
    molde_clave := r.molde_clave; maquina_id := r.maquina_principal_id;
    maquina_clave := r.maquina_clave; es_principal := r.principal;
    ciclo_seg := r.tiempo_estandar_seg; cavidades := r.cav;

    if r.maquina_principal_id is null or coalesce(r.tiempo_estandar_seg,0) <= 0 then
      min_libres := 0; eficiencia := null; capacidad_pz := 0; sugerido_pz := 0;
      alcanza := false;
      return next; continue;
    end if;

    eficiencia := eficiencia_maquina(p_empresa_id, r.maquina_principal_id);
    min_libres := capacidad_libre_maquina(p_empresa_id, r.maquina_principal_id, p_fecha_requerida);
    capacidad_pz := floor(min_libres * 60.0 * eficiencia / r.tiempo_estandar_seg) * r.cav;

    v_toma := least(greatest(v_resta, 0), capacidad_pz);
    sugerido_pz := v_toma;
    v_resta := v_resta - v_toma;
    alcanza := (v_resta <= 0);
    return next;
  end loop;
END $$;

grant execute on function capacidad_libre_maquina(int, int, date) to anon, authenticated, service_role;
grant execute on function sugerir_moldes_parte(int, int, numeric, date, int) to anon, authenticated, service_role;
