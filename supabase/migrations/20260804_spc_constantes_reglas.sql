-- Constantes de las cartas por variables (tablas AIAG / ASTM).
-- d2 convierte el rango promedio en desviacion estandar del proceso; A2, D3 y
-- D4 son los factores de los limites de control a tres sigma.
create or replace function spc_constantes(p_n integer)
returns table(d2 numeric, a2 numeric, d3 numeric, d4 numeric)
language sql immutable as $$
  select t.d2, t.a2, t.d3, t.d4 from (values
    (1,  1.128, 2.660, 0.000, 3.267),   -- X-mR: A2 hace de E2 y el rango es movil
    (2,  1.128, 1.880, 0.000, 3.267),
    (3,  1.693, 1.023, 0.000, 2.574),
    (4,  2.059, 0.729, 0.000, 2.282),
    (5,  2.326, 0.577, 0.000, 2.114),
    (6,  2.534, 0.483, 0.000, 2.004),
    (7,  2.704, 0.419, 0.076, 1.924),
    (8,  2.847, 0.373, 0.136, 1.864),
    (9,  2.970, 0.337, 0.184, 1.816),
    (10, 3.078, 0.308, 0.223, 1.777)
  ) as t(n, d2, a2, d3, d4)
  where t.n = least(greatest(coalesce(p_n,5), 1), 10);
$$;

-- Reglas de deteccion de fuera de control (Nelson / Western Electric).
--
-- Solo se evaluan las que de verdad se accionan en piso. Un punto fuera de
-- los limites dice que el proceso cambio; las tendencias dicen que va a
-- cambiar. Se distinguen porque no ameritan la misma reaccion.
create or replace function spc_evaluar_reglas(p_empresa_id integer, p_subgrupo_id integer)
returns table(fuera_control boolean, reglas text)
language plpgsql stable as $$
DECLARE
  s record; lim record;
  m numeric[]; k int; cur numeric; sg numeric;
  v_out boolean := false; v_txt text := '';
  i int; arriba int; abajo int; sube int; baja int;
BEGIN
  select * into s from spc_subgrupos where id = p_subgrupo_id and empresa_id = p_empresa_id;
  if s.id is null then return query select false, null::text; return; end if;

  select * into lim from spc_limites
  where caracteristica_id = s.caracteristica_id and estatus = 'vigente'
    and (maquina_id is null or maquina_id = s.maquina_id)
  order by maquina_id nulls last limit 1;
  if lim.id is null then return query select false, null::text; return; end if;

  -- Regla 1: el punto se salio de los limites de control.
  if lim.lcs_x is not null and (s.media > lim.lcs_x or s.media < lim.lci_x) then
    v_out := true;
    v_txt := v_txt || 'Regla 1: la media se salio de los limites de control. ';
  end if;
  if lim.lcs_r is not null and (s.rango > lim.lcs_r or s.rango < coalesce(lim.lci_r, 0)) then
    v_out := true;
    v_txt := v_txt || 'Regla 1: el rango se salio de los limites de control, la variacion dentro del subgrupo cambio. ';
  end if;

  -- Historia reciente, del mas viejo al mas nuevo, terminando en este punto.
  select array_agg(media order by fecha, id) into m from (
    select x.media, x.fecha, x.id from spc_subgrupos x
    where x.caracteristica_id = s.caracteristica_id
      and (x.maquina_id is not distinct from s.maquina_id)
      and (x.fecha < s.fecha or (x.fecha = s.fecha and x.id <= s.id))
    order by x.fecha desc, x.id desc limit 9
  ) q;

  k := coalesce(array_length(m, 1), 0);
  if k = 0 or lim.lc_x is null then
    return query select v_out, nullif(v_txt, ''); return;
  end if;
  cur := m[k];
  sg := (lim.lcs_x - lim.lc_x) / 3.0;

  -- Regla 2: nueve puntos seguidos del mismo lado de la linea central.
  if k >= 9 then
    arriba := 0; abajo := 0;
    for i in (k - 8)..k loop
      if m[i] > lim.lc_x then arriba := arriba + 1;
      elsif m[i] < lim.lc_x then abajo := abajo + 1; end if;
    end loop;
    if arriba = 9 or abajo = 9 then
      v_txt := v_txt || 'Regla 2: nueve puntos seguidos del mismo lado de la linea central, el proceso se corrio. ';
    end if;
  end if;

  -- Regla 3: seis puntos seguidos subiendo o bajando.
  if k >= 7 then
    sube := 0; baja := 0;
    for i in (k - 5)..k loop
      if m[i] > m[i-1] then sube := sube + 1;
      elsif m[i] < m[i-1] then baja := baja + 1; end if;
    end loop;
    if sube = 6 or baja = 6 then
      v_txt := v_txt || 'Regla 3: seis puntos seguidos en tendencia, el proceso se esta desplazando. ';
    end if;
  end if;

  -- Regla 4: dos de tres puntos mas alla de dos sigma del mismo lado.
  if k >= 3 and sg > 0 then
    arriba := 0; abajo := 0;
    for i in (k - 2)..k loop
      if m[i] > lim.lc_x + 2 * sg then arriba := arriba + 1; end if;
      if m[i] < lim.lc_x - 2 * sg then abajo := abajo + 1; end if;
    end loop;
    if (arriba >= 2 and (cur > lim.lc_x + 2 * sg))
       or (abajo >= 2 and (cur < lim.lc_x - 2 * sg)) then
      v_txt := v_txt || 'Regla 4: dos de tres puntos mas alla de dos sigma del mismo lado. ';
    end if;
  end if;

  -- Regla 5: cuatro de cinco puntos mas alla de una sigma del mismo lado.
  if k >= 5 and sg > 0 then
    arriba := 0; abajo := 0;
    for i in (k - 4)..k loop
      if m[i] > lim.lc_x + sg then arriba := arriba + 1; end if;
      if m[i] < lim.lc_x - sg then abajo := abajo + 1; end if;
    end loop;
    if (arriba >= 4 and (cur > lim.lc_x + sg))
       or (abajo >= 4 and (cur < lim.lc_x - sg)) then
      v_txt := v_txt || 'Regla 5: cuatro de cinco puntos mas alla de una sigma del mismo lado. ';
    end if;
  end if;

  return query select v_out, nullif(v_txt, '');
END $$;
