-- PUESTO, ROL Y JERARQUIA: TRES COSAS DISTINTAS
--
-- Se venian mezclando en un solo campo y por eso aparecia la tentacion de
-- crear un rol por cada nivel de la organizacion. Aqui se separan:
--
--   PUESTO   -> quien eres. Jefe de Moldes, Lider, Coordinador. Dato de RH.
--               Descriptivo, no da ni quita permisos.
--   ROL      -> que puedes ver y hacer. Debe haber POCOS y por funcion, no
--               por nivel: un Lider y un Coordinador de Produccion necesitan
--               los mismos permisos, los distingue el puesto.
--   JERARQUIA-> quien aprueba a quien. Ya vivia en usuarios.gerente_id y se
--               queda ahi; es lo unico que de verdad manda en las compras.
--
-- Si cada nivel fuera un rol, cada modulo nuevo obligaria a decidir permisos
-- siete veces en lugar de una, y casi todas serian copias.

create table if not exists niveles_jerarquicos (
  nivel   integer primary key,
  nombre  text not null,
  orden   integer not null default 0
);

insert into niveles_jerarquicos(nivel, nombre, orden) values
  (1, 'Operativo', 1), (2, 'Lider', 2), (3, 'Supervisor', 3), (4, 'Coordinador', 4),
  (5, 'Jefatura', 5), (6, 'Gerencia', 6), (7, 'Direccion', 7)
on conflict (nivel) do nothing;

create table if not exists puestos (
  id          serial primary key,
  empresa_id  integer not null references empresas(id) on delete cascade,
  clave       text not null,
  nombre      text not null,
  nivel       integer not null default 1 references niveles_jerarquicos(nivel),
  area_id     integer references areas(id),
  activo      boolean not null default true,
  notas       text,
  created_at  timestamptz not null default now()
);
create unique index if not exists puestos_clave_uq on puestos(empresa_id, upper(clave));

alter table usuarios add column if not exists puesto_id integer references puestos(id);

-- ---------- Roles como tabla, no como check ----------
--
-- Estaban en un CHECK de la base y en un arreglo del codigo, asi que agregar
-- "Gerente de Recursos Humanos" obligaba a tocar las dos cosas. Como tabla,
-- se agrega desde la pantalla.
--
-- Las dos banderas sustituyen listas que estaban escritas a mano en el codigo:
--   es_gerencial     -> puede aparecer como jefe que aprueba
--   omite_aprobacion -> su requisicion se va directo a compras sin firma
create table if not exists roles (
  clave            text primary key,
  nombre           text not null,
  descripcion      text,
  nivel            integer references niveles_jerarquicos(nivel),
  es_gerencial     boolean not null default false,
  omite_aprobacion boolean not null default false,
  orden            integer not null default 100,
  activo           boolean not null default true,
  del_sistema      boolean not null default false,
  created_at       timestamptz not null default now()
);

insert into roles(clave, nombre, descripcion, nivel, es_gerencial, omite_aprobacion, orden, del_sistema) values
  ('solicitante',                'Solicitante',                   'Empleado general que levanta requisiciones', 1, false, false, 10, true),
  ('produccion',                 'Produccion (operacion)',        'Captura en piso: OT, reportes, terminal',    1, false, false, 20, true),
  ('calidad',                    'Calidad',                       'Inspeccion, liberacion, SPC',                1, false, false, 30, true),
  ('compras',                    'Compras',                       'Comprador: cotiza y genera ordenes',         1, false, false, 40, true),
  ('logistica',                  'Logistica',                     'Almacenes, embarques, inventario',           1, false, false, 45, false),
  ('customer_service',           'Customer Service',              'Releases y demanda del cliente',             1, false, false, 50, true),
  ('planeacion',                 'Planeacion',                    'MRP, programacion y releases',               1, false, false, 55, false),
  ('mantenimiento',              'Mantenimiento',                 'Ordenes de mantenimiento general y toolcrib',1, false, false, 60, false),
  ('moldes',                     'Moldes',                        'Mantenimiento de moldes, tryouts, traslados',1, false, false, 70, false),
  ('recursos_humanos',           'Recursos Humanos',              'Personal, capacitacion y competencia',       1, false, false, 80, false),
  ('seguridad_higiene',          'Seguridad e Higiene',           'Seguridad, higiene y medio ambiente',        1, false, false, 90, false),
  ('ingenieria',                 'Ingenieria',                    'Rutas, moldes, maquinas, plan de control',   1, false, false, 100, false),
  ('sgc',                        'SGC',                           'Sistema de gestion de calidad y documentos', 1, false, false, 110, true),
  ('ingeniero_nuevos_proyectos', 'Ingeniero de Nuevos Proyectos', 'PPAP, corridas piloto, nuevos numeros',      1, false, false, 120, true),
  ('gerente_area',               'Gerente de Area (generico)',    'Para gerencias que no tienen rol propio',    6, true,  true,  200, true),
  ('gerente_produccion',         'Gerente de Produccion',         null, 6, true,  false, 210, true),
  ('gerente_calidad',            'Gerente de Calidad',            null, 6, true,  false, 220, true),
  ('gerente_logistica',          'Gerente de Logistica',          null, 6, true,  false, 230, true),
  ('gerente_ingenieria',         'Gerente de Ingenieria',         null, 6, true,  false, 240, true),
  ('gerente_compras',            'Gerente de Compras',            null, 6, true,  false, 250, true),
  ('gerente_mantenimiento',      'Gerente de Mantenimiento',      null, 6, true,  false, 260, false),
  ('gerente_rh',                 'Gerente de Recursos Humanos',   null, 6, true,  false, 270, false),
  ('gerente_planta',             'Gerente de Planta',             null, 6, true,  true,  300, true),
  ('gerente_administrativo',     'Gerente Administrativo',        null, 6, true,  true,  310, true),
  ('direccion',                  'Direccion / Director',          null, 7, true,  true,  400, true),
  ('admin',                      'Administrador del sistema',     'Acceso total y configuracion', 7, true, true, 500, true)
on conflict (clave) do nothing;

-- El rol deja de vivir en un check para poder crecer sin tocar codigo.
alter table usuarios drop constraint if exists usuarios_rol_check;
alter table usuarios add constraint usuarios_rol_fk
  foreign key (rol) references roles(clave) on update cascade;

insert into modulos(clave, nombre, orden)
select 'config_roles', 'Roles y Puestos', 8
where not exists (select 1 from modulos where clave = 'config_roles');

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select pr.rol, (select id from modulos where clave = 'config_roles'),
       pr.puede_ver, pr.puede_crear, pr.puede_editar, pr.puede_eliminar, pr.puede_aprobar
from permisos_rol pr
join modulos m on m.id = pr.modulo_id
where m.clave = 'config_usuarios'
  and not exists (
    select 1 from permisos_rol x
    where x.rol = pr.rol and x.modulo_id = (select id from modulos where clave = 'config_roles')
  );
