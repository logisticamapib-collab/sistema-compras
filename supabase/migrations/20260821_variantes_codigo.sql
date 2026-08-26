-- =====================================================================
-- VARIANTES DE CODIGO sobre el mismo molde.
--
-- Ya se distinguian dos casos de "varios articulos en un molde":
--
--   mismo molde + mismo color    = familia simultanea (salen del mismo disparo)
--   mismo molde + distinto color = corridas separadas, con purga entre una y otra
--
-- Faltaba un tercero, y es el mas invisible de los tres: mismo molde, MISMO
-- color, distinto codigo. El cliente manda la misma pieza a distintos paises
-- o plataformas y pide que le facturemos codigos distintos. La A del molde 1
-- nos la piden como A1 y como A2. Es la misma geometria y el mismo material;
-- lo unico que cambia es el codigo y, a veces, el empaque.
--
-- Hasta hoy esos codigos caian en la misma familia simultanea y el sistema
-- creia que salian juntos del mismo disparo. No salen: son corridas
-- separadas y hay que programarlas aparte.
--
--   mismo molde + mismo color + misma variante    = salen juntos
--   mismo molde + mismo color + distinta variante = corridas separadas, 0 min
--
-- A diferencia del color, el cambio de variante NO cuesta purga: no se toca
-- el material. Solo se cambia la documentacion del puesto de trabajo. Por eso
-- arranca en cero. Se deja capturable porque a veces cambia el empaque, y
-- cambiar de contenedor o de tarima si toma tiempo real; cuando nadie captura
-- nada se comporta exactamente igual que si el campo no existiera.
--
-- Los minutos capturados se cobran como SETUP, no como purga: lo que se
-- prepara es el puesto, no el material.
--
-- Compatibilidad: con variante_codigo_id en NULO todo agrupa igual que antes.
-- Nada de lo ya capturado cambia de comportamiento.
--
-- Lo que este cambio NO hace: A1 y A2 no se netean entre si en el MRP. La
-- demanda llega por codigo y se produce por codigo. Si para algun cliente si
-- son intercambiables, eso ya se dice con el catalogo de PARTES, que arrastra
-- el neteo y el FIFO cruzado. No se construye un segundo mecanismo para lo
-- mismo.
-- =====================================================================

create table if not exists variantes_codigo (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  clave text not null,
  nombre text not null,
  -- Para que quien captura entienda de que se trata: "Planta Brasil",
  -- "Plataforma X", "Empaque a granel".
  descripcion text,
  -- Cero por defecto: cambiar de codigo es cambiar papeles. Se captura solo
  -- cuando ademas cambia el empaque y eso cuesta tiempo de verdad.
  minutos_cambio numeric not null default 0,
  activo boolean not null default true,
  unique (empresa_id, clave)
);

alter table articulos add column if not exists variante_codigo_id int references variantes_codigo(id);
create index if not exists idx_articulos_variante on articulos(variante_codigo_id);

comment on column articulos.variante_codigo_id is
  'Distingue codigos que salen del mismo molde y el mismo color pero se piden '
  'por separado (otro pais, otra plataforma). En nulo, agrupa como siempre.';


-- ---------------------------------------------------------------------
-- Que sale del MISMO disparo
-- ---------------------------------------------------------------------
-- Se agrega la variante como tercer eje. Cambia el tipo de salida, asi que
-- hay que soltar la funcion antes: Postgres no deja cambiarle el retorno a
-- una funcion existente.
drop function if exists familia_simultanea(int, int);
create or replace function familia_simultanea(p_molde_id int, p_articulo_id int)
returns table (articulo_id int, cavidades bigint, codigo text, descripcion text,
               color_id int, variante_codigo_id int)
