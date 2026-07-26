-- Mtto Moldes Fase C: try-out de liberacion (firmas por area) + reincidencia.
create table if not exists molde_mtto_firmas (
  id serial primary key,
  mtto_id integer not null references molde_mtto(id) on delete cascade,
  area text not null check (area in ('calidad','produccion','ingenieria')),
  decision text not null check (decision in ('aprobada','rechazada')),
  firmado_por uuid, comentario text, fecha timestamptz default now(),
  unique (mtto_id, area));
create index if not exists idx_moldemttofirmas_mtto on molde_mtto_firmas(mtto_id);
grant all on molde_mtto_firmas to anon, authenticated, service_role;
grant usage, select on sequence molde_mtto_firmas_id_seq to anon, authenticated, service_role;
alter table molde_mtto add column if not exists reintentos integer not null default 0;
