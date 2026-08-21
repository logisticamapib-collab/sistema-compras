import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import EditarOrden from './EditarOrden'
import ImprimirOrden from './ImprimirOrden'
import { enviarCorreo, obtenerInvolucrados } from '../../lib/email'

const estatusLabels = {
  borrador: 'Borrador',
  aprobacion_gerente_area: 'Pendiente - Gerente de Area',
  aprobacion_gerente_logistica: 'Pendiente - Gerente de Logistica',
  revision_compras: 'Revision de precios - Compras',
  aprobacion_gerente_planta: 'Pendiente - Gerente de Planta/Adm',
  aprobacion_gerente_compras: 'Pendiente - Gerente de Compras',
  aprobacion_direccion: 'Pendiente - Direccion',
  aprobada: 'Aprobada',
  enviada_proveedor: 'Enviada a proveedor',
  confirmada: 'Confirmada por proveedor',
  en_transito: 'En transito',
  recibida_parcial: 'Recibida parcial',
  recibida: 'Recibida',
  cancelada: 'Cancelada',
}

const eventoLabels = {
  enviada_proveedor: 'Enviada a proveedor',
  confirmada_proveedor: 'Confirmada por proveedor',
  en_transito: 'Marcada en transito',
  recepcion_parcial: 'Recepcion parcial registrada',
  recepcion_completa: 'Recepcion completa registrada',
}

// Determina el siguiente estatus del flujo de APROBACION unicamente.
// El seguimiento logistico (enviada, confirmada, transito, recepcion) se maneja aparte.
function determinarSiguienteEstatus(orden) {
  if (orden.tipo === 'subcontrato') {
    switch (orden.estatus) {
      case 'aprobacion_gerente_logistica': return 'revision_compras'
      case 'revision_compras': return 'aprobacion_gerente_compras'
      case 'aprobacion_gerente_compras': return 'aprobada'
      default: return null
    }
  }
  const criticidadAlta = orden.requisiciones?.criticidad === 'alta'
  switch (orden.estatus) {
    case 'aprobacion_gerente_area':
      return criticidadAlta ? 'aprobacion_gerente_planta' : 'aprobacion_gerente_compras'
    case 'aprobacion_gerente_planta':
      return 'aprobacion_gerente_compras'
    case 'aprobacion_gerente_compras':
      return 'aprobacion_direccion'
    case 'aprobacion_direccion':
      return 'aprobada'
    default:
      return null
  }
}

const etiquetasBoton = {
  aprobacion_gerente_logistica: 'Aprobar (Logistica)',
  revision_compras: 'Precios OK - enviar a Gerente Compras',
  aprobacion_gerente_planta: 'Aprobar orden',
  aprobacion_gerente_compras: 'Aprobar orden',
  aprobacion_direccion: 'Aprobar orden',
  aprobada: 'Aprobar orden final',
}

