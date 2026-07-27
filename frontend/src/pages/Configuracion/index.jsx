import { useState, useEffect } from 'react'
import { useAuth } from '../../context/AuthContext'
import Usuarios from './Usuarios'
import Sites from './Sites'
import CentrosCostos from './CentrosCostos'
import CuentasGastos from './CuentasGastos'
import Categorias from './Categorias'
import Delegaciones from './Delegaciones'
import Permisos from './Permisos'
import Notificaciones from './Notificaciones'
import DatosEmpresa from './DatosEmpresa'
import ConfigEtiquetas from './ConfigEtiquetas'

const secciones = [
  { id: 'empresa', modulo: 'config_empresa', titulo: 'Datos de la Empresa' },
  { id: 'usuarios', modulo: 'config_usuarios', titulo: 'Usuarios' },
  { id: 'sites', modulo: 'config_sites', titulo: 'Sites / Plantas' },
  { id: 'centros', modulo: 'config_centros_costos', titulo: 'Centros de Costos' },
  { id: 'cuentas', modulo: 'config_cuentas_gastos', titulo: 'Cuentas de Gastos' },
  { id: 'categorias', modulo: 'config_categorias', titulo: 'Categorias' },
  { id: 'delegaciones', modulo: 'config_delegaciones', titulo: 'Delegacion de Autoridad' },
  { id: 'permisos', modulo: 'config_permisos', titulo: 'Permisos por Rol' },
  { id: 'notificaciones', modulo: 'config_notificaciones', titulo: 'Notificaciones' },
  { id: 'etiquetas', modulo: 'config_etiquetas', titulo: 'Configuracion de Etiquetas' },
]

export default function Configuracion() {
  const { perfil, tienePermiso } = useAuth()

  // Cada seccion ahora es su propio modulo de permisos: se muestra solo si el rol
  // tiene "ver" habilitado para ese submodulo especifico (ajustable en Permisos por Rol).
  const seccionesVisibles = secciones.filter(s => tienePermiso(s.modulo, 'ver'))

  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  useEffect(() => {
    if (!seccionesVisibles.find(s => s.id === seccion)) {
      setSeccion(seccionesVisibles[0]?.id || '')
    }
  }, [perfil?.rol, seccionesVisibles.length])

  return (
    <div style={styles.container}>
      <div style={styles.sidebar} className="no-imprimir">
        <p style={styles.sidebarTitulo}>Configuracion</p>
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
          <p style={{ color: '#666' }}>
            Tu rol no tiene ninguna seccion de Configuracion habilitada. Pide a un Administrador que te asigne acceso desde Permisos por Rol.
          </p>
        )}
        {seccion === 'empresa' && <DatosEmpresa />}
        {seccion === 'usuarios' && <Usuarios />}
        {seccion === 'sites' && <Sites />}
        {seccion === 'centros' && <CentrosCostos />}
        {seccion === 'cuentas' && <CuentasGastos />}
        {seccion === 'categorias' && <Categorias />}
        {seccion === 'delegaciones' && <Delegaciones />}
        {seccion === 'permisos' && <Permisos />}
        {seccion === 'notificaciones' && <Notificaciones />}
        {seccion === 'etiquetas' && <ConfigEtiquetas />}
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