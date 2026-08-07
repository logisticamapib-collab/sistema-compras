-- UNIFICAR "AREA" CONTRA EL CATALOGO
--
-- El area vivia como texto libre en seis tablas distintas: alertas de calidad,
-- no conformidades, equipos de medicion, documentos, tipos de registro y
-- usuarios. Tres de ellas las agregue yo en la misma sesion en que propuse el
-- catalogo, asi que estaba ampliando el desorden en lugar de arreglarlo.
--
-- Con texto libre, "Inyeccion", "INYECCION" e "Inyeccion 1" son tres areas y
-- cualquier agrupacion sale rota; ademas no se puede colgar del area un centro
-- de costo, una cuenta de gasto ni un responsable, que es justo lo que Toolcrib
-- necesita para imputar.
--
-- Se migra a area_id. Nada se pierde: el texto que no corresponda a un area
-- existente CREA el area en lugar de descartarse, y el original queda
-- respaldado por si alguna correspondencia hay que revisarla.
--
-- No se toca molde_mtto_firmas.area: ahi no es una ubicacion sino quien firma
-- el tryout, viene limitada por un check a tres valores y esta amarrada a los
-- parametros de mantenimiento y a una restriccion unica.

create or replace function area_normaliza(p_texto text)
returns text language sql immutable as $$
  select lower(trim(translate(coalesce(p_texto, ''),
    'aeiouAEIOUnNuU', 'aeiouAEIOUnNuU')));
$$;

-- Resuelve un texto libre a un area del catalogo. Si no existe, la crea.
create or replace function area_resolver(p_empresa_id integer, p_texto text)
returns integer language plpgsql as $$
DECLARE v_id int; v_clave text;
BEGIN
  if coalesce(trim(p_texto), '') = '' then return null; end if;

  select a.id into v_id from areas a
  where a.empresa_id = p_empresa_id
    and (area_normaliza(a.clave) = area_normaliza(p_texto)
      or area_normaliza(a.nombre) = area_normaliza(p_texto));
  if v_id is not null then return v_id; end if;

  v_clave := upper(regexp_replace(substring(trim(p_texto) from 1 for 6), '[^a-zA-Z0-9]', '', 'g'));
  if coalesce(v_clave, '') = '' then v_clave := 'AREA'; end if;
  while exists (select 1 from areas a where a.empresa_id = p_empresa_id
                and upper(a.clave) = v_clave) loop
    v_clave := v_clave || '1';
  end loop;

  insert into areas(empresa_id, clave, nombre)
  values (p_empresa_id, v_clave, trim(p_texto))
  returning id into v_id;
  return v_id;
END $$;

alter table areas            add column if not exists notas text;
alter table calidad_alertas  add column if not exists area_id integer references areas(id);
alter table no_conformidades add column if not exists area_id integer references areas(id);
alter table equipos_medicion add column if not exists area_id integer references areas(id);
alter table documentos       add column if not exists area_id integer references areas(id);
alter table usuarios         add column if not exists area_id integer references areas(id);
alter table registro_tipos   add column if not exists responsable_area_id integer references areas(id);

create table if not exists areas_migracion_respaldo (
  id          serial primary key,
  tabla       text not null,
  registro_id text not null,
  texto       text,
  area_id     integer references areas(id),
  migrado_at  timestamptz not null default now()
);