export default function DetalleOrden({ orden, onVolver }) {
  const { perfil } = useAuth()
  const [lineas, setLineas] = useState([])
  const [aprobaciones, setAprobaciones] = useState([])
  const [seguimiento, setSeguimiento] = useState([])
  const [seguimientoDetalle, setSeguimientoDetalle] = useState([])
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState(false)
  // Aviso informativo: esta contraparte tambien nos compra. No cambia el flujo
  // de la orden, solo se lo hace saber a Compras.
  const [tambienCliente, setTambienCliente] = useState(false)
  useEffect(() => {
    if (!orden?.proveedor_id) { setTambienCliente(false); return }
    supabase.from('clientes').select('id').eq('proveedor_id', orden.proveedor_id).limit(1)
      .then(({ data }) => setTambienCliente(!!(data && data.length)))
  }, [orden?.proveedor_id])
  const [comentario, setComentario] = useState('')
  const [comentarioSeguimiento, setComentarioSeguimiento] = useState('')
  const [recepciones, setRecepciones] = useState({})
  const [editando, setEditando] = useState(false)
  const [imprimiendo, setImprimiendo] = useState(false)

  useEffect(() => { cargarDetalle() }, [])

  const cargarDetalle = async () => {
    setLoading(true)
    const [{ data: l }, { data: a }, { data: s }, { data: sd }] = await Promise.all([
      supabase.from('oc_lineas')
        .select('*, articulos(codigo_interno, descripcion), centros_costos(codigo, nombre), cuentas_gastos(codigo, nombre)')
        .eq('oc_id', orden.id),
      supabase.from('aprobaciones')
        .select('*, aprobador:aprobador_id(nombre)')
        .eq('referencia_id', orden.id)
        .eq('tipo', 'orden_compra')
        .order('created_at'),
      supabase.from('oc_seguimiento')
        .select('*, usuario:usuario_id(nombre)')
        .eq('oc_id', orden.id)
        .order('fecha'),
      supabase.from('oc_seguimiento_detalle')
        .select('*, oc_lineas(descripcion, unidad_medida, articulos(codigo_interno, descripcion))')
        .eq('oc_id', orden.id)
    ])
    setLineas(l || [])
    setAprobaciones(a || [])
    setSeguimiento(s || [])
    setSeguimientoDetalle(sd || [])
    const inicial = {}
    for (const linea of l || []) {
      const pendiente = parseFloat(linea.cantidad) - parseFloat(linea.cantidad_recibida || 0)
      inicial[linea.id] = pendiente > 0 ? pendiente.toString() : '0'
    }
    setRecepciones(inicial)
    setLoading(false)
  }

  const puedeAprobar = () => {
    if (perfil?.rol === 'admin') return true
    const { estatus } = orden
    if (['aprobacion_gerente_area', 'aprobacion_gerente_planta'].includes(estatus)) {
      return perfil?.id === orden.aprobador_actual_id
    }
    if (estatus === 'aprobacion_gerente_logistica') return perfil?.rol === 'gerente_logistica'
    if (estatus === 'revision_compras') return ['compras', 'gerente_compras'].includes(perfil?.rol)
    if (estatus === 'aprobacion_gerente_compras') return perfil?.rol === 'gerente_compras'
    if (estatus === 'aprobacion_direccion') return perfil?.rol === 'direccion'
    return false
  }

  // Solo Compras, Gerente de Compras o Admin gestionan el seguimiento logistico
  const puedeGestionarSeguimiento = () => {
    return ['compras', 'gerente_compras', 'admin'].includes(perfil?.rol)
  }

  // Solo se puede editar mientras nadie haya aprobado o rechazado todavia,
  // y solo el comprador que la genero (o admin) puede hacerlo.
  const puedeEditar = () => {
    if (orden.estatus === 'cancelada') return false
    if (orden.tipo === 'subcontrato' && orden.estatus === 'revision_compras') return ['compras', 'gerente_compras', 'admin'].includes(perfil?.rol)
    if (aprobaciones.length > 0) return false
    return perfil?.id === orden.comprador_id || perfil?.rol === 'admin'
  }

  const avanzarEstatus = async () => {
    setProcesando(true)
    const next = determinarSiguienteEstatus(orden)

    await supabase.from('aprobaciones').insert({
      tipo: 'orden_compra',
      referencia_id: orden.id,
      aprobador_id: perfil.id,
      nivel: 1,
      rol_requerido: perfil.rol,
      decision: 'aprobada',
      comentarios: comentario || null,
      fecha_decision: new Date().toISOString()
    })

    const updateData = { estatus: next }

    if (next === 'aprobacion_gerente_planta') {
      updateData.aprobador_actual_id = perfil.gerente_id || null
    } else {
      updateData.aprobador_actual_id = null
    }

    await supabase.from('ordenes_compra').update(updateData).eq('id', orden.id)

    // Cuando la OC queda totalmente aprobada (aprobacion final), se manda UN solo correo
    // a todos los que intervinieron en toda la cadena: solicitante, comprador y cada aprobador.
    if (next === 'aprobada') {
      const involucrados = await obtenerInvolucrados({ requisicionId: orden.requisicion_id, ordenId: orden.id })
      await enviarCorreo({
        to: involucrados.map(u => u.email),
        subject: `Orden de compra ${orden.folio} fue aprobada`,
        html: `
          <p>La orden de compra <strong>${orden.folio}</strong> quedo <strong style="color:#16a34a">totalmente aprobada</strong>.</p>
          <p>Proveedor: <strong>${orden.proveedores?.nombre || '-'}</strong></p>
          <p>Total: <strong>$${parseFloat(orden.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} ${orden.moneda}</strong></p>
          <p>Compras dara seguimiento al envio, confirmacion y recepcion. Puedes consultar el avance dentro del sistema SYNTIA.</p>
        `,
        perfilQuienActua: perfil
      })
    }

    setProcesando(false)
    onVolver()
  }

  const rechazar = async () => {
    if (!comentario) {
      alert('Debes agregar un comentario al rechazar')
      return
    }
    setProcesando(true)
    await supabase.from('aprobaciones').insert({
      tipo: 'orden_compra',
      referencia_id: orden.id,
      aprobador_id: perfil.id,
      nivel: 1,
      rol_requerido: perfil.rol,
      decision: 'rechazada',
      comentarios: comentario,
      fecha_decision: new Date().toISOString()
    })
    await supabase.from('ordenes_compra').update({ estatus: 'cancelada' }).eq('id', orden.id)

    const involucrados = await obtenerInvolucrados({ requisicionId: orden.requisicion_id, ordenId: orden.id })
    await enviarCorreo({
      to: involucrados.map(u => u.email),
      subject: `Orden de compra ${orden.folio} fue rechazada`,
      html: `
        <p>La orden de compra <strong>${orden.folio}</strong> fue <strong style="color:#dc2626">rechazada</strong> por ${perfil.nombre}.</p>
        <p><strong>Comentario:</strong> ${comentario}</p>
        <p>Puedes revisar el detalle completo dentro del sistema SYNTIA.</p>
      `,
      perfilQuienActua: perfil
    })

    setProcesando(false)
    onVolver()
  }

  // Registra un evento de seguimiento simple (enviada, confirmada, transito) que solo cambia el estatus general
  const registrarEvento = async (evento, nuevoEstatus) => {
    setProcesando(true)
    await supabase.from('oc_seguimiento').insert({
      oc_id: orden.id,
      evento,
      usuario_id: perfil.id,
      comentario: comentarioSeguimiento || null
    })
    await supabase.from('ordenes_compra').update({ estatus: nuevoEstatus }).eq('id', orden.id)
    setProcesando(false)
    setComentarioSeguimiento('')
    onVolver()
  }

  // Registra una recepcion (parcial o completa) actualizando cantidad_recibida por linea
  const registrarRecepcion = async () => {
    const actualizaciones = lineas.map(l => {
      const recibidoAhora = parseFloat(recepciones[l.id]) || 0
      const nuevaCantidadRecibida = parseFloat(l.cantidad_recibida || 0) + recibidoAhora
      return { id: l.id, cantidad: parseFloat(l.cantidad), recibidoAhora, nuevaCantidadRecibida }
    })

    if (actualizaciones.every(act => act.recibidoAhora <= 0)) {
      alert('Debes registrar al menos una cantidad recibida mayor a cero')
      return
    }

    setProcesando(true)

    for (const act of actualizaciones) {
      if (act.recibidoAhora > 0) {
        await supabase.from('oc_lineas')
          .update({ cantidad_recibida: act.nuevaCantidadRecibida })
          .eq('id', act.id)
      }
    }

    const todoRecibido = actualizaciones.every(act => act.nuevaCantidadRecibida >= act.cantidad)
    const evento = todoRecibido ? 'recepcion_completa' : 'recepcion_parcial'
    const nuevoEstatus = todoRecibido ? 'recibida' : 'recibida_parcial'

    const { data: eventoGuardado } = await supabase.from('oc_seguimiento').insert({
      oc_id: orden.id,
      evento,
      usuario_id: perfil.id,
      comentario: comentarioSeguimiento || null
    }).select().single()

    // Guardar el detalle linea por linea de esta recepcion, para poder mostrarlo despues en el historial
    const detalleInsert = actualizaciones
      .filter(act => act.recibidoAhora > 0)
      .map(act => ({
        seguimiento_id: eventoGuardado?.id,
        oc_id: orden.id,
        oc_linea_id: act.id,
        cantidad_recibida: act.recibidoAhora
      }))
    if (detalleInsert.length > 0) {
      await supabase.from('oc_seguimiento_detalle').insert(detalleInsert)
    }

    const updateData = { estatus: nuevoEstatus }
    if (todoRecibido) {
      updateData.fecha_entrega_real = new Date().toISOString().split('T')[0]
    }
    await supabase.from('ordenes_compra').update(updateData).eq('id', orden.id)

    if (todoRecibido && orden.requisicion_id) {
      await supabase.from('requisiciones')
        .update({ estatus: 'completada' })
        .eq('id', orden.requisicion_id)
    }

    setProcesando(false)
    setComentarioSeguimiento('')
    onVolver()
  }

  const etiquetaBotonAvanzar = () => {
    const next = determinarSiguienteEstatus(orden)
    return etiquetasBoton[next] || 'Avanzar'
  }

  const siguienteAprobadorLabel = () => {
    const next = determinarSiguienteEstatus(orden)
    return estatusLabels[next] || '-'
  }

  if (editando) {
    return <EditarOrden
      orden={orden}
      onVolver={() => setEditando(false)}
      onGuardado={() => { setEditando(false); onVolver() }}
    />
  }

  if (imprimiendo) {
    return <ImprimirOrden
      orden={orden}
      onVolver={() => setImprimiendo(false)}
    />
  }

  const enFlujoAprobacion = ['aprobacion_gerente_area', 'aprobacion_gerente_planta', 'aprobacion_gerente_compras', 'aprobacion_direccion'].includes(orden.estatus)
  const enSeguimientoLogistico = ['aprobada', 'enviada_proveedor', 'confirmada', 'en_transito', 'recibida_parcial'].includes(orden.estatus)

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <button style={styles.botonVolver} onClick={onVolver}>
          &larr; Volver a ordenes
        </button>
        <div style={styles.encabezadoInfo}>
          <h2 style={styles.titulo}>{orden.folio}</h2>
          <span style={styles.estatusBadge}>{estatusLabels[orden.estatus] || orden.estatus}</span>
          <button style={styles.botonImprimir} onClick={() => setImprimiendo(true)}>
            Imprimir
          </button>
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Informacion general</h3>
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Proveedor</span>
              <span style={styles.infoValor}>
                {orden.proveedores?.nombre}
                {tambienCliente && (
                  <span style={{ marginLeft: 8, padding: '1px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600, backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' }}
                    title="Esta contraparte tambien esta dada de alta como cliente">
                    tambien es cliente
                  </span>
                )}
              </span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Comprador</span>
              <span style={styles.infoValor}>{orden.comprador?.nombre}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Requisicion origen</span>
              <span style={styles.infoValor}>{orden.requisiciones?.folio || 'Orden directa'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Criticidad</span>
              <span style={styles.infoValor}>{orden.requisiciones?.criticidad?.toUpperCase() || '-'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Fecha emision</span>
              <span style={styles.infoValor}>{new Date(orden.fecha_emision).toLocaleDateString('es-MX')}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Entrega estimada</span>
              <span style={styles.infoValor}>
                {orden.fecha_entrega_estimada ? new Date(orden.fecha_entrega_estimada).toLocaleDateString('es-MX') : '-'}
              </span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Entrega real</span>
              <span style={styles.infoValor}>
                {orden.fecha_entrega_real ? new Date(orden.fecha_entrega_real).toLocaleDateString('es-MX') : '-'}
              </span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Condiciones de pago</span>
              <span style={styles.infoValor}>{orden.condiciones_pago || '-'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Moneda</span>
              <span style={styles.infoValor}>{orden.moneda}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Subtotal</span>
              <span style={styles.infoValor}>${parseFloat(orden.subtotal || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>IVA</span>
              <span style={styles.infoValor}>${parseFloat(orden.iva || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}</span>
            </div>
            <div style={{ ...styles.infoItem, gridColumn: '1 / -1' }}>
              <span style={styles.infoLabel}>Total</span>
              <span style={{ ...styles.infoValor, fontSize: '18px', fontWeight: '700', color: '#2563eb' }}>
                ${parseFloat(orden.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {orden.moneda}
              </span>
            </div>
            {orden.justificacion && (
              <div style={{ ...styles.infoItem, gridColumn: '1 / -1' }}>
                <span style={styles.infoLabel}>Justificacion (orden directa)</span>
                <span style={styles.infoValor}>{orden.justificacion}</span>
              </div>
            )}
            {orden.notas && (
              <div style={{ ...styles.infoItem, gridColumn: '1 / -1' }}>
                <span style={styles.infoLabel}>Notas</span>
                <span style={styles.infoValor}>{orden.notas}</span>
              </div>
            )}
            {enFlujoAprobacion && (
              <div style={{ ...styles.infoItem, gridColumn: '1 / -1' }}>
                <span style={styles.infoLabel}>Siguiente paso</span>
                <span style={styles.infoValor}>{siguienteAprobadorLabel()}</span>
              </div>
            )}
          </div>
        </div>

        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Historial de aprobaciones</h3>
          {aprobaciones.length === 0 ? (
            <p style={styles.sinDatos}>Sin aprobaciones registradas</p>
          ) : (
            aprobaciones.map(a => (
              <div key={a.id} style={styles.aprobacionItem}>
                <div style={{ ...styles.aprobacionDecision, backgroundColor: a.decision === 'aprobada' ? '#f0fdf4' : '#fef2f2', color: a.decision === 'aprobada' ? '#16a34a' : '#dc2626' }}>
                  {a.decision === 'aprobada' ? 'Aprobada' : 'Rechazada'}
                </div>
                <div>
                  <p style={styles.aprobacionNombre}>{a.aprobador?.nombre}</p>
                  <p style={styles.aprobacionFecha}>{new Date(a.fecha_decision).toLocaleString('es-MX')}</p>
                  {a.comentarios && <p style={styles.aprobacionComentario}>{a.comentarios}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {seguimiento.length > 0 && (
        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Historial de seguimiento logistico</h3>
          {seguimiento.map(s => {
            const detallesDeEsteEvento = seguimientoDetalle.filter(d => d.seguimiento_id === s.id)
            return (
              <div key={s.id} style={styles.aprobacionItem}>
                <div style={{ ...styles.aprobacionDecision, backgroundColor: '#f0f9ff', color: '#0891b2' }}>
                  {eventoLabels[s.evento] || s.evento}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={styles.aprobacionNombre}>{s.usuario?.nombre}</p>
                  <p style={styles.aprobacionFecha}>{new Date(s.fecha).toLocaleString('es-MX')}</p>
                  {s.comentario && <p style={styles.aprobacionComentario}>{s.comentario}</p>}
                  {detallesDeEsteEvento.length > 0 && (
                    <div style={styles.detalleRecepcion}>
                      {detallesDeEsteEvento.map(d => (
                        <p key={d.id} style={styles.detalleRecepcionLinea}>
                          {d.oc_lineas?.articulos
                            ? `${d.oc_lineas.articulos.codigo_interno} - ${d.oc_lineas.articulos.descripcion}`
                            : d.oc_lineas?.descripcion}
                          {' — '}
                          <strong>{d.cantidad_recibida} {d.oc_lineas?.unidad_medida}</strong>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={styles.seccion}>
        <h3 style={styles.seccionTitulo}>Lineas de la orden</h3>
        {loading ? <p style={styles.sinDatos}>Cargando...</p> : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 0.5 }}>#</span>
              <span style={{ flex: 3 }}>Articulo</span>
              <span style={{ flex: 1 }}>Cantidad</span>
              <span style={{ flex: 1 }}>Recibido</span>
              <span style={{ flex: 1 }}>Unidad</span>
              <span style={{ flex: 1 }}>Precio unit.</span>
              <span style={{ flex: 1 }}>Subtotal</span>
            </div>
            {lineas.map((l, i) => (
              <div key={l.id} style={styles.tablaFila}>
                <span style={{ flex: 0.5, color: '#94a3b8', fontSize: '12px' }}>{i + 1}</span>
                <span style={{ flex: 3, fontSize: '13px' }}>
                  {l.articulos ? `${l.articulos.codigo_interno} - ${l.articulos.descripcion}` : l.descripcion}
                </span>
                <span style={{ flex: 1, fontSize: '13px' }}>{l.cantidad}</span>
                <span style={{ flex: 1, fontSize: '13px', color: parseFloat(l.cantidad_recibida || 0) >= parseFloat(l.cantidad) ? '#16a34a' : '#c2410c' }}>
                  {l.cantidad_recibida || 0}
                </span>
                <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{l.unidad_medida}</span>
                <span style={{ flex: 1, fontSize: '13px' }}>${parseFloat(l.precio_unitario).toFixed(2)}</span>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: '500' }}>${parseFloat(l.subtotal || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {puedeEditar() && (
        <div style={styles.seccion}>
          <p style={styles.textoEditar}>
            Aun no hay ninguna aprobacion registrada. Puedes corregir articulos, cantidades, precios o datos generales antes de que continue el flujo.
          </p>
          <button style={styles.botonEditar} onClick={() => setEditando(true)}>
            Editar orden
          </button>
        </div>
      )}

      {puedeAprobar() && (
        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Accion requerida</h3>
          <textarea style={styles.textarea} value={comentario}
            onChange={e => setComentario(e.target.value)}
            placeholder="Comentarios opcionales (obligatorio al rechazar)..."
            rows={2} />
          <div style={styles.botones}>
            <button style={styles.botonRechazar} onClick={rechazar} disabled={procesando}>
              Rechazar / Cancelar
            </button>
            <button style={styles.boton} onClick={avanzarEstatus} disabled={procesando}>
              {procesando ? 'Procesando...' : etiquetaBotonAvanzar()}
            </button>
          </div>
        </div>
      )}

      {enSeguimientoLogistico && puedeGestionarSeguimiento() && (
        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Seguimiento logistico</h3>

          {orden.estatus === 'aprobada' && (
            <>
              <p style={styles.textoEditar}>Marca este evento cuando envies la orden al proveedor.</p>
              <textarea style={styles.textarea} value={comentarioSeguimiento}
                onChange={e => setComentarioSeguimiento(e.target.value)}
                placeholder="Comentarios opcionales..." rows={2} />
              <div style={styles.botones}>
                <button style={styles.boton} onClick={() => registrarEvento('enviada_proveedor', 'enviada_proveedor')} disabled={procesando}>
                  {procesando ? 'Procesando...' : 'Marcar enviada a proveedor'}
                </button>
              </div>
            </>
          )}

          {orden.estatus === 'enviada_proveedor' && (
            <>
              <p style={styles.textoEditar}>Marca este evento cuando el proveedor confirme la orden (fecha, existencia, etc).</p>
              <textarea style={styles.textarea} value={comentarioSeguimiento}
                onChange={e => setComentarioSeguimiento(e.target.value)}
                placeholder="Comentarios opcionales..." rows={2} />
              <div style={styles.botones}>
                <button style={styles.boton} onClick={() => registrarEvento('confirmada_proveedor', 'confirmada')} disabled={procesando}>
                  {procesando ? 'Procesando...' : 'Marcar confirmada por proveedor'}
                </button>
              </div>
            </>
          )}

          {orden.estatus === 'confirmada' && (
            <>
              <p style={styles.textoEditar}>Marca este evento cuando el pedido salga del proveedor rumbo a la planta.</p>
              <textarea style={styles.textarea} value={comentarioSeguimiento}
                onChange={e => setComentarioSeguimiento(e.target.value)}
                placeholder="Comentarios opcionales (ej. guia, transportista)..." rows={2} />
              <div style={styles.botones}>
                <button style={styles.boton} onClick={() => registrarEvento('en_transito', 'en_transito')} disabled={procesando}>
                  {procesando ? 'Procesando...' : 'Marcar en transito'}
                </button>
              </div>
            </>
          )}

          {['en_transito', 'recibida_parcial'].includes(orden.estatus) && (
            <>
              <p style={styles.textoEditar}>
                Registra cuanto se recibio de cada linea. Si es un servicio o no llega fisicamente a almacen,
                registralo aqui manualmente igual. Cuando todas las lineas queden completas la orden pasara a Recibida.
              </p>
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 3 }}>Articulo</span>
                  <span style={{ flex: 1 }}>Ordenado</span>
                  <span style={{ flex: 1 }}>Recibido acum.</span>
                  <span style={{ flex: 1.5 }}>Recibir ahora</span>
                </div>
                {lineas.map(l => {
                  const yaRecibido = parseFloat(l.cantidad_recibida || 0)
                  const pendiente = parseFloat(l.cantidad) - yaRecibido
                  return (
                    <div key={l.id} style={styles.tablaFila}>
                      <span style={{ flex: 3, fontSize: '13px' }}>
                        {l.articulos ? `${l.articulos.codigo_interno} - ${l.articulos.descripcion}` : l.descripcion}
                      </span>
                      <span style={{ flex: 1, fontSize: '13px' }}>{l.cantidad}</span>
                      <span style={{ flex: 1, fontSize: '13px' }}>{yaRecibido}</span>
                      <span style={{ flex: 1.5 }}>
                        <input style={styles.inputRecepcion} type="number" min="0" max={pendiente} step="0.01"
                          value={recepciones[l.id] || '0'}
                          onChange={e => setRecepciones({ ...recepciones, [l.id]: e.target.value })} />
                      </span>
                    </div>
                  )
                })}
              </div>
              <textarea style={{ ...styles.textarea, marginTop: '12px' }} value={comentarioSeguimiento}
                onChange={e => setComentarioSeguimiento(e.target.value)}
                placeholder="Comentarios de la recepcion (numero de remision, observaciones)..." rows={2} />
              <div style={styles.botones}>
                <button style={styles.boton} onClick={registrarRecepcion} disabled={procesando}>
                  {procesando ? 'Guardando...' : 'Registrar recepcion'}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

const styles = {
  textoEditar: { fontSize: '13px', color: '#666', margin: '0 0 12px 0' },
  botonEditar: { padding: '9px 20px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  container: { padding: '28px' },
  encabezado: { marginBottom: '20px' },
  encabezadoInfo: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' },
  titulo: { fontSize: '20px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  estatusBadge: { padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: '500', backgroundColor: '#eff6ff', color: '#2563eb' },
  botonImprimir: { padding: '6px 14px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginLeft: 'auto' },
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' },
  seccion: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  seccionTitulo: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' },
  infoGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' },
  infoItem: { display: 'flex', flexDirection: 'column', gap: '2px' },
  infoLabel: { fontSize: '11px', color: '#94a3b8', fontWeight: '500', textTransform: 'uppercase' },
  infoValor: { fontSize: '14px', color: '#1a1a2e' },
  sinDatos: { color: '#94a3b8', fontSize: '13px', margin: '0' },
  aprobacionItem: { display: 'flex', gap: '12px', alignItems: 'flex-start', marginBottom: '12px', paddingBottom: '12px', borderBottom: '1px solid #f1f5f9' },
  aprobacionDecision: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', flexShrink: 0 },
  aprobacionNombre: { margin: '0', fontSize: '13px', fontWeight: '500' },
  aprobacionFecha: { margin: '2px 0 0 0', fontSize: '11px', color: '#94a3b8' },
  aprobacionComentario: { margin: '4px 0 0 0', fontSize: '12px', color: '#666', fontStyle: 'italic' },
  detalleRecepcion: { marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #e2e8f0' },
  detalleRecepcionLinea: { margin: '0 0 4px 0', fontSize: '12px', color: '#444' },
  tabla: { overflowX: 'auto' },
  tablaHeader: { display: 'flex', padding: '10px 16px', backgroundColor: '#f8fafc', borderRadius: '7px', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' },
  tablaFila: { display: 'flex', padding: '12px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  inputRecepcion: { padding: '6px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  campo: { marginBottom: '12px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444', display: 'block', marginBottom: '4px' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  textarea: { width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '12px' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonRechazar: { padding: '10px 24px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
}
