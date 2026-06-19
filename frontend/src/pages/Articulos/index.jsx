import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const unidades = ['PZA','KG','LT','MT','CJ','RLL','PAR','JGO','SRV','TON','GR','ML','CM','M2','M3']
const monedas = ['MXN','USD','EUR']

export default function Articulos() {
  const { perfil } = useAuth()
  const [articulos, setArticulos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [articuloSeleccionado, setArticuloSeleccionado] = useState(null)
  const [mostrarProveedores, setMostrarProveedores] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [formProveedor, setFormProveedor] = useState({
    proveedor_id: '', codigo_proveedor: '', precio: '',
    minimo_compra: 1, tiempo_entrega_dias: '', tiempo_trayecto_dias: ''
  })
  const [form, setForm] = useState({
    codigo_interno: '', descripcion: '', unidad_medida: 'PZA',
    categoria_id: '', tipo_moneda: 'MXN', iva_porcentaje: 16,
    retencion_iva: 0
  })

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: a }, { data: c }, { data: p }] = await Promise.all([
      supabase.from('articulos').select('*, categorias(nombre)').eq('empresa_id', perfil.empresa_id).order('codigo_interno'),
      supabase.from('categorias').select('*').eq('empresa_id', perfil.empresa_id),
      supabase.from('proveedores').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true)
    ])
    setArticulos(a || [])
    setCategorias(c || [])
    setProveedores(p || [])
    setLoading(false)
  }

  const guardarArticulo = async () => {
    if (!form.codigo_interno || !form.descripcion || !form.unidad_medida) {
      setError('Codigo, descripcion y unidad de medida son obligatorios')
      return
    }
    setError('')
    setLoading(true)

    const { error } = await supabase.from('articulos').insert({
      ...form,
      empresa_id: perfil.empresa_id,
      categoria_id: form.categoria_id ? parseInt(form.categoria_id) : null,
      iva_porcentaje: parseFloat(form.iva_porcentaje),
      retencion_iva: parseFloat(form.retencion_iva)
    })

    if (error) {
      setError(error.message.includes('unique') ? 'El codigo interno ya existe' : error.message)
      setLoading(false)
      return
    }

    setExito('Articulo guardado correctamente')
    setMostrarForm(false)
    setForm({ codigo_interno: '', descripcion: '', unidad_medida: 'PZA', categoria_id: '', tipo_moneda: 'MXN', iva_porcentaje: 16, retencion_iva: 0 })
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const abrirProveedores = async (articulo) => {
    setArticuloSeleccionado(articulo)
    setMostrarProveedores(true)
  }

  const guardarProveedorArticulo = async () => {
    if (!formProveedor.proveedor_id || !formProveedor.precio) {
      setError('Proveedor y precio son obligatorios')
      return
    }
    setError('')

    const { error } = await supabase.from('articulo_proveedor').insert({
      articulo_id: articuloSeleccionado.id,
      proveedor_id: parseInt(formProveedor.proveedor_id),
      codigo_proveedor: formProveedor.codigo_proveedor,
      precio: parseFloat(formProveedor.precio),
      minimo_compra: parseFloat(formProveedor.minimo_compra) || 1,
      tiempo_entrega_dias: parseInt(formProveedor.tiempo_entrega_dias) || 0,
      tiempo_trayecto_dias: parseInt(formProveedor.tiempo_trayecto_dias) || 0
    })

    if (error) {
      setError(error.message.includes('unique') ? 'Este proveedor ya esta asignado al articulo' : error.message)
      return
    }

    setExito('Proveedor asignado correctamente')
    setFormProveedor({ proveedor_id: '', codigo_proveedor: '', precio: '', minimo_compra: 1, tiempo_entrega_dias: '', tiempo_trayecto_dias: '' })
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (a) => {
    await supabase.from('articulos').update({ activo: !a.activo }).eq('id', a.id)
    await cargarDatos()
  }

  const articulosFiltrados = articulos.filter(a =>
    a.codigo_interno.toLowerCase().includes(busqueda.toLowerCase()) ||
    a.descripcion.toLowerCase().includes(busqueda.toLowerCase())
  )

  if (mostrarProveedores && articuloSeleccionado) {
    return <VistaProveedoresArticulo
      articulo={articuloSeleccionado}
      proveedores={proveedores}
      formProveedor={formProveedor}
      setFormProveedor={setFormProveedor}
      guardarProveedorArticulo={guardarProveedorArticulo}
      error={error}
      exito={exito}
      onVolver={() => { setMostrarProveedores(false); setArticuloSeleccionado(null); setError(''); setExito('') }}
    />
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Articulos</h2>
        <button style={styles.boton} onClick={() => setMostrarForm(!mostrarForm)}>
          {mostrarForm ? 'Cancelar' : '+ Nuevo articulo'}
        </button>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nuevo articulo</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Codigo interno *</label>
              <input style={styles.input} value={form.codigo_interno}
                onChange={e => setForm({ ...form, codigo_interno: e.target.value.toUpperCase() })}
                placeholder="Ej: MP-001" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Descripcion *</label>
              <input style={styles.input} value={form.descripcion}
                onChange={e => setForm({ ...form, descripcion: e.target.value })}
                placeholder="Descripcion del articulo" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Unidad de medida *</label>
              <select style={styles.input} value={form.unidad_medida}
                onChange={e => setForm({ ...form, unidad_medida: e.target.value })}>
                {unidades.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Categoria</label>
              <select style={styles.input} value={form.categoria_id}
                onChange={e => setForm({ ...form, categoria_id: e.target.value })}>
                <option value="">Sin categoria</option>
                {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Moneda</label>
              <select style={styles.input} value={form.tipo_moneda}
                onChange={e => setForm({ ...form, tipo_moneda: e.target.value })}>
                {monedas.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>IVA (%)</label>
              <input style={styles.input} type="number" value={form.iva_porcentaje}
                onChange={e => setForm({ ...form, iva_porcentaje: e.target.value })}
                placeholder="16" min="0" max="100" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Retencion IVA (%)</label>
              <input style={styles.input} type="number" value={form.retencion_iva}
                onChange={e => setForm({ ...form, retencion_iva: e.target.value })}
                placeholder="0" min="0" max="100" />
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={() => setMostrarForm(false)}>Cancelar</button>
            <button style={styles.boton} onClick={guardarArticulo} disabled={loading}>
              {loading ? 'Guardando...' : 'Guardar articulo'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.buscador}>
        <input style={styles.inputBusqueda} value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por codigo o descripcion..." />
      </div>

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1 }}>Codigo</span>
          <span style={{ flex: 3 }}>Descripcion</span>
          <span style={{ flex: 1 }}>Unidad</span>
          <span style={{ flex: 1 }}>Moneda</span>
          <span style={{ flex: 1 }}>IVA</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 2 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : articulosFiltrados.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay articulos registrados</p>
        ) : (
          articulosFiltrados.map(a => (
            <div key={a.id} style={styles.tablaFila}>
              <span style={{ flex: 1, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{a.codigo_interno}</span>
              <span style={{ flex: 3 }}>
                <p style={{ margin: '0', fontWeight: '500', fontSize: '14px' }}>{a.descripcion}</p>
                <p style={{ margin: '0', fontSize: '11px', color: '#94a3b8' }}>{a.categorias?.nombre}</p>
              </span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{a.unidad_medida}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{a.tipo_moneda}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{a.iva_porcentaje}%</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: a.activo ? '#f0fdf4' : '#fef2f2', color: a.activo ? '#16a34a' : '#dc2626' }}>
                  {a.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 2, display: 'flex', gap: '6px' }}>
                <button style={styles.botonAccion} onClick={() => abrirProveedores(a)}>
                  Proveedores
                </button>
                <button style={styles.botonAccion} onClick={() => toggleActivo(a)}>
                  {a.activo ? 'Desactivar' : 'Activar'}
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function VistaProveedoresArticulo({ articulo, proveedores, formProveedor, setFormProveedor, guardarProveedorArticulo, error, exito, onVolver }) {
  const [proveedoresAsignados, setProveedoresAsignados] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargarProveedoresAsignados() }, [])

  const cargarProveedoresAsignados = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('articulo_proveedor')
      .select('*, proveedores(nombre)')
      .eq('articulo_id', articulo.id)
    setProveedoresAsignados(data || [])
    setLoading(false)
  }

  const toggleActivoProveedor = async (ap) => {
    await supabase.from('articulo_proveedor').update({ activo: !ap.activo }).eq('id', ap.id)
    await cargarProveedoresAsignados()
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <div>
          <button style={styles.botonVolver} onClick={onVolver}>
            &larr; Volver a articulos
          </button>
          <h2 style={styles.titulo}>Proveedores del articulo</h2>
          <p style={styles.subtituloArticulo}>{articulo.codigo_interno} - {articulo.descripcion}</p>
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.form}>
        <h3 style={styles.formTitulo}>Asignar proveedor</h3>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Proveedor *</label>
            <select style={styles.input} value={formProveedor.proveedor_id}
              onChange={e => setFormProveedor({ ...formProveedor, proveedor_id: e.target.value })}>
              <option value="">Selecciona proveedor</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Codigo proveedor</label>
            <input style={styles.input} value={formProveedor.codigo_proveedor}
              onChange={e => setFormProveedor({ ...formProveedor, codigo_proveedor: e.target.value })}
              placeholder="Codigo en sistema del proveedor" />
          </div>
        </div>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Precio *</label>
            <input style={styles.input} type="number" value={formProveedor.precio}
              onChange={e => setFormProveedor({ ...formProveedor, precio: e.target.value })}
              placeholder="0.00" min="0" step="0.01" />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Minimo de compra</label>
            <input style={styles.input} type="number" value={formProveedor.minimo_compra}
              onChange={e => setFormProveedor({ ...formProveedor, minimo_compra: e.target.value })}
              placeholder="1" min="0" />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Tiempo entrega (dias)</label>
            <input style={styles.input} type="number" value={formProveedor.tiempo_entrega_dias}
              onChange={e => setFormProveedor({ ...formProveedor, tiempo_entrega_dias: e.target.value })}
              placeholder="0" min="0" />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Tiempo trayecto (dias)</label>
            <input style={styles.input} type="number" value={formProveedor.tiempo_trayecto_dias}
              onChange={e => setFormProveedor({ ...formProveedor, tiempo_trayecto_dias: e.target.value })}
              placeholder="0" min="0" />
          </div>
        </div>
        <div style={styles.botones}>
          <button style={styles.boton} onClick={async () => { await guardarProveedorArticulo(); await cargarProveedoresAsignados() }}>
            Asignar proveedor
          </button>
        </div>
      </div>

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Proveedor</span>
          <span style={{ flex: 1 }}>Codigo prov.</span>
          <span style={{ flex: 1 }}>Precio</span>
          <span style={{ flex: 1 }}>Minimo</span>
          <span style={{ flex: 1 }}>Entrega</span>
          <span style={{ flex: 1 }}>Trayecto</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : proveedoresAsignados.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay proveedores asignados a este articulo</p>
        ) : (
          proveedoresAsignados.map(ap => (
            <div key={ap.id} style={styles.tablaFila}>
              <span style={{ flex: 2, fontWeight: '500' }}>{ap.proveedores?.nombre}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{ap.codigo_proveedor}</span>
              <span style={{ flex: 1, fontSize: '13px' }}>${parseFloat(ap.precio).toFixed(2)}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{ap.minimo_compra}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{ap.tiempo_entrega_dias} dias</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{ap.tiempo_trayecto_dias} dias</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: ap.activo ? '#f0fdf4' : '#fef2f2', color: ap.activo ? '#16a34a' : '#dc2626' }}>
                  {ap.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 1 }}>
                <button style={styles.botonAccion} onClick={() => toggleActivoProveedor(ap)}>
                  {ap.activo ? 'Desactivar' : 'Activar'}
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
  subtituloArticulo: { fontSize: '13px', color: '#666', margin: '4px 0 0 0' },
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
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}