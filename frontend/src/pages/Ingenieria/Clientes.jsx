import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import CargaMasivaCatalogo from '../../components/CargaMasivaCatalogo'

const COLS_CLI = [
  { label: 'Clave', get: c => c.clave },
  { label: 'Nombre', get: c => c.nombre },
  { label: 'RFC', get: c => c.rfc },
  { label: 'Contacto', get: c => c.contacto },
  { label: 'Telefono', get: c => c.telefono },
  { label: 'Email', get: c => c.email },
  { label: 'Direccion', get: c => c.direccion },
  { label: 'Estatus', get: c => c.activo ? 'Activo' : 'Inactivo' },
]

// Especificacion de la plantilla de carga masiva. El orden manda: asi salen las
// columnas en el Excel.
const COLS_CARGA = [
  { campo: 'clave', upper: true, ayuda: 'Ej: CLI-001. Identifica al cliente y no puede repetirse.' },
  { campo: 'nombre', req: true, ayuda: 'Razon social o nombre comercial del cliente.' },
  { campo: 'rfc', upper: true, ayuda: 'RFC para facturacion. Dejalo vacio si el cliente es extranjero.' },
  { campo: 'email', ayuda: 'Correo de contacto. Se va a ocupar para avisos de embarque.' },
  { campo: 'telefono' },
  { campo: 'contacto', ayuda: 'Nombre de la persona con quien se trata.' },
  { campo: 'direccion' },
]
const EJEMPLOS_CARGA = [
  ['CLI-001', 'Autopartes del Bajio SA de CV', 'ABC010203XY1', 'compras@autopartesbajio.com', '442 123 4567', 'Ing. Laura Ruiz', 'Av. Industrial 100, Queretaro'],
  ['CLI-002', 'Ensambles Norte SA de CV', 'ENO980512QP3', 'planeacion@ensamblesnorte.com', '81 8123 4567', 'Lic. Mario Salas', 'Parque Industrial Apodaca, NL'],
]

const formVacio = { clave: '', nombre: '', rfc: '', email: '', direccion: '', contacto: '', telefono: '' }

