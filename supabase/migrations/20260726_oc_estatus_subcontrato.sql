-- Cadena de aprobacion de OC de subcontrato: gerente_logistica -> revision_compras (precios)
-- -> gerente_compras -> aprobada (compradora envia).
alter table ordenes_compra drop constraint if exists ordenes_compra_estatus_check;
alter table ordenes_compra add constraint ordenes_compra_estatus_check
  check (estatus = any (array[
    'borrador','aprobacion_gerente_area','aprobacion_gerente_planta',
    'aprobacion_gerente_logistica','revision_compras',
    'aprobacion_gerente_compras','aprobacion_direccion','aprobada',
    'enviada_proveedor','confirmada','en_transito','recibida_parcial','recibida','cancelada'
  ]));
