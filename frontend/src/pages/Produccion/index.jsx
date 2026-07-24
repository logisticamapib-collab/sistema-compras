import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import OrdenesTrabajo from './OrdenesTrabajo'
import ReporteProduccion from './ReporteProduccion'
import CatalogosProduccion from './Catalogos'
import ProgramacionProduccion from './ProgramacionProduccion'
import TableroAndon from './TableroAndon'

const secciones = [
  { id: 'ordenes', modulo: 'prod_ordenes', titulo: 'Ordenes de Trabajo' },
  { id: 'reporte', modulo: 'prod_reportes', titulo: 'Reporte de Produccion' },
  { id: 'programa', modulo: 'prod_programa', titulo: 'Programacion' },
  { id: 'andon', modulo: 'prod_andon', titulo: 'Tablero Andon' },
  { id: 'catalogos', modulo: 'prod_catalogos', titulo: 'Catalogos' },
]

export default function GrupoProduccion() {
  const { tienePermiso } = useAuth()
  const seccionesVisibles = secciones.filter(s => tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <p style={styles.sidebarTitulo}>Produccion</p>
        {seccionesVisibles.map(s => (
          <button key={s.id}
            className={seccion === s.id ? 'nav-item nav-item-activo' : 'nav-item'}
            style={seccion === s.id ? styles.itemActivo : styles.item}
            onClick={() => setSeccion(s.id)}>
            {s.titulo}
          </button>
        ))}
      </div>
      <div style={styles.contenido}>
        {seccionesVisibles.length === 0 && <p style={{ color: '#666', padding: '28px' }}>Tu rol no tiene ninguna seccion de Produccion habilitada.</p>}
        {seccion === 'ordenes' && <OrdenesTrabajo />}
        {seccion === 'reporte' && <ReporteProduccion />}
        {seccion === 'programa' && <ProgramacionProduccion />}
        {seccion === 'andon' && <TableroAndon />}
        {seccion === 'catalogos' && <CatalogosProduccion />}
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', minHeight: 'calc(100vh - 50px)' },
  sidebar: { width: '200px', backgroundColor: '#fff', borderRight: '1px solid #e2e8f0', padding: '20px 0' },
  sidebarTitulo: { fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', padding: '0 16px', margin: '0 0 8px 0' },
  item: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', fontSize: '14px', color: '#444', cursor: 'pointer' },
  itemActivo: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: '#fff7ed', textAlign: 'left', fontSize: '14px', color: '#c2410c', fontWeight: '600', cursor: 'pointer', borderLeft: '3px solid #c2410c' },
  contenido: { flex: 1, backgroundColor: '#f8fafc' },
}
