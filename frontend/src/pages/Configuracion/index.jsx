import { useState } from 'react'
import Usuarios from './Usuarios'
import Sites from './Sites'
import CentrosCostos from './CentrosCostos'
import CuentasGastos from './CuentasGastos'

const secciones = [
  { id: 'usuarios', titulo: 'Usuarios' },
  { id: 'sites', titulo: 'Sites / Plantas' },
  { id: 'centros', titulo: 'Centros de Costos' },
  { id: 'cuentas', titulo: 'Cuentas de Gastos' },
]

export default function Configuracion() {
  const [seccion, setSeccion] = useState('usuarios')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <p style={styles.sidebarTitulo}>Configuracion</p>
        {secciones.map(s => (
          <button
            key={s.id}
            style={seccion === s.id ? styles.itemActivo : styles.item}
            onClick={() => setSeccion(s.id)}>
            {s.titulo}
          </button>
        ))}
      </div>
      <div style={styles.contenido}>
        {seccion === 'usuarios' && <Usuarios />}
        {seccion === 'sites' && <Sites />}
        {seccion === 'centros' && <CentrosCostos />}
        {seccion === 'cuentas' && <CuentasGastos />}
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
  contenido: { flex: 1, padding: '28px', backgroundColor: '#f8fafc' },
}