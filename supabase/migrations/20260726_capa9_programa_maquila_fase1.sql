-- Capa 9 Fase 1: la OM es un PROGRAMA de maquila (release al maquilador) con
-- lineas firme/forecast. El firme se convierte en OC (fase 2). Aplicado via MCP 2026-07-26.
alter table ordenes_maquila drop constraint if exists ordenes_maquila_estatus_check;
alter table ordenes_maquila add constraint ordenes_maquila_estatus_check
  check (estatus in ('borrador','abierta','enviada','en_proceso','recibida_parcial','cerrada','cancelada'));

create table if not exists om_lineas (
  id serial primary key,
  om_id integer not null references ordenes_maquila(id) on delete cascade,
  fecha_requerida date,
  tipo text not null default 'firme' check (tipo in ('firme','forecast')),
  cantidad numeric not null default 0,
  cantidad_oc numeric not null default 0,
  cantidad_recibida numeric not null default 0,
  vigente boolean not null default true,
  corrida_id integer,
  created_at timestamptz default now()
);
create index if not exists idx_omlineas_om on om_lineas(om_id);

alter table om_materiales add column if not exists enviar boolean not null default true;
alter table ordenes_compra add column if not exists om_id integer references ordenes_maquila(id);

grant all on om_lineas to anon, authenticated, service_role;
grant usage, select on sequence om_lineas_id_seq to anon, authenticated, service_role;
