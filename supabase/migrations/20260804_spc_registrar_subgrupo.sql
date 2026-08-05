-- Registrar un subgrupo desde la terminal de piso.
--
-- Aqui cobra sentido la calibracion: si el equipo del plan no esta vigente,
-- la captura se rechaza. Medir con un equipo vencido genera un dato que se ve
-- bien y no vale, y ese es justo el error que nadie detecta despues.
create or replace function registrar_subgrupo(
  p_empresa_id integer, p_caracteristica_id integer, p_ot_id integer,
  p_valores numeric[], p_turno text default null, p_lote_id integer default null,
  p_usuario uuid default null, p_notas text default null
) returns integer language plpgsql as $$
DECLARE
  c record; o record; eq record; lim record; k record; v_par record;
  v_id int; v_n int; v_media numeric; v_rango numeric; v_min numeric; v_max numeric; v_desv numeric;
  v_fuera_esp boolean := false; v_fuera_ctl boolean := false;
  v_reglas text := ''; v_prev numeric;
  v_alerta int; v_nc int; v_sev text;
  i int; v_val numeric;
BEGIN
  if p_valores is null or array_length(p_valores,1) is null then
    raise exception 'No se capturo ninguna medicion';
  end if;

  select c2.*, p.articulo_id as art_id, p.estatus as plan_estatus into c
  from plan_control_caracteristicas c2
  join planes_control p on p.id = c2.plan_id
  where c2.id = p_caracteristica_id and p.empresa_id = p_empresa_id;
  if c.id is null then raise exception 'No existe la caracteristica indicada'; end if;
  if not c.activo then raise exception 'La caracteristica "%" esta inactiva en el plan', c.nombre; end if;
  if c.plan_estatus <> 'vigente' then
    raise exception 'La caracteristica "%" pertenece a un plan que no esta vigente. Captura contra el plan vigente del articulo', c.nombre;
  end if;

  select * into o from ordenes_trabajo where id = p_ot_id and empresa_id = p_empresa_id;
  if o.id is null then raise exception 'No existe la orden de trabajo indicada'; end if;
  if o.articulo_id <> c.art_id then
    raise exception 'La caracteristica "%" es de otro articulo: no pertenece al plan de la OT %', c.nombre, o.folio;
  end if;

  -- CANDADO: no se mide con un equipo que no esta en condiciones.
  if c.equipo_id is not null then
    select * into eq from equipo_utilizable(p_empresa_id, c.equipo_id);
    if not eq.ok then
      raise exception 'No se puede capturar "%": el equipo asignado no esta en condiciones de medir. %',
        c.nombre, eq.motivo using errcode = 'check_violation';
    end if;
  end if;

  v_n := array_length(p_valores, 1);
  if v_n <> c.tamano_subgrupo then
    raise exception 'El plan pide un subgrupo de % piezas y se capturaron %. Cambiar el tamano a media corrida invalida los limites de control',
      c.tamano_subgrupo, v_n;
  end if;

  select avg(v), max(v) - min(v), min(v), max(v),
         case when count(*) > 1 then stddev_samp(v) else null end
    into v_media, v_rango, v_min, v_max, v_desv
  from unnest(p_valores) v;

  -- Para n = 1 el rango del subgrupo es cero; se usa el rango movil contra la
  -- lectura anterior, que es lo que hace una carta X-mR.
  if v_n = 1 then
    select s.media into v_prev from spc_subgrupos s
    where s.caracteristica_id = p_caracteristica_id
      and (s.maquina_id is not distinct from o.maquina_id)
    order by s.fecha desc, s.id desc limit 1;
    v_rango := coalesce(abs(v_media - v_prev), 0);
  end if;

  -- Fuera de especificacion no es lo mismo que fuera de control: esto ya es
  -- producto que no cumple, y se evalua exista o no la carta.
  if (c.lie is not null and v_min < c.lie) or (c.lse is not null and v_max > c.lse) then
    v_fuera_esp := true;
    v_reglas := v_reglas || 'Fuera de especificacion. ';
  end if;

  select * into lim from spc_limites
  where caracteristica_id = p_caracteristica_id and estatus = 'vigente'
    and (maquina_id is null or maquina_id = o.maquina_id)
  order by maquina_id nulls last limit 1;

  insert into spc_subgrupos(empresa_id, caracteristica_id, ot_id, maquina_id, lote_id,
                            equipo_id, turno, n, media, rango, minimo, maximo, desv,
                            fuera_especificacion, limites_id, notas, capturado_por)
  values (p_empresa_id, p_caracteristica_id, p_ot_id, o.maquina_id, p_lote_id,
          c.equipo_id, coalesce(p_turno, o.turno), v_n, v_media, v_rango, v_min, v_max, v_desv,
          v_fuera_esp, lim.id, p_notas, p_usuario)
  returning id into v_id;

  i := 0;
  foreach v_val in array p_valores loop
    i := i + 1;
    insert into spc_mediciones(subgrupo_id, secuencia, valor) values (v_id, i, v_val);
  end loop;

  -- Las reglas solo tienen sentido si ya hay limites congelados.
  if lim.id is not null then
    select * into k from spc_evaluar_reglas(p_empresa_id, v_id);
    v_fuera_ctl := coalesce(k.fuera_control, false);
    v_reglas := v_reglas || coalesce(k.reglas, '');
  end if;
  update spc_subgrupos
  set fuera_control = v_fuera_ctl, reglas = nullif(trim(v_reglas), '')
  where id = v_id;

  -- Reaccion. Fuera de especificacion es producto que no cumple; fuera de
  -- control es un proceso que cambio. Las tendencias avisan pero no levantan
  -- no conformidad: si lo hicieran, la bandeja se llena y deja de leerse.
  select * into v_par from spc_parametros where empresa_id = p_empresa_id;

  if v_fuera_esp or v_fuera_ctl then
    v_sev := case when v_fuera_esp then 'mayor' else 'menor' end;

    insert into calidad_alertas(empresa_id, folio, titulo, articulo_id, mensaje,
                                severidad, area, vigente, creado_por)
    values (p_empresa_id, 'SPC-' || v_id, c.nombre || ' en ' || o.folio, c.art_id,
            nullif(trim(v_reglas), '') || ' Plan de reaccion: ' || c.plan_reaccion,
            case when v_fuera_esp then 'critica' else 'mayor' end,
            'Produccion', true, p_usuario)
    returning id into v_alerta;

    if (v_fuera_esp and coalesce(v_par.nc_por_fuera_especificacion, true))
       or (v_fuera_ctl and coalesce(v_par.nc_por_fuera_control, true)) then
      insert into no_conformidades(empresa_id, folio, origen, fecha, detectado_por, area,
                                   articulo_id, lote_id, maquina_id, ot_id, descripcion,
                                   severidad, estatus, creado_por)
      values (p_empresa_id, 'NC-SPC-' || v_id, 'interno', current_date, p_usuario, 'Produccion',
              c.art_id, p_lote_id, o.maquina_id, p_ot_id,
              'SPC ' || c.nombre || ' (' || o.folio || '): ' || nullif(trim(v_reglas), '')
                || ' Media ' || round(v_media, 4)
                || '. Especificacion ' || coalesce(c.lie::text,'-') || ' a ' || coalesce(c.lse::text,'-')
                || '. Plan de reaccion: ' || c.plan_reaccion,
              v_sev, 'abierta', p_usuario)
      returning id into v_nc;
      update calidad_alertas set nc_id = v_nc where id = v_alerta;
    end if;

    update spc_subgrupos set alerta_id = v_alerta, nc_id = v_nc where id = v_id;

  elsif nullif(trim(v_reglas), '') is not null then
    -- Tendencia sin punto fuera: se avisa y ya.
    insert into calidad_alertas(empresa_id, folio, titulo, articulo_id, mensaje,
                                severidad, area, vigente, creado_por)
    values (p_empresa_id, 'SPC-' || v_id, c.nombre || ' con tendencia en ' || o.folio,
            c.art_id, v_reglas || 'Plan de reaccion: ' || c.plan_reaccion,
            'menor', 'Produccion', true, p_usuario)
    returning id into v_alerta;
    update spc_subgrupos set alerta_id = v_alerta where id = v_id;
  end if;

  return v_id;
END $$;
