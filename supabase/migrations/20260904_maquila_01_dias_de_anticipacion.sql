-- =====================================================================
-- Un articulo maquilado no lo fabrica tu maquina.
--
-- QUE ESTABA MAL
--
-- Ninguna funcion del sistema miraba se_maquila: ni mrp_correr, ni
-- plan_maquina, ni secuencia_sugerida, ni capacidad_libre_maquina.
--
-- Consecuencia: para los cuatro QG1HA005A -- que se maquilan en Autycon -- el
-- MRP estimaba la fecha de liberacion con TU capacidad: 4 cavidades, ciclo de
-- 35 segundos, 21.25 horas al dia. Daba 2 dias para una orden de 10,200 y 3
-- para una de 20,400. Numeros correctos, calculados sobre una maquina que no
-- va a usarse.
--
-- QUE NUMEROS SON
--
-- Tres, y son distintos:
--
--   dias_maquila    lo que tarda el maquilador en producirlo
--   dias_traslado   el viaje de ida y vuelta
--   dias_colchon    la reserva de planeacion, para no recibir el mismo dia
--                   que hay que embarcarle al cliente
--
-- El colchon mueve la FECHA. El inventario de seguridad, que ya existe en
-- dias_inventario_seguridad, mueve la CANTIDAD. Son dos cosas y se quieren las
-- dos: llegar con dias de sobra, y con piezas de sobra.
--
-- DONDE VIVEN
--
-- Por omision en el MAQUILADOR: si Autycon tarda 10 dias, se captura una vez y
-- todos sus articulos lo heredan. En el ARTICULO se puede sobrescribir cuando
-- una pieza sea la excepcion.
--
-- Las columnas del articulo son NULAS a proposito. Un cero significaria "sin
-- dias", que es una respuesta valida y distinta de "usa lo del maquilador".
-- Con un DEFAULT 0 no habria forma de distinguirlas.
--
-- UNA SOLA REGLA
--
-- dias_maquila_de() la resuelve, y de ahi la leen el MRP y la pantalla. Cuando
-- la misma cuenta vive en dos lados, tarde o temprano dan numeros distintos:
-- ya paso con el SNP del articulo contra su norma de empaque.
--
-- COMPROBADO
--
-- Con Autycon en 10 + 2 + 5 = 17 dias, los cuatro codigos dan la MISMA fecha de
-- liberacion (11/sep para una demanda del 1/oct) sin importar que la orden sea
-- de 10,200 o de 20,400. Antes daban 2 y 3 dias segun la cantidad. Y con una
-- sobrescritura en un solo articulo, ese pasa a 4 dias y los otros tres siguen
-- en 17.
--
-- PENDIENTE RELACIONADO
--
-- plan_maquina y secuencia_sugerida siguen sin mirar se_maquila. Leen de
-- ordenes_trabajo, asi que un maquilado solo estorba si alguien le crea una OT
-- con maquina. Se atiende cuando se trabaje el modulo de produccion.
-- =====================================================================

alter table proveedores add column if not exists dias_maquila  int not null default 0;
alter table proveedores add column if not exists dias_traslado int not null default 0;
alter table proveedores add column if not exists dias_colchon  int not null default 0;

comment on column proveedores.dias_maquila is
  'Dias que tarda este maquilador en producir, por omision para todos sus articulos.';
comment on column proveedores.dias_colchon is
  'Dias de reserva para no recibir el mismo dia del embarque al cliente.';

-- Nulo = hereda del maquilador. Cero = de verdad son cero dias.
alter table articulos add column if not exists dias_maquila  int;
alter table articulos add column if not exists dias_traslado int;
alter table articulos add column if not exists dias_colchon  int;

comment on column articulos.dias_maquila is
  'Sobrescribe los dias del maquilador para ESTE articulo. Nulo = hereda. '
  'Cero significa cero dias, que no es lo mismo que heredar.';

