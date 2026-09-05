-- =====================================================================
-- SEGURIDAD 7 de 8 — Los documentos dejan de estar publicados.
--
-- QUE ESTABA MAL
--
-- Los tres buckets eran publicos y, peor, las politicas de lectura decian:
--
--   Public read calidad -> USING (bucket_id = 'calidad')   para el rol public
--
-- Sin una sola comprobacion de sesion. Volver el bucket privado no habria
-- bastado: la politica seguiria dejando leer a quien no ha iniciado sesion.
-- Es la misma trampa del EXECUTE a PUBLIC en las funciones (archivo 01), y por
-- eso se cambian las dos cosas a la vez.
--
-- Y aparte, el sistema guardaba la URL publica dentro de la base. Esa URL es
-- un enlace permanente y sin autenticacion: quien la tenga entra para siempre,
-- aunque se le desactive la cuenta. Son dibujos de cliente, PPAPs, PSWs y
-- certificados de material.
--
-- QUE SE HACE
--
-- Se guarda la RUTA ("calidad/8/PSW_x.pdf") en vez de la URL, y la aplicacion
-- firma un enlace de una hora al abrir el documento (lib/archivos.js). Se
-- convirtieron 8 valores en 4 columnas y se comprobo uno por uno que la ruta
-- resultante corresponde a un archivo que existe de verdad en storage.
--
-- empresa-assets se queda PUBLICO a proposito: solo tiene el logo, que no es
-- confidencial, y un enlace que caduca se romperia dentro de los PDFs ya
-- impresos y de los correos ya enviados.
--
-- calibraciones.documento_url y equipo_rr.documento_url NO se tocan: ahi el
-- usuario escribe a mano la direccion de un documento de fuera. La aplicacion
-- distingue las dos formas y esos los abre tal cual, sin firmarlos.
--
-- LO QUE NO HACE
--
-- Separar por empresa o por planta: hoy cualquier usuario con sesion puede
-- leer cualquier documento del proyecto. Como cada empresa tiene su propio
-- proyecto de Supabase, "cualquier usuario con sesion" es "cualquier usuario
-- de la empresa". La separacion por planta llega con el paso de sites.
-- =====================================================================

-- 1. La URL guardada se vuelve ruta.
update liberaciones_calidad set ppap_url        = regexp_replace(ppap_url,        '^https?://[^/]+/storage/v1/object/public/', '') where ppap_url        like 'http%';
update liberaciones_calidad set psw_url         = regexp_replace(psw_url,         '^https?://[^/]+/storage/v1/object/public/', '') where psw_url         like 'http%';
update normas_empaque       set documento_url   = regexp_replace(documento_url,   '^https?://[^/]+/storage/v1/object/public/', '') where documento_url   like 'http%';
update recibo_lineas        set certificado_url = regexp_replace(certificado_url, '^https?://[^/]+/storage/v1/object/public/', '') where certificado_url like 'http%';

-- Las que hoy estan vacias, para que no queden con la forma vieja el dia que
-- alguien suba algo con una version anterior del codigo.
update documentos                  set archivo_url            = regexp_replace(archivo_url,            '^https?://[^/]+/storage/v1/object/public/', '') where archivo_url            like 'http%';
update niveles_ingenieria          set documento_url          = regexp_replace(documento_url,          '^https?://[^/]+/storage/v1/object/public/', '') where documento_url          like 'http%';
update ordenes_compra              set cotizacion_archivo_url = regexp_replace(cotizacion_archivo_url, '^https?://[^/]+/storage/v1/object/public/', '') where cotizacion_archivo_url like 'http%';
update solicitudes_maquina_alterna set doc_url                = regexp_replace(doc_url,                '^https?://[^/]+/storage/v1/object/public/', '') where doc_url                like 'http%';
update registros_archivados        set archivo_url            = regexp_replace(archivo_url,            '^https?://[^/]+/storage/v1/object/public/', '') where archivo_url            like 'http%';
update facturas_proveedor          set pdf_url                = regexp_replace(pdf_url,                '^https?://[^/]+/storage/v1/object/public/', '') where pdf_url                like 'http%';
update facturas_proveedor          set xml_url                = regexp_replace(xml_url,                '^https?://[^/]+/storage/v1/object/public/', '') where xml_url                like 'http%';

-- 2. Los buckets dejan de ser publicos.
update storage.buckets set public = false where id in ('calidad', 'cotizaciones');

-- 3. Las politicas de lectura. Las viejas no comprueban sesion.
drop policy if exists "Public read calidad"      on storage.objects;
drop policy if exists "Public read cotizaciones" on storage.objects;

create policy "Leer calidad con sesion" on storage.objects
  for select to authenticated using (bucket_id = 'calidad');

create policy "Leer cotizaciones con sesion" on storage.objects
  for select to authenticated using (bucket_id = 'cotizaciones');
