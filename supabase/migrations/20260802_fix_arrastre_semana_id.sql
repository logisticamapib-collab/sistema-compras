-- =====================================================================
-- Fix: una OT arrastrada seguia colgada de la semana anterior.
--
-- Sintoma: al arrastrar una OT pendiente a la semana nueva, la fecha se
-- movia pero al volver a presionar "Programar semana" reaparecia el aviso
-- "OT pendientes de la semana del ..." con la misma OT, indefinidamente.
--
-- Causa: programar_semana solo re-secuencia las OT con estatus 'programada'
-- (correcto: una OT que ya esta corriendo no se debe mover de fecha), pero
-- por eso mismo nunca actualizaba semana_id en las 'en_proceso'. Como el
-- aviso se basa en semana_id, la OT seguia perteneciendo a la semana vieja.
--
-- Correccion: al final de programar_semana, toda OT abierta cuya fecha cae
-- dentro de la semana queda ligada a esa semana, sin importar su estatus.
-- La semana de una OT es la de su fecha programada.
-- =====================================================================


create or replace function programar_semana(
  p_empresa_id integer, p_site_id integer, p_semana_inicio date,
  p_usuario_id uuid DEFAULT NULL::uuid, p_cambio_molde_min numeric DEFAULT 60
)
returns integer language plpgsql as $function$
DECLARE
  v_semana int; v_estatus text; v_dom date;
  m record; t record; s record; o record; d date;
  v_dh numeric; v_acc numeric; v_cap numeric;
  v_last_molde int; v_seq int;
  v_remaining numeric; v_started boolean; v_take numeric;
  v_ini_fecha date; v_ini_turno text; v_change numeric;
