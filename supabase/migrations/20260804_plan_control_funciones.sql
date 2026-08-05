-- Activar un plan: las validaciones que no se pueden dejar a la pantalla.
--
-- Un plan vigente es la referencia contra la que se va a medir producto que
-- se le manda a un cliente, asi que aqui es donde se para lo que no cuadra.
-- Si una caracteristica especial no lleva SPC, o si lo lleva y no tiene con
-- que medirse, el plan no se activa: preferimos que no arranque a que arranque
-- generando evidencia que no vale.
create or replace function activar_plan_control(
  p_empresa_id integer, p_plan_id integer, p_usuario uuid default null
) returns integer language plpgsql as $$
DECLARE p record; v_n int; v_msg text; r record;
BEGIN
  select * into p from planes_control where id = p_plan_id and empresa_id = p_empresa_id;
  if p.id is null then raise exception 'No existe el plan indicado'; end if;
  if p.estatus = 'vigente' then raise exception 'El plan ya esta vigente'; end if;
  if p.estatus = 'obsoleto' then
    raise exception 'El plan esta obsoleto. Clona una version nueva en lugar de reactivarlo';
  end if;

  select count(*) into v_n from plan_control_caracteristicas
  where plan_id = p_plan_id and activo;
  if v_n = 0 then
    raise exception 'El plan no tiene ninguna caracteristica activa: no hay nada que medir';
  end if;

  -- Una caracteristica especial del cliente obliga a SPC, no es opcional.
  select string_agg(nombre, ', ') into v_msg from plan_control_caracteristicas
  where plan_id = p_plan_id and activo and especial is not null and not requiere_spc;
  if v_msg is not null then
    raise exception 'Estas caracteristicas estan marcadas como especiales del cliente pero sin SPC: %. Una caracteristica especial obliga a control estadistico', v_msg;
  end if;

  -- Si se va a llevar carta, tiene que haber con que medir y contra que comparar.
  select string_agg(nombre, ', ') into v_msg from plan_control_caracteristicas
  where plan_id = p_plan_id and activo and requiere_spc and tipo = 'variable' and equipo_id is null;
  if v_msg is not null then
    raise exception 'Estas caracteristicas llevan SPC pero no tienen equipo de medicion asignado: %', v_msg;
  end if;

  -- El equipo puede existir y aun asi no servir. Se avisa al activar porque
  -- el candado de verdad esta en la captura, pero mas vale saberlo ahora.
  v_msg := null;
  for r in
    select c.nombre, e.clave, u.motivo
    from plan_control_caracteristicas c
    join equipos_medicion e on e.id = c.equipo_id
    cross join lateral equipo_utilizable(p_empresa_id, c.equipo_id) u
    where c.plan_id = p_plan_id and c.activo and not u.ok
  loop
    v_msg := coalesce(v_msg || ' | ', '') || format('%s usa %s (%s)', r.nombre, r.clave, r.motivo);
  end loop;
  if v_msg is not null then
    raise exception 'No se puede activar: hay equipos que no estan en condiciones de medir. %', v_msg;
  end if;

  -- Sin plan de reaccion el plan de control no sirve de nada: dice que medir
  -- pero no que hacer cuando sale mal, que es justo el momento que importa.
  select string_agg(nombre, ', ') into v_msg from plan_control_caracteristicas
  where plan_id = p_plan_id and activo and coalesce(trim(plan_reaccion),'') = '';
  if v_msg is not null then
    raise exception 'Estas caracteristicas no tienen plan de reaccion: %', v_msg;
  end if;

  update planes_control set estatus = 'obsoleto'
  where empresa_id = p_empresa_id and articulo_id = p.articulo_id
    and estatus = 'vigente' and id <> p_plan_id;

  update planes_control
  set estatus = 'vigente', vigente_desde = current_date,
      aprobado_por = p_usuario, aprobado_at = now()
  where id = p_plan_id;

  return v_n;
END $$;

