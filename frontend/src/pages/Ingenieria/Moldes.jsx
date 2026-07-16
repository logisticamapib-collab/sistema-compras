import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const formVacio = {
  clave: '', nombre: '', num_cavidades: 1,
  shots_alerta_min: '', shots_alerta_max: '', ubicacion_fisica: ''
}

export default function Moldes() {
  const { perfil, tienePermiso } = useAuth()
  const [moldes, setMoldes] = useState([])
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [moldeCavidades, setMoldeCavidades] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_moldes', 'crear')
  const puedeEditar = tienePermiso('ing_moldes', 'editar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: m }, { data: a }] = await Promise.all([
      supabase.from('moldes').select('*').eq('empresa_id', perfil.empresa_id).order('clave'),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('codigo_interno'),
    ])
    setMoldes(m || [])
    setArticulos(a || [])
    setLoading(false)
  }

  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setMostrarForm(true); setError('') }
  const abrirEditar = (m) => {
    setEditando(m)
    setForm({
      clave: m.clave, nombre: m.nombre || '', num_cavidades: m.num_cavidades,
      shots_alerta_min: m.shots_alerta_min || '', shots_alerta_max: m.shots_alerta_max || '',
      ubicacion_fisica: m.ubicacion_fisica || '',
    })
    setMostrarForm(true)
    setError('')
  }

  const guardar = async () => {
    if (!form.clave || !form.num_cavidades) { setError('Clave y numero de cavidades son obligatorios'); return }
    setError('')
    setLoading(true)

    const payload = {
      clave: form.clave, nombre: form.nombre, num_cavidades: parseInt(form.num_cavidades),
      shots_alerta_min: form.shots_alerta_min ? parseInt(form.shots_alerta_min) : null,
      shots_alerta_max: form.shots_alerta_max ? parseInt(form.shots_alerta_max) : null,
      ubicacion_fisica: form.ubicacion_fisica,
    }

    let error, moldeId
    if (editando) {
      const r = await supabase.from('moldes').update(payload).eq('id', editando.id)
      error = r.error
      moldeId = editando.id
    } else {
      const r = await supabase.from('moldes').insert({ ...payload, empresa_id: perfil.empresa_id }).select().single()
      error = r.error
      moldeId = r.data?.id
    }

    if (error) { setError(error.message.includes('unique') ? 'Esa clave ya existe' : error.message); setLoading(false); return }

    // Si cambio el numero de cavidades, asegurar que existan filas en molde_cavidades para cada una
    if (moldeId) {
      const { data: cavidadesExistentes } = await supabase.from('molde_cavidades').select('numero_cavidad').eq('molde_id', moldeId)
      const existentes = new Set((cavidadesExistentes || []).map(c => c.numero_cavidad))
      const faltantes = []
      for (let i = 1; i <= parseInt(form.num_cavidades); i++) {
        if (!existentes.has(i)) faltantes.push({ molde_id: moldeId, numero_cavidad: i })
      }
      if (faltantes.length > 0) await supabase.from('molde_cavidades').insert(faltantes)
    }

    setExito(editando ? 'Molde actualizado' : 'Molde creado, ya puedes asignar sus cavidades')
    setMostrarForm(false)
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (m) => {
    await supabase.from('moldes').update({ activo: !m.activo }).eq('id', m.id)
    await cargarDatos()
  }

  const abrirCavidades = async (molde) => {
    const { data } = await supabase.from('molde_cavidades').select('*').eq('molde_id', molde.id).order('numero_cavidad')
    setMoldeCavidades({ molde, cavidades: data || [] })
  }

  const actualizarCavidad = (numeroCavidad, articuloId) => {
    setMoldeCavidades(prev => ({
      ...prev,
      cavidades: prev.cavidades.map(c => c.numero_cavidad === numeroCavidad ? { ...c, articulo_id: articuloId ? parseInt(articuloId) : null } : c)
    }))
  }

  const guardarCavidades = async () => {
    setLoading(true)
    for (const c of moldeCavidades.cavidades) {
      await supabase.from('molde_cavidades').update({ articulo_id: c.articulo_id }).eq('id', c.id)
    }
    setLoading(false)
    setExito('Cavidades actualizadas correctamente')
    setMoldeCavidades(null)
    setTimeout(() => setExito(''), 3000)
  }

  if (moldeCavidades) {
    return (
      <div style={styles.container}>
        <button style={styles.botonVolver} onClick={() => setMoldeCavidades(null)}>&larr; Volver a moldes</button>
        <h2 style={styles.titulo}>Cavidades: {moldeCavidades.molde.clave}</h2>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px' }}>
          Asigna que articulo produce cada cavidad. Si todas las cavidades hacen el mismo articulo, selecciona el mismo en todas.
          Si el molde produce piezas espejo (ej. izquierda/derecha), asigna el articulo correspondiente a cada cavidad.
        </p>
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Cavidad</span>
            <span style={{ flex: 3 }}>Articulo que produce</span>
          </div>
          {moldeCavidades.cavidades.map(c => (
            <div key={c.id} style={styles.tablaFila} className="fila-hover">
              <span style={{ flex: 1, fontWeight: '600' }}>#{c.numero_cavidad}</span>
              <span style={{ flex: 3 }}>
                <select style={styles.input} value={c.articulo_id || ''} onChange={e => actualizarCavidad(c.numero_cavidad, e.target.value)}>
                  <option value="">Sin asignar</option>
                  {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
                </select>
              </span>
            </div>
          ))}
        </div>
        <div style={styles.botones}>
          <button style={styles.boton} onClick={guardarCavidades} disabled={loading}>{loading ? 'Guardando...' : 'Guardar cavidades'}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Moldes</h2>
        {puedeCrear && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo molde'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form} className="aparecer">
          <h3 style={styles.formTitulo}>{editando ? `Editando: ${editando.clave}` : 'Nuevo molde'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Clave *</label>
              <input style={styles.input} value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="Ej: MLD-014" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Numero de cavidades *</label>
              <input style={styles.input} type="number" min="1" value={form.num_cavidades} onChange={e => setForm({ ...form, num_cavidades: e.target.value })} />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Shots alerta minimo</label>
              <input style={styles.input} type="number" value={form.shots_alerta_min} onChange={e => setForm({ ...form, shots_alerta_min: e.target.value })} placeholder="Ej: 450000" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Shots alerta maximo</label>
              <input style={styles.input} type="number" value={form.shots_alerta_max} onChange={e => setForm({ ...form, shots_alerta_max: e.target.value })} placeholder="Ej: 500000" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Ubicacion fisica</label>
              <input style={styles.input} value={form.ubicacion_fisica} onChange={e => setForm({ ...form, ubicacion_fisica: e.target.value })} />
            </div>
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
          <span style={{ flex: 1 }}>Cavidades</span>
          <span style={{ flex: 1 }}>Shots acum.</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 2 }}>Acciones</span>
        </div>
        {loading ? <p style={{ padding: 20, color: '#666' }}>Cargando...</p> : moldes.length === 0 ? (
          <p style={{ padding: 20, color: '#666' }}>No hay moldes registrados</p>
        ) : moldes.map(m => {
          const cercaDeAlerta = m.shots_alerta_max && m.shots_acumulados >= m.shots_alerta_max
          const enRangoAlerta = m.shots_alerta_min && m.shots_acumulados >= m.shots_alerta_min && !cercaDeAlerta
          return (
            <div key={m.id} style={styles.tablaFila} className="fila-hover">
              <span style={{ flex: 1, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{m.clave}</span>
              <span style={{ flex: 2, fontSize: '14px' }}>{m.nombre}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{m.num_cavidades}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{m.shots_acumulados?.toLocaleString('es-MX') || 0}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, ...(cercaDeAlerta ? { backgroundColor: '#fef2f2', color: '#dc2626' } : enRangoAlerta ? { backgroundColor: '#fef9c3', color: '#854d0e' } : { backgroundColor: '#f0fdf4', color: '#16a34a' }) }}>
                  {cercaDeAlerta ? 'Requiere Mtto' : enRangoAlerta ? 'Cerca de Mtto' : 'OK'}
                </span>
              </span>
              <span style={{ flex: 2 }}>
                <button style={styles.botonAccion} onClick={() => abrirCavidades(m)}>Cavidades</button>
                {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => abrirEditar(m)}>Editar</button>}
                {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => toggleActivo(m)}>{m.activo ? 'Desactivar' : 'Activar'}</button>}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '16px' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
