import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'

const tipos = [
  { value: 'inyeccion', label: 'Inyeccion' },
  { value: 'ensamble', label: 'Ensamble' },
]

const formVacio = { clave: '', nombre: '', tipo: 'inyeccion', tonelaje: '', site_id: '', estatus: 'activa', capacidad_doble_inyeccion: false, costo_hora_hombre: '', costo_hora_maquina: '' }

export default function Maquinas() {
  const { perfil, tienePermiso } = useAuth()
  const [maquinas, setMaquinas] = useState([])
  const [filtroMaq, setFiltroMaq] = useState('')
  const [sites, setSites] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_maquinas', 'crear')
  const puedeEditar = tienePermiso('ing_maquinas', 'editar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: m }, { data: s }] = await Promise.all([
      supabase.from('maquinas').select('*, sites(nombre, codigo)').eq('empresa_id', perfil.empresa_id).order('clave'),
      supabase.from('sites').select('id, nombre').eq('empresa_id', perfil.empresa_id),
    ])
    setMaquinas(m || [])
    setSites(s || [])
    setLoading(false)
  }

  const maquinasFiltradas = maquinas.filter(m => !filtroMaq || (`${m.clave} ${m.nombre}`).toLowerCase().includes(filtroMaq.toLowerCase()))
  const colsMaq = [{ label: 'Clave', get: m => m.clave }, { label: 'Nombre', get: m => m.nombre }, { label: 'Tipo', get: m => m.tipo }, { label: 'Tonelaje', get: m => m.tonelaje }, { label: 'Costo hora-hombre', get: m => m.costo_hora_hombre }, { label: 'Costo hora-maquina', get: m => m.costo_hora_maquina }, { label: 'Site', get: m => m.sites?.nombre || '' }, { label: 'Estatus', get: m => m.activo ? 'Activo' : 'Inactivo' }]
  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setMostrarForm(true); setError('') }
  const abrirEditar = (m) => {
    setEditando(m)
    setForm({
      clave: m.clave, nombre: m.nombre || '', tipo: m.tipo, tonelaje: m.tonelaje || '',
      site_id: m.site_id?.toString() || '', estatus: m.estatus,
      capacidad_doble_inyeccion: m.capacidad_doble_inyeccion || false,
      costo_hora_hombre: m.costo_hora_hombre ?? '',
      costo_hora_maquina: m.costo_hora_maquina ?? '',
    })
    setMostrarForm(true)
    setError('')
  }

  const guardar = async () => {
    if (!form.clave || !form.tipo) { setError('Clave y tipo son obligatorios'); return }
    setError('')
    setLoading(true)

    const payload = {
      clave: form.clave, nombre: form.nombre, tipo: form.tipo,
      tonelaje: form.tonelaje ? parseFloat(form.tonelaje) : null,
      site_id: form.site_id ? parseInt(form.site_id) : null,
      estatus: form.estatus,
      capacidad_doble_inyeccion: form.tipo === 'inyeccion' ? form.capacidad_doble_inyeccion : false,
      costo_hora_hombre: form.costo_hora_hombre === '' ? 0 : parseFloat(form.costo_hora_hombre),
      costo_hora_maquina: form.costo_hora_maquina === '' ? 0 : parseFloat(form.costo_hora_maquina),
    }

    let error
    if (editando) {
      const r = await supabase.from('maquinas').update(payload).eq('id', editando.id)
      error = r.error
    } else {
      const r = await supabase.from('maquinas').insert({ ...payload, empresa_id: perfil.empresa_id })
      error = r.error
    }

    if (error) { setError(error.message.includes('unique') ? 'Esa clave ya existe' : error.message); setLoading(false); return }

    setExito(editando ? 'Maquina actualizada' : 'Maquina creada')
    setMostrarForm(false)
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (m) => {
    await supabase.from('maquinas').update({ activo: !m.activo }).eq('id', m.id)
    await cargarDatos()
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Maquinas</h2>
        {puedeCrear && (
          <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nueva maquina'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form} className="aparecer">
          <h3 style={styles.formTitulo}>{editando ? `Editando: ${editando.clave}` : 'Nueva maquina'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Clave *</label>
              <input style={styles.input} value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="Ej: INY-05" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Nombre</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Tipo *</label>
              <select style={styles.input} value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                {tipos.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Tonelaje</label>
              <input style={styles.input} type="number" value={form.tonelaje} onChange={e => setForm({ ...form, tonelaje: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Costo hora-hombre</label>
              <input style={styles.input} type="number" min="0" step="0.01" value={form.costo_hora_hombre}
                onChange={e => setForm({ ...form, costo_hora_hombre: e.target.value })} placeholder="0 = usa la tarifa de planta" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Costo hora-maquina</label>
              <input style={styles.input} type="number" min="0" step="0.01" value={form.costo_hora_maquina}
                onChange={e => setForm({ ...form, costo_hora_maquina: e.target.value })} placeholder="0 = usa la tarifa de planta" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Site</label>
              <select style={styles.input} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value })}>
                <option value="">Selecciona</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Estatus</label>
              <select style={styles.input} value={form.estatus} onChange={e => setForm({ ...form, estatus: e.target.value })}>
                <option value="activa">Activa</option>
                <option value="mantenimiento">Mantenimiento</option>
                <option value="baja">Baja</option>
              </select>
            </div>
          </div>
          {form.tipo === 'inyeccion' && (
            <div style={styles.filaCheckbox}>
              <input type="checkbox" id="capacidad2k" checked={form.capacidad_doble_inyeccion}
                onChange={e => setForm({ ...form, capacidad_doble_inyeccion: e.target.checked })} />
              <label htmlFor="capacidad2k" style={styles.labelCheckbox}>
                Tiene capacidad de doble inyeccion (2K) en un solo ciclo
              </label>
            </div>
          )}
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      )}

      <div className="no-imprimir" style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <input style={{ padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', width: '260px' }} value={filtroMaq} onChange={e => setFiltroMaq(e.target.value)} placeholder="Filtrar por clave o nombre..." />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button style={{ padding: '9px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => exportarExcel('maquinas', colsMaq, maquinasFiltradas)}>Excel</button>
          <button style={{ padding: '9px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => imprimirTablaPDF('Maquinas', colsMaq, maquinasFiltradas)}>PDF</button>
        </div>
      </div>
      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1 }}>Clave</span>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1 }}>Tipo</span>
          <span style={{ flex: 1 }}>Tonelaje</span>
          <span style={{ flex: 1 }}>Site</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? <p style={{ padding: 20, color: '#666' }}>Cargando...</p> : maquinas.length === 0 ? (
          <p style={{ padding: 20, color: '#666' }}>No hay maquinas registradas</p>
        ) : maquinasFiltradas.map(m => (
          <div key={m.id} style={styles.tablaFila} className="fila-hover">
            <span style={{ flex: 1, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{m.clave}</span>
            <span style={{ flex: 2, fontSize: '14px' }}>{m.nombre}</span>
            <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>
              {tipos.find(t => t.value === m.tipo)?.label}
              {m.capacidad_doble_inyeccion && <span style={styles.badge2k}> 2K</span>}
            </span>
            <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{m.tonelaje || '-'}</span>
            <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{m.sites?.nombre || '-'}</span>
            <span style={{ flex: 1 }}>
              <span style={{ ...styles.badge, ...(m.estatus === 'activa' ? { backgroundColor: '#f0fdf4', color: '#16a34a' } : m.estatus === 'mantenimiento' ? { backgroundColor: '#fef9c3', color: '#854d0e' } : { backgroundColor: '#fef2f2', color: '#dc2626' }) }}>
                {m.estatus}
              </span>
            </span>
            <span style={{ flex: 1 }}>
              {puedeEditar && <button style={styles.botonAccion} onClick={() => abrirEditar(m)}>Editar</button>}
              {puedeEditar && <button style={{ ...styles.botonAccion, marginLeft: '6px' }} onClick={() => toggleActivo(m)}>{m.activo ? 'Desactivar' : 'Activar'}</button>}
            </span>
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
  badge2k: { backgroundColor: '#f5f3ff', color: '#7c3aed', padding: '2px 6px', borderRadius: '10px', fontSize: '10px', fontWeight: '700', marginLeft: '4px' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
