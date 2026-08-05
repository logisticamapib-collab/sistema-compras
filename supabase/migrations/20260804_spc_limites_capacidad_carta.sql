-- Congelar los limites de control a partir de un estudio.
--
-- Este es el paso que casi siempre falta. Los limites NO se recalculan con
-- cada punto: si lo hicieran, perseguirian a los datos, se abririan solos
-- conforme el proceso se degrada y la carta dejaria de detectar nada. Se
-- calculan una vez sobre una ventana estable y se congelan; volver a
-- calcularlos es una decision explicita que queda registrada.
create or replace function calcular_limites_control(
  p_empresa_id integer, p_caracteristica_id integer,
  p_maquina_id integer default null,
  p_desde timestamptz default null, p_hasta timestamptz default null,
  p_usuario uuid default null, p_notas text default null
) returns integer language plpgsql as $$
DECLARE
  c record; k record; v_min int; v_id int;
  v_cnt int; v_n int; v_ns int;
  v_x numeric; v_r numeric; v_sw numeric; v_st numeric;
  v_cp numeric; v_cpk numeric; v_pp numeric; v_ppk numeric;
  v_d timestamptz; v_h timestamptz; v_primero int;
BEGIN
  select c2.*, p.articulo_id as art_id into c
  from plan_control_caracteristicas c2
  join planes_control p on p.id = c2.plan_id
  where c2.id = p_caracteristica_id and p.empresa_id = p_empresa_id;
  if c.id is null then raise exception 'No existe la caracteristica indicada'; end if;
  if c.tipo <> 'variable' then
    raise exception 'Las cartas por variables solo aplican a caracteristicas que se miden, y "%" es por atributos', c.nombre;
  end if;

  select coalesce(subgrupos_minimos, 25) into v_min from spc_parametros where empresa_id = p_empresa_id;
  v_min := coalesce(v_min, 25);

  select count(*), count(distinct s.n), min(s.n), min(s.fecha), max(s.fecha)
    into v_cnt, v_ns, v_n, v_d, v_h
  from spc_subgrupos s
  where s.caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta);

  if v_cnt < v_min then
    raise exception 'Hay % subgrupo(s) en la ventana y se necesitan al menos %. Con menos datos los limites salen tan inestables que la carta marca falsas alarmas',
      v_cnt, v_min;
  end if;
  if v_ns > 1 then
    raise exception 'La ventana mezcla subgrupos de distinto tamano. Los limites de control dependen de n, asi que no se pueden calcular sobre datos revueltos';
  end if;

  select * into k from spc_constantes(v_n);

  -- El primer subgrupo de la serie tiene rango movil cero por definicion (no
  -- tiene contra que compararse). Incluirlo en n = 1 encogeria los limites.
  if v_n = 1 then
    select s.id into v_primero from spc_subgrupos s
    where s.caracteristica_id = p_caracteristica_id
      and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    order by s.fecha, s.id limit 1;
  end if;

  select avg(s.media) into v_x from spc_subgrupos s
  where s.caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta);

  select avg(s.rango) into v_r from spc_subgrupos s
  where s.caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
    and (v_n <> 1 or s.id is distinct from v_primero);

  -- Sigma de corto plazo: la variacion natural del proceso, sin el ruido de
  -- los cambios entre subgrupos. Es la que va en Cp y Cpk.
  v_sw := case when k.d2 > 0 then v_r / k.d2 else null end;

  -- Sigma de largo plazo: toda la variacion que realmente vio el cliente.
  -- Es la que va en Pp y Ppk, y por eso Ppk suele salir mas bajo que Cpk.
  select stddev_samp(md.valor) into v_st
  from spc_mediciones md
  join spc_subgrupos s on s.id = md.subgrupo_id
  where s.caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta);

  if c.lie is not null and c.lse is not null then
    v_cp  := case when v_sw > 0 then (c.lse - c.lie) / (6 * v_sw) end;
    v_pp  := case when v_st > 0 then (c.lse - c.lie) / (6 * v_st) end;
    v_cpk := case when v_sw > 0 then least((c.lse - v_x) / (3 * v_sw), (v_x - c.lie) / (3 * v_sw)) end;
    v_ppk := case when v_st > 0 then least((c.lse - v_x) / (3 * v_st), (v_x - c.lie) / (3 * v_st)) end;
  elsif c.lse is not null then
    -- Tolerancia unilateral: Cp no existe, solo el lado que si tiene limite.
    v_cpk := case when v_sw > 0 then (c.lse - v_x) / (3 * v_sw) end;
    v_ppk := case when v_st > 0 then (c.lse - v_x) / (3 * v_st) end;
  elsif c.lie is not null then
    v_cpk := case when v_sw > 0 then (v_x - c.lie) / (3 * v_sw) end;
    v_ppk := case when v_st > 0 then (v_x - c.lie) / (3 * v_st) end;
  end if;

  update spc_limites set estatus = 'obsoleto'
  where caracteristica_id = p_caracteristica_id and estatus = 'vigente'
    and coalesce(maquina_id, 0) = coalesce(p_maquina_id, 0);

  insert into spc_limites(empresa_id, caracteristica_id, maquina_id, estatus, n, subgrupos,
                          x_barra, r_barra, lci_x, lc_x, lcs_x, lci_r, lc_r, lcs_r,
                          sigma_within, sigma_total, cp, cpk, pp, ppk,
                          desde, hasta, notas, calculado_por)
  values (p_empresa_id, p_caracteristica_id, p_maquina_id, 'vigente', v_n, v_cnt,
          round(v_x, 6), round(v_r, 6),
          round(v_x - k.a2 * v_r, 6), round(v_x, 6), round(v_x + k.a2 * v_r, 6),
          round(k.d3 * v_r, 6), round(v_r, 6), round(k.d4 * v_r, 6),
          round(v_sw, 6), round(v_st, 6),
          round(v_cp, 3), round(v_cpk, 3), round(v_pp, 3), round(v_ppk, 3),
          v_d, v_h, p_notas, p_usuario)
  returning id into v_id;

  -- Los puntos de la ventana quedan amarrados al estudio que los produjo.
  update spc_subgrupos set limites_id = v_id
  where caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or maquina_id = p_maquina_id)
    and (p_desde is null or fecha >= p_desde)
    and (p_hasta is null or fecha <= p_hasta);

  return v_id;
