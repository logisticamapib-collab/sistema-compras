import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const estatusLabels = {
  borrador: 'Borrador',
  enviada_aprobacion: 'En aprobacion',
  aprobada_gerente: 'Aprobada - Gerente',
  aprobada_direccion: 'Aprobada - Direccion',
  enviada_proveedor: 'Enviada a proveedor',
  confirmada: 'Confirmada',
  en_transito: 'En transito',
  recibida_parcial: 'Recibida parcial',
  recibida: 'Recibida',
  cancelada: 'Cancelada',
}

const siguienteEstatus = {
  enviada_aprobacion: 'aprobada_gerente',
  aprobada_gerente: 'aprobada_direccion',
  aprobada_direccion: 'enviada_proveedor',
  enviada_proveedor: 'confirmada',
  confirmada: 'en_transito',
  en_transito: 'recibida',
}

const rolesQueAprueban = {
  enviada_aprobacion: ['gerente_area', 'gerente_planta', 'gerente_administrativo'],
  aprobada_gerente: ['direccion', 'admin'],
  aprobada_direccion: ['compras', 'admin'],
  enviada_proveedor: ['compras', 'admin'],
  confirmada: ['compras', 'admin'],
  en_transito: ['compras', 'admin'],
}

export default function DetalleOrden({ orden, onVolver }) {
  const { perfil } = useAuth()
  const [lineas, setLineas] = useState([])
  const [aprobaciones, setAprobaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [procesando, setProcesando] = useState(false)
  const [comentario, setComentario] = useState('')
  const [fechaEntregaReal, setFechaEntregaReal] = useState('')

  useEffect(() => { cargarDetalle() }, [])

  const cargarDetalle = async () => {
    setLoading(true)
    const [{ data: l }, { data: a }] = await Promise.all([
      supabase.from('oc_lineas')
        .select('*, articulos(codigo_interno, descripcion), centros_costos(codigo, nombre), cuentas_gastos(codigo, nombre)')
        .eq('oc_id', orden.id),
      supabase.from('aprobaciones')
        .select('*, usuarios(nombre)')
        .eq('referencia_id', orden.id)
        .eq('tipo', 'orden_compra')
        .order('created_at')
    ])
    setLineas(l || [])
    setAprobaciones(a || [])
    setLoading(false)
  }

  const puedeAprobar = () => {
    const roles = rolesQueAprueban[orden.estatus] || []
    return roles.includes(perfil?.rol)
  }

  const avanzarEstatus = async () => {
    setProcesando(true)
    const next = siguienteEstatus[orden.estatus]

    await supabase.from('aprobaciones').insert({
      tipo: 'orden_compra',
      referencia_id: orden.id,
      aprobador_id: perfil.id,
      nivel: 1,
      rol_requerido: perfil.rol,
      decision: 'aprobada',
      comentarios: comentario,
      fecha_decision: new Date().toISOString()
    })

    const updateData = { estatus: next }
    if (next === 'recibida' && fechaEntregaReal) {
      updateData.fecha_entrega_real = fechaEntregaReal
    }

    await supabase.from('ordenes_compra').update(updateData).eq('id', orden.id)
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
    setProcesando(false)
    onVolver()
  }

  const etiquetaBotonAvanzar = () => {
    const next = siguienteEstatus[orden.estatus]
    const etiquetas = {
      aprobada_gerente: 'Aprobar orden',
      aprobada_direccion: 'Aprobar - Direccion',
      enviada_proveedor: 'Marcar enviada a proveedor',
      confirmada: 'Marcar confirmada por proveedor',
      en_transito: 'Marcar en transito',
      recibida: 'Confirmar recepcion',
    }
    return etiquetas[next] || 'Avanzar'
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <button style={styles.botonVolver} onClick={onVolver}>
          &larr; Volver a ordenes
        </button>
        <div style={styles.encabezadoInfo}>
          <h2 style={styles.titulo}>{orden.folio}</h2>
          <span style={styles.estatusBadge}>{estatusLabels[orden.estatus]}</span>
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Informacion general</h3>
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Proveedor</span>
              <span style={styles.infoValor}>{orden.proveedores?.nombre}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Comprador</span>
              <span style={styles.infoValor}>{orden.usuarios?.nombre}</span>
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
            {orden.notas && (
              <div style={{ ...styles.infoItem, gridColumn: '1 / -1' }}>
                <span style={styles.infoLabel}>Notas</span>
                <span style={styles.infoValor}>{orden.notas}</span>
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
                  <p style={styles.aprobacionNombre}>{a.usuarios?.nombre}</p>
                  <p style={styles.aprobacionFecha}>{new Date(a.fecha_decision).toLocaleString('es-MX')}</p>
                  {a.comentarios && <p style={styles.aprobacionComentario}>{a.comentarios}</p>}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={styles.seccion}>
        <h3 style={styles.seccionTitulo}>Lineas de la orden</h3>
        {loading ? <p style={styles.sinDatos}>Cargando...</p> : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 0.5 }}>#</span>
              <span style={{ flex: 3 }}>Articulo</span>
              <span style={{ flex: 1 }}>Cantidad</span>
              <span style={{ flex: 1 }}>Unidad</span>
              <span style={{ flex: 1 }}>Precio unit.</span>
              <span style={{ flex: 1 }}>IVA %</span>
              <span style={{ flex: 1 }}>Subtotal</span>
            </div>
            {lineas.map((l, i) => (
              <div key={l.id} style={styles.tablaFila}>
                <span style={{ flex: 0.5, color: '#94a3b8', fontSize: '12px' }}>{i + 1}</span>
                <span style={{ flex: 3, fontSize: '13px' }}>
                  {l.articulos ? `${l.articulos.codigo_interno} - ${l.articulos.descripcion}` : l.descripcion}
                </span>
                <span style={{ flex: 1, fontSize: '13px' }}>{l.cantidad}</span>
                <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{l.unidad_medida}</span>
                <span style={{ flex: 1, fontSize: '13px' }}>${parseFloat(l.precio_unitario).toFixed(2)}</span>
                <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{l.iva_porcentaje}%</span>
                <span style={{ flex: 1, fontSize: '13px', fontWeight: '500' }}>${parseFloat(l.subtotal || 0).toFixed(2)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {puedeAprobar() && (
        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Accion requerida</h3>
          {orden.estatus === 'en_transito' && (
            <div style={styles.campo}>
              <label style={styles.label}>Fecha de recepcion real</label>
              <input style={{ ...styles.input, maxWidth: '200px' }} type="date"
                value={fechaEntregaReal}
                onChange={e => setFechaEntregaReal(e.target.value)} />
            </div>
          )}
          <textarea style={styles.textarea} value={comentario}
            onChange={e => setComentario(e.target.value)}
            placeholder="Comentarios opcionales..."
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
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { marginBottom: '20px' },
  encabezadoInfo: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' },
  titulo: { fontSize: '20px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  estatusBadge: { padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: '500', backgroundColor: '#eff6ff', color: '#2563eb' },
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
  tabla: { overflowX: 'auto' },
  tablaHeader: { display: 'flex', padding: '10px 16px', backgroundColor: '#f8fafc', borderRadius: '7px', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' },
  tablaFila: { display: 'flex', padding: '12px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  campo: { marginBottom: '12px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444', display: 'block', marginBottom: '4px' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  textarea: { width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '12px' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonRechazar: { padding: '10px 24px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
}