language sql stable as $$
  with ref as (
    select a.color_id, a.variante_codigo_id from articulos a where a.id = p_articulo_id
  )
  select mc.articulo_id, count(*)::bigint, a.codigo_interno, a.descripcion,
         a.color_id, a.variante_codigo_id
  from molde_cavidades mc
  join articulos a on a.id = mc.articulo_id
  cross join ref
  where mc.molde_id = p_molde_id and mc.activa
    and a.color_id is not distinct from ref.color_id
    and a.variante_codigo_id is not distinct from ref.variante_codigo_id
  group by mc.articulo_id, a.codigo_interno, a.descripcion, a.color_id, a.variante_codigo_id;
$$;


-- Corridas separadas del molde por variante de codigo, dentro de un mismo
-- color. Gemela de variantes_color_molde.
create or replace function variantes_codigo_molde(p_molde_id int, p_color_id int default null)
returns table (variante_codigo_id int, variante_clave text, variante_nombre text,
               minutos_cambio numeric, articulos text, num_articulos bigint)
language sql stable as $$
  select a.variante_codigo_id, v.clave, v.nombre, coalesce(v.minutos_cambio, 0),
         string_agg(distinct a.codigo_interno, ', ' order by a.codigo_interno),
         count(distinct a.id)::bigint
  from molde_cavidades mc
  join articulos a on a.id = mc.articulo_id
  left join variantes_codigo v on v.id = a.variante_codigo_id
  where mc.molde_id = p_molde_id and mc.activa
    and (p_color_id is null or a.color_id is not distinct from p_color_id)
  group by a.variante_codigo_id, v.clave, v.nombre, v.minutos_cambio
  order by v.clave nulls first;
$$;


-- ---------------------------------------------------------------------
-- Secuencia sugerida: la variante entra despues del color
-- ---------------------------------------------------------------------
-- El orden de agrupacion es molde, luego color, luego variante. El color va
-- antes porque es el unico de los tres que cuesta material: cada cambio de
-- color tira purga. Agrupar las variantes dentro del color evita ir y venir
-- con la documentacion del puesto sin ninguna ganancia.
--
-- Un cambio de variante solo se cobra si el molde NO cambio. Si cambiaste de
-- molde ya estas parando la maquina de todos modos y ese tiempo ya viene
-- contado en el cambio de molde.
drop function if exists secuencia_sugerida(int, int, date, date);
create or replace function secuencia_sugerida(
  p_empresa_id int, p_maquina_id int, p_desde date, p_hasta date
)
returns table (
  escenario text, posicion bigint,
  ot_id int, ot_folio text, fecha_programada date, turno text,
  articulo_codigo text, articulo_desc text, cantidad numeric,
  molde_id int, molde_clave text,
  color_id int, color_clave text, color_nombre text, orden_color int,
  variante_id int, variante_clave text, variante_nombre text,
  cambio_molde boolean, cambio_color boolean, cambio_variante boolean,
  min_purga numeric, kg_purga numeric, es_retroceso boolean,
  min_molde numeric, min_variante numeric
)
language sql stable as $$
with ot as (
  select o.id, o.folio, o.fecha_programada, o.turno, o.secuencia,
         o.cantidad_programada, o.molde_id, o.cambio_molde_min,
         a.codigo_interno, a.descripcion, a.color_id, a.variante_codigo_id,
         m.clave as molde_clave,
         c.clave as color_clave, c.nombre as color_nombre,
         coalesce(c.orden_secuencia, 999) as orden_color,
         v.clave as variante_clave, v.nombre as variante_nombre,
         coalesce(v.minutos_cambio, 0) as variante_min,
         min(o.fecha_programada) over (partition by o.molde_id) as campana
  from ordenes_trabajo o
  join articulos a on a.id = o.articulo_id
  left join moldes m on m.id = o.molde_id
  left join colores c on c.id = a.color_id
  left join variantes_codigo v on v.id = a.variante_codigo_id
  where o.empresa_id = p_empresa_id
    and o.maquina_id = p_maquina_id
    and o.fecha_programada between p_desde and p_hasta
    and o.estatus in ('programada', 'en_proceso')
),
ordenado as (
  select 'actual'::text as escenario, o.*,
         row_number() over (order by o.secuencia nulls last, o.fecha_programada, o.id) as pos
  from ot o
  union all
  select 'sugerido'::text, o.*,
         row_number() over (order by o.campana, o.molde_id, o.orden_color,
                                     o.variante_codigo_id nulls first,
                                     o.fecha_programada, o.id) as pos
  from ot o
),
con_previo as (
  select x.*,
         lag(x.molde_id)            over (partition by x.escenario order by x.pos) as molde_prev,
         lag(x.color_id)            over (partition by x.escenario order by x.pos) as color_prev,
         lag(x.orden_color)         over (partition by x.escenario order by x.pos) as orden_prev,
         lag(x.variante_codigo_id)  over (partition by x.escenario order by x.pos) as var_prev,
         count(*)                   over (partition by x.escenario order by x.pos
                                          rows between unbounded preceding and current row) as fila
  from ordenado x
)
select
  p.escenario, p.pos, p.id, p.folio, p.fecha_programada, p.turno,
  p.codigo_interno, p.descripcion, p.cantidad_programada,
  p.molde_id, p.molde_clave, p.color_id, p.color_clave, p.color_nombre, p.orden_color,
  p.variante_codigo_id, p.variante_clave, p.variante_nombre,
  (p.molde_prev is not null and p.molde_prev is distinct from p.molde_id),
  (p.color_prev is not null and p.color_prev is distinct from p.color_id),
  -- La primera OT de la lista no es un cambio de nada: no hay contra que
  -- comparar. Por eso se pide fila > 1 en vez de var_prev is not null, que
  -- daria falso cuando la variante anterior estaba en nulo.
  (p.fila > 1 and p.var_prev is distinct from p.variante_codigo_id),
  coalesce(cc.minutos, 0), coalesce(cc.kg, 0), coalesce(cc.es_retroceso, false),
  case when p.molde_prev is not null and p.molde_prev is distinct from p.molde_id
       then coalesce(p.cambio_molde_min, 0) else 0 end,
  case when p.fila > 1
        and p.var_prev is distinct from p.variante_codigo_id
        and p.molde_prev is not distinct from p.molde_id
       then p.variante_min else 0 end
