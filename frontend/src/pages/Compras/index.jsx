import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import Requisiciones from '../Requisiciones/index'
import Aprobaciones from '../Aprobaciones/index'
import Ordenes from '../Ordenes/index'
import Proveedores from '../Proveedores/index'
import Reportes from '../Reportes/index'
import GeneradorReportes from './GeneradorReportes'

const secciones = [
  { id: 'requisiciones', modulo: 'requisiciones', titulo: 'Requisiciones' },
  { id: 'aprobaciones', modulo: 'aprobaciones', titulo: 'Aprobaciones' },
  { id: 'ordenes', modulo: 'ordenes', titulo: 'Ordenes de Compra' },
  { id: 'proveedores', modulo: 'proveedores', titulo: 'Proveedores' },
  { id: 'reportes', modulo: 'reportes', titulo: 'Reportes KPI' },
  { id: 'generador', modulo: 'reportes', titulo: 'Generador de Reportes' },
]

export default function GrupoCompras() {
  const { tienePermiso } = useAuth()
  const seccionesVisibles = secciones.filter(s => tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <p style={styles.sidebarTitulo}>Compras</p>
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
          <p style={{ color: '#666' }}>Tu rol no tiene ninguna secci\u00f3n de Compras habilitada.</p>
        )}
        {seccion === 'requisiciones' && <Requisiciones />}
        {seccion === 'aprobaciones' && <Aprobaciones />}
        {seccion === 'ordenes' && <Ordenes />}
        {seccion === 'proveedores' && <Proveedores />}
        {seccion === 'reportes' && <Reportes />}
        {seccion === 'generador' && <GeneradorReportes />}
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
