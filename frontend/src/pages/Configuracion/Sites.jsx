import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const formVacio = {
  nombre: '', codigo: '', razon_social: '', rfc: '',
  telefono: '', email: '', direccion: '', ciudad: '', estado: '', cp: ''
}

export default function Sites() {
  const { perfil, tienePermiso } = useAuth()
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState(formVacio)

  useEffect(() => { cargarSites() }, [])

  const cargarSites = async () => {
    setLoading(true)
    const { data } = await supabase.from('sites')
      .select('*').eq('empresa_id', perfil.empresa_id).order('nombre')
    setSites(data || [])
    setLoading(false)
  }

  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setMostrarForm(true); setError('') }
  const abrirEditar = (s) => {
    setEditando(s)
    setForm({
      nombre: s.nombre || '', codigo: s.codigo || '', razon_social: s.razon_social || '',
      rfc: s.rfc || '', telefono: s.telefono || '', email: s.email || '',
      direccion: s.direccion || '', ciudad: s.ciudad || '', estado: s.estado || '', cp: s.cp || '',
    })
    setMostrarForm(true)
    setError('')
  }

  const guardarSite = async () => {
    if (!form.nombre || !form.codigo) {
      setError('Nombre y codigo son obligatorios')
      return
    }
    setError('')
    setLoading(true)

    const payload = { ...form, codigo: form.codigo.toUpperCase() }
    let error
    if (editando) {
      const r = await supabase.from('sites').update(payload).eq('id', editando.id)
      error = r.error
    } else {
      const r = await supabase.from('sites').insert({ ...payload, empresa_id: perfil.empresa_id })
      error = r.error
    }

    if (error) {
      setError(error.message.includes('unique') ? 'El codigo de site ya existe' : error.message)
      setLoading(false)
      return
    }

    setExito(editando ? 'Site actualizado correctamente' : 'Site guardado correctamente')
    setMostrarForm(false)
    setEditando(null)
    setForm(formVacio)
    await cargarSites()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (site) => {
    await supabase.from('sites').update({ activo: !site.activo }).eq('id', site.id)
    await cargarSites()
  }

  return (
    <div>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Sites / Plantas</h2>
        {tienePermiso('config_sites', 'crear') && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo site'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{editando ? `Editando: ${editando.nombre}` : 'Nuevo site'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre del site *</label>
              <input style={styles.input} value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Ej: Planta Queretaro" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Codigo *</label>
              <input style={styles.input} value={form.codigo}
                onChange={e => setForm({ ...form, codigo: e.target.value.toUpperCase() })}
                placeholder="Ej: PLT2" maxLength={6} />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Razon social</label>
              <input style={styles.input} value={form.razon_social}
                onChange={e => setForm({ ...form, razon_social: e.target.value })}
                placeholder="Si es diferente a la empresa" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>RFC</label>
              <input style={styles.input} value={form.rfc}
                onChange={e => setForm({ ...form, rfc: e.target.value })}
                placeholder="RFC del site" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Telefono</label>
              <input style={styles.input} value={form.telefono}
                onChange={e => setForm({ ...form, telefono: e.target.value })}
                placeholder="442 123 4567" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Email</label>
              <input style={styles.input} value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="site@empresa.com" />
            </div>
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Direccion</label>
            <input style={styles.input} value={form.direccion}
              onChange={e => setForm({ ...form, direccion: e.target.value })}
              placeholder="Calle, numero, colonia" />
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Ciudad</label>
              <input style={styles.input} value={form.ciudad}
                onChange={e => setForm({ ...form, ciudad: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Estado</label>
              <input style={styles.input} value={form.estado}
                onChange={e => setForm({ ...form, estado: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>CP</label>
              <input style={styles.input} value={form.cp}
                onChange={e => setForm({ ...form, cp: e.target.value })} />
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={() => { setMostrarForm(false); setEditando(null) }}>Cancelar</button>
            <button style={styles.boton} onClick={guardarSite} disabled={loading}>
              {loading ? 'Guardando...' : editando ? 'Actualizar site' : 'Guardar site'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1 }}>Codigo</span>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 2 }}>Ciudad / Estado</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 2 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : sites.map(s => (
          <div key={s.id} style={styles.tablaFila}>
            <span style={{ flex: 1, fontWeight: '600', color: '#2563eb' }}>{s.codigo}</span>
            <span style={{ flex: 2, fontWeight: '500' }}>{s.nombre}</span>
            <span style={{ flex: 2, color: '#666', fontSize: '13px' }}>{s.ciudad}{s.estado ? `, ${s.estado}` : ''}</span>
            <span style={{ flex: 1 }}>
              <span style={{ ...styles.badge, backgroundColor: s.activo ? '#f0fdf4' : '#fef2f2', color: s.activo ? '#16a34a' : '#dc2626' }}>
                {s.activo ? 'Activo' : 'Inactivo'}
              </span>
            </span>
            <span style={{ flex: 2 }}>
              {tienePermiso('config_sites', 'editar') && (
                <>
                  <button style={styles.botonAccion} onClick={() => abrirEditar(s)}>Editar</button>
                  <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => toggleActivo(s)}>
                    {s.activo ? 'Desactivar' : 'Activar'}
                  </button>
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
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' },
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
