-- =====================================================================
-- Programacion con CAPACIDAD FINITA.
--
-- Hasta ahora la OT vivia en un cubo (fecha + turno) sin duracion, por eso
-- se podian encimar varias OT el mismo dia. Ahora cada OT tiene un inicio y
-- un fin calculados sobre el calendario laboral real.
--
--   duracion = (cantidad pendiente / cavidades) x ciclo del disparo
--              / eficiencia + cambio de molde + purga por cambio de color
--
-- Criterios acordados:
--   - La maquina corre CONTINUO entre turnos: una OT puede cruzar de turno.
--   - La eficiencia sale del OEE historico de esa misma maquina, con un
--     default configurable mientras no haya historia y un piso para evitar
--     duraciones absurdas.
--   - Cada OT arranca en el MAYOR de dos momentos: su turno programado, o
--     el instante en que la anterior libera la maquina. Si la anterior se
--     pasa de largo, esta queda marcada como EMPUJADA.
--   - Al traslapar se BLOQUEA, y el mensaje calcula a cuantas piezas habria
--     que reducir la OT que estorba o a que hora habria que cerrarla.
-- =====================================================================

alter table ordenes_trabajo add column if not exists inicio_plan timestamptz;
alter table ordenes_trabajo add column if not exists fin_plan timestamptz;
alter table ordenes_trabajo add column if not exists duracion_plan_min numeric;

create table if not exists programacion_parametros (
  empresa_id int primary key references empresas(id) on delete cascade,
  eficiencia_default numeric not null default 75,
  eficiencia_minima numeric not null default 40,
  semanas_historia int not null default 4,
  bloquea_traslape boolean not null default true,
  updated_at timestamptz default now(),
  updated_by uuid references usuarios(id)
);
insert into programacion_parametros (empresa_id) select id from empresas
on conflict (empresa_id) do nothing;

do $mig$ begin
  if not exists (select 1 from pg_type where typname = 'ventana_habil') then
    create type ventana_habil as (
      fecha date, turno text, turno_nombre text, orden int,
      inicio timestamptz, fin timestamptz, min_prod numeric
    );
  end if;
end $mig$;


-- Eficiencia con la que se programa una maquina (0..1). Sale del OEE real
-- de las ultimas semanas; sin historia usa el default y nunca baja del piso.
create or replace function eficiencia_maquina(p_empresa_id int, p_maquina_id int)
returns numeric language sql stable as $$
  with par as (select * from programacion_parametros where empresa_id = p_empresa_id),
  d as (
    select sum(o.min_operativo) op, sum(o.min_programados) prog,
           sum(o.min_ideales) ide, sum(o.piezas_ok) ok, sum(o.piezas_scrap) sc
    from oee_detalle(
           p_empresa_id,
           current_date - ((select semanas_historia from par) * 7),
           current_date, null, 'programadas') o
    where o.maquina_id = p_maquina_id
  )
  select greatest(
           coalesce(
             case when d.prog > 0 and d.op > 0 and d.ide > 0 and (d.ok + d.sc) > 0
                  then (d.op / d.prog) * (d.ide / d.op) * (d.ok / (d.ok + d.sc))
             end,
             (select eficiencia_default from par) / 100.0),
           (select eficiencia_minima from par) / 100.0)
  from d;
$$;

-- Ventanas de tiempo habiles: un renglon por dia y turno, con hora real de
-- inicio y fin y los minutos productivos que aporta. El sabado de 15 h abre
-- 2 turnos y entre semana los 3, igual que el OEE.
create or replace function ventanas_habiles(p_empresa_id int, p_desde date, p_hasta date)
returns table (fecha date, turno text, turno_nombre text, orden int,
               inicio timestamptz, fin timestamptz, min_prod numeric)
language sql stable as $$
with tz as (
  select coalesce(zona_horaria, 'America/Mexico_City') z from empresas where id = p_empresa_id
),
tur as (
  select t.clave, t.nombre, t.orden, t.hora_inicio, t.hora_fin, t.horas_efectivas,
         -- duracion de reloj del turno; si cruza medianoche se le suman 24 h
         (t.hora_fin - t.hora_inicio)
           + case when t.hora_fin < t.hora_inicio then interval '24 hours'
                  else interval '0' end as span,
         sum(t.horas_efectivas) over (order by t.orden
             rows between unbounded preceding and current row) acum
  from turnos t where t.empresa_id = p_empresa_id and t.activo
),
dias as (
  select d::date f, c.horas_efectivas horas_dia
  from generate_series(p_desde, p_hasta, interval '1 day') d
  join mrp_calendario c on c.empresa_id = p_empresa_id
       and c.dia_semana = extract(isodow from d)::int
  where c.trabaja and coalesce(c.horas_efectivas, 0) > 0
)
select d.f, t.clave, t.nombre, t.orden,
       ((d.f + t.hora_inicio) at time zone (select z from tz)),
       ((d.f + t.hora_inicio) at time zone (select z from tz)) + t.span,
       t.horas_efectivas * 60
