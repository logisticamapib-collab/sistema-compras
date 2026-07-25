-- KPI de variacion de demanda: agrega release_cambios por cliente/articulo/tipo/origen/periodo.
-- delta = cantidad_nueva - cantidad_anterior. Filtro por rango sobre created_at (fecha del cambio).
-- Periodo = mes de fecha_requerida. Aplicado via MCP el 2026-07-24.
create or replace function kpi_variacion_demanda(
  p_empresa integer, p_desde date default null, p_hasta date default null,
  p_cliente integer default null, p_articulo integer default null
) returns table(
  cliente_id integer, articulo_id integer, tipo text, origen text, periodo text,
  n bigint, incrementos numeric, decrementos numeric, neto numeric, base_anterior numeric
) language sql stable security definer set search_path = public, pg_temp as $$
  select rc.cliente_id, rc.articulo_id, rc.tipo, rc.origen,
         to_char(rc.fecha_requerida,'YYYY-MM') as periodo,
         count(*)::bigint,
         coalesce(sum(case when rc.delta>0 then rc.delta else 0 end),0),
         coalesce(sum(case when rc.delta<0 then rc.delta else 0 end),0),
         coalesce(sum(rc.delta),0),
         coalesce(sum(rc.cantidad_anterior),0)
  from release_cambios rc
  where rc.empresa_id = p_empresa
    and (p_desde is null or rc.created_at::date >= p_desde)
    and (p_hasta is null or rc.created_at::date <= p_hasta)
    and (p_cliente is null or rc.cliente_id = p_cliente)
    and (p_articulo is null or rc.articulo_id = p_articulo)
  group by rc.cliente_id, rc.articulo_id, rc.tipo, rc.origen, to_char(rc.fecha_requerida,'YYYY-MM')
$$;
grant execute on function kpi_variacion_demanda(integer,date,date,integer,integer) to anon, authenticated, service_role;

insert into modulos (clave, nombre, orden) values ('cs_variacion','Variacion de Demanda',55) on conflict (clave) do nothing;
insert into permisos_rol (rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
  select r.rol, m.id, true, false, false, false, false
  from (values ('customer_service'),('gerente_logistica'),('direccion'),('gerente_administrativo')) as r(rol)
  cross join (select id from modulos where clave='cs_variacion') m on conflict do nothing;
