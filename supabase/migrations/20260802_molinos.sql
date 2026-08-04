-- =====================================================================
-- MOLINOS.
--
-- El area muele las piezas NG. De ahi sale MOLIDO, que segun el articulo se
-- puede reincorporar a la mezcla (articulos.admite_molido y pct_molido_max
-- ya existian) o venderse. Aparte esta la BARREDURA: resina del piso, de
-- limpiar tolvas o contaminada, que ya no entra a proceso.
--
-- Criterios acordados con la operacion:
--   - El molido entra al inventario a un PORCENTAJE DE RECUPERACION sobre
--     el costo del virgen. El scrap ya se cargo como perdida en la OT, asi
--     que valuarlo a costo pleno duplicaria el valor del inventario.
--   - La barredura lleva su propio porcentaje, mucho menor, porque ya no
--     entra a proceso y a lo mucho se vende como desecho.
--   - La captura es directa por dia y turno.
--   - El molido de consigna sigue la politica del cliente: el material es
--     suyo, y venderlo sin que el contrato lo permita es el riesgo.
--   - Molinos tiene almacen propio pero es de TRANSITO.
-- =====================================================================

alter table articulos add column if not exists tipo_material text;
alter table articulos drop constraint if exists articulos_tipo_material_check;
alter table articulos add constraint articulos_tipo_material_check
  check (tipo_material is null or tipo_material in ('virgen','molido','barredura'));
alter table articulos add column if not exists articulo_virgen_id int references articulos(id);
alter table articulos add column if not exists pct_recuperacion numeric;
alter table articulos add column if not exists permite_venta boolean not null default true;
create index if not exists idx_articulos_tipo_material on articulos(tipo_material);

create table if not exists molino_parametros (
  empresa_id int primary key references empresas(id) on delete cascade,
  almacen_molinos_id int references almacenes(id),
  pct_recuperacion_default numeric not null default 40,
  pct_recuperacion_barredura numeric not null default 5,
  requiere_entrega boolean not null default true,
  updated_at timestamptz default now(),
  updated_by uuid references usuarios(id)
);
insert into molino_parametros (empresa_id) select id from empresas
on conflict (empresa_id) do nothing;

create table if not exists cliente_molido_politica (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  cliente_id int not null references clientes(id) on delete cascade,
  permite_mezcla boolean not null default true,
  permite_venta boolean not null default false,
  retorna_cliente boolean not null default true,
  notas text,
  unique (empresa_id, cliente_id)
);

create table if not exists molino_entregas (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  site_id int references sites(id),
  folio text,
  fecha date not null default current_date,
  almacen_origen_id int references almacenes(id),
  almacen_destino_id int references almacenes(id),
  estatus text not null default 'abierta' check (estatus in ('abierta','entregada','cancelada')),
  entregado_por uuid references usuarios(id),
  recibido_por uuid references usuarios(id),
  recibido_at timestamptz,
  notas text,
  created_at timestamptz default now()
);

create table if not exists molienda (
  id serial primary key,
  empresa_id int not null references empresas(id) on delete cascade,
  site_id int references sites(id),
  fecha date not null default current_date,
  turno text,
  articulo_molido_id int not null references articulos(id),
  kg numeric not null check (kg > 0),
  articulo_ng_id int references articulos(id),
  piezas_ng numeric,
  cliente_id int references clientes(id),
  es_consigna boolean not null default false,
  lote_id int references lotes(id),
  costo_unitario numeric,
  costo_total numeric,
  entrega_id int references molino_entregas(id),
  capturado_por uuid references usuarios(id),
  created_at timestamptz default now()
);
create index if not exists idx_molienda_fecha on molienda(empresa_id, fecha);

alter table movimientos drop constraint if exists movimientos_tipo_check;
alter table movimientos add constraint movimientos_tipo_check
  check (tipo = any (array[
    'entrada_inicial','ajuste_positivo','ajuste_negativo','traspaso',
    'liberacion_calidad','rechazo_calidad','consumo_produccion','entrada_produccion',
    'salida_embarque','salida_maquila','entrada_maquila','consumo_maquila',
    'cuarentena','scrap','retrabajo','surtido_produccion','retorno_suministro',
    'molienda','entrega_molinos','retorno_cliente'
  ]));


