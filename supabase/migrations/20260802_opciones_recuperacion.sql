-- =====================================================================
-- Opciones de recuperacion.
--
-- Cuando una OT se atrasa o queda empujada no basta con marcarla en rojo:
-- hay que poner enfrente las salidas CON NUMEROS para poder decidir. Para
-- cada OT en riesgo se calculan cuatro:
--   A) reducir la cantidad  -> cuanto alcanza a producirse antes del
--                              compromiso y cuanto quedarias corto
--   B) meter tiempo extra   -> cuantas horas y cuanto cuestan con las
--                              tarifas de esa maquina
--   C) diferir otra OT      -> cual conviene mover (la de compromiso mas
--                              lejano en la misma maquina)
--   D) maquina alterna      -> si hay una autorizada en la ruta
--
-- El compromiso es la fecha requerida mas temprana de una linea FIRME
-- vigente con SALDO pendiente (cantidad menos lo entregado en
-- release_entregas). No se usa forecast: no es un compromiso.
--
-- Los riesgos se distinguen porque se resuelven distinto:
--   vencido            la fecha del cliente ya paso
--   atrasada           el plan dice que ya debio terminar y sigue abierta
--   no_cabe            no alcanza a terminar en el horizonte
--   tarde_vs_cliente   terminara despues de una fecha que aun no llega
--   empujada           arranca despues de su turno porque la anterior sigue
-- =====================================================================
create or replace function opciones_recuperacion(
  p_empresa_id int, p_maquina_id int, p_desde date, p_hasta date
)
returns table (
  ot_id int, folio text, articulo_id int, articulo_codigo text, articulo_desc text,
  cantidad numeric, pendiente numeric,
  inicio timestamptz, fin timestamptz,
  fecha_compromiso date, cliente text, saldo_release numeric,
  riesgo text, horas_desfase numeric,
  cant_que_cabe numeric, faltante_release numeric,
  horas_extra numeric, costo_extra numeric,
  mover_id int, mover_folio text, mover_compromiso date,
  alterna_id int, alterna_clave text, alterna_aprobada boolean
)
language plpgsql stable as $$
DECLARE
  v_p record; v_dur record; v_lim timestamptz; v_disp numeric; v_tz text;
  v_th numeric; v_tm numeric; v_pers numeric;
  v_art_id int; v_comp date; v_cli text; v_riesgo text; v_saldo numeric;
