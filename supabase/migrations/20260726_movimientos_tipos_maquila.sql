-- Capa 9 Fase 3/4: tipos de movimiento de maquila (free-issue, recepcion, consumo).
alter table movimientos drop constraint if exists movimientos_tipo_check;
alter table movimientos add constraint movimientos_tipo_check
  check (tipo = any (array[
    'entrada_inicial','ajuste_positivo','ajuste_negativo','traspaso','liberacion_calidad',
    'rechazo_calidad','consumo_produccion','entrada_produccion','salida_embarque',
    'salida_maquila','entrada_maquila','consumo_maquila'
  ]));
