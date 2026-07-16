import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import NuevaRequisicion from './NuevaRequisicion'
import DetalleRequisicion from './DetalleRequisicion'

const estatusColores = {
  borrador: { bg: '#f1f5f9', color: '#64748b' },
  enviada: { bg: '#eff6ff', color: '#2563eb' },
  aprobada_gerente_area: { bg: '#eff6ff', color: '#2563eb' },
  en_proceso: { bg: '#f0f9ff', color: '#0891b2' },
  completada: { bg: '#f0fdf4', color: '#15803d' },
  rechazada: { bg: '#fef2f2', color: '#dc2626' },
  cancelada: { bg: '#fef2f2', color: '#991b1b' },
}

const estatusLabels = {
  borrador: 'Borrador',
  enviada: 'Pendiente de aprobacion - Gerente Area',
  aprobada_gerente_area: 'Aprobada - Pendiente generar OC',
  en_proceso: 'En proceso - Compras generando OC',
  completada: 'Completada',
  rechazada: 'Rechazada',
  cancelada: 'Cancelada',
}

// Estatus de las ordenes de compra, para mostrar el avance real cuando ya existe una OC
const ocEstatusColores = {
  aprobacion_gerente_area: { bg: '#fef9c3', color: '#854d0e' },
  aprobacion_gerente_planta: { bg: '#fef9c3', color: '#854d0e' },
  aprobacion_gerente_compras: { bg: '#fde68a', color: '#854d0e' },
  aprobacion_direccion: { bg: '#f5f3ff', color: '#7c3aed' },
  aprobada: { bg: '#f0fdf4', color: '#16a34a' },
  enviada_proveedor: { bg: '#f0f9ff', color: '#0891b2' },
  confirmada: { bg: '#eff6ff', color: '#2563eb' },
  en_transito: { bg: '#fef3c7', color: '#c2410c' },
  recibida_parcial: { bg: '#fff7ed', color: '#c2410c' },
  recibida: { bg: '#f0fdf4', color: '#16a34a' },
  cancelada: { bg: '#fef2f2', color: '#dc2626' },
}

const ocEstatusLabels = {
  aprobacion_gerente_area: 'OC pendiente - Gerente de Area',
  aprobacion_gerente_planta: 'OC pendiente - Gerente de Planta/Adm',
  aprobacion_gerente_compras: 'OC pendiente - Gerente de Compras',
  aprobacion_direccion: 'OC pendiente - Direccion',
  aprobada: 'OC Aprobada',
  enviada_proveedor: 'OC enviada a proveedor',
  confirmada: 'OC confirmada por proveedor',
  en_transito: 'OC en transito',
  recibida_parcial: 'OC recibida parcial',
  recibida: 'OC recibida',
  cancelada: 'OC cancelada',
}

const TAMANO_PAGINA = 50

const prioridadColores = {
  alta: { bg: '#fef2f2', color: '#dc2626' },
  media: { bg: '#fef9c3', color: '#854d0e' },
  baja: { bg: '#f0fdf4', color: '#16a34a' },
}

