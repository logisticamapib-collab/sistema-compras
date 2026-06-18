import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const roles = [
  { value: 'solicitante', label: 'Solicitante' },
  { value: 'gerente_area', label: 'Gerente de Area' },
  { value: 'gerente_planta', label: 'Gerente de Planta' },
  { value: 'gerente_administrativo', label: 'Gerente Administrativo' },
  { value: 'compras', label: 'Compras' },
  { value: 'direccion', label: 'Direccion' },
  { value: 'admin', label: 'Administrador' },
]

export default function Usuarios() {
  const { perfil } = useAuth()
  const [usuarios, setUsuarios] = useState([])
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState({
    nombre: '', email: '', password: '', rol: 'solicitante',
    site_id: '', puesto: ''
  })

  useEffect(() => {
    cargarDatos()
  }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: u }, { data: s }] = await Promise.all([
      supabase.from('usuarios').select('*, sites(nombre)').eq('empresa_id', perfil.empresa_id),
      supabase.from('sites').select('*').eq('empresa_id', perfil.empresa_id)
    ])
    setUsuarios(u || [])
    setSites(s || [])
    setLoading(false)
  }

  const guardarUsuario = async () => {
    if (!form.nombre || !form.email || !form.password || !form.site_id) {
      setError('Nombre, correo, contrasena y site son obligatorios')
      return
    }
    setError('')
    setLoading(true)

    const { data, error: errorAuth } = await supabase.auth.admin
      ? await supabase.auth.signUp({ email: form.email, password: form.password })
      : await supabase.auth.signUp({ email: form.email, password: form.password })

    if (errorAuth) {
      setError('Error al crear usuario: ' + errorAuth.message)
      setLoading(false)
      return
    }

    if (data?.user) {
      await supabase.from('usuarios').upsert({
        id: data.user.id,
        nombre: form.nombre,
        email: form.email,
        rol: form.rol,
        puesto: form.puesto,
        site_id: parseInt(form.site_id),
        empresa_id: perfil.empresa_id
      })
    }

    setExito('Usuario creado correctamente')
    setMostrarForm(false)
    setForm({ nombre: '', email: '', password: '', rol: 'solicitante', site_id: '', puesto: '' })
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (usuario) => {
    await supabase.from('usuarios')
      .update({ activo: !usuario.activo })
      .eq('id', usuario.id)
    await cargarDatos()
  }

  return (
    <div>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Usuarios del sistema</h2>
        <button style={styles.boton} onClick={() => setMostrarForm(!mostrarForm)}>
          {mostrarForm ? 'Cancelar' : '+ Nuevo usuario'}
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nuevo usuario</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre completo *</label>
              <input style={styles.input} value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Nombre completo" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Puesto</label>
              <input style={styles.input} value={form.puesto}
                onChange={e => setForm({ ...form, puesto: e.target.value })}
                placeholder="Ej: Analista de compras" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Correo electronico *</label>
              <input style={styles.input} type="email" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="correo@empresa.com" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Contrasena temporal *</label>
              <input style={styles.input} type="password" value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })}
                placeholder="Minimo 6 caracteres" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Rol *</label>
              <select style={styles.input} value={form.rol}
                onChange={e => setForm({ ...form, rol: e.target.value })}>
                {roles.map(r => (
                  <option key={r.value} value={r.value}>{r.label}</option>
                ))}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Site / Planta *</label>
              <select style={styles.input} value={form.site_id}
                onChange={e => setForm({ ...form, site_id: e.target.value })}>
                <option value="">Selecciona un site</option>
                {sites.map(s => (
                  <option key={s.id} value={s.id}>{s.nombre}</option>
                ))}
              </select>
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={() => setMostrarForm(false)}>
              Cancelar
            </button>
            <button style={styles.boton} onClick={guardarUsuario} disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar usuario'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 2 }}>Correo</span>
          <span style={{ flex: 1 }}>Rol</span>
          <span style={{ flex: 1 }}>Site</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : usuarios.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay usuarios registrados</p>
        ) : (
          usuarios.map(u => (
            <div key={u.id} style={styles.tablaFila}>
              <span style={{ flex: 2, fontWeight: '500' }}>{u.nombre}</span>
              <span style={{ flex: 2, color: '#666', fontSize: '13px' }}>{u.email}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: '#eff6ff', color: '#2563eb' }}>
                  {roles.find(r => r.value === u.rol)?.label || u.rol}
                </span>
              </span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{u.sites?.nombre}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: u.activo ? '#f0fdf4' : '#fef2f2', color: u.activo ? '#16a34a' : '#dc2626' }}>
                  {u.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 1 }}>
                <button style={styles.botonAccion} onClick={() => toggleActivo(u)}>
                  {u.activo ? 'Desactivar' : 'Activar'}
                </button>
              </span>
            </div>
          ))
        )}
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
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}