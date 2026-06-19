import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

export default function Proveedores() {
  const { perfil } = useAuth()
  const [proveedores, setProveedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState({
    nombre: '', razon_social: '', rfc: '', contacto: '',
    email: '', telefono: '', direccion: '', ciudad: '',
    estado: '', cp: '', condiciones_pago: '', dias_credito: 0
  })

  useEffect(() => { cargarProveedores() }, [])

  const cargarProveedores = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('proveedores')
      .select('*')
      .eq('empresa_id', perfil.empresa_id)
      .order('nombre')
    setProveedores(data || [])
    setLoading(false)
  }

  const guardar = async () => {
    if (!form.nombre) {
      setError('El nombre del proveedor es obligatorio')
      return
    }
    setError('')
    setLoading(true)

    const { error } = await supabase.from('proveedores')
      .insert({ ...form, empresa_id: perfil.empresa_id, dias_credito: parseInt(form.dias_credito) || 0 })

    if (error) {
      setError('Error al guardar: ' + error.message)
      setLoading(false)
      return
    }

    setExito('Proveedor guardado correctamente')
    setMostrarForm(false)
    setForm({ nombre: '', razon_social: '', rfc: '', contacto: '', email: '', telefono: '', direccion: '', ciudad: '', estado: '', cp: '', condiciones_pago: '', dias_credito: 0 })
    await cargarProveedores()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (p) => {
    await supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id)
    await cargarProveedores()
  }

  const proveedoresFiltrados = proveedores.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (p.rfc && p.rfc.toLowerCase().includes(busqueda.toLowerCase()))
  )

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Proveedores</h2>
        <button style={styles.boton} onClick={() => setMostrarForm(!mostrarForm)}>
          {mostrarForm ? 'Cancelar' : '+ Nuevo proveedor'}
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nuevo proveedor</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre comercial *</label>
              <input style={styles.input} value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })}
                placeholder="Nombre del proveedor" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Razon social</label>
              <input style={styles.input} value={form.razon_social}
                onChange={e => setForm({ ...form, razon_social: e.target.value })}
                placeholder="Razon social completa" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>RFC</label>
              <input style={styles.input} value={form.rfc}
                onChange={e => setForm({ ...form, rfc: e.target.value })}
                placeholder="RFC del proveedor" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Contacto</label>
              <input style={styles.input} value={form.contacto}
                onChange={e => setForm({ ...form, contacto: e.target.value })}
                placeholder="Nombre del contacto" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={form.email}
                onChange={e => setForm({ ...form, email: e.target.value })}
                placeholder="correo@proveedor.com" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Telefono</label>
              <input style={styles.input} value={form.telefono}
                onChange={e => setForm({ ...form, telefono: e.target.value })}
                placeholder="442 123 4567" />
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
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Condiciones de pago</label>
              <select style={styles.input} value={form.condiciones_pago}
                onChange={e => setForm({ ...form, condiciones_pago: e.target.value })}>
                <option value="">Selecciona</option>
                <option value="contado">Contado</option>
                <option value="15 dias">15 dias</option>
                <option value="30 dias">30 dias</option>
                <option value="45 dias">45 dias</option>
                <option value="60 dias">60 dias</option>
                <option value="90 dias">90 dias</option>
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Dias de credito</label>
              <input style={styles.input} type="number" value={form.dias_credito}
                onChange={e => setForm({ ...form, dias_credito: e.target.value })}
                placeholder="0" min="0" />
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={() => setMostrarForm(false)}>Cancelar</button>
            <button style={styles.boton} onClick={guardar} disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar proveedor'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.buscador}>
        <input style={styles.inputBusqueda} value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por nombre o RFC..." />
      </div>

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1 }}>RFC</span>
          <span style={{ flex: 1 }}>Contacto</span>
          <span style={{ flex: 1 }}>Telefono</span>
          <span style={{ flex: 1 }}>Condiciones</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : proveedoresFiltrados.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay proveedores registrados</p>
        ) : (
          proveedoresFiltrados.map(p => (
            <div key={p.id} style={styles.tablaFila}>
              <span style={{ flex: 2 }}>
                <p style={{ margin: '0', fontWeight: '500' }}>{p.nombre}</p>
                <p style={{ margin: '0', fontSize: '11px', color: '#94a3b8' }}>{p.razon_social}</p>
              </span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{p.rfc}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{p.contacto}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{p.telefono}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{p.condiciones_pago}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: p.activo ? '#f0fdf4' : '#fef2f2', color: p.activo ? '#16a34a' : '#dc2626' }}>
                  {p.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 1 }}>
                <button style={styles.botonAccion} onClick={() => toggleActivo(p)}>
                  {p.activo ? 'Desactivar' : 'Activar'}
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
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  buscador: { marginBottom: '16px' },
  inputBusqueda: { padding: '9px 14px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '300px' },
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