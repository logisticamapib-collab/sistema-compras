import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import EditarRequisicion from './EditarRequisicion'

const estatusLabels = {
  borrador: 'Borrador',
  enviada: 'Pendiente de aprobacion - Gerente Area',
  aprobada_gerente_area: 'Aprobada - Pendiente generar OC',
  en_proceso: 'En proceso - Compras generando OC',
  completada: 'Completada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
}

const estatusColores = {
  borrador: { backgroundColor: '#f1f5f9', color: '#64748b' },
  enviada: { backgroundColor: '#fef9c3', color: '#854d0e' },
  aprobada_gerente_area: { backgroundColor: '#eff6ff', color: '#2563eb' },
  en_proceso: { backgroundColor: '#f0f9ff', color: '#0891b2' },
  completada: { backgroundColor: '#f0fdf4', color: '#16a34a' },
  rechazada: { backgroundColor: '#fef2f2', color: '#dc2626' },
  cancelada: { backgroundColor: '#fef2f2', color: '#991b1b' },
}

export default function DetalleRequisicion({ requisicion, onVolver }) {
  const { perfil } = useAuth()
  const [lineas, setLineas] = useState([])
  const [aprobaciones, setAprobaciones] = useState([])
  const [solicitante, setSolicitante] = useState(null)
  const [loading, setLoading] = useState(true)
  const [comentario, setComentario] = useState('')
  const [procesando, setProcesando] = useState(false)
  const [editando, setEditando] = useState(false)

  useEffect(() => { cargarDetalle() }, [])

  const cargarDetalle = async () => {
    setLoading(true)
    const [{ data: l }, { data: a }, { data: s }] = await Promise.all([
      supabase.from('requisicion_lineas')
        .select('*, articulos(codigo_interno, descripcion), centros_costos(codigo, nombre), cuentas_gastos(codigo, nombre), proveedores(nombre)')
        .eq('requisicion_id', requisicion.id),
      supabase.from('aprobaciones')
        .select('*, aprobador:aprobador_id(nombre)')
        .eq('referencia_id', requisicion.id)
        .eq('tipo', 'requisicion')
        .order('created_at'),
      supabase.from('usuarios')
        .select('nombre, email, area, puesto')
        .eq('id', requisicion.solicitante_id)
        .single()
    ])
    setLineas(l || [])
    setAprobaciones(a || [])
    setSolicitante(s)
    setLoading(false)
  }

  const puedeAprobar = () => {
    if (requisicion.estatus !== 'enviada') return false
    if (perfil?.id === requisicion.aprobador_actual_id) return true
    if (['gerente_area', 'gerente_planta', 'gerente_administrativo', 'admin'].includes(perfil?.rol) &&
      perfil?.id === requisicion.gerente_area_id) return true
    return false
  }

  const puedeCancelar = () => {
    return perfil?.id === requisicion.solicitante_id &&
      ['borrador', 'enviada'].includes(requisicion.estatus)
  }

  const aprobar = async () => {
    setProcesando(true)

    await supabase.from('aprobaciones').insert({
      tipo: 'requisicion',
      referencia_id: requisicion.id,
      aprobador_id: perfil.id,
      nivel: 1,
      rol_requerido: perfil.rol,
      decision: 'aprobada',
      comentarios: comentario || null,
      fecha_decision: new Date().toISOString()
    })

    await supabase.from('requisiciones')
      .update({
        estatus: 'en_proceso',
        aprobador_actual_id: null,
        paso_aprobacion: 2
      })
      .eq('id', requisicion.id)

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
      tipo: 'requisicion',
      referencia_id: requisicion.id,
      aprobador_id: perfil.id,
      nivel: 1,
      rol_requerido: perfil.rol,
      decision: 'rechazada',
      comentarios: comentario,
      fecha_decision: new Date().toISOString()
    })

    await supabase.from('requisiciones')
      .update({ estatus: 'rechazada' })
      .eq('id', requisicion.id)

    setProcesando(false)
    onVolver()
  }

  const cancelar = async () => {
    if (!confirm('Seguro que deseas cancelar esta requisicion?')) return
    setProcesando(true)
    await supabase.from('requisiciones')
      .update({ estatus: 'cancelada' })
      .eq('id', requisicion.id)
    setProcesando(false)
    onVolver()
  }

  const enviar = async () => {
    setProcesando(true)

    const aprobadorId = perfil.gerente_id || null

    await supabase.from('requisiciones')
      .update({
        estatus: ['gerente_area', 'gerente_planta', 'gerente_administrativo'].includes(perfil.rol)
          ? 'en_proceso' : 'enviada',
        aprobador_actual_id: aprobadorId,
        gerente_area_id: perfil.gerente_id || perfil.id,
        paso_aprobacion: 1
      })
      .eq('id', requisicion.id)

    setProcesando(false)
    onVolver()
  }

  if (editando) {
    return <EditarRequisicion
      requisicion={requisicion}
      onVolver={() => setEditando(false)}
      onGuardado={() => { setEditando(false); onVolver() }}
    />
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <button style={styles.botonVolver} onClick={onVolver}>
          &larr; Volver a requisiciones
        </button>
        <div style={styles.encabezadoInfo}>
          <h2 style={styles.titulo}>{requisicion.folio}</h2>
          <span style={{ ...styles.estatusBadge, ...estatusColores[requisicion.estatus] }}>
            {estatusLabels[requisicion.estatus]}
          </span>
        </div>
      </div>

      <div style={styles.grid}>
        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Informacion general</h3>
          <div style={styles.infoGrid}>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Solicitante</span>
              <span style={styles.infoValor}>{solicitante?.nombre || '-'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Area</span>
              <span style={styles.infoValor}>{solicitante?.area || '-'}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Fecha de solicitud</span>
              <span style={styles.infoValor}>{new Date(requisicion.fecha_solicitud).toLocaleDateString('es-MX')}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Fecha requerida</span>
              <span style={styles.infoValor}>{new Date(requisicion.fecha_requerida).toLocaleDateString('es-MX')}</span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Criticidad</span>
              <span style={{ ...styles.infoValor, color: requisicion.criticidad === 'alta' ? '#dc2626' : requisicion.criticidad === 'media' ? '#854d0e' : '#16a34a', fontWeight: '600' }}>
                {requisicion.criticidad?.toUpperCase()}
              </span>
            </div>
            <div style={styles.infoItem}>
              <span style={styles.infoLabel}>Paso actual</span>
              <span style={styles.infoValor}>{requisicion.paso_aprobacion || 0}</span>
            </div>
            {requisicion.justificacion && (
              <div style={{ ...styles.infoItem, gridColumn: '1 / -1' }}>
                <span style={styles.infoLabel}>Justificacion</span>
                <span style={styles.infoValor}>{requisicion.justificacion}</span>
              </div>
            )}
            {requisicion.notas && (
              <div style={{ ...styles.infoItem, gridColumn: '1 / -1' }}>
                <span style={styles.infoLabel}>Notas</span>
                <span style={styles.infoValor}>{requisicion.notas}</span>
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

      <div style={styles.seccion}>
        <h3 style={styles.seccionTitulo}>Lineas de requisicion</h3>
        {loading ? <p style={styles.sinDatos}>Cargando...</p> : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 0.5 }}>#</span>
              <span style={{ flex: 3 }}>Articulo / Descripcion</span>
              <span style={{ flex: 1 }}>Cantidad</span>
              <span style={{ flex: 1 }}>Unidad</span>
              <span style={{ flex: 1.5 }}>Centro costos</span>
              <span style={{ flex: 1.5 }}>Cuenta gastos</span>
              <span style={{ flex: 1.5 }}>Prov. sugerido</span>
            </div>
            {lineas.map((l, i) => (
              <div key={l.id} style={styles.tablaFila}>
                <span style={{ flex: 0.5, color: '#94a3b8', fontSize: '12px' }}>{i + 1}</span>
                <span style={{ flex: 3 }}>
                  {l.articulos ? (
                    <p style={{ margin: '0', fontWeight: '500', fontSize: '13px' }}>
                      {l.articulos.codigo_interno} - {l.articulos.descripcion}
                    </p>
                  ) : (
                    <p style={{ margin: '0', fontSize: '13px' }}>{l.descripcion_libre}</p>
                  )}
                  {l.notas && <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>{l.notas}</p>}
                </span>
                <span style={{ flex: 1, fontSize: '13px' }}>{l.cantidad}</span>
                <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{l.unidad_medida}</span>
                <span style={{ flex: 1.5, fontSize: '12px', color: '#666' }}>
                  {l.centros_costos ? `${l.centros_costos.codigo} - ${l.centros_costos.nombre}` : '-'}
                </span>
                <span style={{ flex: 1.5, fontSize: '12px', color: '#666' }}>
                  {l.cuentas_gastos ? `${l.cuentas_gastos.codigo} - ${l.cuentas_gastos.nombre}` : '-'}
                </span>
                <span style={{ flex: 1.5, fontSize: '12px', color: '#666' }}>
                  {l.proveedores?.nombre || '-'}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={styles.acciones}>
        {requisicion.estatus === 'borrador' && perfil?.id === requisicion.solicitante_id && (
          <div style={{ display: 'flex', gap: '12px' }}>
            <button style={styles.botonEditar} onClick={() => setEditando(true)}>
              Editar borrador
            </button>
            <button style={styles.boton} onClick={enviar} disabled={procesando}>
              Enviar requisicion
            </button>
          </div>
        )}
        {puedeAprobar() && (
          <div style={styles.seccionAprobacion}>
            <h3 style={styles.seccionTitulo}>Tu aprobacion es requerida</h3>
            <textarea style={styles.textarea} value={comentario}
              onChange={e => setComentario(e.target.value)}
              placeholder="Comentarios (obligatorio al rechazar)..."
              rows={2} />
            <div style={styles.botonesAprobacion}>
              <button style={styles.botonRechazar} onClick={rechazar} disabled={procesando}>
                Rechazar
              </button>
              <button style={styles.boton} onClick={aprobar} disabled={procesando}>
                {procesando ? 'Procesando...' : 'Aprobar requisicion'}
              </button>
            </div>
          </div>
        )}
        {puedeCancelar() && (
          <button style={styles.botonCancelar} onClick={cancelar} disabled={procesando}>
            Cancelar requisicion
          </button>
        )}
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { marginBottom: '20px' },
  encabezadoInfo: { display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' },
  titulo: { fontSize: '20px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  estatusBadge: { padding: '4px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: '500' },
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
  tablaFila: { display: 'flex', padding: '12px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'flex-start' },
  acciones: { display: 'flex', flexDirection: 'column', gap: '12px' },
  seccionAprobacion: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  botonesAprobacion: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '12px' },
  textarea: { width: '100%', padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', boxSizing: 'border-box' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonEditar: { padding: '10px 24px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonRechazar: { padding: '10px 24px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonCancelar: { padding: '10px 24px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '7px', fontSize: '14px', cursor: 'pointer', alignSelf: 'flex-start' },
}