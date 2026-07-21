// Unidades de manejo (LPN): cajas y tarimas master.
// La caja nace al declarar produccion o al recibir; la tarima agrupa cajas para
// mover muchas de golpe. Usar la tarima es OPCIONAL: el material se puede mover
// caja por caja. El inventario por cantidad (existencias) sigue siendo la verdad
// cuantitativa; los contenedores son la capa de manejo y trazabilidad fina.

// Genera el folio consecutivo (CJ-AAMMDD-### / TA-AAMMDD-###)
export async function folioContenedor(supabase, empresaId, tipo) {
  const { data, error } = await supabase.rpc('generar_folio_contenedor', { p_empresa_id: empresaId, p_tipo: tipo })
  if (error) throw new Error('No se pudo generar el folio de contenedor: ' + error.message)
  return data
}

// Crea las cajas de una cantidad segun el SNP. Devuelve las cajas creadas.
// snp <= 0 -> una sola caja con toda la cantidad.
export async function crearCajas(supabase, {
  empresaId, articuloId, loteId, moldeId = null, cantidad, snp = 0,
  almacenId, ubicacionId = null, origen = null, usuarioId,
}) {
  const total = Number(cantidad) || 0
  if (total <= 0) return []
  const porCaja = Number(snp) > 0 ? Number(snp) : total
  const n = Math.ceil(total / porCaja)
  const cajas = []
  for (let i = 0; i < n; i++) {
    const cant = i === n - 1 ? total - porCaja * (n - 1) : porCaja
    const folio = await folioContenedor(supabase, empresaId, 'caja')
    const { data, error } = await supabase.from('contenedores').insert({
      empresa_id: empresaId, folio, tipo: 'caja', articulo_id: articuloId, lote_id: loteId,
      molde_id: moldeId, cantidad: cant, almacen_id: almacenId, ubicacion_id: ubicacionId,
      origen, creado_por: usuarioId,
    }).select().single()
    if (error) throw error
    cajas.push(data)
  }
  return cajas
}

// Dos articulos son agrupables en la misma tarima si son el mismo articulo
// o si comparten molde (izquierda y derecha de un molde familiar).
export function agrupables(articuloA, articuloB, cavidades = []) {
  if (!articuloA || !articuloB) return false
  if (articuloA === articuloB) return true
  const moldesA = cavidades.filter(c => c.articulo_id === articuloA).map(c => c.molde_id)
  const moldesB = cavidades.filter(c => c.articulo_id === articuloB).map(c => c.molde_id)
  return moldesA.some(m => moldesB.includes(m))
}

// Cajas activas de un contenedor tarima
export const cajasDe = (contenedores, tarimaId) =>
  contenedores.filter(c => c.padre_id === tarimaId && c.estatus === 'activo')

// Contenido de una tarima: total de piezas, numero de cajas y lotes distintos
export function resumenTarima(contenedores, tarimaId, lotes = []) {
  const cajas = cajasDe(contenedores, tarimaId)
  const total = cajas.reduce((s, c) => s + Number(c.cantidad), 0)
  const lotesIds = [...new Set(cajas.map(c => c.lote_id).filter(Boolean))]
  const articulos = [...new Set(cajas.map(c => c.articulo_id).filter(Boolean))]
  return {
    cajas: cajas.length, total, articulos,
    lotes: lotesIds.map(id => lotes.find(l => l.id === id)?.codigo_lote).filter(Boolean),
  }
}

// Mueve un contenedor (y sus cajas hijas si es tarima) a otro almacen/ubicacion.
// No toca existencias: eso lo hace el flujo de traspaso, que es la verdad cuantitativa.
export async function moverContenedor(supabase, contenedorId, { almacenId, ubicacionId = null }) {
  const { error } = await supabase.from('contenedores')
    .update({ almacen_id: almacenId, ubicacion_id: ubicacionId })
    .or(`id.eq.${contenedorId},padre_id.eq.${contenedorId}`)
  if (error) throw error
}
