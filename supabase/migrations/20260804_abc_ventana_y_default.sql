-- Ventana del Pareto ABC.
--
-- Sin ventana, el ABC se calcula sobre toda la historia y una pieza que se
-- dejo de correr hace dos anos sigue saliendo clase A, robandole frecuencia
-- de conteo a lo que si se esta moviendo hoy. Doce meses cubre el ciclo
-- completo de programas del cliente sin arrastrar lo muerto.
alter table inventario_parametros
  add column if not exists meses_abc integer not null default 12;

comment on column inventario_parametros.meses_abc is
  'Meses hacia atras que considera el Pareto ABC. Fuera de esa ventana el movimiento no cuenta.';

-- El criterio ABC por defecto depende del tipo de articulo:
--   fabricado -> piezas embarcadas (lo que se le manda al cliente)
--   comprado  -> valor de consumo (lo que amarra dinero en almacen)
-- 'manual' queda como palanca para forzar un numero de parte en concreto,
-- no como valor de arranque: mientras un articulo diga manual y no tenga
-- clase, el ciclico lo trata como C y se cuenta lo menos posible.
update articulos
set abc_criterio = case when origen = 'fabricado' then 'piezas' else 'costo' end
where abc_criterio is null;

alter table articulos alter column abc_criterio set default 'piezas';
