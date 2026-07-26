import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import MoldesEstado from './MoldesEstado'
import OrdenesMtto from './OrdenesMtto'
import TiposMtto from './TiposMtto'

const secciones = [
  { id: 'estado', modulo: 'mol_estado', titulo: 'Moldes y estado' },
  { id: 'ordenes', modulo: 'mol_ordenes', titulo: 'Ordenes de Mantenimiento' },
  { id: 'tipos', modulo: 'mol_tipos', titulo: 'Tipos y parametros' },
]

export default function GrupoMoldes() {
  const { tienePermiso } = useAuth()
  const visibles = secciones.filter(s => tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(visibles[0]?.id || '')
  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <p style={styles.sidebarTitulo}>Mantenimiento de Moldes</p>
        {visibles.map(s => (
          <button key={s.id} className={seccion === s.id ? 'nav-item nav-item-activo' : 'nav-item'}
            style={seccion === s.id ? styles.itemActivo : styles.item} onClick={() => setSeccion(s.id)}>{s.titulo}</button>
        ))}
      </div>
      <div style={styles.contenido}>
        {visibles.length === 0 && <p style={{ color: '#666', padding: '28px' }}>Tu rol no tiene secciones de Mantenimiento de Moldes.</p>}
        {seccion === 'estado' && <MoldesEstado />}
        {seccion === 'ordenes' && <OrdenesMtto />}
        {seccion === 'tipos' && <TiposMtto />}
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', minHeight: 'calc(100vh - 50px)' },
  sidebar: { width: '220px', backgroundColor: '#fff', borderRight: '1px solid #e2e8f0', padding: '20px 0' },
  sidebarTitulo: { fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', padding: '0 16px', margin: '0 0 8px 0' },
  item: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', fontSize: '14px', color: '#444', cursor: 'pointer' },
  itemActivo: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: '#fdf6e3', textAlign: 'left', fontSize: '14px', color: '#a16207', fontWeight: '600', cursor: 'pointer', borderLeft: '3px solid #a16207' },
  contenido: { flex: 1, backgroundColor: '#f8fafc' },
}