END $$;

-- Los puntos de la carta con sus limites, listos para graficar.
create or replace function spc_carta(
  p_empresa_id integer, p_caracteristica_id integer,
  p_maquina_id integer default null,
  p_desde timestamptz default null, p_hasta timestamptz default null
) returns table(
  subgrupo_id integer, fecha timestamptz, turno text, ot text, maquina text,
  n integer, media numeric, rango numeric, minimo numeric, maximo numeric,
  fuera_especificacion boolean, fuera_control boolean, reglas text,
  nc_id integer,
  lci_x numeric, lc_x numeric, lcs_x numeric,
  lci_r numeric, lc_r numeric, lcs_r numeric,
  lie numeric, nominal numeric, lse numeric, unidad text
) language sql stable as $$
  select s.id, s.fecha, s.turno, o.folio, mq.clave,
         s.n, s.media, s.rango, s.minimo, s.maximo,
         s.fuera_especificacion, s.fuera_control, s.reglas, s.nc_id,
         l.lci_x, l.lc_x, l.lcs_x, l.lci_r, l.lc_r, l.lcs_r,
         c.lie, c.nominal, c.lse, c.unidad
  from spc_subgrupos s
  join plan_control_caracteristicas c on c.id = s.caracteristica_id
  left join ordenes_trabajo o on o.id = s.ot_id
  left join maquinas mq on mq.id = s.maquina_id
  left join lateral (
    select * from spc_limites x
    where x.caracteristica_id = s.caracteristica_id and x.estatus = 'vigente'
      and (x.maquina_id is null or x.maquina_id = s.maquina_id)
    order by x.maquina_id nulls last limit 1
  ) l on true
  where s.empresa_id = p_empresa_id
    and s.caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
  order by s.fecha, s.id;
$$;

-- Capacidad sobre una ventana, calculada al vuelo. Sirve para ver como va el
-- proceso hoy sin tocar los limites congelados.
create or replace function spc_capacidad(
  p_empresa_id integer, p_caracteristica_id integer,
  p_maquina_id integer default null,
  p_desde timestamptz default null, p_hasta timestamptz default null
) returns table(
  subgrupos integer, mediciones integer, n integer,
  media numeric, sigma_within numeric, sigma_total numeric,
  cp numeric, cpk numeric, pp numeric, ppk numeric,
  meta_cpk numeric, meta_ppk numeric,
  cumple_cpk boolean, cumple_ppk boolean,
  fuera_especificacion integer, fuera_control integer
) language plpgsql stable as $$
DECLARE
  c record; k record; v_cnt int; v_n int; v_med int;
  v_x numeric; v_r numeric; v_sw numeric; v_st numeric;
  v_cp numeric; v_cpk numeric; v_pp numeric; v_ppk numeric;
  v_fe int; v_fc int; v_primero int;
