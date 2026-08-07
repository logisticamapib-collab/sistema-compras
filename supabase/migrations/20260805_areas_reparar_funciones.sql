-- Las funciones que leian el area en texto ahora la resuelven del catalogo.
-- Siguen devolviendo el nombre para que las pantallas no cambien de forma,
-- pero ahora tambien devuelven el id y el dato sale de un solo lugar.
drop function if exists equipos_estado(integer, integer);
drop function if exists documentos_resumen(integer);

create function equipos_estado(p_empresa_id integer, p_site_id integer default null)
returns table(
  id integer, clave text, nombre text, tipo text, marca text, modelo text, serie text,
  area text, area_id integer, unidad text, resolucion numeric,
  intervalo_meses integer, ultima_calibracion date, proxima_calibracion date,
  estatus text, estado text, dias integer, motivo text,
  requiere_rr boolean, ultimo_rr_pct numeric, ultimo_rr_resultado text, ultimo_rr_fecha date,
  ultimo_certificado text, site_id integer
) language sql stable as $$
  select e.id, e.clave, e.nombre, e.tipo, e.marca, e.modelo, e.serie,
         ar.nombre, e.area_id, e.unidad, e.resolucion,
         e.intervalo_meses, e.ultima_calibracion, e.proxima_calibracion,
         e.estatus, s.estado, s.dias, s.motivo,
         e.requiere_rr, e.ultimo_rr_pct, e.ultimo_rr_resultado, e.ultimo_rr_fecha,
         (select c.numero_certificado from calibraciones c
          where c.equipo_id = e.id and c.resultado <> 'rechazado'
          order by c.fecha desc, c.id desc limit 1),
         e.site_id
  from equipos_medicion e
  left join areas ar on ar.id = e.area_id
  cross join lateral equipo_estado(p_empresa_id, e.id) s
  where e.empresa_id = p_empresa_id
    and e.estatus <> 'baja'
    and (p_site_id is null or e.site_id is null or e.site_id = p_site_id)
  order by
    case s.estado when 'vencido' then 1 when 'sin_calibrar' then 2
                  when 'fuera_de_servicio' then 3 when 'por_vencer' then 4 else 5 end,
    e.proxima_calibracion nulls first, e.clave;
$$;

create function documentos_resumen(p_empresa_id integer)
returns table(
  id integer, codigo text, titulo text, tipo text, area text, area_id integer,
  version integer, estatus text, origen text, fuente_externa text,
  vigente_desde date, proxima_revision date, dias_para_revision integer,
  revision_vencida boolean, versiones integer,
  archivo_url text, archivo_nombre text, motivo_cambio text, aprobado_at timestamptz
) language sql stable as $$
  select d.id, d.codigo, d.titulo, d.tipo, ar.nombre, d.area_id,
         d.version, d.estatus, d.origen, d.fuente_externa,
         d.vigente_desde, d.proxima_revision,
         case when d.proxima_revision is null then null
              else (d.proxima_revision - current_date)::int end,
         d.estatus = 'vigente' and d.proxima_revision is not null
           and d.proxima_revision < current_date,
         (select count(*)::int from documentos x
          where x.empresa_id = d.empresa_id and upper(x.codigo) = upper(d.codigo)),
         d.archivo_url, d.archivo_nombre, d.motivo_cambio, d.aprobado_at
  from documentos d
  left join areas ar on ar.id = d.area_id
  where d.empresa_id = p_empresa_id
  order by d.codigo,
           case d.estatus when 'vigente' then 1 when 'borrador' then 2 else 3 end,
           d.version desc;
$$;

create or replace function clonar_documento(
  p_empresa_id integer, p_documento_id integer, p_usuario uuid default null
) returns integer language plpgsql as $$
DECLARE d record; v_new int; v_ver int;
BEGIN
  select * into d from documentos where id = p_documento_id and empresa_id = p_empresa_id;
  if d.id is null then raise exception 'No existe el documento indicado'; end if;

  if exists (select 1 from documentos
             where empresa_id = p_empresa_id and upper(codigo) = upper(d.codigo)
               and estatus = 'borrador') then
    raise exception 'Ya hay una version en borrador de %. Terminala o descartala antes de sacar otra', d.codigo;
  end if;

  select coalesce(max(version),0) + 1 into v_ver from documentos
  where empresa_id = p_empresa_id and upper(codigo) = upper(d.codigo);

  insert into documentos(empresa_id, codigo, titulo, tipo, area_id, version, estatus,
                         origen, fuente_externa, archivo_url, archivo_nombre,
                         proxima_revision, elaborado_por, notas)
  values (p_empresa_id, d.codigo, d.titulo, d.tipo, d.area_id, v_ver, 'borrador',
          d.origen, d.fuente_externa, d.archivo_url, d.archivo_nombre,
          d.proxima_revision, p_usuario, d.notas)
  returning id into v_new;

  return v_new;
END $$;

create or replace function registros_por_purgar(
  p_empresa_id integer, p_dias_aviso integer default 60
) returns table(
  registro_id integer, tipo_clave text, tipo_nombre text, disposicion text,
  identificador text, descripcion text, fecha_registro date, fecha_purga date,
  dias integer, situacion text, retencion_legal boolean, ubicacion text,
  responsable_area text, articulo text
) language sql stable as $$
  select r.id, t.clave, t.nombre, t.disposicion,
         r.identificador, r.descripcion, r.fecha_registro, r.fecha_purga,
         case when r.fecha_purga is null then null
              else (r.fecha_purga - current_date)::int end,
         case when r.retencion_legal then 'retenido por asunto legal'
              when r.fecha_purga is null and t.base_retencion = 'permanente' then 'se conserva siempre'
              when r.fecha_purga is null then 'la pieza sigue en produccion'
              when r.fecha_purga < current_date then 'ya se puede destruir'
              else 'por vencer'
         end,
         r.retencion_legal, r.ubicacion, ar.nombre, a.codigo_interno
  from registros_archivados r
  join registro_tipos t on t.id = r.tipo_id
  left join areas ar on ar.id = t.responsable_area_id
  left join articulos a on a.id = r.articulo_id
  where r.empresa_id = p_empresa_id
    and r.estatus = 'vigente'
    and r.fecha_purga is not null
    and r.fecha_purga <= current_date + coalesce(p_dias_aviso, 60)
  order by r.retencion_legal, r.fecha_purga;
$$;
