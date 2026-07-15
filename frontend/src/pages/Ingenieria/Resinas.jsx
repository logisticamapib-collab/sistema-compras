import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const formVacio = {
  clave: '', nombre: '', tipo: '', es_consigna: false,
  lead_time_dias: '', moq: '', tiempo_transito_dias: '',
}

export default function Resinas() {
  const { perfil, tienePermiso } = useAuth()
  const [resinas, setResinas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  // Panel de proveedores por resina
  const [resinaProv, setResinaProv] = useState(null) // resina seleccionada para ver proveedores
  const [listaProv, setListaProv] = useState([])
  const [nuevoProv, setNuevoProv] = useState({ proveedor_id: '', precio: '' })

  const puedeCrear = tienePermiso('ing_resinas', 'crear')
  const puedeEditar = tienePermiso('ing_resinas', 'editar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: r }, { data: p }] = await Promise.all([
      supabase.from('resinas').select('*').eq('empresa_id', perfil.empresa_id).order('clave'),
      supabase.from('proveedores').select('id, nombre').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('nombre'),
    ])
    setResinas(r || [])
    setProveedores(p || [])
    setLoading(false)
  }

  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setMostrarForm(true); setError('') }
  const abrirEditar = (r) => {
    setEditando(r)
    setForm({
      clave: r.clave, nombre: r.nombre || '', tipo: r.tipo || '',
      es_consigna: r.es_consigna || false,
      lead_time_dias: r.lead_time_dias?.toString() || '',
      moq: r.moq?.toString() || '',
      tiempo_transito_dias: r.tiempo_transito_dias?.toString() || '',
    })
    setMostrarForm(true)
    setError('')
  }

  const guardar = async () => {
    if (!form.clave) { setError('La clave es obligatoria'); return }
    setError('')
    setLoading(true)

    const payload = {
      clave: form.clave, nombre: form.nombre, tipo: form.tipo,
      es_consigna: form.es_consigna,
      lead_time_dias: form.lead_time_dias ? parseInt(form.lead_time_dias) : 0,
      moq: form.moq ? parseFloat(form.moq) : 0,
      tiempo_transito_dias: form.tiempo_transito_dias ? parseInt(form.tiempo_transito_dias) : 0,
    }

    let error
    if (editando) {
      const r = await supabase.from('resinas').update(payload).eq('id', editando.id)
      error = r.error
    } else {
      const r = await supabase.from('resinas').insert({ ...payload, empresa_id: perfil.empresa_id })
      error = r.error
    }

    if (error) { setError(error.message.includes('unique') ? 'Esa clave ya existe' : error.message); setLoading(false); return }

    setExito(editando ? 'Resina actualizada' : 'Resina creada')
    setMostrarForm(false)
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (r) => {
    await supabase.from('resinas').update({ activo: !r.activo }).eq('id', r.id)
    await cargarDatos()
  }

  // --- Proveedores por resina ---
  const abrirProveedores = async (r) => {
    if (resinaProv?.id === r.id) { setResinaProv(null); return }
    setResinaProv(r)
    setNuevoProv({ proveedor_id: '', precio: '' })
    await cargarProveedoresResina(r.id)
  }

  const cargarProveedoresResina = async (resinaId) => {
    const { data } = await supabase.from('resina_proveedor')
      .select('*, proveedores(nombre)')
      .eq('resina_id', resinaId)
      .order('id')
    setListaProv(data || [])
  }

  const agregarProveedor = async () => {
    if (!nuevoProv.proveedor_id) { setError('Selecciona un proveedor'); return }
    if (listaProv.some(lp => lp.proveedor_id === parseInt(nuevoProv.proveedor_id))) {
      setError('Ese proveedor ya esta asignado a esta resina'); return
    }
    setError('')
    const { error } = await supabase.from('resina_proveedor').insert({
      resina_id: resinaProv.id,
      proveedor_id: parseInt(nuevoProv.proveedor_id),
      precio: nuevoProv.precio ? parseFloat(nuevoProv.precio) : null,
    })
    if (error) { setError(error.message); return }
    setNuevoProv({ proveedor_id: '', precio: '' })
    await cargarProveedoresResina(resinaProv.id)
  }

  const actualizarPrecio = async (lp, precio) => {
    await supabase.from('resina_proveedor').update({ precio: precio ? parseFloat(precio) : null }).eq('id', lp.id)
    await cargarProveedoresResina(resinaProv.id)
  }

  const toggleProveedor = async (lp) => {
    await supabase.from('resina_proveedor').update({ activo: !lp.activo }).eq('id', lp.id)
    await cargarProveedoresResina(resinaProv.id)
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Resinas</h2>
        {puedeCrear && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nueva resina'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{editando ? `Editando: ${editando.clave}` : 'Nueva resina'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Clave *</label>
              <input style={styles.input} value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="Ej: PP-1120" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Ej: Polipropileno Profax 1120" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Tipo</label>
              <input style={styles.input} value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })} placeholder="Ej: PP, ABS, PC, Nylon" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Lead time (dias)</label>
              <input style={styles.input} type="number" min="0" value={form.lead_time_dias} onChange={e => setForm({ ...form, lead_time_dias: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>MOQ (kg)</label>
              <input style={styles.input} type="number" min="0" value={form.moq} onChange={e => setForm({ ...form, moq: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Tiempo de transito (dias)</label>
              <input style={styles.input} type="number" min="0" value={form.tiempo_transito_dias} onChange={e => setForm({ ...form, tiempo_transito_dias: e.target.value })} />
            </div>
          </div>
          <div style={styles.filaCheckbox}>
            <input type="checkbox" id="esConsigna" checked={form.es_consigna}
              onChange={e => setForm({ ...form, es_consigna: e.target.checked })} />
            <label htmlFor="esConsigna" style={styles.labelCheckbox}>
              Es material a consigna (el cliente/proveedor lo surte, no se compra)
            </label>
          </div>
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      )}

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1 }}>Clave</span>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1 }}>Tipo</span>
          <span style={{ flex: 1 }}>Lead time</span>
          <span style={{ flex: 1 }}>MOQ</span>
          <span style={{ flex: 1 }}>Consigna</span>
          <span style={{ flex: 2 }}>Acciones</span>
        </div>
        {loading ? <p style={{ padding: 20, color: '#666' }}>Cargando...</p> : resinas.length === 0 ? (
          <p style={{ padding: 20, color: '#666' }}>No hay resinas registradas</p>
        ) : resinas.map(r => (
          <div key={r.id}>
            <div style={{ ...styles.tablaFila, opacity: r.activo ? 1 : 0.5 }}>
              <span style={{ flex: 1, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{r.clave}</span>
              <span style={{ flex: 2, fontSize: '14px' }}>{r.nombre || '-'}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{r.tipo || '-'}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{r.lead_time_dias ? `${r.lead_time_dias} dias` : '-'}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{r.moq > 0 ? r.moq : '-'}</span>
              <span style={{ flex: 1 }}>
                {r.es_consigna
                  ? <span style={{ ...styles.badge, backgroundColor: '#fef9c3', color: '#854d0e' }}>Consigna</span>
                  : <span style={{ ...styles.badge, backgroundColor: '#f0fdf4', color: '#16a34a' }}>Compra</span>}
              </span>
              <span style={{ flex: 2 }}>
                {puedeEditar && <button style={styles.botonAccion} onClick={() => abrirEditar(r)}>Editar</button>}
                <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => abrirProveedores(r)}>
                  {resinaProv?.id === r.id ? 'Cerrar' : 'Proveedores'}
                </button>
                {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => toggleActivo(r)}>{r.activo ? 'Desactivar' : 'Activar'}</button>}
              </span>
            </div>

            {resinaProv?.id === r.id && (
              <div style={styles.panelProv}>
                <p style={styles.panelTitulo}>Proveedores de {r.clave}</p>
                {listaProv.length === 0 && <p style={{ fontSize: '13px', color: '#666', margin: '0 0 10px 0' }}>Sin proveedores asignados</p>}
                {listaProv.map(lp => (
                  <div key={lp.id} style={styles.provFila}>
                    <span style={{ flex: 2, fontSize: '13px' }}>{lp.proveedores?.nombre}</span>
                    <span style={{ flex: 1 }}>
                      {puedeEditar ? (
                        <input style={{ ...styles.input, padding: '5px 8px', width: '110px' }} type="number" min="0" step="0.01"
                          defaultValue={lp.precio || ''} placeholder="Precio/kg"
                          onBlur={e => e.target.value !== (lp.precio?.toString() || '') && actualizarPrecio(lp, e.target.value)} />
                      ) : (
                        <span style={{ fontSize: '13px', color: '#666' }}>{lp.precio ? `$${lp.precio}` : '-'}</span>
                      )}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ ...styles.badge, ...(lp.activo ? { backgroundColor: '#f0fdf4', color: '#16a34a' } : { backgroundColor: '#fef2f2', color: '#dc2626' }) }}>
                        {lp.activo ? 'Activo' : 'Inactivo'}
                      </span>
                    </span>
                    <span style={{ flex: 1 }}>
                      {puedeEditar && <button style={styles.botonAccion} onClick={() => toggleProveedor(lp)}>{lp.activo ? 'Desactivar' : 'Activar'}</button>}
                    </span>
                  </div>
                ))}
                {puedeEditar && (
                  <div style={{ ...styles.provFila, borderBottom: 'none', marginTop: '6px' }}>
                    <select style={{ ...styles.input, flex: 2, padding: '6px 8px' }} value={nuevoProv.proveedor_id}
                      onChange={e => setNuevoProv({ ...nuevoProv, proveedor_id: e.target.value })}>
                      <option value="">Selecciona proveedor</option>
                      {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                    <input style={{ ...styles.input, flex: 1, padding: '6px 8px' }} type="number" min="0" step="0.01"
                      placeholder="Precio/kg" value={nuevoProv.precio}
                      onChange={e => setNuevoProv({ ...nuevoProv, precio: e.target.value })} />
                    <button style={{ ...styles.boton, padding: '7px 14px', fontSize: '13px' }} onClick={agregarProveedor}>Agregar</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
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
  botones: { display: 'flex', justifyContent: 'flex-end' },
  filaCheckbox: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' },
  labelCheckbox: { fontSize: '13px', color: '#444' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  panelProv: { backgroundColor: '#f8fafc', padding: '14px 20px 14px 40px', borderBottom: '1px solid #e2e8f0' },
  panelTitulo: { fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', margin: '0 0 10px 0' },
  provFila: { display: 'flex', gap: '10px', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid #eef2f7' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