create or replace function public.dias_maquila_de(p_articulo_id int)
returns table (dias_maquila int, dias_traslado int, dias_colchon int, total int, origen text)
language sql stable as $$
  select
    coalesce(a.dias_maquila,  pr.dias_maquila,  0),
    coalesce(a.dias_traslado, pr.dias_traslado, 0),
    coalesce(a.dias_colchon,  pr.dias_colchon,  0),
    coalesce(a.dias_maquila,  pr.dias_maquila,  0)
      + coalesce(a.dias_traslado, pr.dias_traslado, 0)
      + coalesce(a.dias_colchon,  pr.dias_colchon,  0),
    case
      when not coalesce(a.se_maquila, false) then 'no se maquila'
      when a.maquilador_id is null           then 'sin maquilador asignado'
      when a.dias_maquila is not null or a.dias_traslado is not null or a.dias_colchon is not null
        then 'propio del articulo'
      else 'heredado de ' || coalesce(pr.nombre, '?')
    end
  from articulos a
  left join proveedores pr on pr.id = a.maquilador_id
  where a.id = p_articulo_id;
$$;

comment on function public.dias_maquila_de(int) is
  'Los tres tiempos de un articulo maquilado, ya resueltos: lo propio del '
  'articulo si lo tiene, si no lo del maquilador, si no cero. Es la unica regla; '
  'el MRP y la pantalla leen de aqui para no interpretarla distinto.';

-- ---------------------------------------------------------------------
-- El parche a mrp_correr. Se hace por texto porque la funcion es larga y
-- tiene tres dependientes; reescribirla completa arriesga mas que cambiarle
-- cinco anclas validadas una por una.
-- ---------------------------------------------------------------------
do $$
declare def text; nuevo text;
  a1 text := '  v_ciclo numeric; v_cav int; v_ppd numeric; v_leaddays int;';
  a2 text := '             CASE WHEN COALESCE(a.es_consigna,false) THEN ''consigna'' ELSE cat.tipo END';
  a3 text := '        INTO v_moq, v_mult, v_lead, v_trans, v_origen, v_escons, v_dias, v_snp, v_grupo';
  a4 text := '      v_ciclo := NULL; v_cav := NULL;';
  a5 text := '          IF v_origen=''fabricado'' THEN
            IF v_estimar AND COALESCE(v_ciclo,0)>0 AND COALESCE(v_cav,0)>0 AND v_horas_prom>0 THEN';
begin
  select pg_get_functiondef(p.oid) into def
  from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
  where ns.nspname='public' and p.proname='mrp_correr';

  if def is null then raise exception 'No existe public.mrp_correr'; end if;

  if position('IF v_maq THEN' in def) > 0 then
    raise notice 'mrp_correr ya considera la maquila, no se toca.';
    return;
  end if;

  if position(a1 in def) = 0 or position(a2 in def) = 0 or position(a3 in def) = 0
     or position(a4 in def) = 0 or position(a5 in def) = 0 then
    raise exception 'Alguna ancla no se encontro; no se modifica la funcion.';
  end if;

  nuevo := def;
  nuevo := replace(nuevo, a1, a1 || E'\n  v_maq boolean; v_dmaq int;');
  nuevo := replace(nuevo, a2, a2 || ', COALESCE(a.se_maquila,false)');
  nuevo := replace(nuevo, a3, a3 || ', v_maq');
  nuevo := replace(nuevo, a4, a4 || E'\n      -- Si se maquila, los dias los pone el maquilador, no nuestra maquina.\n      SELECT total INTO v_dmaq FROM dias_maquila_de(v_art);');
  nuevo := replace(nuevo, a5,
       E'          IF v_maq THEN\n'
    || E'            -- No lo fabrica nuestra maquina: la fecha la manda el maquilador.\n'
    || E'            -- dias_maquila + dias_traslado + dias_colchon, en dias HABILES,\n'
    || E'            -- resueltos por dias_maquila_de: lo propio del articulo si lo\n'
    || E'            -- tiene, si no lo del maquilador. La cantidad de la orden NO\n'
    || E'            -- mueve esta fecha, que era el error anterior.\n'
    || E'            v_flib := mrp_restar_habiles(p_empresa_id, v_b.ini, GREATEST(COALESCE(v_dmaq,0), 0));\n'
    || E'          ELSIF v_origen=''fabricado'' THEN\n'
    || E'            IF v_estimar AND COALESCE(v_ciclo,0)>0 AND COALESCE(v_cav,0)>0 AND v_horas_prom>0 THEN');

  execute nuevo;
end $$;
