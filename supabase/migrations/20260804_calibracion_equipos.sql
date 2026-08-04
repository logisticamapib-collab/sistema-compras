-- CALIBRACION DE EQUIPOS DE MEDICION (IATF 16949, 7.1.5.2)
--
-- Un dato medido con un equipo vencido no vale, y peor: no se nota. La carta
-- de control se ve normal, el Cpk sale bien y el producto se embarca. Por eso
-- el padron de equipos no es un catalogo administrativo, es el cimiento del
-- SPC: si el equipo no esta vigente, la medicion que produce no es evidencia
-- de nada.
--
-- La norma pide ademas que cuando un equipo se encuentra fuera de calibracion
-- se evalue la validez de lo que se midio con el desde la ultima calibracion
-- buena. Por eso cada calibracion rechazada guarda desde cuando queda en duda.

create table if not exists calibracion_parametros (
  empresa_id        integer primary key references empresas(id) on delete cascade,
  dias_aviso        integer not null default 30,
  rr_aceptable_pct  numeric not null default 10,
  rr_marginal_pct   numeric not null default 30,
  ndc_minimo        integer not null default 5,
  updated_at        timestamptz not null default now(),
  updated_by        uuid references usuarios(id)
);

create table if not exists equipos_medicion (
  id                  serial primary key,
  empresa_id          integer not null references empresas(id) on delete cascade,
  site_id             integer references sites(id),
  clave               text not null,
  nombre              text not null,
  tipo                text,
  marca               text,
  modelo              text,
  serie               text,
  resolucion          numeric,
  rango_min           numeric,
  rango_max           numeric,
  unidad              text,
  area                text,
  responsable_id      uuid references usuarios(id),
  intervalo_meses     integer not null default 12,
  ultima_calibracion  date,
  proxima_calibracion date,
  estatus             text not null default 'activo'
                        check (estatus in ('activo','fuera_de_servicio','baja')),
  requiere_rr         boolean not null default false,
  ultimo_rr_fecha     date,
  ultimo_rr_pct       numeric,
  ultimo_rr_resultado text,
  notas               text,
  activo              boolean not null default true,
  created_at          timestamptz not null default now()
);

create unique index if not exists equipos_medicion_clave_uq
  on equipos_medicion(empresa_id, upper(clave));
create index if not exists equipos_medicion_proxima_idx on equipos_medicion(proxima_calibracion);

create table if not exists calibraciones (
  id                 serial primary key,
  empresa_id         integer not null references empresas(id) on delete cascade,
  equipo_id          integer not null references equipos_medicion(id) on delete cascade,
  fecha              date not null,
  tipo               text not null default 'externa'
                       check (tipo in ('externa','interna','verificacion')),
  laboratorio        text,
  numero_certificado text,
  patron             text,
  trazabilidad       text,
  resultado          text not null
                       check (resultado in ('aprobado','aprobado_con_ajuste','rechazado')),
  error_encontrado   numeric,
  incertidumbre      numeric,
  proxima_fecha      date,
  -- Desde cuando queda en duda lo medido con este equipo. Solo se llena
  -- cuando la calibracion sale rechazada, y es la fecha de la ultima
  -- calibracion buena: todo lo medido entre esa fecha y hoy hay que revisarlo.
  impacto_desde      date,
  documento_url      text,
  notas              text,
  capturado_por      uuid references usuarios(id),
  created_at         timestamptz not null default now()
);

create index if not exists calibraciones_equipo_idx on calibraciones(equipo_id, fecha desc);

-- Estudios R&R / MSA (IATF 7.1.5.1.1). Aqui se guarda el RESULTADO del
-- estudio y su evidencia, no se calcula el estudio.
create table if not exists equipo_rr (
  id             serial primary key,
  empresa_id     integer not null references empresas(id) on delete cascade,
  equipo_id      integer not null references equipos_medicion(id) on delete cascade,
  fecha          date not null,
  articulo_id    integer references articulos(id),
  caracteristica text,
  operadores     integer,
  partes         integer,
  ensayos        integer,
  pct_rr         numeric,
  ndc            integer,
  resultado      text check (resultado in ('aceptable','marginal','inaceptable')),
  documento_url  text,
  notas          text,
  capturado_por  uuid references usuarios(id),
  created_at     timestamptz not null default now()
);

insert into calibracion_parametros(empresa_id)
select id from empresas
on conflict (empresa_id) do nothing;

insert into modulos(clave, nombre, orden)
select 'cal_calibracion', 'Calibracion de Equipos', 70
where not exists (select 1 from modulos where clave = 'cal_calibracion');

-- Permisos: se copian de No Conformidades, que es el modulo de Calidad con el
-- reparto de roles mas parecido, y encima se ajusta quien captura. Registrar
-- certificados es trabajo de Calidad; los demas roles consultan si un equipo
-- esta vigente, que es lo que necesitan antes de medir.
insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select pr.rol, (select id from modulos where clave = 'cal_calibracion'),
       pr.puede_ver, pr.puede_crear, pr.puede_editar, false,
       pr.rol in ('gerente_calidad','sgc','admin','direccion')
from permisos_rol pr
join modulos m on m.id = pr.modulo_id
where m.clave = 'cal_nc'
  and not exists (
    select 1 from permisos_rol x
    where x.rol = pr.rol and x.modulo_id = (select id from modulos where clave = 'cal_calibracion')
  );

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select 'admin', (select id from modulos where clave = 'cal_calibracion'), true, true, true, false, true
where not exists (
  select 1 from permisos_rol x
  where x.rol = 'admin' and x.modulo_id = (select id from modulos where clave = 'cal_calibracion')
);

update permisos_rol
set puede_crear = false, puede_editar = false
where modulo_id = (select id from modulos where clave = 'cal_calibracion')
  and rol in ('produccion','gerente_produccion','gerente_planta','gerente_ingenieria','direccion');
