// Regla unica de "que sale junto de un molde".
//
// Un molde familiar produce varias piezas del MISMO disparo (izquierda y
// derecha). Pero el mismo molde tambien corre VARIANTES DE COLOR, que no
// salen juntas: se corre un color, se purga, y luego el siguiente. Como el
// codigo de articulo cambia con el color, ambos casos se ven igual en
// molde_cavidades y hay que distinguirlos por el color del articulo.
//
//   mismo molde + mismo color    -> familia simultanea (co-productos)
//   mismo molde + distinto color -> variantes secuenciales (una tras otra)
//
// Si el articulo no tiene color capturado se agrupa con los demas sin color,
// que es exactamente el comportamiento anterior a los colores.

// Normaliza el color: undefined y null son el mismo grupo "sin color".
export const colorDe = (articulos, artId) => {
  const a = articulos.find(x => x.id === Number(artId))
  return a && a.color_id != null ? a.color_id : null
}

// Molde al que pertenece un articulo (por su asignacion de cavidades).
export const moldeDeArticulo = (cavidades, artId) =>
  cavidades.find(c => c.articulo_id === Number(artId))?.molde_id || null

// Articulos que salen del MISMO disparo que el articulo de referencia.
// Devuelve [{ articulo_id, cavidades }].
export function familiaSimultanea(cavidades, articulos, moldeId, articuloRefId) {
  if (!moldeId) return []
  const colorRef = colorDe(articulos, articuloRefId)
  const porArt = {}
  cavidades
    .filter(c => c.molde_id === moldeId && c.articulo_id)
    .forEach(c => {
      if (colorDe(articulos, c.articulo_id) !== colorRef) return
      porArt[c.articulo_id] = (porArt[c.articulo_id] || 0) + 1
    })
  return Object.keys(porArt).map(id => ({ articulo_id: Number(id), cavidades: porArt[id] }))
}

// Todos los articulos del molde sin importar color (para la ruta, que es la
// misma para cualquier color porque el ciclo no cambia).
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

// Etiqueta corta del color de un articulo, para las listas.
export const etiquetaColor = (articulos, colores, artId) => {
  const cid = colorDe(articulos, artId)
  if (cid == null) return null
  const c = colores.find(x => x.id === cid)
  return c ? (c.clave || c.nombre) : null
}
