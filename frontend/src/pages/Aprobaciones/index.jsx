import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ROLES_GERENCIALES } from '../../lib/roles'
import { useAuth } from '../../context/AuthContext'
import DetalleRequisicion from '../Requisiciones/DetalleRequisicion'
import DetalleOrden from '../Ordenes/DetalleOrden'

export default function Aprobaciones() {
  const { perfil } = useAuth()
  const [requisiciones, setRequisiciones] = useState([])
  const [ordenes, setOrdenes] = useState([])
  const [loading, setLoading] = useState(true)
  const [vista, setVista] = useState('lista')
  const [itemSeleccionado, setItemSeleccionado] = useState(null)
  const [tipoSeleccionado, setTipoSeleccionado] = useState(null)

  useEffect(() => { cargarPendientes() }, [])

  const cargarPendientes = async () => {
    setLoading(true)

    const promesas = []

    // Requisiciones pendientes segun rol
    if (ROLES_GERENCIALES.includes(perfil?.rol)) {
      promesas.push(
        supabase.from('requisiciones')
          .select('*, solicitante:solicitante_id(nombre, area), sites(nombre, codigo)')
          .eq('empresa_id', perfil.empresa_id)
          .eq('estatus', 'enviada')
          .eq('aprobador_actual_id', perfil.id)
          .order('created_at', { ascending: true })
      )
    } else {
      promesas.push(Promise.resolve({ data: [] }))
    }

    // Ordenes de compra pendientes segun rol
    let queryOC = null
    if (perfil?.rol === 'admin') {
      queryOC = supabase.from('ordenes_compra')
        .select('*, proveedores(nombre), comprador:comprador_id(nombre), sites(codigo), requisiciones(folio, criticidad)')
        .eq('empresa_id', perfil.empresa_id)
        .in('estatus', ['aprobacion_gerente_area', 'aprobacion_gerente_planta', 'aprobacion_gerente_compras', 'aprobacion_direccion'])
        .order('created_at', { ascending: true })
    } else if (perfil?.rol === 'gerente_compras') {
      queryOC = supabase.from('ordenes_compra')
        .select('*, proveedores(nombre), comprador:comprador_id(nombre), sites(codigo), requisiciones(folio, criticidad)')
        .eq('empresa_id', perfil.empresa_id)
        .eq('estatus', 'aprobacion_gerente_compras')
        .order('created_at', { ascending: true })
    } else if (perfil?.rol === 'direccion') {
      queryOC = supabase.from('ordenes_compra')
        .select('*, proveedores(nombre), comprador:comprador_id(nombre), sites(codigo), requisiciones(folio, criticidad)')
        .eq('empresa_id', perfil.empresa_id)
        .eq('estatus', 'aprobacion_direccion')
        .order('created_at', { ascending: true })
    } else if (ROLES_GERENCIALES.includes(perfil?.rol)) {
      // Gerentes de area/planta: solo ven la OC si son la persona asignada como aprobador actual
      queryOC = supabase.from('ordenes_compra')
        .select('*, proveedores(nombre), comprador:comprador_id(nombre), sites(codigo), requisiciones(folio, criticidad)')
        .eq('empresa_id', perfil.empresa_id)
        .in('estatus', ['aprobacion_gerente_area', 'aprobacion_gerente_planta'])
        .eq('aprobador_actual_id', perfil.id)
        .order('created_at', { ascending: true })
    }

    promesas.push(queryOC ? queryOC : Promise.resolve({ data: [] }))

    const [{ data: reqs }, { data: ocs }] = await Promise.all(promesas)
    setRequisiciones(reqs || [])
    setOrdenes(ocs || [])
    setLoading(false)
  }

  const abrirDetalle = (item, tipo) => {
    setItemSeleccionado(item)
    setTipoSeleccionado(tipo)
    setVista('detalle')
  }

  const volver = () => {
    setVista('lista')
    setItemSeleccionado(null)
    setTipoSeleccionado(null)
    cargarPendientes()
  }

  if (vista === 'detalle' && itemSeleccionado) {
    if (tipoSeleccionado === 'requisicion') {
      return <DetalleRequisicion requisicion={itemSeleccionado} onVolver={volver} />
    }
    if (tipoSeleccionado === 'orden') {
      return <DetalleOrden orden={itemSeleccionado} onVolver={volver} />
    }
  }

  const totalPendientes = requisiciones.length + ordenes.length

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Aprobaciones pendientes</h2>
        <button style={styles.botonRefrescar} onClick={cargarPendientes}>
          Refrescar
        </button>
      </div>

      <div style={styles.resumenCards}>
        <div style={{ ...styles.card, borderLeft: '4px solid #2563eb' }}>
          <p style={styles.cardNumero}>{totalPendientes}</p>
          <p style={styles.cardLabel}>Total pendientes</p>
        </div>
        <div style={{ ...styles.card, borderLeft: '4px solid #7c3aed' }}>
          <p style={styles.cardNumero}>{requisiciones.length}</p>
          <p style={styles.cardLabel}>Requisiciones</p>
        </div>
        <div style={{ ...styles.card, borderLeft: '4px solid #0891b2' }}>
          <p style={styles.cardNumero}>{ordenes.length}</p>
          <p style={styles.cardLabel}>Ordenes de compra</p>
        </div>
      </div>

      {loading ? (
        <p style={styles.sinDatos}>Cargando pendientes...</p>
      ) : totalPendientes === 0 ? (
        <div style={styles.sinPendientes}>
          <p style={styles.sinPendientesTitulo}>No tienes aprobaciones pendientes</p>
          <p style={styles.sinPendientesDesc}>Cuando alguien envie una solicitud que requiera tu aprobacion aparecera aqui.</p>
        </div>
      ) : (
        <>
          {requisiciones.length > 0 && (
            <div style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Requisiciones pendientes de tu aprobacion</h3>
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 1.5 }}>Folio</span>
                  <span style={{ flex: 2 }}>Solicitante</span>
                  <span style={{ flex: 1 }}>Area</span>
                  <span style={{ flex: 1 }}>Site</span>
                  <span style={{ flex: 1 }}>Fecha req.</span>
                  <span style={{ flex: 1 }}>Criticidad</span>
                  <span style={{ flex: 1 }}>Dias espera</span>
                  <span style={{ flex: 1 }}>Accion</span>
                </div>
                {requisiciones.map(r => {
                  const diasEspera = Math.floor((new Date() - new Date(r.created_at)) / (1000 * 60 * 60 * 24))
                  return (
                    <div key={r.id} style={styles.tablaFila}>
                      <span style={{ flex: 1.5, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{r.folio}</span>
                      <span style={{ flex: 2, fontSize: '13px' }}>{r.solicitante?.nombre}</span>
                      <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{r.solicitante?.area || '-'}</span>
                      <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{r.sites?.codigo}</span>
                      <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>
                        {new Date(r.fecha_requerida).toLocaleDateString('es-MX')}
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '500', backgroundColor: r.criticidad === 'alta' ? '#fef2f2' : r.criticidad === 'media' ? '#fef9c3' : '#f0fdf4', color: r.criticidad === 'alta' ? '#dc2626' : r.criticidad === 'media' ? '#854d0e' : '#16a34a' }}>
                          {r.criticidad?.toUpperCase()}
                        </span>
                      </span>
                      <span style={{ flex: 1 }}>
                        <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '500', backgroundColor: diasEspera > 2 ? '#fef2f2' : '#f0fdf4', color: diasEspera > 2 ? '#dc2626' : '#16a34a' }}>
                          {diasEspera} dia(s)
                        </span>
                      </span>
                      <span style={{ flex: 1 }}>
                        <button style={styles.botonAprobar} onClick={() => abrirDetalle(r, 'requisicion')}>
                          Revisar
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {ordenes.length > 0 && (
            <div style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Ordenes de compra pendientes de tu aprobacion</h3>
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 1.5 }}>Folio OC</span>
                  <span style={{ flex: 1 }}>Requisicion</span>
                  <span style={{ flex: 2 }}>Proveedor</span>
                  <span style={{ flex: 1 }}>Total</span>
                  <span style={{ flex: 1.5 }}>Estatus</span>
                  <span style={{ flex: 1 }}>Dias espera</span>
                  <span style={{ flex: 1 }}>Accion</span>
                </div>
                {ordenes.map(o => {
                  const diasEspera = Math.floor((new Date() - new Date(o.created_at)) / (1000 * 60 * 60 * 24))
                  return (
                    <div key={o.id} style={styles.tablaFila}>
                      <span style={{ flex: 1.5, fontWeight: '600', color: '#0891b2', fontSize: '13px' }}>{o.folio}</span>
                      <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{o.requisiciones?.folio || 'Directa'}</span>
                      <span style={{ flex: 2, fontSize: '13px' }}>{o.proveedores?.nombre}</span>
                      <span style={{ flex: 1, fontSize: '13px', fontWeight: '500' }}>
                        ${parseFloat(o.total || 0).toLocaleString('es-MX', { minimumFractionDigits: 2 })}
                      </span>
                      <span style={{ flex: 1.5, fontSize: '12px', color: '#666' }}>{o.estatus}</span>
                      <span style={{ flex: 1 }}>
                        <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '500', backgroundColor: diasEspera > 1 ? '#fef2f2' : '#f0fdf4', color: diasEspera > 1 ? '#dc2626' : '#16a34a' }}>
                          {diasEspera} dia(s)
                        </span>
                      </span>
                      <span style={{ flex: 1 }}>
                        <button style={{ ...styles.botonAprobar, backgroundColor: '#0891b2' }}
                          onClick={() => abrirDetalle(o, 'orden')}>
                          Revisar
                        </button>
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  botonRefrescar: { padding: '8px 16px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  resumenCards: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' },
  card: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardNumero: { fontSize: '32px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 4px 0' },
  cardLabel: { fontSize: '13px', color: '#666', margin: '0' },
  sinDatos: { color: '#94a3b8', fontSize: '14px', textAlign: 'center', padding: '40px' },
  sinPendientes: { backgroundColor: '#fff', borderRadius: '10px', padding: '48px', textAlign: 'center', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  sinPendientesTitulo: { fontSize: '16px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 8px 0' },
  sinPendientesDesc: { fontSize: '13px', color: '#666', margin: '0' },
  seccion: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  seccionTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0', paddingBottom: '10px', borderBottom: '1px solid #f1f5f9' },
  tabla: { overflowX: 'auto' },
  tablaHeader: { display: 'flex', padding: '10px 16px', backgroundColor: '#f8fafc', borderRadius: '7px', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' },
  tablaFila: { display: 'flex', padding: '14px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  botonAprobar: { padding: '6px 14px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: '500' },
}