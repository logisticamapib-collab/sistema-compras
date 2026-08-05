-- Poner vigente un documento. Un documento vigente es la instruccion que
-- alguien va a seguir en piso, asi que aqui se para lo que no deberia salir.
create or replace function activar_documento(
  p_empresa_id integer, p_documento_id integer, p_usuario uuid default null
) returns integer language plpgsql as $$
DECLARE d record; v_prev int;
BEGIN
  select * into d from documentos where id = p_documento_id and empresa_id = p_empresa_id;
  if d.id is null then raise exception 'No existe el documento indicado'; end if;
  if d.estatus = 'vigente' then raise exception 'El documento ya esta vigente'; end if;
  if d.estatus = 'obsoleto' then
    raise exception 'El documento esta obsoleto. Clona una version nueva en lugar de reactivarlo';
  end if;
  if coalesce(trim(d.archivo_url), '') = '' then
    raise exception 'El documento no tiene archivo cargado. Un documento controlado sin contenido no sirve de nada: la gente seguiria usando la copia que ya tiene';
  end if;
  if d.version > 1 and coalesce(trim(d.motivo_cambio), '') = '' then
    raise exception 'Falta el motivo del cambio. Sin el, nadie puede saber que cambio respecto a la version anterior ni por que';
  end if;

  select id into v_prev from documentos
  where empresa_id = p_empresa_id and upper(codigo) = upper(d.codigo)
    and estatus = 'vigente' and id <> p_documento_id;

  update documentos set estatus = 'obsoleto' where id = v_prev;

  update documentos
  set estatus = 'vigente', vigente_desde = current_date,
      aprobado_por = coalesce(aprobado_por, p_usuario), aprobado_at = now()
  where id = p_documento_id;

  return coalesce(v_prev, 0);
END $$;

-- Sacar version nueva. Es la unica forma de cambiar un documento vigente:
-- editarlo en su lugar borraria el rastro de que decia cuando alguien lo siguio.
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

  insert into documentos(empresa_id, codigo, titulo, tipo, area, version, estatus,
                         origen, fuente_externa, archivo_url, archivo_nombre,
                         proxima_revision, elaborado_por, notas)
  values (p_empresa_id, d.codigo, d.titulo, d.tipo, d.area, v_ver, 'borrador',
          d.origen, d.fuente_externa, d.archivo_url, d.archivo_nombre,
          d.proxima_revision, p_usuario, d.notas)
  returning id into v_new;

  return v_new;
END $$;

-- El listado con lo que importa de un vistazo: cual es la vigente, cuantas
-- versiones lleva y si ya le toca revision.
create or replace function documentos_resumen(p_empresa_id integer)
returns table(
  id integer, codigo text, titulo text, tipo text, area text,
  version integer, estatus text, origen text, fuente_externa text,
  vigente_desde date, proxima_revision date, dias_para_revision integer,
  revision_vencida boolean, versiones integer,
  archivo_url text, archivo_nombre text, motivo_cambio text, aprobado_at timestamptz
) language sql stable as $$
  select d.id, d.codigo, d.titulo, d.tipo, d.area,
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
  where d.empresa_id = p_empresa_id
  order by d.codigo,
           case d.estatus when 'vigente' then 1 when 'borrador' then 2 else 3 end,
           d.version desc;
$$;

-- ---------- Retencion ----------
--
-- Cuando se puede destruir un registro. Nulo significa que todavia no se
-- puede calcular o que no se destruye nunca, y las dos cosas se distinguen
-- por la base de retencion del tipo.
create or replace function registro_fecha_purga(
  p_base text, p_valor numeric, p_fecha_registro date, p_fin_produccion date
) returns date language sql immutable as $$
  select case p_base
    when 'permanente' then null
    when 'meses' then (p_fecha_registro + (coalesce(p_valor,0) || ' months')::interval)::date
    -- "Un ano calendario" no son 365 dias: es hasta el 31 de diciembre del
    -- ano siguiente al que se creo. Contarlo como dias deja registros cortos.
    when 'anos_calendario' then
      make_date(extract(year from p_fecha_registro)::int + coalesce(p_valor,0)::int, 12, 31)
    -- Vida de la pieza mas N anos: mientras la pieza siga viva no hay fecha.
    when 'vida_pieza_mas_anos' then
      case when p_fin_produccion is null then null
           else make_date(extract(year from p_fin_produccion)::int + coalesce(p_valor,0)::int, 12, 31)
      end
  end;
$$;

create or replace function trg_registro_purga() returns trigger language plpgsql as $$
DECLARE t record;
BEGIN
  select * into t from registro_tipos where id = new.tipo_id;
  if t.id is null then raise exception 'No existe el tipo de registro indicado'; end if;
  new.fecha_purga := registro_fecha_purga(t.base_retencion, t.valor,
                                          new.fecha_registro, new.fecha_fin_produccion);
  return new;
END $$;

drop trigger if exists registro_purga on registros_archivados;
create trigger registro_purga
  before insert or update of tipo_id, fecha_registro, fecha_fin_produccion
  on registros_archivados
  for each row execute function trg_registro_purga();

-- Que ya cumplio su periodo de retencion y se puede destruir.
--
-- La retencion legal manda sobre el calendario: si hay una demanda, un
-- reclamo o una auditoria abierta, el registro no se destruye aunque le
-- toque. Por eso sale aparte y no se puede purgar desde aqui.
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
         r.retencion_legal, r.ubicacion, t.responsable_area, a.codigo_interno
  from registros_archivados r
  join registro_tipos t on t.id = r.tipo_id
  left join articulos a on a.id = r.articulo_id
  where r.empresa_id = p_empresa_id
    and r.estatus = 'vigente'
    and r.fecha_purga is not null
    and r.fecha_purga <= current_date + coalesce(p_dias_aviso, 60)
  order by r.retencion_legal, r.fecha_purga;
$$;

-- Purgar. Nunca borra el renglon: deja constancia de que se destruyo, quien
-- y cuando, que es justo lo que el auditor pregunta.
create or replace function purgar_registro(
  p_empresa_id integer, p_registro_id integer, p_usuario uuid default null, p_notas text default null
) returns void language plpgsql as $$
DECLARE r record;
BEGIN
  select * into r from registros_archivados where id = p_registro_id and empresa_id = p_empresa_id;
  if r.id is null then raise exception 'No existe el registro indicado'; end if;
  if r.estatus = 'purgado' then raise exception 'El registro % ya estaba purgado', r.identificador; end if;
  if r.retencion_legal then
    raise exception 'El registro % esta bajo retencion legal (%): no se destruye aunque haya cumplido su periodo',
      r.identificador, coalesce(r.motivo_retencion, 'sin motivo capturado');
  end if;
  if r.fecha_purga is null then
    raise exception 'El registro % todavia no tiene fecha de purga. Si es por vida de la pieza, primero hay que capturar cuando termino su produccion',
      r.identificador;
  end if;
  if r.fecha_purga > current_date then
    raise exception 'El registro % se puede destruir hasta el %', r.identificador, r.fecha_purga;
  end if;

  update registros_archivados
  set estatus = 'purgado', purgado_por = p_usuario, purgado_at = now(),
      notas = coalesce(notas || ' | ', '') || coalesce(p_notas, 'Purgado por vencimiento de retencion')
  where id = p_registro_id;
END $$;