-- Crea (o devuelve) el articulo derivado de una resina virgen, con prefijo
-- M- para molido y B- para barredura, para identificarlo de un vistazo.
create or replace function crear_articulo_molido(
  p_empresa_id int, p_articulo_virgen_id int, p_tipo text default 'molido'
)
returns int language plpgsql as $$
DECLARE v_v record; v_id int; v_cod text;
BEGIN
  select * into v_v from articulos where id = p_articulo_virgen_id and empresa_id = p_empresa_id;
  if v_v.id is null then raise exception 'No existe la resina virgen indicada'; end if;
  v_cod := (case when p_tipo = 'barredura' then 'B-' else 'M-' end) || v_v.codigo_interno;

  select id into v_id from articulos where empresa_id = p_empresa_id and codigo_interno = v_cod;
  if v_id is not null then return v_id; end if;

  insert into articulos(
    empresa_id, categoria_id, codigo_interno, descripcion, unidad_medida,
    tipo_moneda, activo, origen, es_consigna, site_id,
    tipo_material, articulo_virgen_id, permite_venta, admite_molido, costo
  ) values (
    p_empresa_id, v_v.categoria_id, v_cod,
    (case when p_tipo = 'barredura' then 'Barredura de ' else 'Molido de ' end)
      || coalesce(v_v.descripcion, v_v.codigo_interno),
    v_v.unidad_medida, v_v.tipo_moneda, true, 'fabricado', v_v.es_consigna, v_v.site_id,
    p_tipo, v_v.id, true, false, 0
  ) returning id into v_id;

  update articulos set tipo_material = coalesce(tipo_material, 'virgen')
  where id = p_articulo_virgen_id;
  return v_id;
END $$;

-- Costo unitario del derivado: porcentaje sobre el costo del virgen. El
-- override por articulo gana; si no, el porcentaje segun sea molido o
-- barredura.
create or replace function costo_molido(p_empresa_id int, p_articulo_molido_id int)
returns numeric language sql stable as $$
  select round(
    coalesce(v.costo, 0) *
    coalesce(
      m.pct_recuperacion,
      case when m.tipo_material = 'barredura'
           then (select pct_recuperacion_barredura from molino_parametros where empresa_id = p_empresa_id)
           else (select pct_recuperacion_default    from molino_parametros where empresa_id = p_empresa_id)
      end, 0)
    / 100.0, 6)
  from articulos m
  left join articulos v on v.id = m.articulo_virgen_id
  where m.id = p_articulo_molido_id;
$$;

-- Registra lo molido en un dia/turno: crea el lote, la existencia en el
-- almacen de Molinos y el movimiento, ya costeado.
create or replace function registrar_molienda(
  p_empresa_id int, p_site_id int, p_fecha date, p_turno text,
  p_articulo_molido_id int, p_kg numeric,
  p_articulo_ng_id int default null, p_piezas_ng numeric default null,
  p_cliente_id int default null, p_usuario uuid default null
)
returns int language plpgsql as $$
DECLARE v_alm int; v_lote int; v_id int; v_costo numeric; v_cons boolean;
BEGIN
  if coalesce(p_kg,0) <= 0 then raise exception 'Los kilos deben ser mayores a cero'; end if;
  select almacen_molinos_id into v_alm from molino_parametros where empresa_id = p_empresa_id;
  if v_alm is null then
    raise exception 'Falta configurar el almacen de Molinos en los parametros del modulo';
  end if;

  select es_consigna into v_cons from articulos where id = p_articulo_molido_id;
  v_costo := costo_molido(p_empresa_id, p_articulo_molido_id);

  insert into lotes(empresa_id, articulo_id, codigo_lote, origen, estatus_calidad, fecha, creado_por)
  values (p_empresa_id, p_articulo_molido_id,
          'MOL-' || to_char(p_fecha,'YYMMDD') || '-' || coalesce(p_turno,'X') || '-' || nextval('molienda_id_seq'),
          'produccion', 'liberado', p_fecha, p_usuario)
  returning id into v_lote;

  insert into existencias(lote_id, almacen_id, ubicacion_id, cantidad)
  values (v_lote, v_alm, null, p_kg);

  insert into movimientos(empresa_id, articulo_id, lote_id, tipo, almacen_destino_id,
                          cantidad, motivo, usuario_id)
  values (p_empresa_id, p_articulo_molido_id, v_lote, 'molienda', v_alm,
          p_kg, 'Molienda del ' || p_fecha || ' turno ' || coalesce(p_turno,'-'), p_usuario);

  insert into molienda(empresa_id, site_id, fecha, turno, articulo_molido_id, kg,
                       articulo_ng_id, piezas_ng, cliente_id, es_consigna,
                       lote_id, costo_unitario, costo_total, capturado_por)
  values (p_empresa_id, p_site_id, p_fecha, p_turno, p_articulo_molido_id, p_kg,
          p_articulo_ng_id, p_piezas_ng, p_cliente_id, coalesce(v_cons,false),
          v_lote, v_costo, round(v_costo * p_kg, 2), p_usuario)
  returning id into v_id;
  return v_id;
END $$;

update articulos set admite_molido = false where tipo_material = 'barredura';

grant select, insert, update, delete on molienda, molino_entregas, cliente_molido_politica
  to anon, authenticated, service_role;
grant select, insert, update on molino_parametros to anon, authenticated, service_role;
grant usage, select on sequence molienda_id_seq, molino_entregas_id_seq, cliente_molido_politica_id_seq
  to anon, authenticated, service_role;
grant execute on function crear_articulo_molido(int, int, text) to anon, authenticated, service_role;
grant execute on function costo_molido(int, int) to anon, authenticated, service_role;
grant execute on function registrar_molienda(int, int, date, text, int, numeric, int, numeric, int, uuid)
  to anon, authenticated, service_role;
