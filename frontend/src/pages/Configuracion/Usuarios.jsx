import { useState, useEffect } from 'react'
import { supabase, supabaseAdmin } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import PermisosUsuario from './PermisosUsuario'
import { ROLES as roles, ROLES_GERENCIALES } from '../../lib/roles'


const niveles = [
  { value: 1, label: 'Nivel 1 - Solicitante' },
  { value: 2, label: 'Nivel 2 - Gerente de Area' },
  { value: 3, label: 'Nivel 3 - Gerente Planta / Administrativo' },
  { value: 4, label: 'Nivel 4 - Compras' },
  { value: 5, label: 'Nivel 5 - Gerente de Compras' },
  { value: 6, label: 'Nivel 6 - Direccion' },
]

export default function Usuarios() {
  const { perfil, tienePermiso } = useAuth()
  const [usuarios, setUsuarios] = useState([])
  const [sites, setSites] = useState([])
  const [areas, setAreas] = useState([])
  const [puestos, setPuestos] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [usuarioEditando, setUsuarioEditando] = useState(null)
  const [usuarioPermisos, setUsuarioPermisos] = useState(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState({
    nombre: '', email: '', password: '', rol: 'solicitante',
    site_id: '', puesto_id: '', area_id: '', gerente_id: '',
    nivel_aprobacion: 1, puede_aprobar_como_director: false,
    monto_maximo_aprobacion: ''
  })

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: u }, { data: s }, { data: ars }, { data: pst }] = await Promise.all([
      supabase.from('usuarios')
        .select('*, sites(nombre), gerente:gerente_id(nombre)')
        .eq('empresa_id', perfil.empresa_id)
        .order('nombre'),
      supabase.from('sites').select('*').eq('empresa_id', perfil.empresa_id),
      supabase.from('areas').select('id, clave, nombre').eq('empresa_id', perfil.empresa_id)
        .eq('activo', true).order('clave'),
      supabase.from('puestos').select('id, clave, nombre, nivel, niveles_jerarquicos(nombre)')
        .eq('empresa_id', perfil.empresa_id).eq('activo', true).order('nivel').order('nombre'),
    ])
    setUsuarios(u || [])
    setSites(s || [])
    setAreas(ars || [])
    setPuestos(pst || [])
    setLoading(false)
  }

  const abrirEditar = (usuario) => {
    setUsuarioEditando(usuario)
    setForm({
      nombre: usuario.nombre || '',
      email: usuario.email || '',
      password: '',
      rol: usuario.rol || 'solicitante',
      site_id: usuario.site_id?.toString() || '',
      puesto_id: usuario.puesto_id || '',
      area_id: usuario.area_id || '',
      gerente_id: usuario.gerente_id || '',
      nivel_aprobacion: usuario.nivel_aprobacion || 1,
      puede_aprobar_como_director: usuario.puede_aprobar_como_director || false,
      monto_maximo_aprobacion: usuario.monto_maximo_aprobacion || ''
    })
    setMostrarForm(true)
  }

  const cancelar = () => {
    setMostrarForm(false)
    setUsuarioEditando(null)
    setForm({
      nombre: '', email: '', password: '', rol: 'solicitante',
      site_id: '', puesto_id: '', area_id: '', gerente_id: '',
      nivel_aprobacion: 1, puede_aprobar_como_director: false,
      monto_maximo_aprobacion: ''
    })
    setError('')
  }

  const guardarUsuario = async () => {
    if (!form.nombre || !form.email || !form.site_id) {
      setError('Nombre, correo y site son obligatorios')
      return
    }
    if (!usuarioEditando && !form.password) {
      setError('La contrasena es obligatoria para nuevos usuarios')
      return
    }
    setError('')
    setLoading(true)

    if (usuarioEditando) {
      const { error: errorUpdate } = await supabase
        .from('usuarios')
        .update({
          nombre: form.nombre,
          rol: form.rol,
          puesto_id: form.puesto_id ? Number(form.puesto_id) : null,
          area_id: form.area_id ? Number(form.area_id) : null,
          site_id: parseInt(form.site_id),
          gerente_id: form.gerente_id || null,
          nivel_aprobacion: parseInt(form.nivel_aprobacion),
          puede_aprobar_como_director: form.puede_aprobar_como_director,
          monto_maximo_aprobacion: form.monto_maximo_aprobacion ? parseFloat(form.monto_maximo_aprobacion) : null
        })
        .eq('id', usuarioEditando.id)

      if (errorUpdate) {
        setError('Error al actualizar: ' + errorUpdate.message)
        setLoading(false)
        return
      }
      setExito('Usuario actualizado correctamente')
    } else {
      const { data, error: errorAuth } = await supabaseAdmin.auth.signUp({
        email: form.email,
        password: form.password
      })

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
          puesto_id: form.puesto_id ? Number(form.puesto_id) : null,
          area_id: form.area_id ? Number(form.area_id) : null,
          site_id: parseInt(form.site_id),
          empresa_id: perfil.empresa_id,
          gerente_id: form.gerente_id || null,
          nivel_aprobacion: parseInt(form.nivel_aprobacion),
          puede_aprobar_como_director: form.puede_aprobar_como_director,
          monto_maximo_aprobacion: form.monto_maximo_aprobacion ? parseFloat(form.monto_maximo_aprobacion) : null
        })
      }
      setExito('Usuario creado correctamente')
    }

    cancelar()
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

  const gerentesDisponibles = usuarios.filter(u => ROLES_GERENCIALES.includes(u.rol))

  if (usuarioPermisos) {
    return <PermisosUsuario usuario={usuarioPermisos} onVolver={() => setUsuarioPermisos(null)} />
  }

  return (
    <div>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Usuarios del sistema</h2>
        {tienePermiso('config_usuarios', 'crear') && (
          <button style={styles.boton} onClick={() => {
            setUsuarioEditando(null)
            setMostrarForm(!mostrarForm)
          }}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo usuario'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>
            {usuarioEditando ? `Editando: ${usuarioEditando.nombre}` : 'Nuevo usuario'}
          </h3>

          <div style={styles.seccionForm}>
            <p style={styles.seccionLabel}>Datos personales</p>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Nombre completo *</label>
                <input style={styles.input} value={form.nombre}
                  onChange={e => setForm({ ...form, nombre: e.target.value })}
                  placeholder="Nombre completo" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Puesto</label>
                <select style={styles.input} value={form.puesto_id}
                  onChange={e => setForm({ ...form, puesto_id: e.target.value })}>
                  <option value="">Sin asignar</option>
                  {puestos.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.nombre}{p.niveles_jerarquicos?.nombre ? ` (${p.niveles_jerarquicos.nombre})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Area / Departamento</label>
                <select style={styles.input} value={form.area_id}
                  onChange={e => setForm({ ...form, area_id: e.target.value })}>
                  <option value="">Sin asignar</option>
                  {areas.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                </select>
              </div>
            </div>
            {!usuarioEditando && (
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
            )}
          </div>

          <div style={styles.seccionForm}>
            <p style={styles.seccionLabel}>Rol y jerarquia</p>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Rol en el sistema *</label>
                <select style={styles.input} value={form.rol}
                  onChange={e => setForm({ ...form, rol: e.target.value })}>
                  {roles.map(r => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Nivel de aprobacion</label>
                <select style={styles.input} value={form.nivel_aprobacion}
                  onChange={e => setForm({ ...form, nivel_aprobacion: e.target.value })}>
                  {niveles.map(n => (
                    <option key={n.value} value={n.value}>{n.label}</option>
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
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Gerente directo</label>
                <select style={styles.input} value={form.gerente_id}
                  onChange={e => setForm({ ...form, gerente_id: e.target.value })}>
                  <option value="">Sin gerente asignado</option>
                  {gerentesDisponibles
                    .filter(u => u.id !== usuarioEditando?.id)
                    .map(u => (
                      <option key={u.id} value={u.id}>
                        {u.nombre} - {roles.find(r => r.value === u.rol)?.label}
                      </option>
                    ))}
                </select>
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Monto maximo de aprobacion</label>
                <input style={styles.input} type="number" value={form.monto_maximo_aprobacion}
                  onChange={e => setForm({ ...form, monto_maximo_aprobacion: e.target.value })}
                  placeholder="Sin limite si se deja vacio" min="0" step="0.01" />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Puede aprobar como Director</label>
                <div style={styles.checkboxFila}>
                  <input type="checkbox"
                    checked={form.puede_aprobar_como_director}
                    onChange={e => setForm({ ...form, puede_aprobar_como_director: e.target.checked })}
                    style={{ width: '18px', height: '18px' }} />
                  <span style={styles.checkboxLabel}>
                    Este usuario puede actuar como Director en ausencia
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={cancelar}>Cancelar</button>
            <button style={styles.boton} onClick={guardarUsuario} disabled={loading}>
              {loading ? 'Guardando...' : usuarioEditando ? 'Actualizar usuario' : 'Guardar usuario'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1.5 }}>Correo</span>
          <span style={{ flex: 1 }}>Area</span>
          <span style={{ flex: 1 }}>Rol</span>
          <span style={{ flex: 1 }}>Nivel</span>
          <span style={{ flex: 1.5 }}>Gerente directo</span>
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
              <span style={{ flex: 2 }}>
                <p style={{ margin: '0', fontWeight: '500', fontSize: '14px' }}>{u.nombre}</p>
                <p style={{ margin: '0', fontSize: '11px', color: '#94a3b8' }}>{puestos.find(p => p.id === u.puesto_id)?.nombre || '-'}</p>
              </span>
              <span style={{ flex: 1.5, fontSize: '12px', color: '#666' }}>{u.email}</span>
              <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{areas.find(a => a.id === u.area_id)?.nombre || '-'}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: '#eff6ff', color: '#2563eb' }}>
                  {roles.find(r => r.value === u.rol)?.label || u.rol}
                </span>
              </span>
              <span style={{ flex: 1, fontSize: '12px', color: '#666', textAlign: 'center' }}>
                {u.nivel_aprobacion || 1}
              </span>
              <span style={{ flex: 1.5, fontSize: '12px', color: '#666' }}>
                {u.gerente?.nombre || '-'}
              </span>
              <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>
                {u.sites?.nombre || '-'}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: u.activo ? '#f0fdf4' : '#fef2f2', color: u.activo ? '#16a34a' : '#dc2626' }}>
                  {u.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                {tienePermiso('config_usuarios', 'editar') && (
                  <button style={styles.botonAccion} onClick={() => abrirEditar(u)}>
                    Editar
                  </button>
                )}
                {tienePermiso('config_usuarios', 'editar') && (
                  <button style={styles.botonAccion} onClick={() => toggleActivo(u)}>
                    {u.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
                {perfil?.rol === 'admin' && (
                  <button style={styles.botonAccionPermisos} onClick={() => setUsuarioPermisos(u)}>
                    Permisos
                  </button>
                )}
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
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 20px 0' },
  seccionForm: { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '16px', marginBottom: '16px' },
  seccionLabel: { fontSize: '11px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', margin: '0 0 12px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  checkboxFila: { display: 'flex', alignItems: 'center', gap: '8px', padding: '9px 0' },
  checkboxLabel: { fontSize: '13px', color: '#444' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '9px 20px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  botonAccionPermisos: { padding: '4px 10px', backgroundColor: '#f5f3ff', color: '#7c3aed', border: '1px solid #ddd6fe', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}