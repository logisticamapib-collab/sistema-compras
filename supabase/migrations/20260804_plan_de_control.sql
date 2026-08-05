-- PLAN DE CONTROL (IATF 16949, 8.5.1.1 y Anexo A)
--
-- Es el documento que dice que se mide, con que, cada cuando, y que se hace
-- cuando sale mal. Aqui no es un anexo en Excel: es la tabla de la que va a
-- salir la carta de control, asi que lo que se capture aqui determina si el
-- SPC de manana significa algo.
--
-- Va por VERSION y con un solo vigente por articulo. Cambiar una tolerancia
-- sin dejar rastro es de las cosas que mas caro salen en auditoria, y ademas
-- rompe la comparabilidad de las cartas: los datos viejos se midieron contra
-- otra especificacion. Por eso no se edita el plan vigente, se saca version.

create table if not exists planes_control (
  id                    serial primary key,
  empresa_id            integer not null references empresas(id) on delete cascade,
  articulo_id           integer not null references articulos(id) on delete cascade,
  version               integer not null default 1,
  fase                  text not null default 'produccion'
                          check (fase in ('prototipo','pre_lanzamiento','produccion')),
  estatus               text not null default 'borrador'
                          check (estatus in ('borrador','vigente','obsoleto')),
  nivel_revision_dibujo text,
  vigente_desde         date,
  elaborado_por         uuid references usuarios(id),
  aprobado_por          uuid references usuarios(id),
  aprobado_at           timestamptz,
  notas                 text,
  created_at            timestamptz not null default now()
);

create unique index if not exists planes_control_version_uq
  on planes_control(empresa_id, articulo_id, version);
-- Un solo plan vigente por articulo. Es una regla de la norma y aqui la
-- sostiene la base, no la pantalla.
create unique index if not exists planes_control_vigente_uq
  on planes_control(empresa_id, articulo_id) where estatus = 'vigente';

create table if not exists plan_control_caracteristicas (
  id                  serial primary key,
  plan_id             integer not null references planes_control(id) on delete cascade,
  orden               integer not null default 1,
  numero              text,
  nombre              text not null,
  tipo                text not null default 'variable'
                        check (tipo in ('variable','atributo')),
  -- Simbolo del cliente. Una caracteristica especial obliga a SPC.
  especial            text check (especial in ('critica','significativa','seguridad')),
  ruta_fabricacion_id integer references rutas_fabricacion(id),
  nominal             numeric,
  lie                 numeric,
  lse                 numeric,
  unidad              text,
  equipo_id           integer references equipos_medicion(id),
  tamano_subgrupo     integer not null default 5,
  frecuencia_tipo     text not null default 'por_turno'
                        check (frecuencia_tipo in ('arranque','por_hora','cada_n_horas','por_turno','por_lote','por_piezas')),
  frecuencia_valor    numeric,
  metodo_control      text,
  plan_reaccion       text not null,
  meta_cpk            numeric not null default 1.33,
  meta_ppk            numeric not null default 1.67,
  requiere_spc        boolean not null default true,
  activo              boolean not null default true,
  created_at          timestamptz not null default now(),

  -- Una variable sin ningun limite no se puede evaluar: no hay contra que
  -- comparar ni forma de calcular capacidad.
  constraint carac_variable_con_limite
    check (tipo <> 'variable' or lie is not null or lse is not null),
  constraint carac_limites_coherentes
    check (lie is null or lse is null or lie < lse),
  constraint carac_nominal_dentro
    check (nominal is null
           or ((lie is null or nominal >= lie) and (lse is null or nominal <= lse))),
  constraint carac_subgrupo_valido
    check (tamano_subgrupo between 1 and 25)
);

create unique index if not exists carac_nombre_uq
  on plan_control_caracteristicas(plan_id, upper(nombre));
create index if not exists carac_plan_idx on plan_control_caracteristicas(plan_id, orden);

insert into modulos(clave, nombre, orden)
select 'cal_plan_control', 'Plan de Control', 71
where not exists (select 1 from modulos where clave = 'cal_plan_control');

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select pr.rol, (select id from modulos where clave = 'cal_plan_control'),
       pr.puede_ver, pr.puede_crear, pr.puede_editar, false,
       pr.rol in ('gerente_calidad','sgc','admin')
from permisos_rol pr
join modulos m on m.id = pr.modulo_id
where m.clave = 'cal_calibracion'
  and not exists (
    select 1 from permisos_rol x
    where x.rol = pr.rol and x.modulo_id = (select id from modulos where clave = 'cal_plan_control')
  );

-- Ingenieria elabora planes de control; Produccion solo los consulta.
update permisos_rol
set puede_crear = true, puede_editar = true
where modulo_id = (select id from modulos where clave = 'cal_plan_control')
  and rol in ('gerente_ingenieria','ingenieria','ingeniero_nuevos_proyectos');
