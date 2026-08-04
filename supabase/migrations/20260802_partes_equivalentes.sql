-- =====================================================================
-- PARTES EQUIVALENTES.
--
-- Dos moldes distintos pueden fabricar la misma pieza con codigos de
-- articulo distintos: el molde 001 saca A (LH) y B (RH), y el molde 002
-- saca C (LH) y D (RH). Fisicamente A y C son la misma parte y el cliente
-- recibe cualquiera; los codigos difieren para saber de que molde salio,
-- que es lo que pide la trazabilidad automotriz.
--
-- La demanda llega contra UN solo codigo, asi que el sistema necesita
-- saber que A y C son sustituibles para poder surtir de cualquiera de los
-- dos y para ver el disponible junto.
--
-- Una PARTE es el grupo de codigos intercambiables. No sustituye al
-- articulo: cada codigo sigue siendo el que se produce, se etiqueta y se
-- rastrea. La parte solo dice "estos son la misma pieza".
-- =====================================================================

create table if not exists partes (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  clave text not null,
  nombre text not null,
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz default now(),
  unique (empresa_id, clave)
);

alter table articulos add column if not exists parte_id int references partes(id);
create index if not exists idx_articulos_parte on articulos(parte_id);

-- Codigos intercambiables con uno dado. Si el articulo no pertenece a
-- ninguna parte se devuelve el solo, asi el resto del sistema funciona
-- igual que antes sin casos especiales.
create or replace function equivalentes_articulo(p_articulo_id int)
returns table (articulo_id int, codigo_interno text, descripcion text,
               molde_id int, molde_clave text, es_el_mismo boolean)
language sql stable as $$
  with ref as (select id, parte_id from articulos where id = p_articulo_id)
  select a.id, a.codigo_interno, a.descripcion,
         mc.molde_id, m.clave, (a.id = p_articulo_id)
  from articulos a
  cross join ref
  left join lateral (
    select mc2.molde_id from molde_cavidades mc2
    where mc2.articulo_id = a.id and mc2.activa limit 1
  ) mc on true
  left join moldes m on m.id = mc.molde_id
  where a.activo
    and (
      (ref.parte_id is not null and a.parte_id = ref.parte_id)
      or (ref.parte_id is null and a.id = p_articulo_id)
    )
  order by (a.id = p_articulo_id) desc, a.codigo_interno;
$$;

-- Disponible liberado sumando todos los codigos equivalentes, con el
-- desglose por codigo para ver de donde sale cada pieza.
create or replace function disponible_parte(
  p_empresa_id int, p_articulo_id int, p_site_id int default null
)
returns table (articulo_id int, codigo_interno text, molde_clave text,
               disponible numeric, es_el_mismo boolean)
language sql stable as $$
  select e.articulo_id, e.codigo_interno, e.molde_clave,
         coalesce(inv.q, 0), e.es_el_mismo
  from equivalentes_articulo(p_articulo_id) e
  left join lateral (
    select sum(ex.cantidad) q
    from existencias ex
    join lotes l on l.id = ex.lote_id
    left join almacenes al on al.id = ex.almacen_id
    where l.articulo_id = e.articulo_id
      and l.empresa_id = p_empresa_id
      and l.estatus_calidad = 'liberado'
      and (p_site_id is null or al.site_id is null or al.site_id = p_site_id)
  ) inv on true
  order by e.es_el_mismo desc, e.codigo_interno;
$$;

grant select, insert, update, delete on partes to anon, authenticated, service_role;
grant usage, select on sequence partes_id_seq to anon, authenticated, service_role;
grant execute on function equivalentes_articulo(int) to anon, authenticated, service_role;
grant execute on function disponible_parte(int, int, int) to anon, authenticated, service_role;

insert into modulos (clave, nombre, orden)
values ('ing_partes', 'Partes equivalentes', 45)
on conflict (clave) do nothing;

insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r.rol, m.id, true, r.edita, r.edita, r.edita, false
from modulos m
cross join (values
  ('admin', true), ('ingenieria', true), ('gerente_planta', true),
  ('gerente_produccion', false), ('planeacion', false), ('produccion', false),
  ('gerente_logistica', false), ('logistica', false),
  ('gerente_calidad', false), ('calidad', false), ('direccion', false)
) as r(rol, edita)
where m.clave = 'ing_partes'
and not exists (select 1 from permisos_rol p where p.rol = r.rol and p.modulo_id = m.id);
