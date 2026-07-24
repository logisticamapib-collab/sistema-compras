import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import Clientes from '../Ingenieria/Clientes'
import ModuloPendiente from '../ModuloPendiente'
import Releases from './Releases'
import Almacenes from './Almacenes'
import FlujosAlmacen from './FlujosAlmacen'
import Inventario from './Inventario'
import ConsultasInventario from './ConsultasInventario'
import Recibos from './Recibos'
import AutorizacionesConsigna from './AutorizacionesConsigna'
import Embarques from './Embarques'
import ListaEmbarque from './ListaEmbarque'
import EmbarquePreparar from './EmbarquePreparar'
import MovimientoMaterial from './MovimientoMaterial'
import TraspasoEscaneo from './TraspasoEscaneo'
import Contenedores from './Contenedores'

const secciones = [
  { id: 'almacenes', modulo: 'log_almacenes', titulo: 'Almacenes' },
  { id: 'flujos', modulo: 'log_flujos', titulo: 'Flujos de Almacen' },
  { id: 'recibos', modulo: 'log_recibos', titulo: 'Recibos' },
  { id: 'movimiento', modulo: 'log_movimiento', titulo: 'Movimiento de Material' },
  { id: 'traspaso_escaneo', modulo: 'log_movimiento', titulo: 'Traspaso por Escaneo' },
  { id: 'contenedores', modulo: 'log_contenedores', titulo: 'Cajas y Tarimas' },
  { id: 'inventario', modulo: 'log_inventario', titulo: 'Inventario' },
  { id: 'consultas', modulo: 'log_consultas', titulo: 'Consultas de Inventario' },
  { id: 'embarques', modulo: 'log_embarques', titulo: 'Embarques' },
  { id: 'lista_embarque', modulo: 'log_embarques', titulo: 'Lista de Embarque' },
  { id: 'preparar_embarque', modulo: 'log_embarques', titulo: 'Preparar Embarque' },
  { id: 'customer_service', modulo: 'cs_releases', titulo: 'Customer Service' },
  { id: 'consigna', modulo: 'cs_consigna', titulo: 'Autorizaciones de Consigna' },
  { id: 'clientes', modulo: 'ing_clientes', titulo: 'Clientes' },
]

export default function GrupoLogistica() {
  const { tienePermiso } = useAuth()
  const seccionesVisibles = secciones.filter(s => s.pendiente || tienePermiso(s.modulo, 'ver'))
  const [seccion, setSeccion] = useState(seccionesVisibles[0]?.id || '')

  return (
    <div style={styles.container}>
      <div style={styles.sidebar}>
        <p style={styles.sidebarTitulo}>Logistica</p>
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
          <p style={{ color: '#666', padding: '28px' }}>Tu rol no tiene ninguna seccion de Logistica habilitada.</p>
        )}
        {seccion === 'almacenes' && <Almacenes />}
        {seccion === 'flujos' && <FlujosAlmacen />}
        {seccion === 'recibos' && <Recibos />}
        {seccion === 'movimiento' && <MovimientoMaterial />}
        {seccion === 'traspaso_escaneo' && <TraspasoEscaneo />}
        {seccion === 'contenedores' && <Contenedores />}
        {seccion === 'inventario' && <Inventario />}
        {seccion === 'consultas' && <ConsultasInventario />}
        {seccion === 'embarques' && <Embarques />}
        {seccion === 'lista_embarque' && <ListaEmbarque />}
        {seccion === 'preparar_embarque' && <EmbarquePreparar />}
        {seccion === 'customer_service' && <Releases />}
        {seccion === 'consigna' && <AutorizacionesConsigna />}
        {seccion === 'clientes' && <Clientes />}
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