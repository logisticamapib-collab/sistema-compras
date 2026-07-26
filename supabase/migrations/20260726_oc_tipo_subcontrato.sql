-- Capa 9 Fase 2: OC de subcontrato (firme del programa de maquila -> OC).
alter table ordenes_compra drop constraint if exists ordenes_compra_tipo_check;
alter table ordenes_compra add constraint ordenes_compra_tipo_check
  check (tipo = any (array['con_requisicion','directa','subcontrato']));
