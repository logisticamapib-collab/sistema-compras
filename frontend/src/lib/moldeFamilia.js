// Regla unica de "que sale junto de un molde".
//
// Un molde familiar produce varias piezas del MISMO disparo (izquierda y
// derecha). Pero el mismo molde tambien corre variantes que NO salen juntas.
// Como el codigo de articulo cambia en los tres casos, todos se ven igual en
// molde_cavidades y hay que distinguirlos por los datos del articulo:
//
//   mismo molde + mismo color + misma variante    -> familia simultanea
//   mismo molde + distinto color                  -> corridas separadas, con purga
//   mismo molde + mismo color + distinta variante -> corridas separadas, sin purga
//
// La tercera es la mas invisible: el cliente manda la misma pieza a distintos
// paises o plataformas y pide codigos distintos. Es la misma geometria y el
// mismo material; solo cambia el codigo y, a veces, el empaque. Por eso no
// cuesta purga, pero tampoco salen del mismo disparo.
//
// Si el articulo no tiene color ni variante capturados se agrupa con los demas
// que tampoco los tienen, que es exactamente el comportamiento anterior.
//
// OJO: esta regla vive dos veces, aqui y en SQL (familia_simultanea). Si
// cambias una, cambia la otra.

// Normaliza: undefined y null son el mismo grupo "sin capturar".
const campoDe = (articulos, artId, campo) => {
  const a = articulos.find(x => x.id === Number(artId))
  return a && a[campo] != null ? a[campo] : null
}

export const colorDe = (articulos, artId) => campoDe(articulos, artId, 'color_id')
export const varianteDe = (articulos, artId) => campoDe(articulos, artId, 'variante_codigo_id')

// Molde al que pertenece un articulo (por su asignacion de cavidades).
export const moldeDeArticulo = (cavidades, artId) =>
  cavidades.find(c => c.articulo_id === Number(artId))?.molde_id || null

// Articulos que salen del MISMO disparo que el articulo de referencia.
// Devuelve [{ articulo_id, cavidades }].
export function familiaSimultanea(cavidades, articulos, moldeId, articuloRefId) {
  if (!moldeId) return []
  const colorRef = colorDe(articulos, articuloRefId)
  const varRef = varianteDe(articulos, articuloRefId)
  const porArt = {}
  cavidades
    .filter(c => c.molde_id === moldeId && c.articulo_id)
    .forEach(c => {
      if (colorDe(articulos, c.articulo_id) !== colorRef) return
      if (varianteDe(articulos, c.articulo_id) !== varRef) return
      porArt[c.articulo_id] = (porArt[c.articulo_id] || 0) + 1
    })
  return Object.keys(porArt).map(id => ({ articulo_id: Number(id), cavidades: porArt[id] }))
}

// Todos los articulos del molde sin importar color ni variante (para la ruta,
// que es la misma en todos los casos porque el ciclo no cambia).
export function articulosDelMolde(cavidades, moldeId) {
  if (!moldeId) return []
  return [...new Set(cavidades.filter(c => c.molde_id === moldeId && c.articulo_id).map(c => c.articulo_id))]
}

// Corridas separadas del molde: un grupo por color, ordenado de claro a
// oscuro. colores = catalogo [{ id, clave, nombre, orden_secuencia }].
export function variantesColor(cavidades, articulos, colores, moldeId) {
  const grupos = new Map()
  cavidades
    .filter(c => c.molde_id === moldeId && c.articulo_id)
    .forEach(c => {
      const col = colorDe(articulos, c.articulo_id)
      const k = col == null ? 'sin' : col
      if (!grupos.has(k)) grupos.set(k, { color_id: col, articulos: new Set() })
      grupos.get(k).articulos.add(c.articulo_id)
    })
  return [...grupos.values()]
    .map(g => {
      const col = colores.find(x => x.id === g.color_id)
      return {
        ...g,
        articulos: [...g.articulos],
        color: col || null,
        orden: col ? col.orden_secuencia : 999,
      }
    })
    .sort((a, b) => a.orden - b.orden)
}

// Corridas separadas por variante de codigo DENTRO de un color. Si no se pasa
// color se listan todas las del molde. variantes = catalogo
// [{ id, clave, nombre, minutos_cambio }].
export function variantesCodigo(cavidades, articulos, variantes, moldeId, colorId = undefined) {
  const grupos = new Map()
  cavidades
    .filter(c => c.molde_id === moldeId && c.articulo_id)
    .forEach(c => {
      if (colorId !== undefined && colorDe(articulos, c.articulo_id) !== colorId) return
      const va = varianteDe(articulos, c.articulo_id)
      const k = va == null ? 'sin' : va
      if (!grupos.has(k)) grupos.set(k, { variante_codigo_id: va, articulos: new Set() })
      grupos.get(k).articulos.add(c.articulo_id)
    })
  return [...grupos.values()]
    .map(g => {
      const va = variantes.find(x => x.id === g.variante_codigo_id)
      return {
        ...g,
        articulos: [...g.articulos],
        variante: va || null,
        // Cambiar de codigo es cambiar papeles: cero salvo que alguien haya
        // capturado lo que cuesta cambiar tambien el empaque.
        minutos: va ? Number(va.minutos_cambio || 0) : 0,
      }
    })
    .sort((a, b) => String(a.variante?.clave || '').localeCompare(String(b.variante?.clave || '')))
}

// Etiqueta corta del color de un articulo, para las listas.
export const etiquetaColor = (articulos, colores, artId) => {
  const cid = colorDe(articulos, artId)
  if (cid == null) return null
  const c = colores.find(x => x.id === cid)
  return c ? (c.clave || c.nombre) : null
}

// Etiqueta corta de la variante de codigo, para las listas.
export const etiquetaVariante = (articulos, variantes, artId) => {
  const vid = varianteDe(articulos, artId)
  if (vid == null) return null
  const v = variantes.find(x => x.id === vid)
  return v ? (v.clave || v.nombre) : null
}
