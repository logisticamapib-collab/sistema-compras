-- SPC: SUBGRUPOS, LIMITES DE CONTROL Y CAPACIDAD
--
-- Dos ideas que hay que separar o el SPC no sirve:
--
-- 1) Los LIMITES DE ESPECIFICACION los pone el cliente en el dibujo y dicen
--    si la pieza sirve. Viven en el plan de control.
-- 2) Los LIMITES DE CONTROL salen del propio proceso y dicen si el proceso
--    esta haciendo hoy lo mismo que hacia ayer. Viven aqui.
--
-- Y una regla que casi siempre se rompe: los limites de control se CONGELAN a
-- partir de un estudio, no se recalculan con cada punto nuevo. Si se
-- recalculan, los limites persiguen a los datos, se abren solos conforme el
-- proceso se degrada y la carta deja de detectar nada. Por eso hay una tabla
-- de limites con version vigente y un paso explicito para recalcularlos.

create table if not exists spc_parametros (
  empresa_id                  integer primary key references empresas(id) on delete cascade,
  subgrupos_minimos           integer not null default 25,
  nc_por_fuera_especificacion boolean not null default true,
  nc_por_fuera_control        boolean not null default true,
  nc_por_tendencia            boolean not null default false,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references usuarios(id)
);

create table if not exists spc_limites (
  id                serial primary key,
  empresa_id        integer not null references empresas(id) on delete cascade,
  caracteristica_id integer not null references plan_control_caracteristicas(id) on delete cascade,
  -- Los limites son del proceso, y una maquina distinta es otro proceso.
  -- Si se dejan nulos, aplican a cualquier maquina.
  maquina_id        integer references maquinas(id),
  estatus           text not null default 'vigente' check (estatus in ('vigente','obsoleto')),
  n                 integer not null,
  subgrupos         integer not null,
  x_barra           numeric,
  r_barra           numeric,
  lci_x             numeric, lc_x numeric, lcs_x numeric,
  lci_r             numeric, lc_r numeric, lcs_r numeric,
  sigma_within      numeric,
  sigma_total       numeric,
  cp                numeric, cpk numeric, pp numeric, ppk numeric,
  desde             timestamptz,
  hasta             timestamptz,
  notas             text,
  calculado_por     uuid references usuarios(id),
  created_at        timestamptz not null default now()
);

create unique index if not exists spc_limites_vigente_uq
  on spc_limites(caracteristica_id, coalesce(maquina_id, 0)) where estatus = 'vigente';

create table if not exists spc_subgrupos (
  id                   serial primary key,
  empresa_id           integer not null references empresas(id) on delete cascade,
  caracteristica_id    integer not null references plan_control_caracteristicas(id) on delete cascade,
  ot_id                integer references ordenes_trabajo(id),
  maquina_id           integer references maquinas(id),
  lote_id              integer references lotes(id),
  equipo_id            integer references equipos_medicion(id),
  fecha                timestamptz not null default now(),
  turno                text,
  n                    integer not null,
  media                numeric not null,
  rango                numeric not null,
  minimo               numeric not null,
  maximo               numeric not null,
  desv                 numeric,
  fuera_especificacion boolean not null default false,
  fuera_control        boolean not null default false,
  reglas               text,
  limites_id           integer references spc_limites(id),
  alerta_id            integer references calidad_alertas(id),
  nc_id                integer references no_conformidades(id),
  notas                text,
  capturado_por        uuid references usuarios(id),
  created_at           timestamptz not null default now()
);

create index if not exists spc_subgrupos_carac_idx
  on spc_subgrupos(caracteristica_id, fecha);
create index if not exists spc_subgrupos_ot_idx on spc_subgrupos(ot_id);
create index if not exists spc_subgrupos_equipo_idx on spc_subgrupos(equipo_id, fecha);

create table if not exists spc_mediciones (
  id           serial primary key,
  subgrupo_id  integer not null references spc_subgrupos(id) on delete cascade,
  secuencia    integer not null,
  valor        numeric not null
);
create index if not exists spc_mediciones_sub_idx on spc_mediciones(subgrupo_id, secuencia);

insert into spc_parametros(empresa_id) select id from empresas
on conflict (empresa_id) do nothing;

insert into modulos(clave, nombre, orden)
select 'cal_spc', 'Cartas de Control y Capacidad', 72
where not exists (select 1 from modulos where clave = 'cal_spc');

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select pr.rol, (select id from modulos where clave = 'cal_spc'),
       pr.puede_ver, true, pr.puede_editar, false,
       pr.rol in ('gerente_calidad','sgc','admin')
from permisos_rol pr
join modulos m on m.id = pr.modulo_id
where m.clave = 'cal_plan_control'
  and not exists (
    select 1 from permisos_rol x
    where x.rol = pr.rol and x.modulo_id = (select id from modulos where clave = 'cal_spc')
  );

-- Produccion captura en la terminal: es quien mide durante la corrida.
insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r, (select id from modulos where clave = 'cal_spc'), true, true, false, false, false
from unnest(array['produccion','gerente_produccion']) r
where not exists (
  select 1 from permisos_rol x
  where x.rol = r and x.modulo_id = (select id from modulos where clave = 'cal_spc')
);
