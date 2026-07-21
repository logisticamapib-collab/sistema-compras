// Utilidades para las etiquetas de identificacion de material.
// El QR contiene UNICAMENTE el codigo de lote: al escanearlo, el sistema
// resuelve articulo, cliente, cantidad, maquina, lado y tipo desde la base.

// Detecta el lado (RH/LH) desde la descripcion del articulo.
// Reconoce: RH, LH, R/H, L/H, DERECHO/DERECHA, IZQUIERDO/IZQUIERDA.
export function ladoDeDescripcion(descripcion) {
  const d = (descripcion || '').toUpperCase()
  if (/\b(RH|R\/H|DERECH[OA])\b/.test(d)) return 'RH'
  if (/\b(LH|L\/H|IZQUIERD[OA])\b/.test(d)) return 'LH'
  if (/\bR\/L\b|\bL\/R\b/.test(d)) return ''   // aplica a ambos: no se marca lado
  return ''
}

// Tipo de material para la etiqueta: PT / WIP / MP / CONSIGNA
export function tipoDeArticulo(articulo, bom = []) {
  if (!articulo) return ''
  if (articulo.es_consigna) return 'CONSIGNA'
  if (articulo.origen === 'comprado') return 'MP'
  const esComponente = bom.some(b => b.componente_articulo_id === articulo.id)
  return esComponente ? 'WIP' : 'PT'
}

export const fmtFechaEtiqueta = (d = new Date()) =>
  `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`

export const fmtHoraEtiqueta = (d = new Date()) =>
  d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', hour12: true })

// Arma los datos de una etiqueta a partir del lote y sus catalogos.
// contenedor  -> caja/tarima a la que pertenece la etiqueta (opcional)
// qrContenido -> 'contenedor' (default) o 'lote': que se codifica en el QR
export function datosEtiqueta({ lote, articulo, empresa, cliente, codigoCliente, maquina, cantidad, bom, contenedor = null, qrContenido = 'contenedor' }) {
  const qr = qrContenido === 'lote'
    ? (lote?.codigo_lote || '')
    : (contenedor?.folio || lote?.codigo_lote || '')
  return {
    folio: contenedor?.folio || '',
    qr,
    numeroParte: codigoCliente || articulo?.codigo_interno || '',
    codigoInterno: articulo?.codigo_interno || '',
    descripcion: articulo?.descripcion || '',
    cantidad: cantidad ?? 0,
    lote: lote?.codigo_lote || '',
    maquina: maquina?.clave || '',
    cliente: cliente?.nombre || '',
    lado: ladoDeDescripcion(articulo?.descripcion),
    tipo: tipoDeArticulo(articulo, bom),
    logoUrl: empresa?.logo_url || '',
    empresa: empresa?.nombre || '',
    fecha: lote?.fecha ? fmtFechaEtiqueta(new Date(lote.fecha + 'T00:00:00')) : fmtFechaEtiqueta(),
    hora: fmtHoraEtiqueta(),
  }
}
