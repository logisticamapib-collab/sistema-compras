import { supabase } from './supabase'

// Archivos: se guarda la RUTA, no la URL.
//
// QUE ESTABA MAL
//
// Al subir un documento se guardaba en la base la URL publica que devuelve
// Supabase. Esa URL es un enlace permanente y sin autenticacion: quien la
// tenga entra para siempre, aunque ya no trabaje ahi, aunque se le desactive
// la cuenta. Y son dibujos de cliente, PPAPs y certificados.
//
// Ahora se guarda "bucket/ruta" -- por ejemplo calidad/normas_empaque/8/x.pdf
// -- y el enlace se firma en el momento de abrirlo, con una hora de vigencia.
// Copiar ese enlace y mandarlo por mensaje no sirve de nada al dia siguiente.
//
// COMPATIBILIDAD
//
// partesDe() acepta tres formas, porque en la base conviven las tres:
//   "calidad/8/x.pdf"                    lo nuevo
//   "https://...supabase.co/.../public/calidad/8/x.pdf"   lo viejo, ya migrado
//                                        pero por si quedo alguno suelto
//   "https://sitio-de-un-proveedor/..."  un enlace de fuera, escrito a mano.
//                                        Calibracion guarda de estos: se abren
//                                        tal cual y no se firman.

export const VIGENCIA_SEGUNDOS = 60 * 60

const PREFIJO_PUBLICO = '/storage/v1/object/public/'

export function partesDe(valor) {
  const v = String(valor ?? '').trim()
  if (!v) return null

  if (v.startsWith('http')) {
    const i = v.indexOf(PREFIJO_PUBLICO)
    if (i === -1) return { externo: v }
    const resto = v.slice(i + PREFIJO_PUBLICO.length).split('?')[0]
    const j = resto.indexOf('/')
    if (j === -1) return { externo: v }
    return { bucket: resto.slice(0, j), ruta: decodeURIComponent(resto.slice(j + 1)) }
  }

  const j = v.indexOf('/')
  if (j === -1) return { externo: v }
  return { bucket: v.slice(0, j), ruta: v.slice(j + 1) }
}

// Sube y devuelve lo que hay que guardar en la base.
export async function subirArchivo(bucket, ruta, archivo) {
  const { error } = await supabase.storage.from(bucket).upload(ruta, archivo)
  if (error) return { error: error.message }
  return { valor: `${bucket}/${ruta}` }
}

// Enlace temporal para abrir el archivo.
export async function enlaceDe(valor) {
  const p = partesDe(valor)
  if (!p) return { error: 'No hay archivo.' }
  if (p.externo) return { url: p.externo }
  const { data, error } = await supabase.storage.from(p.bucket)
    .createSignedUrl(p.ruta, VIGENCIA_SEGUNDOS)
  if (error) return { error: error.message }
  return { url: data.signedUrl }
}
