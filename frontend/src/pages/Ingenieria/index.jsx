import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import Articulos from '../Articulos/index'
import Maquinas from './Maquinas'
import Moldes from './Moldes'
import RutasFabricacion from './RutasFabricacion'
import Clientes from './Clientes'
import NormasEmpaque from './NormasEmpaque'
import BOM from './BOM'
import NivelesIngenieria from './NivelesIngenieria'
import CargaMasiva from './CargaMasiva'

const secciones = [
  { id: 'articulos', modulo: 'articulos', titulo: 'Articulos' },
  { id: 'maquinas', modulo: 'ing_maquinas', titulo: 'Maquinas' },
  { id: 'moldes', modulo: 'ing_moldes', titulo: 'Moldes' },
  { id: 'rutas', modulo: 'ing_rutas', titulo: 'Rutas de Fabricacion' },
  { id: 'bom', modulo: 'ing_bom', titulo: 'BOM (Lista de Materiales)' },
  { id: 'niveles', modulo: 'ing_niveles', titulo: 'Niveles de Ingenieria' },
  { id: 'normas_empaque', modulo: 'ing_normas_empaque', titulo: 'Normas de Empaque' },
  { id: 'clientes', modulo: 'ing_clientes', titulo: 'Clientes' },
  { id: 'carga_masiva', modulo: 'articulos', titulo: 'Carga Masiva' },
  // Aqui se iran agregando: Niveles de ingenieria, etc.
]

export default function GrupoIngenieria() {
  const { tienePermiso } = useAuth()
  const seccionesVisibles = secciones.filter(s => tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar} className="no-imprimir">
        <p style={styles.sidebarTitulo}>Ingenieria</p>
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
          <p style={{ color: '#666' }}>Tu rol no tiene ninguna seccion de Ingenieria habilitada.</p>
        )}
        {seccion === 'articulos' && <Articulos />}
        {seccion === 'maquinas' && <Maquinas />}
        {seccion === 'moldes' && <Moldes />}
        {seccion === 'rutas' && <RutasFabricacion />}
        {seccion === 'bom' && <BOM />}
        {seccion === 'niveles' && <NivelesIngenieria />}
        {seccion === 'normas_empaque' && <NormasEmpaque />}
        {seccion === 'clientes' && <Clientes />}
        {seccion === 'carga_masiva' && <CargaMasiva />}
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
