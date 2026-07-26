-- Capa 9 Fase 4: el PT recibido de maquila entra con lote origen 'maquila'.
alter table lotes drop constraint if exists lotes_origen_check;
alter table lotes add constraint lotes_origen_check
  check (origen = any (array['inicial','produccion','compra','ajuste','consigna','maquila']));
