import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import ParametrosMRP from './ParametrosMRP'
import CorrerMRP from './CorrerMRP'
import BandejaMRP from './BandejaMRP'

const secciones = [
  { id: 'correr', modulo: 'plan_correr', titulo: 'Correr MRP' },
  { id: 'ordenes', modulo: 'plan_ordenes', titulo: 'Ordenes planeadas' },
  { id: 'parametros', modulo: 'plan_parametros', titulo: 'Parametros MRP' },
]

export default function GrupoPlaneacion() {
  const { tienePermiso } = useAuth()
  const seccionesVisibles = secciones.filter(s => tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <p style={styles.sidebarTitulo}>Planeacion</p>
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
        {seccionesVisibles.length === 0 && <p style={{ color: '#666', padding: '28px' }}>Tu rol no tiene ninguna seccion de Planeacion habilitada.</p>}
        {seccion === 'correr' && <div style={{ padding: '28px' }}><CorrerMRP /></div>}
        {seccion === 'ordenes' && <div style={{ padding: '28px' }}><BandejaMRP /></div>}
        {seccion === 'parametros' && <div style={{ padding: '28px' }}><ParametrosMRP /></div>}
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', minHeight: 'calc(100vh - 50px)' },
  sidebar: { width: '200px', backgroundColor: '#fff', borderRight: '1px solid #e2e8f0', padding: '20px 0' },
  sidebarTitulo: { fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', padding: '0 16px', margin: '0 0 8px 0' },
  item: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', fontSize: '14px', color: '#444', cursor: 'pointer' },
  itemActivo: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: '#faf5ff', textAlign: 'left', fontSize: '14px', color: '#9333ea', fontWeight: '600', cursor: 'pointer', borderLeft: '3px solid #9333ea' },
  contenido: { flex: 1, backgroundColor: '#f8fafc' },
}
