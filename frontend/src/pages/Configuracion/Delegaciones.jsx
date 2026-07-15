import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const tiposDelegacion = [
  { value: 'ausencia_general', label: 'Ausencia general', desc: 'El usuario aprueba todo en nombre del Director durante el periodo indicado' },
  { value: 'por_monto', label: 'Por monto', desc: 'El usuario aprueba OCs que no superen el monto indicado' },
  { value: 'por_proveedor', label: 'Por proveedor', desc: 'El usuario aprueba OCs de un proveedor especifico' },
  { value: 'por_numero_parte', label: 'Por numero de parte', desc: 'El usuario aprueba OCs que contengan un articulo especifico' },
]

export default function Delegaciones() {
  const { perfil } = useAuth()
  const [delegaciones, setDelegaciones] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState({
    delegado_id: '',
    tipo: 'ausencia_general',
    monto_maximo: '',
    proveedor_id: '',
    articulo_id: '',
    fecha_inicio: '',
    fecha_fin: ''
  })

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: d }, { data: u }, { data: p }, { data: a }] = await Promise.all([
      supabase.from('delegaciones_autoridad')
        .select('*, delegado:delegado_id(nombre), proveedores(nombre), articulos(codigo_interno, descripcion)')
        .eq('empresa_id', perfil.empresa_id)
        .order('created_at', { ascending: false }),
      supabase.from('usuarios').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('nombre'),
      supabase.from('proveedores').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true),
      supabase.from('articulos').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true)
    ])
    setDelegaciones(d || [])
    setUsuarios(u || [])
    setProveedores(p || [])
    setArticulos(a || [])
    setLoading(false)
  }

  const guardar = async () => {
    if (!form.delegado_id) { setError('Debes seleccionar un usuario delegado'); return }
    if (form.tipo === 'por_monto' && !form.monto_maximo) { setError('Debes ingresar el monto maximo'); return }
    if (form.tipo === 'por_proveedor' && !form.proveedor_id) { setError('Debes seleccionar el proveedor'); return }
    if (form.tipo === 'por_numero_parte' && !form.articulo_id) { setError('Debes seleccionar el articulo'); return }

    setError('')
    setLoading(true)

    const { error } = await supabase.from('delegaciones_autoridad').insert({
      empresa_id: perfil.empresa_id,
      director_id: perfil.id,
      delegado_id: form.delegado_id,
      tipo: form.tipo,
      monto_maximo: form.monto_maximo ? parseFloat(form.monto_maximo) : null,
      proveedor_id: form.proveedor_id ? parseInt(form.proveedor_id) : null,
      articulo_id: form.articulo_id ? parseInt(form.articulo_id) : null,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin: form.fecha_fin || null,
      activo: true
    })

    if (error) { setError('Error al guardar: ' + error.message); setLoading(false); return }

    setExito('Delegacion creada correctamente')
    setMostrarForm(false)
    setForm({ delegado_id: '', tipo: 'ausencia_general', monto_maximo: '', proveedor_id: '', articulo_id: '', fecha_inicio: '', fecha_fin: '' })
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (d) => {
    await supabase.from('delegaciones_autoridad').update({ activo: !d.activo }).eq('id', d.id)
    await cargarDatos()
  }

  const eliminar = async (id) => {
    if (!confirm('Seguro que deseas eliminar esta delegacion?')) return
    await supabase.from('delegaciones_autoridad').delete().eq('id', id)
    await cargarDatos()
  }

  const tipoLabel = (tipo) => tiposDelegacion.find(t => t.value === tipo)?.label || tipo

  return (
    <div>
      <div style={styles.encabezado}>
        <div>
          <h2 style={styles.titulo}>Delegacion de Autoridad</h2>
          <p style={styles.subtitulo}>Panel exclusivo para el Director. Asigna quien puede aprobar en tu nombre.</p>
        </div>
        {['direccion', 'admin'].includes(perfil?.rol) && (
          <button style={styles.boton} onClick={() => setMostrarForm(!mostrarForm)}>
            {mostrarForm ? 'Cancelar' : '+ Nueva delegacion'}
          </button>
        )}
      </div>

      {!['direccion', 'admin'].includes(perfil?.rol) && (
        <div style={styles.alertaAcceso}>
          Solo el Director o Administrador puede gestionar las delegaciones de autoridad.
        </div>
      )}

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && ['direccion', 'admin'].includes(perfil?.rol) && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nueva delegacion de autoridad</h3>

          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Tipo de delegacion *</label>
              <select style={styles.input} value={form.tipo}
                onChange={e => setForm({ ...form, tipo: e.target.value, monto_maximo: '', proveedor_id: '', articulo_id: '' })}>
                {tiposDelegacion.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p style={styles.inputDesc}>
                {tiposDelegacion.find(t => t.value === form.tipo)?.desc}
              </p>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Usuario delegado *</label>
              <select style={styles.input} value={form.delegado_id}
                onChange={e => setForm({ ...form, delegado_id: e.target.value })}>
                <option value="">Selecciona usuario</option>
                {usuarios.filter(u => u.id !== perfil.id).map(u => (
                  <option key={u.id} value={u.id}>{u.nombre} - {u.rol}</option>
                ))}
              </select>
            </div>
          </div>

          {form.tipo === 'por_monto' && (
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Monto maximo a aprobar *</label>
                <input style={styles.input} type="number" value={form.monto_maximo}
                  onChange={e => setForm({ ...form, monto_maximo: e.target.value })}
                  placeholder="Ej: 50000.00" min="0" step="0.01" />
              </div>
            </div>
          )}

          {form.tipo === 'por_proveedor' && (
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Proveedor *</label>
                <select style={styles.input} value={form.proveedor_id}
                  onChange={e => setForm({ ...form, proveedor_id: e.target.value })}>
                  <option value="">Selecciona proveedor</option>
                  {proveedores.map(p => (
                    <option key={p.id} value={p.id}>{p.nombre}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {form.tipo === 'por_numero_parte' && (
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Articulo / Numero de parte *</label>
                <select style={styles.input} value={form.articulo_id}
                  onChange={e => setForm({ ...form, articulo_id: e.target.value })}>
                  <option value="">Selecciona articulo</option>
                  {articulos.map(a => (
                    <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Fecha inicio (opcional)</label>
              <input style={styles.input} type="date" value={form.fecha_inicio}
                onChange={e => setForm({ ...form, fecha_inicio: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Fecha fin (opcional)</label>
              <input style={styles.input} type="date" value={form.fecha_fin}
                onChange={e => setForm({ ...form, fecha_fin: e.target.value })}
                min={form.fecha_inicio || ''} />
            </div>
            <div style={{ ...styles.campo, justifyContent: 'flex-end' }}>
              <p style={styles.inputDesc}>Si no defines fechas la delegacion estara activa indefinidamente hasta que la desactives.</p>
            </div>
          </div>

          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={() => setMostrarForm(false)}>Cancelar</button>
            <button style={styles.boton} onClick={guardar} disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar delegacion'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1.5 }}>Tipo</span>
          <span style={{ flex: 2 }}>Usuario delegado</span>
          <span style={{ flex: 2 }}>Condicion</span>
          <span style={{ flex: 1.5 }}>Vigencia</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : delegaciones.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay delegaciones registradas</p>
        ) : (
          delegaciones.map(d => (
            <div key={d.id} style={styles.tablaFila}>
              <span style={{ flex: 1.5 }}>
                <span style={styles.badge}>{tipoLabel(d.tipo)}</span>
              </span>
              <span style={{ flex: 2, fontWeight: '500', fontSize: '13px' }}>
                {d.delegado?.nombre}
              </span>
              <span style={{ flex: 2, fontSize: '12px', color: '#666' }}>
                {d.tipo === 'por_monto' && `Hasta $${parseFloat(d.monto_maximo).toLocaleString('es-MX')}`}
                {d.tipo === 'por_proveedor' && d.proveedores?.nombre}
                {d.tipo === 'por_numero_parte' && `${d.articulos?.codigo_interno} - ${d.articulos?.descripcion}`}
                {d.tipo === 'ausencia_general' && 'Aprobacion general'}
              </span>
              <span style={{ flex: 1.5, fontSize: '12px', color: '#666' }}>
                {d.fecha_inicio ? new Date(d.fecha_inicio).toLocaleDateString('es-MX') : 'Sin inicio'}
                {' - '}
                {d.fecha_fin ? new Date(d.fecha_fin).toLocaleDateString('es-MX') : 'Sin fin'}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: d.activo ? '#f0fdf4' : '#fef2f2', color: d.activo ? '#16a34a' : '#dc2626' }}>
                  {d.activo ? 'Activa' : 'Inactiva'}
                </span>
              </span>
              <span style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button style={styles.botonAccion} onClick={() => toggleActivo(d)}>
                  {d.activo ? 'Desactivar' : 'Activar'}
                </button>
                <button style={{ ...styles.botonAccion, color: '#dc2626' }} onClick={() => eliminar(d.id)}>
                  Eliminar
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
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  subtitulo: { fontSize: '13px', color: '#666', margin: '4px 0 16px 0' },
  alertaAcceso: { backgroundColor: '#fef9c3', border: '1px solid #fde047', borderRadius: '7px', padding: '12px 16px', fontSize: '13px', color: '#854d0e', marginBottom: '16px' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 20px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  inputDesc: { fontSize: '11px', color: '#94a3b8', margin: '4px 0 0 0' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '9px 20px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500', backgroundColor: '#eff6ff', color: '#2563eb' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}