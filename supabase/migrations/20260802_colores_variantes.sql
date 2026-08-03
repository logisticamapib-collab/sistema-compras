-- =====================================================================
-- Variantes de COLOR sobre el mismo molde.
--
-- Hoy la "familia de molde" se deriva de molde_cavidades: todos los
-- articulos que comparten molde se consideran co-productos del MISMO
-- disparo (izquierdo + derecho). Eso es correcto para LH/RH, pero NO para
-- variantes de color: mismo molde, corridas SEPARADAS con purga entre una
-- y otra.
--
--   mismo molde + mismo color    = familia simultanea (salen juntos)
--   mismo molde + distinto color = variantes secuenciales (una tras otra)
--
-- Compatibilidad: con color_id en NULO todos los articulos caen en el mismo
-- grupo y el comportamiento es identico al anterior.
-- =====================================================================

create table if not exists colores (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  clave text not null,
  nombre text not null,
  hex text,
  -- menor = mas claro. Se corre de claro a oscuro porque regresar a un
  -- color claro exige mucha mas purga.
  orden_secuencia int not null default 50,
  es_dificil_purga boolean not null default false,
  activo boolean not null default true,
  unique (empresa_id, clave)
);

alter table articulos add column if not exists color_id int references colores(id);
create index if not exists idx_articulos_color on articulos(color_id);

create table if not exists color_parametros (
  empresa_id int primary key references empresas(id) on delete cascade,
  min_purga_base numeric not null default 10,
  min_por_paso numeric not null default 0.4,
  kg_purga_base numeric not null default 2,
  kg_por_paso numeric not null default 0.12,
  factor_retroceso numeric not null default 2.5,
  factor_dificil numeric not null default 1.6,
  updated_at timestamptz default now(),
  updated_by uuid references usuarios(id)
);
insert into color_parametros (empresa_id) select id from empresas
on conflict (empresa_id) do nothing;

-- Overrides explicitos para pares que no siguen la regla general
create table if not exists color_cambios (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  color_origen_id int not null references colores(id) on delete cascade,
  color_destino_id int not null references colores(id) on delete cascade,
  minutos_purga numeric not null default 0,
  kg_purga numeric not null default 0,
  notas text,
  unique (empresa_id, color_origen_id, color_destino_id)
);

-- Una cavidad fisica produce siempre la misma geometria, pero el codigo de
-- articulo cambia con el color. Por eso la cavidad debe poder apuntar a
-- varios articulos: uno por color.
alter table molde_cavidades drop constraint if exists molde_cavidades_molde_id_numero_cavidad_key;
create unique index if not exists molde_cavidades_unq
  on molde_cavidades (molde_id, numero_cavidad, articulo_id) where articulo_id is not null;
create unique index if not exists molde_cavidades_vacia_unq
  on molde_cavidades (molde_id, numero_cavidad) where articulo_id is null;


-- Costo de purga al pasar de un color a otro. Usa el override si existe;
-- si no, lo estima con la distancia de orden entre ambos colores.
create or replace function color_cambio_costo(p_empresa_id int, p_origen int, p_destino int)
returns table (minutos numeric, kg numeric, es_retroceso boolean, fuente text)
language sql stable as $$
  select 0::numeric, 0::numeric, false, 'sin cambio'::text
  where p_origen is not null and p_destino is not null and p_origen = p_destino

  union all
  select cc.minutos_purga, cc.kg_purga,
         (cd.orden_secuencia < co.orden_secuencia), 'capturado'::text
  from color_cambios cc
  join colores co on co.id = cc.color_origen_id
  join colores cd on cd.id = cc.color_destino_id
  where cc.empresa_id = p_empresa_id
    and cc.color_origen_id = p_origen and cc.color_destino_id = p_destino
    and p_origen is distinct from p_destino

  union all
  select
    round((pa.min_purga_base + pa.min_por_paso * abs(cd.orden_secuencia - co.orden_secuencia))
          * (case when cd.orden_secuencia < co.orden_secuencia then pa.factor_retroceso else 1 end)
          * (case when co.es_dificil_purga then pa.factor_dificil else 1 end), 1),
    round((pa.kg_purga_base + pa.kg_por_paso * abs(cd.orden_secuencia - co.orden_secuencia))
          * (case when cd.orden_secuencia < co.orden_secuencia then pa.factor_retroceso else 1 end)
          * (case when co.es_dificil_purga then pa.factor_dificil else 1 end), 2),
    (cd.orden_secuencia < co.orden_secuencia), 'estimado'::text
  from color_parametros pa
  join colores co on co.id = p_origen
  join colores cd on cd.id = p_destino
  where pa.empresa_id = p_empresa_id
    and p_origen is distinct from p_destino
    and not exists (select 1 from color_cambios cc
                    where cc.empresa_id = p_empresa_id
                      and cc.color_origen_id = p_origen and cc.color_destino_id = p_destino)
  limit 1;
$$;


-- Articulos que salen del MISMO disparo que el de referencia: mismo molde
-- Y mismo color. Sin color capturado agrupa igual que antes.
create or replace function familia_simultanea(p_molde_id int, p_articulo_id int)
returns table (articulo_id int, cavidades bigint, codigo text, descripcion text, color_id int)
language sql stable as $$
  with ref as (select a.color_id from articulos a where a.id = p_articulo_id)
  select mc.articulo_id, count(*)::bigint, a.codigo_interno, a.descripcion, a.color_id
  from molde_cavidades mc
  join articulos a on a.id = mc.articulo_id
  cross join ref
  where mc.molde_id = p_molde_id and mc.activa
    and a.color_id is not distinct from ref.color_id
  group by mc.articulo_id, a.codigo_interno, a.descripcion, a.color_id;
