import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import BandejaLiberacion from './BandejaLiberacion'
import RequisitosProveedor from './RequisitosProveedor'
import LiberacionesCalidad from './LiberacionesCalidad'
import NoConformidades from './NoConformidades'
import AlertasCalidad from './AlertasCalidad'
import Cuarentena from './Cuarentena'
import ModuloPendiente from '../ModuloPendiente'

const secciones = [
  { id: 'bandeja', modulo: 'cal_bandeja', titulo: 'Liberacion de Lotes' },
  { id: 'liberaciones', modulo: 'cal_liberaciones', titulo: 'Liberacion de Calidad (PSW/PPAP)' },
  { id: 'requisitos', modulo: 'cal_requisitos_prov', titulo: 'Requisitos de Proveedor' },
  { id: 'no_conformidades', modulo: 'cal_nc', titulo: 'No Conformidades' },
  { id: 'alertas', modulo: 'cal_alertas', titulo: 'Alertas de Calidad' },
  { id: 'cuarentena', modulo: 'cal_cuarentena', titulo: 'Cuarentena' },
]

export default function GrupoCalidad() {
  const { tienePermiso } = useAuth()
  const seccionesVisibles = secciones.filter(s => s.pendiente || tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar} className="no-imprimir">
        <p style={styles.sidebarTitulo}>Calidad</p>
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
          <p style={{ color: '#666', padding: '28px' }}>Tu rol no tiene ninguna seccion de Calidad habilitada.</p>
        )}
        {seccion === 'bandeja' && <BandejaLiberacion />}
        {seccion === 'liberaciones' && <LiberacionesCalidad />}
        {seccion === 'requisitos' && <RequisitosProveedor />}
        {seccion === 'no_conformidades' && <NoConformidades />}
        {seccion === 'alertas' && <AlertasCalidad />}
        {seccion === 'cuarentena' && <Cuarentena />}
      </div>
    </div>
  )
}

const styles = {
  container: { display: 'flex', minHeight: 'calc(100vh - 50px)' },
  sidebar: { width: '200px', backgroundColor: '#fff', borderRight: '1px solid #e2e8f0', padding: '20px 0' },
  sidebarTitulo: { fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', padding: '0 16px', margin: '0 0 8px 0' },
  item: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: 'transparent', textAlign: 'left', fontSize: '14px', color: '#444', cursor: 'pointer' },
  itemActivo: { display: 'block', width: '100%', padding: '10px 16px', border: 'none', backgroundColor: '#fef2f2', textAlign: 'left', fontSize: '14px', color: '#b91c1c', fontWeight: '600', cursor: 'pointer', borderLeft: '3px solid #b91c1c' },
  contenido: { flex: 1, backgroundColor: '#f8fafc' },
}
