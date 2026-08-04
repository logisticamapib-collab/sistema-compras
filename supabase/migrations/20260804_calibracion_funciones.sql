-- Estado de un equipo. Una sola definicion para que la pantalla, el tablero
-- y el candado del SPC digan lo mismo.
create or replace function equipo_estado(p_empresa_id integer, p_equipo_id integer)
returns table(estado text, dias integer, motivo text)
language plpgsql stable as $$
DECLARE e record; v_aviso int;
BEGIN
  select * into e from equipos_medicion
  where id = p_equipo_id and empresa_id = p_empresa_id;
  if e.id is null then
    return query select 'inexistente'::text, null::int, 'El equipo no existe'::text; return;
  end if;

  select coalesce(dias_aviso, 30) into v_aviso from calibracion_parametros where empresa_id = p_empresa_id;
  v_aviso := coalesce(v_aviso, 30);

  if e.estatus = 'baja' then
    return query select 'baja'::text, null::int, 'El equipo esta dado de baja'::text; return;
  end if;
  if e.estatus = 'fuera_de_servicio' then
    return query select 'fuera_de_servicio'::text, null::int,
      'El equipo esta fuera de servicio: no se puede medir con el'::text; return;
  end if;
  if not coalesce(e.activo, true) then
    return query select 'baja'::text, null::int, 'El equipo esta inactivo'::text; return;
  end if;
  if e.proxima_calibracion is null then
    return query select 'sin_calibrar'::text, null::int,
      'El equipo nunca se ha calibrado: no hay con que respaldar lo que mide'::text; return;
  end if;

  if e.proxima_calibracion < current_date then
    return query select 'vencido'::text, (current_date - e.proxima_calibracion)::int,
      'Calibracion vencida desde el ' || to_char(e.proxima_calibracion,'DD/MM/YYYY'); return;
  end if;

  if e.proxima_calibracion <= current_date + v_aviso then
    return query select 'por_vencer'::text, (e.proxima_calibracion - current_date)::int,
      'Vence el ' || to_char(e.proxima_calibracion,'DD/MM/YYYY'); return;
  end if;

  return query select 'vigente'::text, (e.proxima_calibracion - current_date)::int,
    'Vigente hasta el ' || to_char(e.proxima_calibracion,'DD/MM/YYYY');
END $$;

-- La respuesta corta que va a consumir el SPC: se puede medir con esto, si o no.
create or replace function equipo_utilizable(p_empresa_id integer, p_equipo_id integer)
returns table(ok boolean, estado text, motivo text)
language sql stable as $$
  select e.estado in ('vigente','por_vencer'), e.estado, e.motivo
  from equipo_estado(p_empresa_id, p_equipo_id) e;
$$;

-- Clasificacion de un estudio R&R con los criterios AIAG, calculada y no
-- capturada: si la teclea una persona, el numero termina diciendo lo que
-- conviene. Menos de 10% es aceptable, hasta 30% es marginal y se usa solo
-- con justificacion, arriba de 30% no sirve para decidir. El ndc es aparte:
-- con menos de 5 categorias el equipo no distingue piezas buenas de malas
-- aunque el porcentaje se vea bien.
create or replace function rr_resultado(p_empresa_id integer, p_pct numeric, p_ndc integer)
returns text language plpgsql stable as $$
DECLARE v_ok numeric; v_mg numeric; v_ndc int; v_res text;
BEGIN
  select rr_aceptable_pct, rr_marginal_pct, ndc_minimo into v_ok, v_mg, v_ndc
  from calibracion_parametros where empresa_id = p_empresa_id;
  v_ok := coalesce(v_ok, 10); v_mg := coalesce(v_mg, 30); v_ndc := coalesce(v_ndc, 5);

  if p_pct is null then return null; end if;
  if p_pct <= v_ok then v_res := 'aceptable';
  elsif p_pct <= v_mg then v_res := 'marginal';
  else v_res := 'inaceptable';
  end if;

  -- El ndc no sube la calificacion, solo la baja.
  if p_ndc is not null and p_ndc < v_ndc and v_res = 'aceptable' then
    v_res := 'marginal';
  end if;
  return v_res;
END $$;