$$;


-- Corridas separadas de un molde: un grupo por color, de claro a oscuro.
create or replace function variantes_color_molde(p_molde_id int)
returns table (color_id int, color_clave text, color_nombre text,
               orden_secuencia int, articulos text, num_articulos bigint)
language sql stable as $$
  select a.color_id, c.clave, c.nombre, coalesce(c.orden_secuencia, 999),
         string_agg(distinct a.codigo_interno, ', ' order by a.codigo_interno),
         count(distinct a.id)::bigint
  from molde_cavidades mc
  join articulos a on a.id = mc.articulo_id
  left join colores c on c.id = a.color_id
  where mc.molde_id = p_molde_id and mc.activa
  group by a.color_id, c.clave, c.nombre, c.orden_secuencia
  order by coalesce(c.orden_secuencia, 999);
$$;


-- Sugerencia de secuencia por maquina: agrupa por molde para no cambiar de
-- molde de mas y dentro de cada campana corre los colores de CLARO a OSCURO.
-- Las campanas se ordenan por la fecha requerida mas temprana para no
-- sacrificar entregas. Devuelve los dos escenarios para poder comparar.
create or replace function secuencia_sugerida(
  p_empresa_id int, p_maquina_id int, p_desde date, p_hasta date
)
returns table (
  escenario text, posicion bigint,
  ot_id int, ot_folio text, fecha_programada date, turno text,
  articulo_codigo text, articulo_desc text, cantidad numeric,
  molde_id int, molde_clave text,
  color_id int, color_clave text, color_nombre text, orden_color int,
  cambio_molde boolean, cambio_color boolean,
  min_purga numeric, kg_purga numeric, es_retroceso boolean,
  min_molde numeric
)
language sql stable as $$
with ot as (
  select o.id, o.folio, o.fecha_programada, o.turno, o.secuencia,
         o.cantidad_programada, o.molde_id, o.cambio_molde_min,
         a.codigo_interno, a.descripcion, a.color_id,
         m.clave as molde_clave,
         c.clave as color_clave, c.nombre as color_nombre,
         coalesce(c.orden_secuencia, 999) as orden_color,
         min(o.fecha_programada) over (partition by o.molde_id) as campana
  from ordenes_trabajo o
  join articulos a on a.id = o.articulo_id
  left join moldes m on m.id = o.molde_id
  left join colores c on c.id = a.color_id
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
         row_number() over (order by o.campana, o.molde_id, o.orden_color, o.fecha_programada, o.id) as pos
  from ot o
),
con_previo as (
  select x.*,
         lag(x.molde_id)    over (partition by x.escenario order by x.pos) as molde_prev,
         lag(x.color_id)    over (partition by x.escenario order by x.pos) as color_prev,
         lag(x.orden_color) over (partition by x.escenario order by x.pos) as orden_prev
  from ordenado x
)
select
  p.escenario, p.pos, p.id, p.folio, p.fecha_programada, p.turno,
  p.codigo_interno, p.descripcion, p.cantidad_programada,
  p.molde_id, p.molde_clave, p.color_id, p.color_clave, p.color_nombre, p.orden_color,
  (p.molde_prev is not null and p.molde_prev is distinct from p.molde_id),
  (p.color_prev is not null and p.color_prev is distinct from p.color_id),
  coalesce(cc.minutos, 0), coalesce(cc.kg, 0), coalesce(cc.es_retroceso, false),
  case when p.molde_prev is not null and p.molde_prev is distinct from p.molde_id
       then coalesce(p.cambio_molde_min, 0) else 0 end
from con_previo p
left join lateral color_cambio_costo(p_empresa_id, p.color_prev, p.color_id) cc on true
order by p.escenario desc, p.pos;
$$;

grant select, insert, update, delete on colores, color_cambios to anon, authenticated, service_role;
grant select, insert, update on color_parametros to anon, authenticated, service_role;
grant usage, select on sequence colores_id_seq, color_cambios_id_seq to anon, authenticated, service_role;
grant execute on function color_cambio_costo(int, int, int) to anon, authenticated, service_role;
grant execute on function familia_simultanea(int, int) to anon, authenticated, service_role;
grant execute on function variantes_color_molde(int) to anon, authenticated, service_role;
grant execute on function secuencia_sugerida(int, int, date, date) to anon, authenticated, service_role;

-- Modulo y permisos del catalogo de colores
insert into modulos (clave, nombre, orden)
values ('ing_colores', 'Colores', 44) on conflict (clave) do nothing;

insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r.rol, m.id, true, r.edita, r.edita, r.edita, false
from modulos m
cross join (values
  ('admin', true), ('ingenieria', true), ('gerente_planta', true),
  ('gerente_produccion', false), ('produccion', false), ('planeacion', false),
  ('gerente_logistica', false), ('logistica', false),
  ('gerente_calidad', false), ('calidad', false), ('direccion', false)
) as r(rol, edita)
where m.clave = 'ing_colores'
and not exists (select 1 from permisos_rol p where p.rol = r.rol and p.modulo_id = m.id);
