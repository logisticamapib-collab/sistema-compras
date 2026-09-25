-- =====================================================================
-- El SNP de un fabricado sale de su norma de empaque, no se teclea.
--
-- QUE ESTABA MAL
--
-- El mismo numero -- cuantas piezas van en un empaque -- vivia en dos lugares:
-- articulos.snp y normas_empaque.piezas_por_empaque. Nada los amarraba, y las
-- pantallas no se ponian de acuerdo sobre cual creer:
--
--   ListaEmbarque  ->  prefiere articulos.snp, cae a la norma si es cero
--   Inventario     ->  prefiere la norma, cae a articulos.snp
--
-- Resultado: de 6 fabricados con norma oficial activa, 5 tenian un snp que
-- contradecia su norma. Dependiendo de la pantalla, la misma pieza se
-- etiquetaba de 1700 o de 4000.
--
-- Y ademas el campo estaba ESCONDIDO: en la pantalla de Articulos vive dentro
-- del bloque "Datos de abastecimiento", que solo se dibuja cuando el origen es
-- comprado. Para un fabricado no habia forma de verlo ni corregirlo, aunque la
-- carga masiva si lo pidiera. El error fue leer la tabla para armar la
-- plantilla sin revisar si la pantalla exponia ese campo.
--
-- QUIEN MANDA
--
-- La norma. Es el documento que el cliente aprueba y que se audita; el campo
-- del articulo era una copia editable, y una copia editable de un dato
-- aprobado es una divergencia esperando a pasar.
--
-- Para los COMPRADOS no hay norma de empaque, asi que ahi articulos.snp sigue
-- siendo la fuente y se captura a mano como siempre.
--
-- POR QUE EN LA BASE Y NO SOLO EN LA PANTALLA
--
-- Porque la divergencia no la creo la pantalla: la crearon la carga masiva y
-- las correcciones por fuera. Un candado que solo vive en el formulario se
-- salta con un archivo de Excel.
--
-- Se conserva articulos.snp como copia, en vez de borrarlo, porque lo leen
-- varias pantallas e informes. El disparador lo mantiene alineado.
-- =====================================================================

create or replace function public.snp_de_la_norma(p_articulo_id int)
returns numeric language sql stable as $$
  select n.piezas_por_empaque::numeric
  from normas_empaque n
  where n.articulo_id = p_articulo_id and n.tipo = 'oficial' and n.activa
  limit 1;
$$;

-- 1. Al guardar un articulo: si tiene norma oficial activa, el snp es el de la
--    norma. No se rechaza el valor que venga, se corrige: quien captura no
--    tiene por que saber que ese campo lo manda otro documento.
create or replace function public.trg_snp_manda_la_norma()
returns trigger language plpgsql as $$
declare v_snp numeric;
begin
  v_snp := public.snp_de_la_norma(NEW.id);
  if v_snp is not null and coalesce(NEW.snp, 0)::numeric is distinct from v_snp then
    NEW.snp := v_snp;
  end if;
  return NEW;
end $$;

drop trigger if exists zz_snp_manda_la_norma on public.articulos;
create trigger zz_snp_manda_la_norma before update on public.articulos
for each row execute function public.trg_snp_manda_la_norma();

-- 2. Al cambiar la norma: el snp del articulo la sigue.
create or replace function public.trg_norma_empuja_snp()
returns trigger language plpgsql as $$
declare v_art int;
begin
  v_art := coalesce(NEW.articulo_id, OLD.articulo_id);

  update articulos a
     set snp = coalesce(public.snp_de_la_norma(v_art), a.snp)
   where a.id = v_art
     and coalesce(a.snp, 0)::numeric is distinct from coalesce(public.snp_de_la_norma(v_art), a.snp::numeric);

  return null;
end $$;

drop trigger if exists zz_norma_empuja_snp on public.normas_empaque;
create trigger zz_norma_empuja_snp after insert or update or delete on public.normas_empaque
for each row execute function public.trg_norma_empuja_snp();

-- 3. Alinear lo que ya esta. Eran 5 articulos.
update articulos a
   set snp = public.snp_de_la_norma(a.id)
 where public.snp_de_la_norma(a.id) is not null
   and coalesce(a.snp, 0)::numeric is distinct from public.snp_de_la_norma(a.id);

comment on function public.snp_de_la_norma(int) is
  'Piezas por empaque segun la norma OFICIAL activa del articulo. Es la fuente '
  'de verdad del SNP para los fabricados; articulos.snp es una copia que se '
  'mantiene alineada por disparador para no romper las pantallas que la leen.';
