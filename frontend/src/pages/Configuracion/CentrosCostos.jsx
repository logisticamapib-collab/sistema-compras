import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function CentrosCostos() {
  const { perfil, tienePermiso } = useAuth()
  const [registros, setRegistros] = useState([])
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState({ codigo: '', nombre: '', site_id: '' })

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: r }, { data: s }] = await Promise.all([
      supabase.from('centros_costos').select('*, sites(nombre)').eq('sites.empresa_id', perfil.empresa_id),
      supabase.from('sites').select('*').eq('empresa_id', perfil.empresa_id)
    ])
    setRegistros(r || [])
    setSites(s || [])
    setLoading(false)
  }

  const guardar = async () => {
    if (!form.codigo || !form.nombre || !form.site_id) {
      setError('Todos los campos son obligatorios')
      return
    }
    setError('')
    const { error } = await supabase.from('centros_costos')
      .insert({ ...form, site_id: parseInt(form.site_id) })
    if (error) { setError(error.message); return }
    setExito('Centro de costos guardado')
    setMostrarForm(false)
    setForm({ codigo: '', nombre: '', site_id: '' })
    await cargarDatos()
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (r) => {
    await supabase.from('centros_costos').update({ activo: !r.activo }).eq('id', r.id)
    await cargarDatos()
  }

  return (
    <div>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Centros de Costos</h2>
        {tienePermiso('config_centros_costos', 'crear') && (
          <button style={styles.boton} onClick={() => setMostrarForm(!mostrarForm)}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo centro de costos'}
          </button>
        )}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      {mostrarForm && (
        <div style={styles.form}>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Codigo *</label>
              <input style={styles.input} value={form.codigo}
                onChange={e => setForm({ ...form, codigo: e.target.value })}
                placeholder="Ej: CC-001" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre *</label>
              <input style={styles.input} value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Produccion" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Site *</label>
              <select style={styles.input} value={form.site_id}
                onChange={e => setForm({ ...form, site_id: e.target.value })}>
                <option value="">Selecciona</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={() => setMostrarForm(false)}>Cancelar</button>
            <button style={styles.boton} onClick={guardar}>Guardar</button>
          </div>
        </div>
      )}
      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1 }}>Codigo</span>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1 }}>Site</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
          : registros.map(r => (
            <div key={r.id} style={styles.tablaFila}>
              <span style={{ flex: 1, fontWeight: '600', color: '#2563eb' }}>{r.codigo}</span>
              <span style={{ flex: 2 }}>{r.nombre}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{r.sites?.nombre}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: r.activo ? '#f0fdf4' : '#fef2f2', color: r.activo ? '#16a34a' : '#dc2626' }}>
                  {r.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 1 }}>
                {tienePermiso('config_centros_costos', 'editar') && (
                  <button style={styles.botonAccion} onClick={() => toggleActivo(r)}>
                    {r.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}

const styles = {
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '9px 20px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}