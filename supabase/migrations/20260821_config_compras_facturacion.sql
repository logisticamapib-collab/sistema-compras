-- Hasta donde llega el modulo de compras de cada empresa.
--
-- En compras hay tres documentos que deben cuadrar: la orden dice que pediste
-- y a que precio, el recibo dice que llego al almacen, y la factura dice que
-- te estan cobrando. Los dos primeros ya estan amarrados; el tercero se
-- habilita aqui.
--
-- No todas las plantas quieren llegar igual de lejos: en muchas, la factura la
-- lleva contabilidad en su propio sistema. Por eso el nivel se configura en
-- vez de imponerse, y de paso evita el peor error de diseno de todos: ofrecer
-- una opcion que el sistema no puede cumplir. Con nivel 'recibo', la politica
-- de moneda deja de ofrecer "congelar al facturar", porque no habria quien
-- registrara esa factura.
--
--   recibo : el costo queda firme al recibir. No se capturan facturas.
--   cotejo : se captura la factura, se liga a sus recibos, y se compara
--            cantidad, precio y tipo de cambio contra la orden y el recibo.
--            Es donde se detecta que te cobraron de mas.
--   cxp    : lo anterior mas vencimientos, antiguedad de saldos y programacion
--            de pagos. Aqui es donde despues se cuelga la contabilidad.
--
-- Las tolerancias existen porque una diferencia de centavos por redondeo no
-- deberia frenar una factura, y un sobreprecio del 15% no deberia pasar solo.
-- Cada empresa decide donde esta esa raya y quien la autoriza.
--
-- En la tolerancia 'ambas' basta con caber en UNA de las dos: la diferencia es
-- chica en porcentaje O es chica en dinero. Exigir las dos convertiria una
-- tolerancia amplia en una estrecha sin que nadie lo notara.
--
-- Aplicada via apply_migration.

create table if not exists config_compras (
  empresa_id int primary key references empresas(id) on delete cascade,
  nivel_facturacion text not null default 'recibo'
    check (nivel_facturacion in ('recibo', 'cotejo', 'cxp')),
  tolerancia_tipo text not null default 'ninguna'
    check (tolerancia_tipo in ('ninguna', 'porcentaje', 'monto', 'ambas')),
  tolerancia_pct numeric not null default 0 check (tolerancia_pct >= 0),
  tolerancia_monto numeric not null default 0 check (tolerancia_monto >= 0),
  autoriza_compras boolean not null default true,
  autoriza_jefe boolean not null default false,
  captura_xml boolean not null default false,
  updated_at timestamptz default now(),
  updated_by uuid references usuarios(id)
);

-- Funcion diferencia_dentro_de_tolerancia(empresa, esperado, real): vive en la
-- base para que la pantalla de facturas, los reportes y cualquier automatismo
-- futuro apliquen exactamente la misma regla.
--
-- Modulo config_compras y sus permisos.