from dias d
join tur t on t.acum <= d.horas_dia + 0.001
order by d.f, t.orden;
$$;

-- Duracion de una OT en minutos productivos. No incluye la purga por cambio
-- de color porque depende de cual OT corrio antes; esa la suma el motor.
create or replace function ot_duracion(p_ot_id int)
returns table (pendiente numeric, cavidades int, ciclo_seg numeric,
               eficiencia numeric, produccion_min numeric, setup_min numeric)
language sql stable as $$
  select
    greatest(coalesce(o.cantidad_programada,0) - coalesce(o.cantidad_producida,0), 0),
    greatest(coalesce(mo.num_cavidades, 1), 1),
    coalesce(rt.tiempo_estandar_seg, 0),
    ef.e,
    case when coalesce(rt.tiempo_estandar_seg,0) > 0 and ef.e > 0
         then ceil(greatest(coalesce(o.cantidad_programada,0) - coalesce(o.cantidad_producida,0), 0)
                   / greatest(coalesce(mo.num_cavidades,1),1)::numeric)
              * rt.tiempo_estandar_seg / 60.0 / ef.e
         else 0 end,
    coalesce(o.cambio_molde_min, 0)
  from ordenes_trabajo o
  left join moldes mo on mo.id = o.molde_id
  left join lateral (
    select rf.tiempo_estandar_seg
    from rutas_fabricacion rf
    where rf.articulo_id = o.articulo_id and coalesce(rf.tiempo_estandar_seg,0) > 0
    order by (rf.maquina_principal_id = o.maquina_id) desc nulls last, rf.secuencia
    limit 1
  ) rt on true
  left join lateral (select eficiencia_maquina(o.empresa_id, o.maquina_id) e) ef on true
  where o.id = p_ot_id;
$$;

-- ---------------------------------------------------------------------
-- Motor: acomoda las OT de una maquina, una tras otra, sobre las ventanas.
-- Cada OT arranca en el mayor de su turno programado y del fin de la
-- anterior; si la anterior invade su turno, queda marcada como EMPUJADA.
-- ---------------------------------------------------------------------
create or replace function plan_maquina(
  p_empresa_id int, p_maquina_id int, p_desde date, p_hasta date,
  p_excluir_ot int default null
)
returns table (
  posicion int, ot_id int, folio text, estatus text,
  articulo_codigo text, articulo_desc text,
  molde_id int, molde_clave text, color_id int, color_clave text,
  cantidad numeric, pendiente numeric,
  setup_min numeric, purga_min numeric, produccion_min numeric, total_min numeric,
  eficiencia numeric,
  inicio timestamptz, fin timestamptz,
  inicio_solicitado timestamptz, empujada boolean, empuje_min numeric,
  fecha_prog date, turno_prog text,
  turnos_ocupados text, cabe boolean, atrasada boolean
)
language plpgsql stable as $$
DECLARE
  v_ot record; v_dur record;
  v_ventanas ventana_habil[]; v_ven ventana_habil;
  v_i int := 0; v_n int := 0; v_j int;
  v_libre numeric := 0;
  v_ini timestamptz; v_fin timestamptz; v_solic timestamptz;
  v_restante numeric; v_toma numeric;
  v_color_prev int := null; v_purga numeric;
  v_pos int := 0; v_turnos text; v_cabe boolean; v_frac numeric;
