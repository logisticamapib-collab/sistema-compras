-- =====================================================================
-- OEE formal por maquina y turno.
--   Disponibilidad = (Tiempo programado - Paros) / Tiempo programado
--   Desempeno      = Minutos ideales / Tiempo operativo
--   Calidad        = Piezas OK / Piezas totales
-- El tiempo programado sale del calendario laboral del MRP (mrp_calendario)
-- cruzado con los turnos activos. El cambio de molde cuenta como paro
-- (perdida por setup). El mantenimiento preventivo se marca como planeado
-- y se descuenta del tiempo programado en lugar de castigar el OEE.
-- =====================================================================

-- Zona horaria de la empresa: la base guarda en UTC y el 3er turno cruza
-- medianoche, asi que sin esto la produccion se atribuiria al dia equivocado.
alter table empresas add column if not exists zona_horaria text not null default 'America/Mexico_City';

-- Clasificacion de cada causa de paro en las seis grandes perdidas.
alter table causas_paro add column if not exists categoria_oee text not null default 'falla';
alter table causas_paro drop constraint if exists causas_paro_categoria_oee_check;
alter table causas_paro add constraint causas_paro_categoria_oee_check
  check (categoria_oee in ('falla','setup','espera','calidad','planeado'));

update causas_paro set categoria_oee = case upper(clave)
  when 'CAM' then 'setup'      -- cambio de molde: perdida por preparacion
  when 'MTO' then 'planeado'   -- preventivo programado: se descuenta del tiempo
  when 'FAL' then 'falla'
  when 'SER' then 'falla'
  when 'MAT' then 'espera'
  when 'PER' then 'espera'
  when 'CAL' then 'calidad'
  else categoria_oee end;

create table if not exists oee_parametros (
  empresa_id int primary key references empresas(id) on delete cascade,
  base_tiempo text not null default 'programadas'
    check (base_tiempo in ('programadas','calendario')),
  meta_oee numeric not null default 85,
  meta_disponibilidad numeric not null default 90,
  meta_desempeno numeric not null default 95,
  meta_calidad numeric not null default 99,
  updated_at timestamptz default now(),
  updated_by uuid references usuarios(id)
);

insert into oee_parametros (empresa_id)
select id from empresas on conflict (empresa_id) do nothing;