BEGIN
  v_dom := p_semana_inicio + 6;

  SELECT id, estatus INTO v_semana, v_estatus FROM semanas_produccion
   WHERE empresa_id=p_empresa_id AND site_id IS NOT DISTINCT FROM p_site_id AND semana_inicio=p_semana_inicio;
  IF v_semana IS NULL THEN
    INSERT INTO semanas_produccion(empresa_id, site_id, semana_inicio, estatus, abierta_por)
    VALUES(p_empresa_id, p_site_id, p_semana_inicio, 'abierta', p_usuario_id) RETURNING id INTO v_semana;
  ELSIF v_estatus='cerrada' THEN
    RAISE EXCEPTION 'La semana % esta cerrada; no se puede reprogramar.', p_semana_inicio;
  END IF;

  DROP TABLE IF EXISTS _slots;
  CREATE TEMP TABLE _slots(id serial PRIMARY KEY, maquina_id int, fecha date, turno_orden int, turno_clave text, cap_rem numeric) ON COMMIT DROP;
  FOR m IN SELECT id FROM maquinas WHERE empresa_id=p_empresa_id AND (p_site_id IS NULL OR COALESCE(site_id,p_site_id)=p_site_id) AND COALESCE(activo,true) LOOP
    d := p_semana_inicio;
    WHILE d <= v_dom LOOP
      SELECT horas_efectivas INTO v_dh FROM mrp_calendario WHERE empresa_id=p_empresa_id AND dia_semana=EXTRACT(ISODOW FROM d)::int AND trabaja;
      IF v_dh IS NOT NULL AND v_dh > 0 THEN
        v_acc := 0;
        FOR t IN SELECT * FROM turnos WHERE empresa_id=p_empresa_id AND activo ORDER BY orden LOOP
          EXIT WHEN v_acc >= v_dh;
          v_cap := LEAST(t.horas_efectivas, v_dh - v_acc);
          INSERT INTO _slots(maquina_id,fecha,turno_orden,turno_clave,cap_rem) VALUES(m.id, d, t.orden, t.clave, v_cap);
          v_acc := v_acc + t.horas_efectivas;
        END LOOP;
      END IF;
      d := d + 1;
    END LOOP;
  END LOOP;

  DROP TABLE IF EXISTS _ots;
  CREATE TEMP TABLE _ots(ot_id int, maquina_id int, molde_id int, dur_h numeric, fecha_ord date) ON COMMIT DROP;
  INSERT INTO _ots
  SELECT ot.id,
         COALESCE(ot.maquina_id, (SELECT r.maquina_principal_id FROM rutas_fabricacion r WHERE r.articulo_id=ot.articulo_id ORDER BY r.secuencia LIMIT 1)),
         ot.molde_id,
         GREATEST(
           CASE WHEN ot.molde_id IS NOT NULL THEN
             COALESCE((SELECT max(oa.cantidad_programada / NULLIF((SELECT count(*) FROM molde_cavidades mc WHERE mc.molde_id=ot.molde_id AND mc.articulo_id=oa.articulo_id AND mc.activa),0))
                       FROM ot_articulos oa WHERE oa.ot_id=ot.id),0)
             * COALESCE((SELECT r.tiempo_estandar_seg FROM rutas_fabricacion r WHERE r.articulo_id=ot.articulo_id AND r.tipo_operacion='inyeccion' ORDER BY r.secuencia LIMIT 1),0) / 3600.0
           ELSE
             COALESCE((SELECT sum(oa.cantidad_programada) FROM ot_articulos oa WHERE oa.ot_id=ot.id), ot.cantidad_programada)
             * COALESCE((SELECT r.tiempo_estandar_seg FROM rutas_fabricacion r WHERE r.articulo_id=ot.articulo_id ORDER BY r.secuencia LIMIT 1),0) / 3600.0
           END, 0.25),
         COALESCE(ot.fecha_programada, p_semana_inicio)
  FROM ordenes_trabajo ot
  WHERE ot.empresa_id=p_empresa_id AND (p_site_id IS NULL OR COALESCE(ot.site_id,p_site_id)=p_site_id) AND ot.estatus='programada';

  UPDATE ordenes_trabajo SET secuencia=NULL, cambio_molde_min=0, programada_auto=false WHERE id IN (SELECT ot_id FROM _ots);

  FOR m IN SELECT DISTINCT maquina_id FROM _ots WHERE maquina_id IS NOT NULL LOOP
    v_last_molde := NULL; v_seq := 0;
    FOR o IN SELECT * FROM _ots WHERE maquina_id=m.maquina_id ORDER BY fecha_ord, molde_id LOOP
      v_change := CASE WHEN v_last_molde IS NOT NULL AND o.molde_id IS DISTINCT FROM v_last_molde THEN p_cambio_molde_min/60.0 ELSE 0 END;
      v_remaining := o.dur_h + v_change;
      v_started := false; v_ini_fecha := NULL; v_ini_turno := NULL;
      LOOP
        SELECT * INTO s FROM _slots WHERE maquina_id=m.maquina_id AND cap_rem>0.001 ORDER BY id LIMIT 1;
        EXIT WHEN NOT FOUND;
        IF NOT v_started THEN v_ini_fecha := s.fecha; v_ini_turno := s.turno_clave; v_started := true; END IF;
        v_take := LEAST(v_remaining, s.cap_rem);
        UPDATE _slots SET cap_rem = cap_rem - v_take WHERE id = s.id;
        v_remaining := v_remaining - v_take;
        EXIT WHEN v_remaining <= 0.001;
      END LOOP;
      v_seq := v_seq + 1;
      UPDATE ordenes_trabajo SET
        maquina_id = m.maquina_id,
        fecha_programada = COALESCE(v_ini_fecha, p_semana_inicio),
        turno = COALESCE(v_ini_turno, turno),
        secuencia = v_seq,
        cambio_molde_min = CASE WHEN v_change>0 THEN p_cambio_molde_min ELSE 0 END,
        semana_id = v_semana,
        programada_auto = true
      WHERE id = o.ot_id;
      v_last_molde := o.molde_id;
    END LOOP;
  END LOOP;

  -- ---- FIX ----
  -- La semana de una OT es la de su fecha programada. Las OT 'en_proceso' no
  -- se re-secuencian (no se debe mover una corrida en curso) pero SI deben
  -- quedar ligadas a la semana correcta; si no, un arrastre no surte efecto
  -- y el aviso de pendientes se repite indefinidamente.
  UPDATE ordenes_trabajo SET semana_id = v_semana
  WHERE empresa_id = p_empresa_id
    AND (p_site_id IS NULL OR COALESCE(site_id, p_site_id) = p_site_id)
    AND estatus IN ('programada', 'en_proceso')
    AND fecha_programada BETWEEN p_semana_inicio AND v_dom
    AND semana_id IS DISTINCT FROM v_semana;

  RETURN v_semana;
END $function$;


-- Reparacion de los registros que ya quedaron desalineados
update ordenes_trabajo o
set semana_id = s.id
from semanas_produccion s
where o.estatus in ('programada','en_proceso')
  and s.empresa_id = o.empresa_id
  and s.site_id is not distinct from o.site_id
  and o.fecha_programada between s.semana_inicio and s.semana_inicio + 6
  and o.semana_id is distinct from s.id;