do $mig$
declare r record;
begin
  for r in select id, empresa_id, area from calidad_alertas where coalesce(trim(area),'') <> '' loop
    update calidad_alertas set area_id = area_resolver(r.empresa_id, r.area) where id = r.id;
    insert into areas_migracion_respaldo(tabla, registro_id, texto, area_id)
    select 'calidad_alertas', r.id::text, r.area, area_id from calidad_alertas where id = r.id;
  end loop;
  for r in select id, empresa_id, area from no_conformidades where coalesce(trim(area),'') <> '' loop
    update no_conformidades set area_id = area_resolver(r.empresa_id, r.area) where id = r.id;
    insert into areas_migracion_respaldo(tabla, registro_id, texto, area_id)
    select 'no_conformidades', r.id::text, r.area, area_id from no_conformidades where id = r.id;
  end loop;
  for r in select id, empresa_id, area from equipos_medicion where coalesce(trim(area),'') <> '' loop
    update equipos_medicion set area_id = area_resolver(r.empresa_id, r.area) where id = r.id;
    insert into areas_migracion_respaldo(tabla, registro_id, texto, area_id)
    select 'equipos_medicion', r.id::text, r.area, area_id from equipos_medicion where id = r.id;
  end loop;
  for r in select id, empresa_id, area from documentos where coalesce(trim(area),'') <> '' loop
    update documentos set area_id = area_resolver(r.empresa_id, r.area) where id = r.id;
    insert into areas_migracion_respaldo(tabla, registro_id, texto, area_id)
    select 'documentos', r.id::text, r.area, area_id from documentos where id = r.id;
  end loop;
  for r in select id, empresa_id, area from usuarios where coalesce(trim(area),'') <> '' loop
    update usuarios set area_id = area_resolver(r.empresa_id, r.area) where id = r.id;
    insert into areas_migracion_respaldo(tabla, registro_id, texto, area_id)
    select 'usuarios', r.id::text, r.area, area_id from usuarios where id = r.id;
  end loop;
  for r in select id, empresa_id, responsable_area from registro_tipos
           where coalesce(trim(responsable_area),'') <> '' loop
    update registro_tipos set responsable_area_id = area_resolver(r.empresa_id, r.responsable_area)
    where id = r.id;
    insert into areas_migracion_respaldo(tabla, registro_id, texto, area_id)
    select 'registro_tipos', r.id::text, r.responsable_area, responsable_area_id
    from registro_tipos where id = r.id;
  end loop;
end $mig$;

-- Las areas que nacieron de la migracion quedan marcadas. Si alguien capturo
-- "Gerente de Planta" en el campo de area, eso se conserva, pero se avisa que
-- probablemente sea un puesto y no un area: es lo que pasa cuando un campo de
-- texto libre no tiene catalogo detras.
update areas a
set notas = 'Creada al migrar el texto libre. Revisa si de verdad es un area: puede ser un puesto o un nombre mal escrito.'
where a.notas is null
  and exists (select 1 from areas_migracion_respaldo r where r.area_id = a.id)
  and upper(a.clave) not in ('INY','ENS','MOL','MTTO','TOOL','CAL','ALM','ING','LOG','SERV');

-- El SPC escribia el area como literal 'Produccion'. Ahora toma el area de la
-- maquina de la OT, que ademas es mas exacto: dice donde paso, no en que
-- departamento generico.
DO $mig$
DECLARE
  v_def text;
  v_viejo text := '''Produccion''';
  v_nuevo text := '(select mq.area_id from maquinas mq where mq.id = o.maquina_id)';
  v_n int;
BEGIN
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'registrar_subgrupo';
  if v_def is null then raise exception 'No se encontro registrar_subgrupo'; end if;
  if position(v_nuevo in v_def) > 0 then return; end if;
  v_n := (length(v_def) - length(replace(v_def, v_viejo, ''))) / length(v_viejo);
  if v_n <> 3 then raise exception 'Se esperaban 3 literales Produccion y hay %; abortado', v_n; end if;
  v_def := replace(v_def, 'severidad, area, vigente, creado_por)', 'severidad, area_id, vigente, creado_por)');
  v_def := replace(v_def, 'detectado_por, area,', 'detectado_por, area_id,');
  v_def := replace(v_def, v_viejo, v_nuevo);
  execute v_def;
END $mig$;

alter table calidad_alertas  drop column if exists area;
alter table no_conformidades drop column if exists area;
alter table equipos_medicion drop column if exists area;
alter table documentos       drop column if exists area;
alter table usuarios         drop column if exists area;
alter table registro_tipos   drop column if exists responsable_area;