export default function Requisiciones() {
  const { perfil } = useAuth()
  const [vista, setVista] = useState('lista')
  const [requisiciones, setRequisiciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [hayMas, setHayMas] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const [filtroEstatus, setFiltroEstatus] = useState('todos')
  const [filtroPrioridad, setFiltroPrioridad] = useState('todos')
  const [busqueda, setBusqueda] = useState('')
  const [requisicionSeleccionada, setRequisicionSeleccionada] = useState(null)

  useEffect(() => { cargarRequisiciones() }, [])

  const cargarRequisiciones = async (desde = 0) => {
    if (desde === 0) setLoading(true); else setCargandoMas(true)
    let query = supabase
      .from('requisiciones')
      .select('*, solicitante:solicitante_id(nombre), sites(nombre,codigo)')
      .eq('empresa_id', perfil.empresa_id)
      .order('created_at', { ascending: false })
      .range(desde, desde + TAMANO_PAGINA - 1)

    if (perfil.rol === 'solicitante') {
      query = query.eq('solicitante_id', perfil.id)
    }

    const { data } = await query
    const reqs = data || []

    if (reqs.length > 0) {
      const { data: ocs } = await supabase
        .from('ordenes_compra')
        .select('id, requisicion_id, folio, estatus, created_at')
        .in('requisicion_id', reqs.map(r => r.id))
        .order('created_at', { ascending: false })

      const ocPorRequisicion = {}
      for (const oc of ocs || []) {
        if (!ocPorRequisicion[oc.requisicion_id]) ocPorRequisicion[oc.requisicion_id] = []
        ocPorRequisicion[oc.requisicion_id].push(oc)
      }
      reqs.forEach(r => { r.ordenesCompra = ocPorRequisicion[r.id] || [] })
    }

    setHayMas(reqs.length === TAMANO_PAGINA)
    setRequisiciones(prev => desde === 0 ? reqs : [...prev, ...reqs])
    setLoading(false)
    setCargandoMas(false)
  }

  const abrirDetalle = (req) => {
    setRequisicionSeleccionada(req)
    setVista('detalle')
  }

  // Determina que estatus mostrar: si ya hay OC generada, refleja el avance real de esa OC
  const estatusMostrado = (r) => {
    if (r.estatus === 'en_proceso' && r.ordenesCompra?.length > 0) {
      const activas = r.ordenesCompra.filter(o => o.estatus !== 'cancelada')
      const ocsRelevantes = activas.length > 0 ? activas : r.ordenesCompra
      const primero = ocsRelevantes[0].estatus
      const todasIguales = ocsRelevantes.every(o => o.estatus === primero)
      if (todasIguales) {
        return { key: 'oc_' + primero, label: ocEstatusLabels[primero] || primero, colores: ocEstatusColores[primero] || {} }
      }
      return { key: 'oc_mixto', label: `${ocsRelevantes.length} ordenes generadas (estatus mixto)`, colores: { bg: '#f1f5f9', color: '#64748b' } }
    }
    return { key: r.estatus, label: estatusLabels[r.estatus] || r.estatus, colores: estatusColores[r.estatus] || {} }
  }

  const requisicionesFiltradas = requisiciones.filter(r => {
    const matchEstatus = filtroEstatus === 'todos' || estatusMostrado(r).key === filtroEstatus
    const matchPrioridad = filtroPrioridad === 'todos' || r.criticidad === filtroPrioridad
    const matchBusqueda = r.folio.toLowerCase().includes(busqueda.toLowerCase()) ||
      (r.solicitante?.nombre && r.solicitante.nombre.toLowerCase().includes(busqueda.toLowerCase()))
    return matchEstatus && matchPrioridad && matchBusqueda
  })

  if (vista === 'nueva') {
    return <NuevaRequisicion
      onVolver={() => setVista('lista')}
      onGuardado={() => { setVista('lista'); cargarRequisiciones() }}
    />
  }

  if (vista === 'detalle' && requisicionSeleccionada) {
    return <DetalleRequisicion
      requisicion={requisicionSeleccionada}
      onVolver={() => { setVista('lista'); cargarRequisiciones() }}
    />
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Requisiciones</h2>
        {['solicitante','gerente_area','gerente_planta','gerente_administrativo','compras','admin'].includes(perfil?.rol) && (
          <button style={styles.boton} onClick={() => setVista('nueva')}>
            + Nueva requisicion
          </button>
        )}
      </div>

      <div style={styles.filtros}>
        <input style={styles.inputBusqueda} value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por folio o solicitante..." />
        <select style={styles.select} value={filtroEstatus}
          onChange={e => setFiltroEstatus(e.target.value)}>
          <option value="todos">Todos los estatus</option>
          <optgroup label="Requisicion">
            {Object.entries(estatusLabels).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </optgroup>
          <optgroup label="Orden de compra">
            {Object.entries(ocEstatusLabels).map(([k, v]) => (
              <option key={'oc_' + k} value={'oc_' + k}>{v}</option>
            ))}
          </optgroup>
        </select>
        <select style={styles.select} value={filtroPrioridad}
          onChange={e => setFiltroPrioridad(e.target.value)}>
          <option value="todos">Todas las prioridades</option>
          <option value="alta">Alta</option>
          <option value="media">Media</option>
          <option value="baja">Baja</option>
        </select>
        <button style={styles.botonRefrescar} onClick={() => cargarRequisiciones()}>
          Refrescar
        </button>
      </div>

      <div style={styles.resumen}>
        {['enviada','aprobada_gerente_area','en_proceso'].map(est => {
          const count = requisiciones.filter(r => r.estatus === est).length
          if (count === 0) return null
          return (
            <div key={est} style={styles.resumenItem}
              onClick={() => setFiltroEstatus(est)}>
              <span style={{ ...styles.badge, ...estatusColores[est] }}>{estatusLabels[est]}</span>
              <span style={styles.resumenCount}>{count}</span>
            </div>
          )
        })}
      </div>

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1.5 }}>Folio</span>
          <span style={{ flex: 2 }}>Solicitante</span>
          <span style={{ flex: 1 }}>Site</span>
          <span style={{ flex: 1 }}>Fecha req.</span>
          <span style={{ flex: 1 }}>Criticidad</span>
          <span style={{ flex: 2.5 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : requisicionesFiltradas.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay requisiciones que mostrar</p>
        ) : (
          requisicionesFiltradas.map(r => {
            const { label, colores } = estatusMostrado(r)
            return (
              <div key={r.id} style={styles.tablaFila}>
                <span style={{ flex: 1.5, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{r.folio}</span>
                <span style={{ flex: 2, fontSize: '13px' }}>{r.solicitante?.nombre}</span>
                <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{r.sites?.codigo}</span>
                <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>
                  {new Date(r.fecha_requerida).toLocaleDateString('es-MX')}
                </span>
                <span style={{ flex: 1 }}>
                  <span style={{ ...styles.badge, ...prioridadColores[r.criticidad] }}>
                    {r.criticidad?.toUpperCase()}
                  </span>
                </span>
                <span style={{ flex: 2.5 }}>
                  <span style={{ ...styles.badge, ...colores }}>
                    {label}
                  </span>
                </span>
                <span style={{ flex: 1 }}>
                  <button style={styles.botonAccion} onClick={() => abrirDetalle(r)}>
                    Ver detalle
                  </button>
                </span>
              </div>
            )
          })
        )}
      </div>

      {hayMas && !loading && (
        <div style={{ textAlign: 'center', marginTop: '14px' }}>
          <button style={styles.botonRefrescar} onClick={() => cargarRequisiciones(requisiciones.length)}>
            {cargandoMas ? 'Cargando...' : 'Cargar mas'}
          </button>
        </div>
      )}
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
  resumen: { display: 'flex', gap: '10px', marginBottom: '16px', flexWrap: 'wrap' },
  resumenItem: { display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' },
  resumenCount: { fontWeight: '700', fontSize: '14px', color: '#1a1a2e' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
}