BEGIN
  -- horizonte ampliado para que una OT larga termine de acomodarse
  select array_agg(row(v.fecha, v.turno, v.turno_nombre, v.orden,
                       v.inicio, v.fin, v.min_prod)::ventana_habil
                   order by v.fecha, v.orden)
    into v_ventanas
  from ventanas_habiles(p_empresa_id, p_desde, p_hasta + 60) v;

  v_n := coalesce(array_length(v_ventanas, 1), 0);
  if v_n = 0 then return; end if;

  for v_ot in
    select o.id, o.folio, o.estatus, o.molde_id, o.cantidad_programada,
           o.fecha_programada, o.turno, o.secuencia,
           a.codigo_interno, a.descripcion, a.color_id,
           m.clave molde_clave, c.clave color_clave
    from ordenes_trabajo o
    join articulos a on a.id = o.articulo_id
    left join moldes m on m.id = o.molde_id
    left join colores c on c.id = a.color_id
    where o.empresa_id = p_empresa_id
      and o.maquina_id = p_maquina_id
      and o.fecha_programada between p_desde and p_hasta
      and o.estatus in ('programada', 'en_proceso')
      and (p_excluir_ot is null or o.id <> p_excluir_ot)
    order by o.fecha_programada, o.secuencia nulls last, o.id
  loop
    v_pos := v_pos + 1;
    select * into v_dur from ot_duracion(v_ot.id);

    v_purga := 0;
    if v_color_prev is not null and v_ot.color_id is distinct from v_color_prev then
      select coalesce(minutos, 0) into v_purga
      from color_cambio_costo(p_empresa_id, v_color_prev, v_ot.color_id);
    end if;
    v_color_prev := coalesce(v_ot.color_id, v_color_prev);

    v_restante := coalesce(v_dur.produccion_min,0) + coalesce(v_dur.setup_min,0) + coalesce(v_purga,0);
    v_ini := null; v_fin := null; v_turnos := ''; v_cabe := true; v_solic := null;

    v_j := null;
    select min(i) into v_j from generate_series(1, v_n) i
    where (v_ventanas[i]).fecha = v_ot.fecha_programada
      and (v_ventanas[i]).turno = v_ot.turno;
    if v_j is null then
      select min(i) into v_j from generate_series(1, v_n) i
      where (v_ventanas[i]).fecha >= v_ot.fecha_programada;
    end if;
    if v_j is null then v_j := v_n; end if;
    v_solic := (v_ventanas[v_j]).inicio;

    if v_j > v_i then
      v_i := v_j; v_libre := (v_ventanas[v_i]).min_prod;
    end if;
    while v_i <= v_n and v_libre <= 0.0001 loop
      v_i := v_i + 1;
      if v_i <= v_n then v_libre := (v_ventanas[v_i]).min_prod; end if;
    end loop;

    if v_i > v_n then
      v_cabe := false;
    else
      v_ven := v_ventanas[v_i];
      v_frac := (v_ven.min_prod - v_libre) / nullif(v_ven.min_prod, 0);
      v_ini := v_ven.inicio + (v_ven.fin - v_ven.inicio) * coalesce(v_frac, 0);
      v_fin := v_ini;

      while v_restante > 0.0001 and v_i <= v_n loop
        v_ven := v_ventanas[v_i];
        v_toma := least(v_restante, v_libre);
        v_restante := v_restante - v_toma;
        v_libre := v_libre - v_toma;
        if v_turnos = '' or v_turnos not like '%' || to_char(v_ven.fecha,'DD/MM') || ' ' || v_ven.turno || '%' then
          v_turnos := v_turnos || case when v_turnos = '' then '' else ', ' end
                      || to_char(v_ven.fecha, 'DD/MM') || ' ' || v_ven.turno;
        end if;
        v_frac := (v_ven.min_prod - v_libre) / nullif(v_ven.min_prod, 0);
        v_fin := v_ven.inicio + (v_ven.fin - v_ven.inicio) * coalesce(v_frac, 0);
        if v_libre <= 0.0001 and v_restante > 0.0001 then
          v_i := v_i + 1;
          if v_i <= v_n then v_libre := (v_ventanas[v_i]).min_prod; else v_cabe := false; end if;
        end if;
      end loop;
    end if;

    posicion := v_pos; ot_id := v_ot.id; folio := v_ot.folio; estatus := v_ot.estatus;
    articulo_codigo := v_ot.codigo_interno; articulo_desc := v_ot.descripcion;
    molde_id := v_ot.molde_id; molde_clave := v_ot.molde_clave;
    color_id := v_ot.color_id; color_clave := v_ot.color_clave;
    cantidad := v_ot.cantidad_programada; pendiente := v_dur.pendiente;
    setup_min := v_dur.setup_min; purga_min := v_purga;
    produccion_min := v_dur.produccion_min;
    total_min := coalesce(v_dur.produccion_min,0) + coalesce(v_dur.setup_min,0) + coalesce(v_purga,0);
    eficiencia := v_dur.eficiencia;
    inicio := v_ini; fin := v_fin;
    inicio_solicitado := v_solic;
    empujada := (v_ini is not null and v_solic is not null and v_ini > v_solic + interval '1 minute');
    empuje_min := case when v_ini is not null and v_solic is not null
                       then round(greatest(extract(epoch from (v_ini - v_solic)) / 60.0, 0))
                       else 0 end;
    fecha_prog := v_ot.fecha_programada; turno_prog := v_ot.turno;
    turnos_ocupados := v_turnos; cabe := v_cabe;
    atrasada := (v_fin is not null and v_fin < now() and v_ot.estatus <> 'cerrada');
    return next;
  end loop;
END $$;


