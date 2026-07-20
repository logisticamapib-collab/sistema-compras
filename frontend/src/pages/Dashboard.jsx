import { useState } from 'react'
import Configuracion from './Configuracion/index'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import GrupoCompras from './Compras/index'
import GrupoIngenieria from './Ingenieria/index'
import GrupoLogistica from './Logistica/index'
import GrupoCalidad from './Calidad/index'
import GrupoProduccion from './Produccion/index'
import ModuloPendiente from './ModuloPendiente'

// Modulos "contenedor" -- agrupan varias pantallas y dependen de permisos granulares internos
const modulosGrupo = [
  { id: 'compras', titulo: 'Compras', desc: 'Requisiciones, ordenes, proveedores y KPI', color: '#2563eb' },
  { id: 'ingenieria', titulo: 'Ingenieria', desc: 'Articulos, rutas, BOM y niveles de ingenieria', color: '#059669' },
  { id: 'logistica', titulo: 'Logistica', desc: 'Almacen, Embarques, Customer Service y Clientes', color: '#0891b2' },
  { id: 'produccion', titulo: 'Produccion', desc: 'Ordenes de trabajo, reporte de produccion y scrap', color: '#c2410c' },
  { id: 'calidad', titulo: 'Calidad', desc: 'Liberacion de lotes, cuarentena y no conformidades', color: '#b91c1c' },
]

// Configuracion es su propio modulo principal (no vive dentro de ningun grupo)
const moduloConfiguracion = { id: 'configuracion', titulo: 'Configuracion', desc: 'Usuarios, sites, permisos y mas', color: '#475569' }

// Modulos del roadmap de MRP, todavia sin funcionalidad interna -- visibles para todos como referencia del plan
const modulosPendientes = [
  { id: 'planeacion', titulo: 'Planeacion de Produccion', desc: 'Motor MRP: plan de produccion y necesidades', color: '#9333ea' },
  { id: 'moldes', titulo: 'Mantenimiento de Moldes', desc: 'Conteo de shots y mantenimiento preventivo', color: '#a16207' },
  { id: 'mantenimiento', titulo: 'Mantenimiento', desc: 'Ordenes de mantenimiento general', color: '#57534e' },
]

export default function Dashboard() {
  const { perfil, tienePermiso } = useAuth()
  const [moduloActivo, setModuloActivo] = useState(null)

  const handleLogout = async () => {
    await supabase.auth.signOut()
  }

  const gruposVisibles = modulosGrupo.filter(m => tienePermiso(m.id, 'ver'))
  const configVisible = tienePermiso('configuracion', 'ver')

  const pendienteActivo = modulosPendientes.find(m => m.id === moduloActivo)

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
          {moduloActivo === 'compras' && <GrupoCompras />}
          {moduloActivo === 'ingenieria' && <GrupoIngenieria />}
          {moduloActivo === 'logistica' && <GrupoLogistica />}
          {moduloActivo === 'calidad' && <GrupoCalidad />}
          {moduloActivo === 'produccion' && <GrupoProduccion />}
          {moduloActivo === 'configuracion' && <Configuracion />}
          {pendienteActivo && <ModuloPendiente titulo={pendienteActivo.titulo} />}
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <div style={styles.headerIzquierdo}>
          <img src="/syntia-logo.png" alt="SYNTIA" style={styles.logoHeader} />
          <div>
            <h1 style={styles.titulo}>SYNTIA</h1>
            <p style={styles.subtitulo}>
              {perfil?.sites?.nombre} - {perfil?.empresas?.nombre}
            </p>
          </div>
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
          {gruposVisibles.map(modulo => (
            <Tarjeta key={modulo.id} modulo={modulo} onClick={() => setModuloActivo(modulo.id)} />
          ))}
          {configVisible && (
            <Tarjeta modulo={moduloConfiguracion} onClick={() => setModuloActivo(moduloConfiguracion.id)} />
          )}
        </div>

        <div style={styles.seccionPendientes}>
          <p style={styles.pendientesTitulo}>Roadmap MRP (en desarrollo)</p>
          <div style={styles.grid}>
            {modulosPendientes.map(modulo => (
              <Tarjeta key={modulo.id} modulo={modulo} atenuada onClick={() => setModuloActivo(modulo.id)} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function Tarjeta({ modulo, onClick, atenuada }) {
  return (
    <div
      className="tarjeta-modulo"
      style={{ ...styles.tarjeta, opacity: atenuada ? 0.75 : 1 }}
      onClick={onClick}
    >
      <div style={{ ...styles.tarjetaBarra, backgroundColor: modulo.color }}></div>
      <div style={styles.tarjetaContenido}>
        <p style={styles.tarjetaTitulo}>{modulo.titulo}</p>
        <p style={styles.tarjetaDesc}>{modulo.desc}</p>
      </div>
    </div>
  )
}

const styles = {
  container: { minHeight: '100vh', backgroundColor: '#f0f2f5' },
  header: { backgroundColor: '#1a1a2e', padding: '10px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  headerIzquierdo: { display: 'flex', alignItems: 'center', gap: '12px' },
  logoHeader: { width: '52px', height: '52px', objectFit: 'contain' },
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
  seccionPendientes: { marginTop: '36px' },
  pendientesTitulo: { fontSize: '12px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 14px 0' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', boxShadow: '0 1px 6px rgba(0,0,0,0.07)', cursor: 'pointer', transition: 'transform 0.2s, box-shadow 0.2s', overflow: 'hidden' },
  tarjetaBarra: { height: '5px', width: '100%' },
  tarjetaContenido: { padding: '20px' },
  tarjetaTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px 0' },
  tarjetaDesc: { fontSize: '12px', color: '#666', margin: '0' },
}