export default function Clientes() {
  const { perfil, tienePermiso } = useAuth()
  const [clientes, setClientes] = useState([])
  // bloqueos[id] = texto que dice donde esta usado el cliente. Si trae algo,
  // no se puede eliminar. Lo contesta la base, no la pantalla.
  const [bloqueos, setBloqueos] = useState({})
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [mostrarCarga, setMostrarCarga] = useState(false)
  const [editando, setEditando] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_clientes', 'crear')
  const puedeEditar = tienePermiso('ing_clientes', 'editar')
  const puedeEliminar = tienePermiso('ing_clientes', 'eliminar')

  useEffect(() => { cargarClientes() }, [])

  const cargarClientes = async () => {
    setLoading(true)
    const { data } = await supabase.from('clientes').select('*').eq('empresa_id', perfil.empresa_id).order('nombre')
    const lista = data || []
    setClientes(lista)

    // Una sola llamada para toda la lista. Preguntar cliente por cliente serian
    // N viajes al servidor y la pantalla se sentiria lenta.
    if (lista.length) {
      const { data: refs } = await supabase.rpc('referencias_resumen', {
        p_tabla: 'clientes',
        p_ids: lista.map(c => c.id),
      })
      const mapa = {}
      for (const r of refs || []) mapa[r.id] = r.motivos
      setBloqueos(mapa)
    } else {
      setBloqueos({})
    }
    setLoading(false)
  }

  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setMostrarForm(true); setMostrarCarga(false); setError('') }
  const abrirEditar = (c) => {
    setEditando(c)
    setForm({
      clave: c.clave || '', nombre: c.nombre || '', rfc: c.rfc || '', email: c.email || '',
      direccion: c.direccion || '', contacto: c.contacto || '', telefono: c.telefono || '',
    })
    setMostrarForm(true)
    setMostrarCarga(false)
    setError('')
  }

  const guardar = async () => {
    if (!form.nombre) { setError('El nombre del cliente es obligatorio'); return }
    setError('')
    setLoading(true)

    const payload = {
      clave: form.clave || null, nombre: form.nombre, rfc: form.rfc || null, email: form.email || null,
      direccion: form.direccion, contacto: form.contacto, telefono: form.telefono,
    }

    let error
    if (editando) {
      const r = await supabase.from('clientes').update(payload).eq('id', editando.id)
      error = r.error
    } else {
      const r = await supabase.from('clientes').insert({ ...payload, empresa_id: perfil.empresa_id })
      error = r.error
    }

    if (error) {
      // La base rechaza claves y RFC repetidos; el mensaje crudo no se entiende.
      setError(error.message.includes('clientes_empresa_clave_uq') ? 'Ya existe otro cliente con esa clave'
        : error.message.includes('clientes_empresa_rfc_uq') ? 'Ya existe otro cliente con ese RFC'
          : error.message)
      setLoading(false)
      return
    }

    setExito(editando ? 'Cliente actualizado' : 'Cliente creado')
    setMostrarForm(false)
    await cargarClientes()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (c) => {
    await supabase.from('clientes').update({ activo: !c.activo }).eq('id', c.id)
    await cargarClientes()
  }

  // Eliminar es irreversible y por eso solo existe mientras nadie use al
  // cliente. El candado real vive en un disparador de la base: aunque esta
  // pantalla se equivoque, el borrado no pasa.
  const eliminar = async (c) => {
    setError(''); setExito('')
    if (!window.confirm(`Eliminar definitivamente a "${c.nombre}"?\n\nEsta accion no se puede deshacer. Si el cliente ya opero alguna vez, usa Desactivar.`)) return
    const { error } = await supabase.from('clientes').delete().eq('id', c.id)
    if (error) { setError(error.message); await cargarClientes(); return }
    setExito('Cliente eliminado')
    await cargarClientes()
    setTimeout(() => setExito(''), 3000)
  }

  const clientesFiltrados = clientes.filter(c =>
    c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (c.clave || '').toLowerCase().includes(busqueda.toLowerCase()) ||
    (c.rfc || '').toLowerCase().includes(busqueda.toLowerCase())
  )

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Clientes</h2>
        {puedeCrear && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={styles.botonSecundario} onClick={() => { setMostrarCarga(!mostrarCarga); setMostrarForm(false) }}>
              {mostrarCarga ? 'Cerrar carga masiva' : 'Carga masiva'}
            </button>
            <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
              {mostrarForm ? 'Cancelar' : '+ Nuevo cliente'}
            </button>
          </div>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarCarga && puedeCrear && (
        <CargaMasivaCatalogo
          titulo="Clientes"
          tabla="clientes"
          columnas={COLS_CARGA}
          dedupe={[{ campo: 'clave', etiqueta: 'Clave' }, { campo: 'rfc', etiqueta: 'RFC' }, { campo: 'nombre', etiqueta: 'Nombre' }]}
          ejemplos={EJEMPLOS_CARGA}
          notas={['Los clientes se dan de alta como Activos.', 'Si una clave, un RFC o un nombre ya existe, esa fila se rechaza y el resto si se carga.']}
          existentes={clientes}
          empresaId={perfil.empresa_id}
          puedeCargar={puedeCrear}
          onCargado={cargarClientes}
          onCerrar={() => setMostrarCarga(false)}
        />
      )}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{editando ? `Editando: ${editando.nombre}` : 'Nuevo cliente'}</h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Clave</label>
              <input style={styles.input} value={form.clave} onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="Ej: CLI-001" />
            </div>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Nombre *</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Razon social del cliente" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>RFC</label>
              <input style={styles.input} value={form.rfc} onChange={e => setForm({ ...form, rfc: e.target.value.toUpperCase() })} placeholder="ABC010203XY1" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Direccion</label>
              <input style={styles.input} value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Contacto</label>
              <input style={styles.input} value={form.contacto} onChange={e => setForm({ ...form, contacto: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Telefono</label>
              <input style={styles.input} value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Email</label>
              <input style={styles.input} type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="compras@cliente.com" />
            </div>
          </div>
          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      )}

      <div style={styles.buscador}>
        <input style={styles.inputBusqueda} value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por clave, nombre o RFC..." />
      </div>

      <div className="no-imprimir" style={{ display: 'flex', gap: '8px', marginBottom: '12px', justifyContent: 'flex-end' }}>
        <button style={{ padding: '9px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => exportarExcel('clientes', COLS_CLI, clientesFiltrados)}>Excel</button>
        <button style={{ padding: '9px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => imprimirTablaPDF('Clientes', COLS_CLI, clientesFiltrados)}>PDF</button>
      </div>
      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1 }}>Clave</span>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1 }}>RFC</span>
          <span style={{ flex: 1 }}>Contacto</span>
          <span style={{ flex: 1 }}>Telefono</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 2 }}>Acciones</span>
        </div>
        {loading ? <p style={{ padding: 20, color: '#666' }}>Cargando...</p> : clientesFiltrados.length === 0 ? (
          <p style={{ padding: 20, color: '#666' }}>No hay clientes registrados</p>
        ) : clientesFiltrados.map(c => {
          const bloqueo = bloqueos[c.id]
          return (
            <div key={c.id} style={styles.tablaFila}>
              <span style={{ flex: 1, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{c.clave}</span>
              <span style={{ flex: 2, fontSize: '14px' }}>{c.nombre}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{c.rfc}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{c.contacto}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{c.telefono}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: c.activo ? '#f0fdf4' : '#fef2f2', color: c.activo ? '#16a34a' : '#dc2626' }}>
                  {c.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 2, display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                {puedeEditar && <button style={styles.botonAccion} onClick={() => abrirEditar(c)}>Editar</button>}
                {puedeEditar && <button style={styles.botonAccion} onClick={() => toggleActivo(c)}>{c.activo ? 'Desactivar' : 'Activar'}</button>}
                {puedeEliminar && (bloqueo
                  ? <button style={styles.botonBloqueado} disabled title={`No se puede eliminar: ya tiene registros en ${bloqueo}. Solo se puede desactivar.`}>Eliminar</button>
                  : <button style={styles.botonEliminar} onClick={() => eliminar(c)} title="Este cliente no tiene ningun registro asociado todavia">Eliminar</button>)}
              </span>
            </div>
          )
        })}
      </div>
      {puedeEliminar && (
        <p style={styles.pie}>
          Eliminar solo esta disponible mientras el cliente no tenga ningun registro asociado (embarques, releases, moldes, articulos ligados, no conformidades…).
          En cuanto tiene historia, la unica opcion es Desactivar: borrarlo romperia la trazabilidad.
        </p>
      )}
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
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '100%', boxSizing: 'border-box' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '9px 20px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  botonEliminar: { padding: '4px 10px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  botonBloqueado: { padding: '4px 10px', backgroundColor: '#f8fafc', color: '#cbd5e1', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'not-allowed' },
  buscador: { marginBottom: '16px' },
  inputBusqueda: { padding: '9px 14px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '300px' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
  pie: { fontSize: '12px', color: '#64748b', marginTop: '12px', maxWidth: '820px', lineHeight: 1.6 },
}
