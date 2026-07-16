import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const tipos = [
  { value: 'materia_prima', label: 'Materia Prima' },
  { value: 'empaque', label: 'Empaque' },
  { value: 'servicio', label: 'Servicio' },
  { value: 'toolcrib', label: 'ToolCrib / Herramienta' },
  { value: 'consumible', label: 'Consumible' },
  { value: 'refaccion', label: 'Refaccion' },
  { value: 'producto_terminado', label: 'Producto Terminado' },
  { value: 'wip', label: 'WIP (producto en proceso)' },
  { value: 'ensamble', label: 'Ensamble' },
  { value: 'otro', label: 'Otro' },
]

export default function Categorias() {
  const { perfil, tienePermiso } = useAuth()
  const [registros, setRegistros] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState({ nombre: '', tipo: 'materia_prima' })

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('categorias')
      .select('*')
      .eq('empresa_id', perfil.empresa_id)
      .order('nombre')
    setRegistros(data || [])
    setLoading(false)
  }

  const abrirNuevo = () => { setEditando(null); setForm({ nombre: '', tipo: 'materia_prima' }); setMostrarForm(true); setError('') }
  const abrirEditar = (r) => {
    setEditando(r)
    setForm({ nombre: r.nombre || '', tipo: r.tipo || 'materia_prima' })
    setMostrarForm(true)
    setError('')
  }

  const guardar = async () => {
    if (!form.nombre) {
      setError('El nombre es obligatorio')
      return
    }
    setError('')
    let error
    if (editando) {
      const r = await supabase.from('categorias').update(form).eq('id', editando.id)
      error = r.error
    } else {
      const r = await supabase.from('categorias').insert({ ...form, empresa_id: perfil.empresa_id })
      error = r.error
    }
    if (error) { setError(error.message); return }
    setExito(editando ? 'Categoria actualizada' : 'Categoria guardada')
    setMostrarForm(false)
    setEditando(null)
    setForm({ nombre: '', tipo: 'materia_prima' })
    await cargarDatos()
    setTimeout(() => setExito(''), 3000)
  }

  return (
    <div>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Categorias de Articulos</h2>
        {tienePermiso('config_categorias', 'crear') && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nueva categoria'}
          </button>
        )}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      {mostrarForm && (
        <div style={styles.form} className="aparecer">
          <h3 style={styles.formTitulo}>{editando ? `Editando: ${editando.nombre}` : 'Nueva categoria'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre *</label>
              <input style={styles.input} value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Resinas" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Tipo</label>
              <select style={styles.input} value={form.tipo}
                onChange={e => setForm({ ...form, tipo: e.target.value })}>
                {tipos.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={() => { setMostrarForm(false); setEditando(null) }}>Cancelar</button>
            <button style={styles.boton} onClick={guardar}>{editando ? 'Actualizar' : 'Guardar'}</button>
          </div>
        </div>
      )}
      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1 }}>Tipo</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
          : registros.length === 0 ? <p style={{ padding: '20px', color: '#666' }}>No hay categorias registradas</p>
          : registros.map(r => (
            <div key={r.id} style={styles.tablaFila} className="fila-hover">
              <span style={{ flex: 2, fontWeight: '500' }}>{r.nombre}</span>
              <span style={{ flex: 1 }}>
                <span style={styles.badge}>
                  {tipos.find(t => t.value === r.tipo)?.label || r.tipo}
                </span>
              </span>
              <span style={{ flex: 1 }}>
                {tienePermiso('config_categorias', 'editar') && (
                  <button style={styles.botonAccion} onClick={() => abrirEditar(r)}>Editar</button>
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
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
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
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', backgroundColor: '#eff6ff', color: '#2563eb' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