-- ---------------------------------------------------------------------
-- Detalle granular por maquina / fecha / turno. Devuelve los COMPONENTES
-- (minutos y piezas), no los porcentajes, para que se puedan sumar y
-- despues dividir al agrupar por dia, semana, mes, turno o maquina.
-- ---------------------------------------------------------------------
create or replace function oee_detalle(
  p_empresa_id int,
  p_desde date,
  p_hasta date,
  p_site_id int default null,
  p_base text default null
)
returns table (
  fecha date, turno text, turno_nombre text,
  maquina_id int, maquina text, site_id int,
  min_calendario numeric, min_planeado numeric, min_programados numeric,
  min_falla numeric, min_setup numeric, min_espera numeric, min_calidad_paro numeric,
  min_paro numeric, min_operativo numeric, min_ideales numeric,
  piezas_ok numeric, piezas_scrap numeric,
  ots text
)
language sql stable as $$
with cfg as (
  select coalesce(p_base,
           (select base_tiempo from oee_parametros where empresa_id = p_empresa_id),
           'programadas') as base,
         coalesce((select zona_horaria from empresas where id = p_empresa_id),
           'America/Mexico_City') as tz
),
-- turnos activos con horas acumuladas, para saber cuantos corren cada dia
tur as (
  select t.clave, t.nombre, t.horas_efectivas, t.orden, t.hora_inicio, t.hora_fin,
         sum(t.horas_efectivas) over (order by t.orden
             rows between unbounded preceding and current row) as acum
  from turnos t
  where t.empresa_id = p_empresa_id and t.activo
),
-- dias habiles del rango segun el calendario laboral del MRP
dias as (
  select d::date as f, c.horas_efectivas as horas_dia
  from generate_series(p_desde, p_hasta, interval '1 day') d
  join mrp_calendario c on c.empresa_id = p_empresa_id
       and c.dia_semana = extract(isodow from d)::int
  where c.trabaja and coalesce(c.horas_efectivas, 0) > 0
),
-- sabado con 15 h solo abre 2 turnos de 7.5; entre semana 22.5 abre los 3
turnos_dia as (
  select d.f as fecha, t.clave as turno, t.nombre as turno_nombre,
         t.horas_efectivas * 60 as min_turno
  from dias d
  join tur t on t.acum <= d.horas_dia + 0.001
),
maq as (
  select m.id, m.nombre, m.site_id
  from maquinas m
  where m.empresa_id = p_empresa_id and m.activo
    and (p_site_id is null or m.site_id = p_site_id)
),
-- produccion atribuida a su fecha-turno real (el 3er turno cruza medianoche)
prod as (
  select ot.maquina_id,
    (case when tt.hora_fin < tt.hora_inicio
            and ((r.fecha at time zone (select tz from cfg))::time) < tt.hora_fin
          then ((r.fecha at time zone (select tz from cfg))::date - 1)
          else  ((r.fecha at time zone (select tz from cfg))::date) end) as fecha,
    coalesce(r.turno, ot.turno) as turno,
    -- ot_reportes.cantidad_ok ya trae el TOTAL de todos los articulos del
    -- molde familiar; ot_reporte_articulos es solo el desglose. No se suman.
    sum(coalesce(r.cantidad_ok, 0)) as ok,
    sum(coalesce(r.cantidad_scrap, 0)) as scrap,
    sum((coalesce(r.cantidad_ok,0) + coalesce(r.cantidad_scrap,0))
        * coalesce(ci.ciclo_seg, 0)) / 60.0 as min_ideales,
    string_agg(distinct ot.folio, ', ') as ots
  from ot_reportes r
  join ordenes_trabajo ot on ot.id = r.ot_id
  left join turnos tt on tt.empresa_id = p_empresa_id
       and tt.clave = coalesce(r.turno, ot.turno)
  left join lateral (
    -- ciclo ideal POR PIEZA = ciclo del disparo / cavidades del molde
    select (rf.tiempo_estandar_seg
            / greatest(coalesce(mo.num_cavidades, 1), 1)::numeric) as ciclo_seg
    from rutas_fabricacion rf
    left join moldes mo on mo.id = coalesce(ot.molde_id, rf.molde_id)
    where rf.articulo_id = ot.articulo_id
      and coalesce(rf.tiempo_estandar_seg, 0) > 0
    order by (rf.maquina_principal_id = ot.maquina_id) desc nulls last, rf.secuencia
    limit 1
  ) ci on true
  where ot.empresa_id = p_empresa_id
  group by 1, 2, 3
),
-- paros atribuidos igual, clasificados por categoria
paros as (
  select ot.maquina_id,
    (case when tt.hora_fin < tt.hora_inicio
            and ((pa.fecha at time zone (select tz from cfg))::time) < tt.hora_fin
          then ((pa.fecha at time zone (select tz from cfg))::date - 1)
          else  ((pa.fecha at time zone (select tz from cfg))::date) end) as fecha,
    coalesce(pa.turno, ot.turno) as turno,
    sum(case when cp.categoria_oee = 'falla'    then pa.minutos else 0 end) as m_falla,
    sum(case when cp.categoria_oee = 'setup'    then pa.minutos else 0 end) as m_setup,
    sum(case when cp.categoria_oee = 'espera'   then pa.minutos else 0 end) as m_espera,
    sum(case when cp.categoria_oee = 'calidad'  then pa.minutos else 0 end) as m_calidad,
    sum(case when cp.categoria_oee = 'planeado' then pa.minutos else 0 end) as m_planeado
  from ot_paros pa
  join ordenes_trabajo ot on ot.id = pa.ot_id
  left join causas_paro cp on cp.id = pa.causa_id
  left join turnos tt on tt.empresa_id = p_empresa_id
       and tt.clave = coalesce(pa.turno, ot.turno)
  where ot.empresa_id = p_empresa_id
  group by 1, 2, 3
),
-- OT programadas: define el universo cuando la base es 'programadas'
prog as (
  select distinct ot.maquina_id, ot.fecha_programada as fecha, ot.turno
  from ordenes_trabajo ot
  where ot.empresa_id = p_empresa_id
    and ot.fecha_programada between p_desde and p_hasta
    and ot.estatus <> 'cancelada'
),
universo as (
  select td.fecha, td.turno, td.turno_nombre, td.min_turno,
         m.id as maquina_id, m.nombre as maquina, m.site_id
  from turnos_dia td
  cross join maq m
  where (select base from cfg) = 'calendario'
     or exists (select 1 from prog  x where x.maquina_id = m.id and x.fecha = td.fecha and x.turno = td.turno)
     or exists (select 1 from prod  x where x.maquina_id = m.id and x.fecha = td.fecha and x.turno = td.turno)
     or exists (select 1 from paros x where x.maquina_id = m.id and x.fecha = td.fecha and x.turno = td.turno)
)
select
  u.fecha, u.turno, u.turno_nombre, u.maquina_id, u.maquina, u.site_id,
  u.min_turno,
  coalesce(pa.m_planeado, 0),
  greatest(u.min_turno - coalesce(pa.m_planeado, 0), 0) as min_programados,
  coalesce(pa.m_falla, 0), coalesce(pa.m_setup, 0),
  coalesce(pa.m_espera, 0), coalesce(pa.m_calidad, 0),
  coalesce(pa.m_falla,0) + coalesce(pa.m_setup,0) + coalesce(pa.m_espera,0) + coalesce(pa.m_calidad,0) as min_paro,
  greatest(
    greatest(u.min_turno - coalesce(pa.m_planeado,0), 0)
    - (coalesce(pa.m_falla,0) + coalesce(pa.m_setup,0) + coalesce(pa.m_espera,0) + coalesce(pa.m_calidad,0)),
    0) as min_operativo,
  coalesce(pr.min_ideales, 0),
  coalesce(pr.ok, 0), coalesce(pr.scrap, 0),
  coalesce(pr.ots, '')
from universo u
left join prod  pr on pr.maquina_id = u.maquina_id and pr.fecha = u.fecha and pr.turno = u.turno
left join paros pa on pa.maquina_id = u.maquina_id and pa.fecha = u.fecha and pa.turno = u.turno
order by u.fecha, u.turno, u.maquina;
$$;

grant execute on function oee_detalle(int, date, date, int, text) to anon, authenticated, service_role;
grant select, insert, update on oee_parametros to anon, authenticated, service_role;