-- Clonar a una version nueva en borrador. Es la unica forma de cambiar un
-- plan vigente, para que quede el rastro de que cambio y cuando.
create or replace function clonar_plan_control(
  p_empresa_id integer, p_plan_id integer, p_usuario uuid default null
) returns integer language plpgsql as $$
DECLARE p record; v_new int; v_ver int;
BEGIN
  select * into p from planes_control where id = p_plan_id and empresa_id = p_empresa_id;
  if p.id is null then raise exception 'No existe el plan indicado'; end if;

  if exists (select 1 from planes_control
             where empresa_id = p_empresa_id and articulo_id = p.articulo_id and estatus = 'borrador') then
    raise exception 'Ya hay una version en borrador para este articulo. Terminala o descartala antes de sacar otra';
  end if;

  select coalesce(max(version),0) + 1 into v_ver from planes_control
  where empresa_id = p_empresa_id and articulo_id = p.articulo_id;

  insert into planes_control(empresa_id, articulo_id, version, fase, estatus,
                             nivel_revision_dibujo, elaborado_por, notas)
  values (p_empresa_id, p.articulo_id, v_ver, p.fase, 'borrador',
          p.nivel_revision_dibujo, p_usuario,
          'Clonado de la version ' || p.version)
  returning id into v_new;

  insert into plan_control_caracteristicas(
    plan_id, orden, numero, nombre, tipo, especial, ruta_fabricacion_id,
    nominal, lie, lse, unidad, equipo_id, tamano_subgrupo,
    frecuencia_tipo, frecuencia_valor, metodo_control, plan_reaccion,
    meta_cpk, meta_ppk, requiere_spc, activo)
  select v_new, orden, numero, nombre, tipo, especial, ruta_fabricacion_id,
         nominal, lie, lse, unidad, equipo_id, tamano_subgrupo,
         frecuencia_tipo, frecuencia_valor, metodo_control, plan_reaccion,
         meta_cpk, meta_ppk, requiere_spc, activo
  from plan_control_caracteristicas where plan_id = p_plan_id;

  return v_new;
END $$;

-- Lo que hay que medir en una OT, ya resuelto: caracteristicas del plan
-- vigente del articulo, con el estado del equipo con que se miden.
create or replace function caracteristicas_ot(p_empresa_id integer, p_ot_id integer)
returns table(
  caracteristica_id integer, plan_id integer, plan_version integer,
  orden integer, numero text, nombre text, tipo text, especial text,
  nominal numeric, lie numeric, lse numeric, unidad text,
  tamano_subgrupo integer, frecuencia_tipo text, frecuencia_valor numeric,
  metodo_control text, plan_reaccion text, meta_cpk numeric, meta_ppk numeric,
  requiere_spc boolean,
  equipo_id integer, equipo_clave text, equipo_estado text,
  equipo_ok boolean, equipo_motivo text
) language sql stable as $$
  select c.id, p.id, p.version,
         c.orden, c.numero, c.nombre, c.tipo, c.especial,
         c.nominal, c.lie, c.lse, c.unidad,
         c.tamano_subgrupo, c.frecuencia_tipo, c.frecuencia_valor,
         c.metodo_control, c.plan_reaccion, c.meta_cpk, c.meta_ppk,
         c.requiere_spc,
         c.equipo_id, e.clave, u.estado, coalesce(u.ok, false), u.motivo
  from ordenes_trabajo o
  join planes_control p
    on p.empresa_id = o.empresa_id and p.articulo_id = o.articulo_id and p.estatus = 'vigente'
  join plan_control_caracteristicas c on c.plan_id = p.id and c.activo
  left join equipos_medicion e on e.id = c.equipo_id
  left join lateral equipo_utilizable(p_empresa_id, c.equipo_id) u on true
  where o.id = p_ot_id and o.empresa_id = p_empresa_id
  order by c.orden, c.id;
$$;

-- Resumen del plan para la pantalla y para saber de un vistazo si un articulo
-- ya tiene con que controlarse.
create or replace function planes_control_resumen(p_empresa_id integer)
returns table(
  plan_id integer, articulo_id integer, codigo_interno text, descripcion text,
  version integer, fase text, estatus text, vigente_desde date,
  nivel_revision_dibujo text,
  caracteristicas integer, especiales integer, con_spc integer,
  equipos_no_utilizables integer
) language sql stable as $$
  select p.id, a.id, a.codigo_interno, a.descripcion,
         p.version, p.fase, p.estatus, p.vigente_desde, p.nivel_revision_dibujo,
         count(c.id) filter (where c.activo)::int,
         count(c.id) filter (where c.activo and c.especial is not null)::int,
         count(c.id) filter (where c.activo and c.requiere_spc)::int,
         count(c.id) filter (where c.activo and c.equipo_id is not null and not coalesce(u.ok,false))::int
  from planes_control p
  join articulos a on a.id = p.articulo_id
  left join plan_control_caracteristicas c on c.plan_id = p.id
  left join lateral equipo_utilizable(p_empresa_id, c.equipo_id) u on c.equipo_id is not null
  where p.empresa_id = p_empresa_id
  group by p.id, a.id, a.codigo_interno, a.descripcion, p.version, p.fase,
           p.estatus, p.vigente_desde, p.nivel_revision_dibujo
  order by a.codigo_interno,
           case p.estatus when 'vigente' then 1 when 'borrador' then 2 else 3 end,
           p.version desc;
$$;
