-- Facturas de proveedor y cotejo de tres vias.
--
-- El tercer lado del triangulo de compras. La orden dice que pediste y a que
-- precio, el recibo dice que llego al almacen, y la factura dice que te estan
-- cobrando. Los tres deben cuadrar; donde no cuadran, ahi esta el dinero que
-- se va.
--
-- La liga fina es a nivel LINEA DE RECIBO, no a nivel factura ni a nivel
-- orden. Es el unico punto donde se pueden comparar las tres cosas a la vez:
-- la linea de recibo sabe cuanto llego, de que linea de orden venia -- y con
-- ella el precio pactado -- y a que lote entro. Ligar solo factura contra
-- orden dejaria fuera lo que de verdad se recibio.
--
-- Una factura puede cubrir varios recibos y una linea de recibo puede partirse
-- entre varias facturas, asi que se lleva cuanto se ha facturado de cada linea
-- en vez de una bandera de si/no.
--
-- APLICAR es lo que vuelve FIRME el costo del lote, con el precio y el tipo de
-- cambio del documento que de verdad se paga. Por eso no se aplica si hay
-- diferencias sin autorizar, y ese candado vive aqui y no en la pantalla:
-- aplicar es lo que mueve el valor del inventario.
--
-- La regla de tolerancia no se repite: cotejar_factura llama a la misma
-- funcion que usa la pantalla de configuracion, para que las dos digan
-- exactamente lo mismo.
--
-- Aplicada via apply_migration.

alter table recibo_lineas add column if not exists cantidad_facturada numeric not null default 0;

create table if not exists facturas_proveedor (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  proveedor_id int not null references proveedores(id),
  folio_proveedor text not null,
  uuid_cfdi text,
  fecha date not null default current_date,
  fecha_vencimiento date,
  moneda text not null default 'MXN',
  tipo_cambio numeric,
  subtotal numeric not null default 0,
  descuento numeric not null default 0,
  iva numeric not null default 0,
  retenciones numeric not null default 0,
  total numeric not null default 0,
  estatus text not null default 'capturada'
    check (estatus in ('capturada','en_revision','autorizada','aplicada','rechazada')),
  xml_url text, xml_nombre text, pdf_url text, pdf_nombre text, notas text,
  autorizada_compras_por uuid references usuarios(id), autorizada_compras_at timestamptz,
  autorizada_jefe_por uuid references usuarios(id), autorizada_jefe_at timestamptz,
  aplicada_por uuid references usuarios(id), aplicada_at timestamptz,
  capturado_por uuid references usuarios(id), created_at timestamptz default now(),
  unique (empresa_id, proveedor_id, folio_proveedor)
);

-- El UUID del CFDI es unico por definicion: candado contra capturar dos veces
-- la misma factura.
create unique index if not exists facturas_proveedor_uuid_uq
  on facturas_proveedor (empresa_id, uuid_cfdi) where coalesce(uuid_cfdi,'') <> '';

create table if not exists factura_lineas (
  id serial primary key,
  factura_id int not null references facturas_proveedor(id) on delete cascade,
  recibo_linea_id int not null references recibo_lineas(id),
  cantidad numeric not null check (cantidad > 0),
  precio_unitario numeric not null check (precio_unitario >= 0),
  subtotal numeric not null default 0,
  notas text
);

-- Funciones: cotejar_factura, factura_requiere_autorizacion y aplicar_factura.
-- Modulo com_facturas y sus permisos.
