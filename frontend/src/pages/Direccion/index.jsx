import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import ReportesEjecutivos from './ReportesEjecutivos'
import Aprobaciones from '../Aprobaciones/index'
import Ordenes from '../Ordenes/index'

const secciones = [
  { id: 'ejecutivos', modulo: 'rep_ejecutivos', titulo: 'Reportes Ejecutivos' },
  { id: 'aprobaciones', modulo: 'aprobaciones', titulo: 'Aprobaciones' },
  { id: 'ordenes', modulo: 'ordenes', titulo: 'Ordenes de Compra' },
]

export default function GrupoDireccion() {
  const { tienePermiso } = useAuth()
  const seccionesVisibles = secciones.filter(s => tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar} className="no-imprimir">
        <p style={styles.sidebarTitulo}>Direccion</p>
        {seccionesVisibles.map(s => (
          <button
            key={s.id}
            className={seccion === s.id ? 'nav-item nav-item-activo' : 'nav-item'}
            style={seccion === s.id ? styles.itemActivo : styles.item}
            onClick={() => setSeccion(s.id)}>
            {s.titulo}
          </button>
        ))}
      </div>
      <div style={styles.contenido}>
        {seccionesVisibles.length === 0 && (
          <p style={{ color: '#666', padding: '28px' }}>Tu rol no tiene ninguna seccion de Direccion habilitada.</p>
        )}
        {seccion === 'ejecutivos' && <ReportesEjecutivos />}
        {seccion === 'aprobaciones' && <Aprobaciones />}
        {seccion === 'ordenes' && <Ordenes />}
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', minHeight: 'calc(100vh - 50px)' },
  sidebar: { width: '200px', backgroundColor: '#fff', borderRight: '1px solid #e2e8f0', padding: '20px 0' },
  sidebarTitulo: { fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', padding: '0 16px', margin: '0 0 8px 0' },
  item: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', fontSize: '14px', 