BEGIN
  select c2.* into c from plan_control_caracteristicas c2 where c2.id = p_caracteristica_id;
  if c.id is null then return; end if;

  select count(*), min(s.n), avg(s.media),
         count(*) filter (where s.fuera_especificacion),
         count(*) filter (where s.fuera_control)
    into v_cnt, v_n, v_x, v_fe, v_fc
  from spc_subgrupos s
  where s.empresa_id = p_empresa_id and s.caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta);

  if coalesce(v_cnt,0) = 0 then return; end if;

  if v_n = 1 then
    select s.id into v_primero from spc_subgrupos s
    where s.caracteristica_id = p_caracteristica_id
      and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    order by s.fecha, s.id limit 1;
  end if;

  select avg(s.rango) into v_r from spc_subgrupos s
  where s.empresa_id = p_empresa_id and s.caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta)
    and (v_n <> 1 or s.id is distinct from v_primero);

  select count(*), stddev_samp(md.valor) into v_med, v_st
  from spc_mediciones md
  join spc_subgrupos s on s.id = md.subgrupo_id
  where s.empresa_id = p_empresa_id and s.caracteristica_id = p_caracteristica_id
    and (p_maquina_id is null or s.maquina_id = p_maquina_id)
    and (p_desde is null or s.fecha >= p_desde)
    and (p_hasta is null or s.fecha <= p_hasta);

  select * into k from spc_constantes(v_n);
  v_sw := case when k.d2 > 0 and v_r is not null then v_r / k.d2 end;

  if c.lie is not null and c.lse is not null then
    v_cp  := case when v_sw > 0 then (c.lse - c.lie) / (6 * v_sw) end;
    v_pp  := case when v_st > 0 then (c.lse - c.lie) / (6 * v_st) end;
    v_cpk := case when v_sw > 0 then least((c.lse - v_x) / (3 * v_sw), (v_x - c.lie) / (3 * v_sw)) end;
    v_ppk := case when v_st > 0 then least((c.lse - v_x) / (3 * v_st), (v_x - c.lie) / (3 * v_st)) end;
  elsif c.lse is not null then
    v_cpk := case when v_sw > 0 then (c.lse - v_x) / (3 * v_sw) end;
    v_ppk := case when v_st > 0 then (c.lse - v_x) / (3 * v_st) end;
  elsif c.lie is not null then
    v_cpk := case when v_sw > 0 then (v_x - c.lie) / (3 * v_sw) end;
    v_ppk := case when v_st > 0 then (v_x - c.lie) / (3 * v_st) end;
  end if;

  return query select v_cnt, v_med, v_n,
    round(v_x,6), round(v_sw,6), round(v_st,6),
    round(v_cp,3), round(v_cpk,3), round(v_pp,3), round(v_ppk,3),
    c.meta_cpk, c.meta_ppk,
    case when v_cpk is null then null else v_cpk >= c.meta_cpk end,
    case when v_ppk is null then null else v_ppk >= c.meta_ppk end,
    v_fe, v_fc;
END $$;

-- El pendiente que dejo la calibracion: que se midio con un equipo desde que
-- quedo en duda. La norma pide evaluar la validez de esas mediciones.
create or replace function calibracion_impacto(p_empresa_id integer, p_equipo_id integer)
returns table(
  desde date, subgrupo_id integer, fecha timestamptz, ot text, articulo text,
  caracteristica text, media numeric, fuera_especificacion boolean, lote text
) language sql stable as $$
  with dudoso as (
    select max(c.impacto_desde) d
    from calibraciones c
    where c.empresa_id = p_empresa_id and c.equipo_id = p_equipo_id
      and c.resultado = 'rechazado'
  )
  select dudoso.d, s.id, s.fecha, o.folio, a.codigo_interno, pc.nombre,
         s.media, s.fuera_especificacion, l.codigo_lote
  from dudoso
  join spc_subgrupos s on s.empresa_id = p_empresa_id and s.equipo_id = p_equipo_id
    and dudoso.d is not null and s.fecha >= dudoso.d
  join plan_control_caracteristicas pc on pc.id = s.caracteristica_id
  left join ordenes_trabajo o on o.id = s.ot_id
  left join articulos a on a.id = o.articulo_id
  left join lotes l on l.id = s.lote_id
  order by s.fecha;
$$;
