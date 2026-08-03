-- =====================================================================
-- Cavidades tapadas.
--
-- Una cavidad se puede tapar por dano o para balancear los sets. Cuando eso
-- pasa el molde entrega menos piezas por disparo, asi que el tiempo por
-- pieza SUBE y la OT se alarga.
--
-- Hasta ahora el plan, el costeo y la duracion usaban moldes.num_cavidades
-- (el conteo NOMINAL de diseno). Eso tenia dos defectos:
--   1. Con una cavidad tapada subestimaban el tiempo y la OT se alargaba en
--      el piso sin que nadie lo viera venir.
--   2. En un MOLDE FAMILIAR dividian entre TODAS las cavidades del molde,
--      cuando el articulo de la OT solo ocupa algunas. Un molde de 4 con 2
--      cavidades por articulo estaba subestimando el tiempo a la MITAD.
--
-- Criterio adoptado:
--   - Plan de capacidad y costeo -> cavidades ACTIVAS DEL ARTICULO.
--   - OEE -> cavidades NOMINALES. Correr con una cavidad tapada es una
--     perdida de capacidad y debe verse como caida de desempeno, no
--     esconderse re-basificando el estandar.
-- =====================================================================

alter table molde_cavidades add column if not exists motivo_bloqueo text;
alter table molde_cavidades add column if not exists bloqueada_at timestamptz;
alter table molde_cavidades add column if not exists bloqueada_por uuid references usuarios(id);

-- Cavidades fisicas ACTIVAS de un molde. Se cuentan numeros de cavidad
-- distintos porque con las variantes de color una misma cavidad tiene un
-- renglon por cada color y contar renglones inflaria el resultado.
create or replace function cavidades_activas(p_molde_id int)
returns int language sql stable as $$
  select coalesce(count(distinct mc.numero_cavidad), 0)::int
  from molde_cavidades mc
  where mc.molde_id = p_molde_id and mc.activa and mc.articulo_id is not null;
$$;

-- Cavidades activas que producen un articulo en particular. En un molde
-- familiar el izquierdo y el derecho ocupan cavidades distintas.
create or replace function cavidades_activas_articulo(p_molde_id int, p_articulo_id int)
returns int language sql stable as $$
  select coalesce(count(distinct mc.numero_cavidad), 0)::int
  from molde_cavidades mc
  where mc.molde_id = p_molde_id and mc.activa and mc.articulo_id = p_articulo_id;
$$;

-- Tapar o liberar una cavidad completa (todos sus colores a la vez).
create or replace function bloquear_cavidad(
  p_molde_id int, p_numero_cavidad int, p_bloquear boolean,
  p_motivo text default null, p_usuario uuid default null
)
returns int language plpgsql as $$
DECLARE v_n int;
BEGIN
  update molde_cavidades set
    activa = not p_bloquear,
    motivo_bloqueo = case when p_bloquear then p_motivo else null end,
    bloqueada_at   = case when p_bloquear then now() else null end,
    bloqueada_por  = case when p_bloquear then p_usuario else null end
  where molde_id = p_molde_id and numero_cavidad = p_numero_cavidad;
  get diagnostics v_n = row_count;
  return v_n;
END $$;

-- Duracion de la OT con cavidades activas del articulo
drop function if exists ot_duracion(int);
create or replace function ot_duracion(p_ot_id int)
returns table (pendiente numeric, cavidades int, cavidades_nominales int,
               ciclo_seg numeric, eficiencia numeric,
               produccion_min numeric, setup_min numeric)
language sql stable as $$
  select
    greatest(coalesce(o.cantidad_programada,0) - coalesce(o.cantidad_producida,0), 0),
    cav.efectivas,
    greatest(coalesce(mo.num_cavidades, 1), 1),
    coalesce(rt.tiempo_estandar_seg, 0),
    ef.e,
    case when coalesce(rt.tiempo_estandar_seg,0) > 0 and ef.e > 0
         then ceil(greatest(coalesce(o.cantidad_programada,0) - coalesce(o.cantidad_producida,0), 0)
                   / cav.efectivas::numeric)
              * rt.tiempo_estandar_seg / 60.0 / ef.e
         else 0 end,
    coalesce(o.cambio_molde_min, 0)
  from ordenes_trabajo o
  left join moldes mo on mo.id = o.molde_id
  left join lateral (
    select greatest(
             coalesce(nullif(cavidades_activas_articulo(o.molde_id, o.articulo_id), 0),
                      nullif(cavidades_activas(o.molde_id), 0),
                      mo.num_cavidades, 1), 1) as efectivas
  ) cav on true
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

grant execute on function cavidades_activas(int) to anon, authenticated, service_role;
grant execute on function cavidades_activas_articulo(int, int) to anon, authenticated, service_role;
grant execute on function bloquear_cavidad(int, int, boolean, text, uuid) to anon, authenticated, service_role;
grant execute on function ot_duracion(int) to anon, authenticated, service_role;

-- NOTA: costo_std_unitario y costeo_ot tambien pasaron a cavidades activas
-- del articulo; su definicion completa esta en la migracion
-- 20260802_costeo_real_vs_estandar.sql con este mismo criterio aplicado.
