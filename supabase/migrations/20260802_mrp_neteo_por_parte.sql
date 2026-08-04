-- =====================================================================
-- MRP: neteo por PARTE equivalente.
--
-- Cuando dos moldes fabrican la misma pieza con codigos distintos, la
-- demanda llega contra UN codigo pero el inventario puede estar en el otro.
-- Hasta ahora el MRP neteaba codigo por codigo: veia cero existencia del
-- codigo pedido y planeaba produccion de mas, ignorando las piezas
-- disponibles del molde gemelo.
--
-- Correccion: antes de netear, la demanda, las recepciones programadas y el
-- inventario de todos los codigos de una parte se juntan en el codigo
-- PRINCIPAL, que es con el que se planea y se produce. El neteo se hace una
-- sola vez sobre el total real y la orden sugerida sale al codigo correcto.
-- Los codigos secundarios dejan de planearse por su cuenta. Los articulos
-- sin parte no cambian en nada.
--
-- Verificado: con 8,000 pz de demanda el MRP sugeria 7,800 pz; al agrupar el
-- codigo del molde gemelo, que tenia 1,500 pz liberadas, la sugerencia baja
-- a 6,300 pz y el codigo secundario queda en cero.
--
-- El parche se aplica sobre la definicion viva de la funcion para no
-- reescribir sus 14 KB a mano y arriesgar perder logica en el camino. Es
-- idempotente: si ya esta aplicado no hace nada.
-- =====================================================================
DO $mig$
DECLARE
  v_def text;
  v_ancla text := 'GROUP BY l.articulo_id;';
  v_bloque text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO v_def
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'mrp_correr'
    AND pg_get_function_identity_arguments(p.oid) LIKE '%p_site_id integer%';

  IF v_def IS NULL THEN
    RAISE EXCEPTION 'No se encontro mrp_correr con p_site_id';
  END IF;

  IF (length(v_def) - length(replace(v_def, v_ancla, ''))) / length(v_ancla) <> 1 THEN
    RAISE EXCEPTION 'El ancla no es unica; abortado para no corromper la funcion';
  END IF;

  IF position('PARTES EQUIVALENTES' in v_def) > 0 THEN
    RAISE NOTICE 'El neteo por parte ya estaba aplicado';
    RETURN;
  END IF;

  v_bloque := v_ancla || '

  -- ================= PARTES EQUIVALENTES =================
  -- Dos moldes que hacen la misma pieza generan codigos distintos pero son
  -- intercambiables. Se colapsa todo al codigo PRINCIPAL para netear una
  -- sola vez contra el inventario real del grupo. Sin parte no pasa nada.
  DROP TABLE IF EXISTS _parte_map;
  CREATE TEMP TABLE _parte_map(articulo_id int PRIMARY KEY, principal int) ON COMMIT DROP;
  INSERT INTO _parte_map(articulo_id, principal)
  SELECT a.id, p.articulo_principal_id
  FROM articulos a
  JOIN partes p ON p.id = a.parte_id
  WHERE a.empresa_id = p_empresa_id
    AND p.activo
    AND p.articulo_principal_id IS NOT NULL
    AND p.articulo_principal_id <> a.id;

  IF EXISTS (SELECT 1 FROM _parte_map) THEN
    UPDATE _req  r SET articulo_id = m.principal FROM _parte_map m WHERE r.articulo_id = m.articulo_id;
    UPDATE _rcpt r SET articulo_id = m.principal FROM _parte_map m WHERE r.articulo_id = m.articulo_id;
    UPDATE _onh  o SET articulo_id = m.principal FROM _parte_map m WHERE o.articulo_id = m.articulo_id;

    -- el remapeo pudo generar renglones repetidos: se colapsan sumando
    DROP TABLE IF EXISTS _tmp_req;
    CREATE TEMP TABLE _tmp_req ON COMMIT DROP AS
      SELECT articulo_id, bucket_idx, sum(qty) qty FROM _req GROUP BY 1,2;
    DELETE FROM _req; INSERT INTO _req SELECT * FROM _tmp_req; DROP TABLE _tmp_req;

    DROP TABLE IF EXISTS _tmp_rcpt;
    CREATE TEMP TABLE _tmp_rcpt ON COMMIT DROP AS
      SELECT articulo_id, bucket_idx, sum(qty) qty FROM _rcpt GROUP BY 1,2;
    DELETE FROM _rcpt; INSERT INTO _rcpt SELECT * FROM _tmp_rcpt; DROP TABLE _tmp_rcpt;

    DROP TABLE IF EXISTS _tmp_onh;
    CREATE TEMP TABLE _tmp_onh ON COMMIT DROP AS
      SELECT articulo_id, sum(qty) qty FROM _onh GROUP BY 1;
    DELETE FROM _onh; INSERT INTO _onh SELECT * FROM _tmp_onh; DROP TABLE _tmp_onh;

    -- los codigos secundarios ya no se planean por su cuenta
    DELETE FROM _arts WHERE id IN (SELECT articulo_id FROM _parte_map);
  END IF;
  -- ================= FIN PARTES EQUIVALENTES =================';

  v_def := replace(v_def, v_ancla, v_bloque);
  EXECUTE v_def;
  RAISE NOTICE 'Neteo por parte aplicado a mrp_correr';
END $mig$;

-- La version de 5 argumentos quedo muerta: el frontend siempre manda
-- p_site_id, asi que PostgREST solo resolvia la de 6. Tener dos overloads
-- hacia que un arreglo pudiera aplicarse a la que nadie llama.
drop function if exists mrp_correr(integer, text, text, integer, text);
