import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Catalogos de produccion: causas de scrap y causas de paro.
// Alimentan el reporte de produccion y los indicadores (scrap por causa, OEE).

export default function CatalogosProduccion() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('prod_catalogos', 'editar')

  const [tab, setTab] = useState('scrap')
  const [scrap, setScrap] = useState([])
  const [paro, setParo] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [form, setForm] = useState(null) // { id?, clave, nombre }

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [s, p] = await Promise.all([
      supabase.from('causas_scrap').select('*').order('nombre'),
      supabase.from('causas_paro').select('*').order('nombre'),
    ])
    setScrap(s.data || []); setParo(p.data || [])
    setLoading(false)
  }

  const tabla = () => tab === 'scrap' ? 'causas_scrap' : 'causas_paro'
  const lista = tab === 'scrap' ? scrap : paro

  const guardar = async () => {
    setError('')
    if (!form.nombre.trim()) { setError('El nombre es obligatorio'); return }
    const datos = { clave: form.clave?.trim().toUpperCase() || null, nombre: form.nombre.trim() }
    const res = form.id
      ? await supabase.from(tabla()).update(datos).eq('id', form.id)
      : await supabase.from(tabla()).insert({ ...datos, empresa_id: perfil.empresa_id })
    if (res.error) { setError('Error: ' + res.error.message); return }
    setForm(null); await cargar()
  }

  const toggle = async (c) => {
    await supabase.from(tabla()).update({ activo: !c.activo }).eq('id', c.id)
    await cargar()
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Catalogos de Produccion</h2>
        {puedeEditar && !form && <button style={styles.boton} onClick={() => setForm({ clave: '', nombre: '' })}>+ Nueva causa</button>}
      </div>
      <div style={styles.tabs}>
        {[['scrap', `Causas de scrap (${scrap.filter(c => c.activo).length})`], ['paro', `Causas de paro (${paro.filter(c => c.activo).length})`]].map(([id, n]) => (
          <button key={id} style={tab === id ? styles.tabActiva : styles.tab} onClick={() => { setTab(id); setForm(null) }}>{n}</button>
        ))}
      </div>
      {error && <p style={styles.error}>{error}</p>}

      {form && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{form.id ? 'Editar causa' : `Nueva causa de ${tab === 'scrap' ? 'scrap' : 'paro'}`}</h3>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
            <div style={{ ...styles.campo, flex: 0.4 }}>
              <label style={styles.label}>Clave</label>
              <input style={styles.input} value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value })} placeholder="Ej. ARR" />
            </div>
            <div style={{ ...styles.campo, flex: 1.4 }}>
              <label style={styles.label}>Nombre *</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Descripcion de la causa" autoFocus />
            </div>
            <button style={styles.botonSec} onClick={() => setForm(null)}>Cancelar</button>
            <button style={styles.boton} onClick={guardar}>{form.id ? 'Guardar' : 'Agregar'}</button>
          </div>
        </div>
      )}

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 0.5 }}>Clave</span>
          <span style={{ flex: 2.5 }}>Nombre</span>
          <span style={{ flex: 0.7, textAlign: 'center' }}>Estatus</span>
          <span style={{ width: '160px' }}></span>
        </div>
        {lista.map(c => (
          <div key={c.id} style={styles.tablaFila} className="fila-hover">
            <span style={{ flex: 0.5, fontWeight: '600' }}>{c.clave || '-'}</span>
            <span style={{ flex: 2.5 }}>{c.nombre}</span>
            <span style={{ flex: 0.7, textAlign: 'center' }}>
              <span style={{ ...styles.badge, ...(c.activo ? styles.badgeVerde : styles.badgeGris) }}>{c.activo ? 'Activa' : 'Inactiva'}</span>
            </span>
            <span style={{ width: '160px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              {puedeEditar && (
                <>
                  <button style={styles.botonAccion} onClick={() => setForm({ id: c.id, clave: c.clave || '', nombre: c.nombre })}>Editar</button>
                  <button style={styles.botonAccion} onClick={() => toggle(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActiva: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#c2410c', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #c2410c' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px 24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 14px 0' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  boton: { padding: '9px 20px', backgroundColor: '#c2410c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
}
