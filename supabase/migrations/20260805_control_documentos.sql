-- CONTROL DE DOCUMENTOS Y REGISTROS (IATF 16949 / ISO 9001, 7.5)
--
-- Son dos cosas distintas que la norma junta en una clausula:
--
--   DOCUMENTOS dicen como se hace algo (procedimientos, instrucciones,
--   formatos, especificaciones). Se controlan por VERSION: importa cual es la
--   buena hoy y que la de ayer ya no se use.
--
--   REGISTROS son evidencia de que algo paso (una carta SPC, un PPAP, una
--   orden). No tienen version: importa cuanto tiempo hay que guardarlos y
--   cuando se pueden destruir.
--
-- El sistema es la copia controlada. Quien abre un documento ve la version
-- vigente y no hay forma de abrir una obsoleta por accidente, que es
-- exactamente lo que pide la norma sobre disponibilidad en el punto de uso.

create table if not exists documentos (
  id                 serial primary key,
  empresa_id         integer not null references empresas(id) on delete cascade,
  codigo             text not null,
  titulo             text not null,
  tipo               text not null default 'procedimiento'
                       check (tipo in ('manual','politica','procedimiento','instruccion_trabajo',
                                       'formato','especificacion','plano','norma_externa',
                                       'plan_calidad','otro')),
  area               text,
  version            integer not null default 1,
  estatus            text not null default 'borrador'
                       check (estatus in ('borrador','vigente','obsoleto')),
  origen             text not null default 'interno' check (origen in ('interno','externo')),
  fuente_externa     text,
  archivo_url        text,
  archivo_nombre     text,
  motivo_cambio      text,
  vigente_desde      date,
  proxima_revision   date,
  elaborado_por      uuid references usuarios(id),
  revisado_por       uuid references usuarios(id),
  aprobado_por       uuid references usuarios(id),
  aprobado_at        timestamptz,
  notas              text,
  created_at         timestamptz not null default now()
);

create unique index if not exists documentos_version_uq
  on documentos(empresa_id, upper(codigo), version);
-- Una sola version vigente por documento. Lo sostiene la base, no la pantalla.
create unique index if not exists documentos_vigente_uq
  on documentos(empresa_id, upper(codigo)) where estatus = 'vigente';
create index if not exists documentos_revision_idx on documentos(proxima_revision)
  where estatus = 'vigente';

-- ---------- Retencion de registros ----------
--
-- IATF 7.5.3.2.1 pide definir tiempos de retencion. Los que vienen sembrados
-- son los de la norma; las CSR de cada cliente pueden pedir mas, y por eso
-- son editables.
create table if not exists registro_tipos (
  id                serial primary key,
  empresa_id        integer not null references empresas(id) on delete cascade,
  clave             text not null,
  nombre            text not null,
  categoria         text,
  base_retencion    text not null default 'anos_calendario'
                      check (base_retencion in ('meses','anos_calendario','vida_pieza_mas_anos','permanente')),
  valor             numeric,
  medio             text not null default 'digital' check (medio in ('fisico','digital','ambos')),
  disposicion       text not null default 'destruir'
                      check (disposicion in ('destruir','archivar','devolver_cliente')),
  responsable_area  text,
  referencia_norma  text,
  notas             text,
  activo            boolean not null default true,
  created_at        timestamptz not null default now()
);
create unique index if not exists registro_tipos_clave_uq
  on registro_tipos(empresa_id, upper(clave));

create table if not exists registros_archivados (
  id                    serial primary key,
  empresa_id            integer not null references empresas(id) on delete cascade,
  tipo_id               integer not null references registro_tipos(id),
  identificador         text not null,
  descripcion           text,
  fecha_registro        date not null,
  -- Para los que se guardan por vida de la pieza. Mientras este vacia, el
  -- registro no se puede purgar: la pieza sigue viva.
  fecha_fin_produccion  date,
  articulo_id           integer references articulos(id),
  cliente_id            integer references clientes(id),
  ubicacion             text,
  archivo_url           text,
  fecha_purga           date,
  -- Retencion legal: si hay una demanda, una auditoria o un reclamo abierto,
  -- el registro no se destruye aunque haya cumplido su periodo.
  retencion_legal       boolean not null default false,
  motivo_retencion      text,
  estatus               text not null default 'vigente'
                          check (estatus in ('vigente','purgado')),
  purgado_por           uuid references usuarios(id),
  purgado_at            timestamptz,
  notas                 text,
  capturado_por         uuid references usuarios(id),
  created_at            timestamptz not null default now()
);
create index if not exists registros_purga_idx on registros_archivados(fecha_purga)
  where estatus = 'vigente';
