import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import Clientes from '../Ingenieria/Clientes'
import ModuloPendiente from '../ModuloPendiente'

const secciones = [
  { id: 'almacen', modulo: null, titulo: 'Almacen', pendiente: true },
  { id: 'embarques', modulo: null, titulo: 'Embarques', pendiente: true },
  { id: 'customer_service', modulo: null, titulo: 'Customer Service', pendiente: true },
  { id: 'clientes', modulo: 'ing_clientes', titulo: 'Clientes' },
]

export default function GrupoLogistica() {
  const { tienePermiso } = useAuth()
  const seccionesVisibles = secciones.filter(s => s.pendiente || tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <p style={styles.sidebarTitulo}>Logistica</p>
        {seccionesVisibles.map(s => (
          <button
            key={s.id}
            style={seccion === s.id ? styles.itemActivo : styles.item}
            onClick={() => setSeccion(s.id)}>
            {s.titulo}
          </button>
        ))}
      </div>
      <div style={styles.contenido}>
        {seccionesVisibles.length === 0 && (
          <p style={{ color: '#666', padding: '28px' }}>Tu rol no tiene ninguna seccion de Logistica habilitada.</p>
        )}
        {seccion === 'almacen' && <ModuloPendiente titulo="Almacen" />}
        {seccion === 'embarques' && <ModuloPendiente titulo="Embarques" />}
        {seccion === 'customer_service' && <ModuloPendiente titulo="Customer Service" />}
        {seccion === 'clientes' && <Clientes />}
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', minHeight: 'calc(100vh - 50px)' },
  sidebar: { width: '200px', backgroundColor: '#fff', borderRight: '1px solid #e2e8f0', padding: '20px 0' },
  sidebarTitulo: { fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', padding: '0 16px', margin: '0 0 8px 0' },
  item: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', fontSize: '14px', color: '#444', cursor: 'pointer' },
  itemActivo: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: '#eff6ff', textAlign: 'left', fontSize: '14px', color: '#2563eb', fontWeight: '600', cursor: 'pointer', borderLeft: '3px solid #2563eb' },
  contenido: { flex: 1, backgroundColor: '#f8fafc' },
}