from con_previo p
left join lateral color_cambio_costo(p_empresa_id, p.color_prev, p.color_id) cc on true
order by p.escenario desc, p.pos;
$$;


-- ---------------------------------------------------------------------
-- Capacidad finita: sumar el cambio de variante
-- ---------------------------------------------------------------------
-- plan_maquina son 6 KB y tiene tres funciones colgando de el. Se parcha
-- sobre la definicion viva en vez de reescribirla a mano, validando que cada
-- ancla exista una sola vez. Si alguna no aparece exactamente una vez, la
-- migracion se detiene sin tocar nada.
--
-- No se le cambia el tipo de salida a proposito: los minutos del cambio de
-- variante entran en setup_min, que es donde pertenecen conceptualmente
-- (se prepara el puesto, no el material) y asi las columnas siguen sumando.
DO $mig$
DECLARE
  v_def text;
  v_anclas text[][] := array[
    array[
      '  v_color_prev int := null; v_purga numeric;',
      '  v_color_prev int := null; v_purga numeric;' || E'\n' ||
      '  v_var_prev int := null; v_molde_prev int := null; v_cambio_var numeric;'
    ],
    array[
      '           a.codigo_interno, a.descripcion, a.color_id,',
      '           a.codigo_interno, a.descripcion, a.color_id, a.variante_codigo_id,'
    ],
    array[
      '    v_color_prev := coalesce(v_ot.color_id, v_color_prev);',
      '    v_color_prev := coalesce(v_ot.color_id, v_color_prev);' || E'\n\n' ||
      '    -- Cambio de codigo sin cambio de molde: solo se cambia la' || E'\n' ||
      '    -- documentacion del puesto. Cero salvo que el empaque tambien' || E'\n' ||
      '    -- cambie y alguien haya capturado cuanto cuesta.' || E'\n' ||
      '    v_cambio_var := 0;' || E'\n' ||
      '    if v_pos > 1 and v_molde_prev is not distinct from v_ot.molde_id' || E'\n' ||
      '       and v_var_prev is distinct from v_ot.variante_codigo_id then' || E'\n' ||
      '      select coalesce(vc.minutos_cambio, 0) into v_cambio_var' || E'\n' ||
      '      from variantes_codigo vc where vc.id = v_ot.variante_codigo_id;' || E'\n' ||
      '      v_cambio_var := coalesce(v_cambio_var, 0);' || E'\n' ||
      '    end if;' || E'\n' ||
      '    v_var_prev := v_ot.variante_codigo_id;' || E'\n' ||
      '    v_molde_prev := v_ot.molde_id;'
    ],
    array[
      '    v_restante := coalesce(v_dur.produccion_min,0) + coalesce(v_dur.setup_min,0) + coalesce(v_purga,0);',
      '    v_restante := coalesce(v_dur.produccion_min,0) + coalesce(v_dur.setup_min,0) + coalesce(v_purga,0) + coalesce(v_cambio_var,0);'
    ],
    array[
      '    setup_min := v_dur.setup_min; purga_min := v_purga;',
      '    setup_min := coalesce(v_dur.setup_min,0) + coalesce(v_cambio_var,0); purga_min := v_purga;'
    ],
    array[
      '    total_min := coalesce(v_dur.produccion_min,0) + coalesce(v_dur.setup_min,0) + coalesce(v_purga,0);',
      '    total_min := coalesce(v_dur.produccion_min,0) + coalesce(v_dur.setup_min,0) + coalesce(v_purga,0) + coalesce(v_cambio_var,0);'
    ]
  ];
  i int;
  v_viejo text; v_nuevo text; v_veces int;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'plan_maquina';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'No encontre plan_maquina';
  END IF;

  -- Idempotente: si ya se aplico, no hace nada.
  IF position('v_cambio_var' in v_def) > 0 THEN
    RAISE NOTICE 'plan_maquina ya trae el cambio de variante; no se toca.';
    RETURN;
  END IF;

  FOR i IN 1 .. array_length(v_anclas, 1) LOOP
    v_viejo := v_anclas[i][1];
    v_nuevo := v_anclas[i][2];
    v_veces := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
    IF v_veces <> 1 THEN
      RAISE EXCEPTION 'El ancla % aparece % veces en plan_maquina, se esperaba 1. No se toca nada. Ancla: %',
        i, v_veces, left(v_viejo, 80);
    END IF;
    v_def := replace(v_def, v_viejo, v_nuevo);
  END LOOP;

  EXECUTE v_def;