create index if not exists registros_tipo_idx on registros_archivados(tipo_id);

insert into modulos(clave, nombre, orden)
select 'cal_documentos', 'Control de Documentos y Registros', 73
where not exists (select 1 from modulos where clave = 'cal_documentos');

insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select pr.rol, (select id from modulos where clave = 'cal_documentos'),
       true, pr.puede_crear, pr.puede_editar, false,
       pr.rol in ('gerente_calidad','sgc','admin','direccion')
from permisos_rol pr
join modulos m on m.id = pr.modulo_id
where m.clave = 'cal_plan_control'
  and not exists (
    select 1 from permisos_rol x
    where x.rol = pr.rol and x.modulo_id = (select id from modulos where clave = 'cal_documentos')
  );

-- Un documento vigente lo tiene que poder consultar cualquiera que trabaje
-- con el; controlarlo es otra cosa.
insert into permisos_rol(rol, modulo_id, puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar)
select r, (select id from modulos where clave = 'cal_documentos'), true, false, false, false, false
from unnest(array['produccion','logistica','compras','ingenieria','mantenimiento',
                  'gerente_logistica','gerente_compras','gerente_planta','gerente_administrativo']) r
where not exists (
  select 1 from permisos_rol x
  where x.rol = r and x.modulo_id = (select id from modulos where clave = 'cal_documentos')
);

-- Tipos de registro segun IATF 7.5.3.2.1. Editables: las CSR del cliente
-- pueden pedir mas tiempo, nunca menos.
insert into registro_tipos(empresa_id, clave, nombre, categoria, base_retencion, valor,
                           medio, disposicion, responsable_area, referencia_norma)
select e.id, x.clave, x.nombre, x.cat, x.base, x.val, x.medio, x.disp, x.area, x.ref
from empresas e
cross join (values
  ('PPAP',    'Aprobacion de partes de produccion (PPAP / PSW)', 'Producto',
   'vida_pieza_mas_anos', 1, 'ambos', 'archivar', 'Calidad', 'IATF 7.5.3.2.1'),
  ('HERRAM',  'Registros de herramentales y moldes', 'Herramental',
   'vida_pieza_mas_anos', 1, 'ambos', 'archivar', 'Ingenieria', 'IATF 7.5.3.2.1'),
  ('DISENO',  'Registros de diseno de producto y proceso', 'Ingenieria',
   'vida_pieza_mas_anos', 1, 'digital', 'archivar', 'Ingenieria', 'IATF 7.5.3.2.1'),
  ('OC',      'Ordenes de compra y sus modificaciones', 'Compras',
   'vida_pieza_mas_anos', 1, 'digital', 'destruir', 'Compras', 'IATF 7.5.3.2.1'),
  ('CONTRATO','Contratos y ordenes de venta con sus modificaciones', 'Comercial',
   'vida_pieza_mas_anos', 1, 'ambos', 'archivar', 'Direccion', 'IATF 7.5.3.2.1'),
  ('AUDIT',   'Auditorias internas', 'Sistema',
   'anos_calendario', 3, 'digital', 'destruir', 'Calidad', 'IATF 9.2.2.1'),
  ('REVDIR',  'Revision por la direccion', 'Sistema',
   'anos_calendario', 3, 'digital', 'archivar', 'Direccion', 'IATF 9.3'),
  ('SPC',     'Cartas de control y registros de inspeccion', 'Calidad',
   'anos_calendario', 1, 'digital', 'destruir', 'Calidad', 'IATF 7.5.3.2.1'),
  ('CALIB',   'Certificados de calibracion', 'Metrologia',
   'anos_calendario', 3, 'ambos', 'archivar', 'Calidad', 'IATF 7.1.5.2.1'),
  ('NC',      'No conformidades y acciones correctivas', 'Calidad',
   'anos_calendario', 3, 'digital', 'destruir', 'Calidad', 'IATF 10.2'),
  ('CAPAC',   'Capacitacion y competencia del personal', 'Recursos Humanos',
   'anos_calendario', 3, 'ambos', 'archivar', 'Recursos Humanos', 'IATF 7.2'),
  ('TRAZA',   'Trazabilidad de lote y embarques', 'Logistica',
   'vida_pieza_mas_anos', 1, 'digital', 'destruir', 'Logistica', 'IATF 8.5.2.1')
) as x(clave, nombre, cat, base, val, medio, disp, area, ref)
where not exists (
  select 1 from registro_tipos t
  where t.empresa_id = e.id and upper(t.clave) = upper(x.clave)
);
