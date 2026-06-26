import { useState } from 'react'
import Configuracion from './Configuracion/index'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import Proveedores from './Proveedores/index'
import Articulos from './Articulos/index'
import Requisiciones from './Requisiciones/index'
import Ordenes from './Ordenes/index'

const modulos = [
  { id: 'requisiciones', titulo: 'Requisiciones', desc: 'Crear y dar seguimiento a requisiciones', color: '#2563eb', roles: ['solicitante','gerente_area','gerente_planta','gerente_administrativo','compras','direccion','admin'] },
  { id: 'aprobaciones', titulo: 'Aprobaciones', desc: 'Revisar y aprobar solicitudes pendientes', color: '#7c3aed', roles: ['gerente_area','gerente_planta','gerente_administrativo','compras','direccion','admin'] },
  { id: 'ordenes', titulo: 'Ordenes de Compra', desc: 'Gestionar ordenes y seguimiento de arribo', color: '#0891b2', roles: ['compras','direccion','admin'] },
  { id: 'articulos', titulo: 'Articulos', desc: 'Catalogo de materiales y herramientas', color: '#059669', roles: ['compras','admin'] },
  { id: 'proveedores', titulo: 'Proveedores', desc: 'Alta y gestion de proveedores', color: '#d97706', roles: ['compras','admin'] },
  { id: 'reportes', titulo: 'Reportes KPI', desc: 'Indicadores y metricas de compras', color: '#dc2626', roles: ['gerente_planta','gerente_administrativo','compras','direccion','admin'] },
  { id: 'configuracion', titulo: 'Configuracion', desc: 'Usuarios, sites, centros de costos y mas', color: '#475569', roles: ['admin'] },
]

export default function Dashboard() {
  const { perfil } = useAuth()
  const [moduloActivo, setModuloActivo] = useState(null)

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  const modulosVisibles = modulos.filter(m =>
    perfil?.rol && m.roles.includes(perfil.rol)
  )

  if (moduloActivo) {
    return (
      <div style={styles.container}>
        <header style={styles.header}>
          <button style={styles.botonBack} onClick={() => setModuloActivo(null)}>
            &larr; Panel de control
          </button>
          <div style={styles.headerDerecho}>
            <span style={styles.usuario}>{perfil?.nombre} - <strong>{perfil?.rol}</strong></span>
            <button onClick={handleLogout} style={styles.botonSalir}>Cerrar sesion</button>
          </div>
        </header>
        <div>
          {moduloActivo === 'configuracion' && <Configuracion />}
          {moduloActivo === 'proveedores' && <Proveedores />}
          {moduloActivo === 'articulos' && <Articulos />}
          {moduloActivo === 'requisiciones' && <Requisiciones />}
          {moduloActivo === 'ordenes' && <Ordenes />}
          {moduloActivo !== 'configuracion' && moduloActivo !== 'proveedores' && moduloActivo !== 'articulos' && moduloActivo !== 'requisiciones' && moduloActivo !== 'ordenes' && (
            <div style={styles.contenido}>
              <h2>Modulo: {moduloActivo} - En construccion</h2>
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.titulo}>Sistema de Compras</h1>
          <p style={styles.subtitulo}>
            {perfil?.sites?.nombre} - {perfil?.empresas?.nombre}
          </p>
        </div>
        <div style={styles.headerDerecho}>
          <span style={styles.usuario}>{perfil?.nombre} - <strong>{perfil?.rol}</strong></span>
          <button onClick={handleLogout} style={styles.botonSalir}>Cerrar sesion</button>
        </div>
      </header>

      <div style={styles.contenido}>
        <div style={styles.bienvenida}>
          <h2 style={styles.bienvenidaTitulo}>Buen dia, {perfil?.nombre?.split(' ')[0]}</h2>
          <p style={styles.bienvenidaDesc}>Selecciona un modulo para comenzar</p>
        </div>

        <div style={styles.grid}>
          {modulosVisibles.map(modulo => (
            <div
              key={modulo.id}
              style={styles.tarjeta}
              onClick={() => setModuloActivo(modulo.id)}
              onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-3px)'}
              onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}
            >
              <div style={{ ...styles.tarjetaBarra, backgroundColor: modulo.color }}></div>
              <div style={styles.tarjetaContenido}>
                <p style={styles.tarjetaTitulo}>{modulo.titulo}</p>
                <p style={styles.tarjetaDesc}>{modulo.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#f0f2f5' },
  header: { backgroundColor: '#1a1a2e', padding: '14px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  titulo: { color: '#fff', fontSize: '17px', fontWeight: '600', margin: '0' },
  subtitulo: { color: '#94a3b8', fontSize: '11px', margin: '2px 0 0 0' },
  headerDerecho: { display: 'flex', alignItems: 'center', gap: '16px' },
  usuario: { color: '#cbd5e1', fontSize: '13px' },
  botonSalir: { padding: '7px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  botonBack: { padding: '7px 14px', backgroundColor: 'transparent', color: '#94a3b8', border: '1px solid #334155', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  contenido: { padding: '28px' },
  bienvenida: { marginBottom: '24px' },
  bienvenidaTitulo: { fontSize: '20px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 4px 0' },
  bienvenidaDesc: { fontSize: '13px', color: '#666', margin: '0' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', overflow: 'hidden' },
  tarjetaBarra: { height: '5px', width: '100%' },
  tarjetaContenido: { padding: '20px' },
  tarjetaTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px 0' },
  tarjetaDesc: { fontSize: '12px', color: '#666', margin: '0' },
}