END $mig$;


-- ---------------------------------------------------------------------
-- Permisos
-- ---------------------------------------------------------------------
grant select, insert, update, delete on variantes_codigo to anon, authenticated, service_role;
grant usage, select on sequence variantes_codigo_id_seq to anon, authenticated, service_role;
grant execute on function familia_simultanea(int, int) to anon, authenticated, service_role;
grant execute on function variantes_codigo_molde(int, int) to anon, authenticated, service_role;
grant execute on function secuencia_sugerida(int, int, date, date) to anon, authenticated, service_role;

insert into modulos (clave, nombre, orden)
values ('ing_variantes_codigo', 'Variantes de codigo', 45) on conflict (clave) do nothing;

-- Mismos roles que el catalogo de colores: lo edita Ingenieria, lo consulta
-- quien programa.
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r.rol, m.id, true, r.edita, r.edita, r.edita, false
from modulos m
cross join (values
  ('admin', true), ('ingenieria', true), ('gerente_planta', true),
  ('gerente_produccion', false), ('produccion', false), ('planeacion', false),
  ('gerente_logistica', false), ('logistica', false),
  ('gerente_calidad', false), ('calidad', false), ('direccion', false)
) as r(rol, edita)
where m.clave = 'ing_variantes_codigo'
and not exists (select 1 from permisos_rol p where p.rol = r.rol and p.modulo_id = m.id);