-- ---------------------------------------------------------------------
-- Candado: si el turno no esta libre, no basta con avisar. Distingue si la
-- OT que estorba viene arrastrada de antes (se puede acortar) o si el turno
-- ya esta asignado a otra OT que arranca ahi (hay que moverla o cerrarla).
-- ---------------------------------------------------------------------
create or replace function validar_traslape(
  p_empresa_id int, p_maquina_id int, p_fecha date, p_turno text,
  p_ot_id int default null
)
returns table (
  cabe boolean, mensaje text,
  ot_bloq_id int, ot_bloq_folio text, ot_bloq_cantidad numeric,
  cantidad_sugerida numeric, libera_en timestamptz, minutos_faltantes numeric
)
language plpgsql stable as $$
DECLARE
  v_ini timestamptz; v_ult record; v_disp numeric; v_dur record; v_sug numeric;
  v_tz text; v_desde date;
BEGIN
  select coalesce(zona_horaria,'America/Mexico_City') into v_tz from empresas where id = p_empresa_id;

  select v.inicio into v_ini
  from ventanas_habiles(p_empresa_id, p_fecha, p_fecha) v
  where v.turno = p_turno limit 1;

  if v_ini is null then
    cabe := false;
    mensaje := 'Ese dia y turno no son habiles segun el calendario laboral del MRP.';
    return next; return;
  end if;

  -- el plan arranca en la OT abierta mas antigua de la maquina, no en el
  -- rango consultado, para que el resultado sea siempre el mismo
  select least(coalesce(min(o.fecha_programada), p_fecha), p_fecha) into v_desde
  from ordenes_trabajo o
  where o.empresa_id = p_empresa_id and o.maquina_id = p_maquina_id
    and o.estatus in ('programada','en_proceso');

  select * into v_ult
  from plan_maquina(p_empresa_id, p_maquina_id, v_desde, p_fecha, p_ot_id) p
  where p.fin > v_ini
  order by p.posicion
  limit 1;

  if v_ult.ot_id is null then
    cabe := true;
    mensaje := 'La maquina esta libre en ese turno.';
    return next; return;
  end if;

  ot_bloq_id := v_ult.ot_id;
  ot_bloq_folio := v_ult.folio;
  ot_bloq_cantidad := v_ult.cantidad;
  libera_en := v_ult.fin;
  minutos_faltantes := round(extract(epoch from (v_ult.fin - v_ini)) / 60.0);
  cabe := false;

  if v_ult.inicio >= v_ini - interval '1 minute' then
    cantidad_sugerida := null;
    mensaje := format(
      'Ese turno ya esta asignado a la OT %s, que corre del %s al %s. Si quieres meter otra OT ahi, primero mueve o cierra la %s.',
      v_ult.folio,
      to_char(v_ult.inicio at time zone v_tz, 'DD/MM HH24:MI'),
      to_char(v_ult.fin at time zone v_tz, 'DD/MM HH24:MI'),
      v_ult.folio);
    return next; return;
  end if;

  select coalesce(sum(
    case when v.inicio >= v_ini or v.fin <= v_ult.inicio then 0
         else v.min_prod
              * (extract(epoch from (least(v.fin, v_ini) - greatest(v.inicio, v_ult.inicio)))
                 / nullif(extract(epoch from (v.fin - v.inicio)), 0))
    end), 0)
  into v_disp
  from ventanas_habiles(p_empresa_id, v_desde, p_fecha) v;

  select * into v_dur from ot_duracion(v_ult.ot_id);

  v_sug := 0;
  if coalesce(v_dur.ciclo_seg,0) > 0 and coalesce(v_dur.eficiencia,0) > 0 then
    v_sug := floor(
      greatest(v_disp - coalesce(v_ult.setup_min,0) - coalesce(v_ult.purga_min,0), 0)
      * 60.0 * v_dur.eficiencia / v_dur.ciclo_seg
    ) * greatest(coalesce(v_dur.cavidades,1),1);
  end if;

  cantidad_sugerida := greatest(v_sug, 0);
  mensaje := format(
    'La OT %s ocupa esta maquina hasta el %s. Para poder programar en el turno %s del %s tendrias que reducir la OT %s de %s a %s piezas, o cerrarla antes de esa hora.',
    v_ult.folio,
    to_char(v_ult.fin at time zone v_tz, 'DD/MM HH24:MI'),
    p_turno, to_char(p_fecha, 'DD/MM'),
    v_ult.folio,
    to_char(coalesce(v_ult.cantidad,0), 'FM999,999,999'),
    to_char(greatest(v_sug,0), 'FM999,999,999'));
  return next;
END $$;

grant execute on function eficiencia_maquina(int, int) to anon, authenticated, service_role;
grant execute on function ventanas_habiles(int, date, date) to anon, authenticated, service_role;
grant execute on function ot_duracion(int) to anon, authenticated, service_role;
grant execute on function plan_maquina(int, int, date, date, int) to anon, authenticated, service_role;
grant execute on function validar_traslape(int, int, date, text, int) to anon, authenticated, service_role;
grant select, insert, update on programacion_parametros to anon, authenticated, service_role;