-- Registrar una calibracion y dejar el equipo al dia en un solo paso.
create or replace function registrar_calibracion(
  p_empresa_id integer, p_equipo_id integer, p_fecha date, p_tipo text,
  p_resultado text, p_laboratorio text default null, p_certificado text default null,
  p_patron text default null, p_trazabilidad text default null,
  p_error numeric default null, p_incertidumbre numeric default null,
  p_proxima date default null, p_documento text default null,
  p_notas text default null, p_usuario uuid default null
) returns integer language plpgsql as $$
DECLARE e record; v_id int; v_prox date; v_impacto date;
BEGIN
  select * into e from equipos_medicion where id = p_equipo_id and empresa_id = p_empresa_id;
  if e.id is null then raise exception 'No existe el equipo indicado'; end if;
  if p_fecha > current_date then
    raise exception 'La calibracion no puede tener fecha futura';
  end if;

  -- La proxima sale del intervalo del equipo salvo que el laboratorio indique otra.
  v_prox := coalesce(p_proxima, p_fecha + (coalesce(e.intervalo_meses,12) || ' months')::interval);

  -- Si salio rechazada, queda en duda todo lo medido desde la ultima buena.
  if p_resultado = 'rechazado' then
    select max(c.fecha) into v_impacto from calibraciones c
    where c.equipo_id = p_equipo_id and c.resultado in ('aprobado','aprobado_con_ajuste')
      and c.fecha <= p_fecha;
  end if;

  insert into calibraciones(empresa_id, equipo_id, fecha, tipo, laboratorio, numero_certificado,
                            patron, trazabilidad, resultado, error_encontrado, incertidumbre,
                            proxima_fecha, impacto_desde, documento_url, notas, capturado_por)
  values (p_empresa_id, p_equipo_id, p_fecha, coalesce(p_tipo,'externa'), p_laboratorio, p_certificado,
          p_patron, p_trazabilidad, p_resultado, p_error, p_incertidumbre,
          case when p_resultado = 'rechazado' then null else v_prox end,
          v_impacto, p_documento, p_notas, p_usuario)
  returning id into v_id;

  if p_resultado = 'rechazado' then
    -- No se vuelve a medir con el hasta que lo reparen y lo recalibren.
    update equipos_medicion
    set estatus = 'fuera_de_servicio', proxima_calibracion = null
    where id = p_equipo_id;
  else
    update equipos_medicion
    set ultima_calibracion = p_fecha,
        proxima_calibracion = v_prox,
        estatus = case when estatus = 'fuera_de_servicio' then 'activo' else estatus end
    where id = p_equipo_id
      and (ultima_calibracion is null or p_fecha >= ultima_calibracion);
  end if;

  return v_id;
END $$;

-- Registrar un estudio R&R. El resultado lo calcula el sistema.
create or replace function registrar_rr(
  p_empresa_id integer, p_equipo_id integer, p_fecha date,
  p_pct numeric, p_ndc integer default null, p_articulo_id integer default null,
  p_caracteristica text default null, p_operadores integer default null,
  p_partes integer default null, p_ensayos integer default null,
  p_documento text default null, p_notas text default null, p_usuario uuid default null
) returns integer language plpgsql as $$
DECLARE v_id int; v_res text;
BEGIN
  if not exists (select 1 from equipos_medicion where id = p_equipo_id and empresa_id = p_empresa_id) then
    raise exception 'No existe el equipo indicado';
  end if;
  if p_pct is null or p_pct < 0 then raise exception 'El %%R&R debe ser un numero positivo'; end if;

  v_res := rr_resultado(p_empresa_id, p_pct, p_ndc);

  insert into equipo_rr(empresa_id, equipo_id, fecha, articulo_id, caracteristica,
                        operadores, partes, ensayos, pct_rr, ndc, resultado,
                        documento_url, notas, capturado_por)
  values (p_empresa_id, p_equipo_id, p_fecha, p_articulo_id, p_caracteristica,
          p_operadores, p_partes, p_ensayos, p_pct, p_ndc, v_res,
          p_documento, p_notas, p_usuario)
  returning id into v_id;

  update equipos_medicion
  set ultimo_rr_fecha = p_fecha, ultimo_rr_pct = p_pct, ultimo_rr_resultado = v_res
  where id = p_equipo_id
    and (ultimo_rr_fecha is null or p_fecha >= ultimo_rr_fecha);

  return v_id;
END $$;

-- El padron con su estado ya resuelto, para la pantalla y el tablero.
create or replace function equipos_estado(p_empresa_id integer, p_site_id integer default null)
returns table(
  id integer, clave text, nombre text, tipo text, marca text, modelo text, serie text,
  area text, unidad text, resolucion numeric,
  intervalo_meses integer, ultima_calibracion date, proxima_calibracion date,
  estatus text, estado text, dias integer, motivo text,
  requiere_rr boolean, ultimo_rr_pct numeric, ultimo_rr_resultado text, ultimo_rr_fecha date,
  ultimo_certificado text, site_id integer
) language sql stable as $$
  select e.id, e.clave, e.nombre, e.tipo, e.marca, e.modelo, e.serie,
         e.area, e.unidad, e.resolucion,
         e.intervalo_meses, e.ultima_calibracion, e.proxima_calibracion,
         e.estatus, s.estado, s.dias, s.motivo,
         e.requiere_rr, e.ultimo_rr_pct, e.ultimo_rr_resultado, e.ultimo_rr_fecha,
         (select c.numero_certificado from calibraciones c
          where c.equipo_id = e.id and c.resultado <> 'rechazado'
          order by c.fecha desc, c.id desc limit 1),
         e.site_id
  from equipos_medicion e
  cross join lateral equipo_estado(p_empresa_id, e.id) s
  where e.empresa_id = p_empresa_id
    and e.estatus <> 'baja'
    and (p_site_id is null or e.site_id is null or e.site_id = p_site_id)
  order by
    case s.estado when 'vencido' then 1 when 'sin_calibrar' then 2
                  when 'fuera_de_servicio' then 3 when 'por_vencer' then 4 else 5 end,
    e.proxima_calibracion nulls first, e.clave;
$$;