BEGIN
  select coalesce(zona_horaria,'America/Mexico_City') into v_tz from empresas where id = p_empresa_id;
  select coalesce(costo_hora_hombre_default,0), coalesce(costo_hora_maquina_default,0)
    into v_th, v_tm from costeo_prod_parametros where empresa_id = p_empresa_id;

  for v_p in
    select * from plan_maquina(p_empresa_id, p_maquina_id, p_desde, p_hasta)
  loop
    select o.articulo_id into v_art_id from ordenes_trabajo o where o.id = v_p.ot_id;

    v_comp := null; v_cli := null; v_saldo := null;
    select rl.fecha_requerida, c.nombre, rl.cantidad - coalesce(ent.e, 0)
      into v_comp, v_cli, v_saldo
    from release_lineas rl
    left join clientes c on c.id = rl.cliente_id
    left join lateral (
      select sum(re.cantidad) e from release_entregas re where re.linea_id = rl.id
    ) ent on true
    where rl.articulo_id = v_art_id
      and rl.vigente
      and coalesce(rl.tipo, 'firme') = 'firme'
      and rl.cantidad - coalesce(ent.e, 0) > 0
    order by rl.fecha_requerida
    limit 1;

    v_riesgo := null;
    if not v_p.cabe then v_riesgo := 'no_cabe';
    elsif v_p.atrasada then v_riesgo := 'atrasada';
    elsif v_comp is not null and v_comp < p_desde then v_riesgo := 'vencido';
    elsif v_comp is not null and v_p.fin::date > v_comp then v_riesgo := 'tarde_vs_cliente';
    elsif v_p.empujada then v_riesgo := 'empujada';
    end if;
    if v_riesgo is null then continue; end if;   -- esta sana, no se reporta

    select * into v_dur from ot_duracion(v_p.ot_id);
    v_pers := greatest(coalesce((select rf.personal_requerido from rutas_fabricacion rf
                                 where rf.articulo_id = v_art_id order by rf.secuencia limit 1), 1), 1);

    ot_id := v_p.ot_id; folio := v_p.folio; articulo_id := v_art_id;
    articulo_codigo := v_p.articulo_codigo; articulo_desc := v_p.articulo_desc;
    cantidad := v_p.cantidad; pendiente := v_p.pendiente;
    inicio := v_p.inicio; fin := v_p.fin;
    fecha_compromiso := v_comp; cliente := v_cli; saldo_release := v_saldo;
    riesgo := v_riesgo;

    -- A) cuanto alcanza antes del compromiso (no aplica si ya vencio)
    cant_que_cabe := null; v_lim := null;
    if v_comp is not null and v_comp >= coalesce(v_p.inicio::date, p_desde) then
      v_lim := ((v_comp + 1)::timestamp) at time zone v_tz;
      select coalesce(sum(
        case when v.inicio >= v_lim or v.fin <= v_p.inicio then 0
             else v.min_prod
                  * (extract(epoch from (least(v.fin, v_lim) - greatest(v.inicio, v_p.inicio)))
                     / nullif(extract(epoch from (v.fin - v.inicio)), 0))
        end), 0)
      into v_disp
      from ventanas_habiles(p_empresa_id, coalesce(v_p.inicio::date, p_desde), v_comp) v;

      if coalesce(v_dur.ciclo_seg,0) > 0 and coalesce(v_dur.eficiencia,0) > 0 then
        cant_que_cabe := floor(greatest(v_disp - coalesce(v_p.setup_min,0) - coalesce(v_p.purga_min,0), 0)
                               * 60.0 * v_dur.eficiencia / v_dur.ciclo_seg)
                         * greatest(coalesce(v_dur.cavidades,1),1);
      else cant_que_cabe := 0; end if;
    end if;

    faltante_release := case when cant_que_cabe is null then null
                        else greatest(coalesce(v_p.cantidad,0) - cant_que_cabe, 0) end;

    horas_desfase := case
      when v_riesgo = 'tarde_vs_cliente' and v_p.fin is not null and v_lim is not null
        then round(extract(epoch from (v_p.fin - v_lim)) / 3600.0, 1)
      when v_riesgo = 'vencido' then (p_desde - v_comp) * 24.0
      when v_riesgo = 'empujada' then round(coalesce(v_p.empuje_min,0) / 60.0, 1)
      else round(coalesce(v_p.total_min,0) / 60.0, 1) end;

    -- B) tiempo extra para cubrir lo que no alcanza, valuado con las tarifas
    horas_extra := case
      when coalesce(v_dur.ciclo_seg,0) > 0 and coalesce(v_dur.eficiencia,0) > 0
           and coalesce(faltante_release,0) > 0
      then round(ceil(faltante_release / greatest(coalesce(v_dur.cavidades,1),1)::numeric)
                 * v_dur.ciclo_seg / 3600.0 / v_dur.eficiencia, 1)
      else 0 end;
    costo_extra := round(horas_extra * (
        coalesce(nullif((select mq.costo_hora_hombre from maquinas mq where mq.id = p_maquina_id), 0), v_th) * v_pers
      + coalesce(nullif((select mq.costo_hora_maquina from maquinas mq where mq.id = p_maquina_id), 0), v_tm)
    ), 2);

    -- C) que OT conviene diferir: la de compromiso mas lejano en esta maquina
    select p2.ot_id, p2.folio, comp.f into mover_id, mover_folio, mover_compromiso
    from plan_maquina(p_empresa_id, p_maquina_id, p_desde, p_hasta) p2
    cross join lateral (
      select min(rl.fecha_requerida) f
      from ordenes_trabajo o2
      join release_lineas rl on rl.articulo_id = o2.articulo_id and rl.vigente
           and coalesce(rl.tipo,'firme') = 'firme'
      where o2.id = p2.ot_id
    ) comp
    where p2.ot_id <> v_p.ot_id
    order by comp.f desc nulls first, p2.posicion desc
    limit 1;

    -- D) maquina alterna autorizada en la ruta
    select mq.id, mq.clave, rma.aprobada_por_cliente
      into alterna_id, alterna_clave, alterna_aprobada
    from rutas_fabricacion rf
    join ruta_maquinas_alternas rma on rma.ruta_id = rf.id
    join maquinas mq on mq.id = rma.maquina_id
    where rf.articulo_id = v_art_id and mq.id <> p_maquina_id and mq.activo
    order by rma.aprobada_por_cliente desc nulls last, mq.clave
    limit 1;

    return next;
  end loop;
END $$;

grant execute on function opciones_recuperacion(int, int, date, date) to anon, authenticated, service_role;
