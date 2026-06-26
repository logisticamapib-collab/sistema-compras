import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import NuevaOrden from './NuevaOrden'
import DetalleOrden from './DetalleOrden'

const estatusColores = {
  borrador: { bg: '#f1f5f9', color: '#64748b' },
  enviada_aprobacion: { bg: '#fef9c3', color: '#854d0e' },
  aprobada_gerente: { bg: '#eff6ff', color: '#2563eb' },
  aprobada_direccion: { bg: '#f0fdf4', color: '#16a34a' },
  enviada_proveedor: { bg: '#f0f9ff', color: '#0891b2' },
  confirmada: { bg: '#eff6ff', color: '#2563eb' },
  en_transito: { bg: '#fef9c3', color: '#854d0e' },
  recibida_parcial: { bg: '#fff7ed', color: '#c2410c' },
  recibida: { bg: '#f0fdf4', color: '#16a34a' },
  cancelada: { bg: '#fef2f2', color: '#dc2626' },
}

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

export default function Ordenes() {
  const { perfil } = useAuth()
  const [vista, setVista] = useState('lista')
  const [ordenes, setOrdenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [filtroEstatus, setFiltroEstatus] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  const [ordenSeleccionada, setOrdenSeleccionada] = useState(null)

  useEffect(() => { cargarOrdenes() }, [])

  const cargarOrdenes = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('ordenes_compra')
      .select('*, proveedores(nombre), usuarios(nombre), sites(codigo), requisiciones(folio)')
      .eq('empresa_id', perfil.empresa_id)
      .order('created_at', { ascending: false })
    setOrdenes(data || [])
    setLoading(false)
  }

  const ordenesFiltradas = ordenes.filter(o => {
    const matchEstatus = filtroEstatus === 'todos' || o.estatus === filtroEstatus
    const matchBusqueda = o.folio.toLowerCase().includes(busqueda.toLowerCase()) ||
      (o.proveedores?.nombre && o.proveedores.nombre.toLowerCase().includes(busqueda.toLowerCase()))
    return matchEstatus && matchBusqueda
  })

  if (vista === 'nueva') {
    return <NuevaOrden
      onVolver={() => setVista('lista')}
      onGuardado={() => { setVista('lista'); cargarOrdenes() }}
    />
  }

  if (vista === 'detalle' && ordenSeleccionada) {
    return <DetalleOrden
      orden={ordenSeleccionada}
      onVolver={() => { setVista('lista'); cargarOrdenes() }}
    />
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Ordenes de Compra</h2>
        {['compras', 'admin'].includes(perfil?.rol) && (
          <button style={styles.boton} onClick={() => setVista('nueva')}>
            + Nueva orden de compra
          </button>
        )}
      </div>

      <div style={styles.filtros}>
        <input style={styles.inputBusqueda} value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por folio o proveedor..." />
        <select style={styles.select} value={filtroEstatus}
          onChange={e => setFiltroEstatus(e.target.value)}>
          <option value="todos">Todos los estatus</option>
          {Object.entries(estatusLabels).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <button style={styles.botonRefrescar} onClick={cargarOrdenes}>
          Refrescar
        </button>
      </div>

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1.5 }}>Folio OC</span>
          <span style={{ flex: 1 }}>Requisicion</span>
          <span style={{ flex: 2 }}>Proveedor</span>
          <span style={{ flex: 1 }}>Site</span>
          <span style={{ flex: 1 }}>Fecha emision</span>
          <span style={{ flex: 1 }}>Entrega est.</span>
          <span style={{ flex: 1 }}>Total</span>
          <span style={{ flex: 1.5 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : ordenesFiltradas.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay ordenes de compra que mostrar</p>
        ) : (
          ordenesFiltradas.map(o => (
            <div key={o.id} style={styles.tablaFila}>
              <span style={{ flex: 1.5, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{o.folio}</span>
              <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{o.requisiciones?.folio}</span>
              <span style={{ flex: 2, fontSize: '13px' }}>{o.proveedores?.nombre}</span>
              <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{o.sites?.codigo}</span>
              <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>
                {new Date(o.fecha_emision).toLocaleDateString('es-MX')}
              </span>
              <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>
                {o.fecha_entrega_estimada ? new Date(o.fecha_entrega_estimada).toLocaleDateString('es-MX') : '-'}
              </span>
              <span style={{ flex: 1, fontSize: '13px', fontWeight: '500' }}>
                {o.total ? `$${parseFloat(o.total).toLocaleString('es-MX', { minimumFractionDigits: 2 })}` : '-'}
              </span>
              <span style={{ flex: 1.5 }}>
                <span style={{ ...styles.badge, ...estatusColores[o.estatus] }}>
                  {estatusLabels[o.estatus]}
                </span>
              </span>
              <span style={{ flex: 1 }}>
                <button style={styles.botonAccion}
                  onClick={() => { setOrdenSeleccionada(o); setVista('detalle') }}>
                  Ver detalle
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  filtros: { display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' },
  inputBusqueda: { padding: '9px 14px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '240px' },
  select: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', backgroundColor: '#fff' },
  botonRefrescar: { padding: '9px 16px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
}