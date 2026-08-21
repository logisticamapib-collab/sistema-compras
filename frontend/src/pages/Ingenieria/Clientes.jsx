import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import CargaMasivaCatalogo from '../../components/CargaMasivaCatalogo'

const COLS_CLI = [
  { label: 'Clave', get: c => c.clave },
  { label: 'Nombre', get: c => c.nombre },
  { label: 'Razon social', get: c => c.razon_social },
  { label: 'RFC', get: c => c.rfc },
  { label: 'Contacto', get: c => c.contacto },
  { label: 'Telefono', get: c => c.telefono },
  { label: 'Email', get: c => c.email },
  { label: 'Direccion', get: c => c.direccion },
  { label: 'Tambien proveedor', get: c => c.proveedor_id ? 'Si' : 'No' },
  { label: 'Estatus', get: c => c.activo ? 'Activo' : 'Inactivo' },
]

const COLS_CARGA = [
  { campo: 'clave', upper: true, ayuda: 'Ej: CLI-001. Identifica al cliente y no puede repetirse.' },
  { campo: 'nombre', req: true, ayuda: 'Nombre comercial: como le decimos aqui adentro.' },
  { campo: 'razon_social', ayuda: 'Como aparece en la factura. Si lo dejas vacio se copia del nombre.' },
  { campo: 'rfc', upper: true, ayuda: 'RFC para facturacion. Dejalo vacio si el cliente es extranjero.' },
  { campo: 'email', ayuda: 'Correo de contacto. Se va a ocupar para avisos de embarque.' },
  { campo: 'telefono' },
  { campo: 'contacto', ayuda: 'Nombre de la persona con quien se trata.' },
  { campo: 'direccion' },
]
const EJEMPLOS_CARGA = [
  ['CLI-001', 'Autopartes Bajio', 'Autopartes del Bajio SA de CV', 'ABC010203XY1', 'compras@autopartesbajio.com', '442 123 4567', 'Ing. Laura Ruiz', 'Av. Industrial 100, Queretaro'],
  ['CLI-002', 'Ensambles Norte', 'Ensambles Norte SA de CV', 'ENO980512QP3', 'planeacion@ensamblesnorte.com', '81 8123 4567', 'Lic. Mario Salas', 'Parque Industrial Apodaca, NL'],
]

const formVacio = { clave: '', nombre: '', razon_social: '', rfc: '', email: '', direccion: '', contacto: '', telefono: '' }

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
  // Casilla del formulario: habilitar a este cliente tambien como proveedor.
  const [tambienProveedor, setTambienProveedor] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_clientes', 'crear')
  const puedeEditar = tienePermiso('ing_clientes', 'editar')
  const puedeEliminar = tienePermiso('ing_clientes', 'eliminar')

  useEffect(() => { cargarClientes() }, [])

  const cargarClientes = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('clientes')
      .select('*, prov:proveedores(id, nombre)')
      .eq('empresa_id', perfil.empresa_id)
      .order('nombre')
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

  const abrirNuevo = () => {
    setEditando(null); setForm(formVacio); setTambienProveedor(false)
    setMostrarForm(true); setMostrarCarga(false); setError('')
  }
  const abrirEditar = (c) => {
    setEditando(c)
    setForm({
      clave: c.clave || '', nombre: c.nombre || '', razon_social: c.razon_social || '',
      rfc: c.rfc || '', email: c.email || '', direccion: c.direccion || '',
      contacto: c.contacto || '', telefono: c.telefono || '',
    })
    setTambienProveedor(!!c.proveedor_id)
    setMostrarForm(true); setMostrarCarga(false); setError('')
  }

  // Crea la ficha de proveedor de la MISMA empresa y la enlaza, o enlaza una
  // que ya exista. Nunca da de alta un tercer registro a ciegas: si ya hay un
  // proveedor con ese RFC, pregunta antes.
  const vincularComoProveedor = async (clienteId, datos) => {
    let provId = null

    if (datos.rfc) {
      const { data: ya } = await supabase.from('proveedores')
        .select('id, nombre').eq('empresa_id', perfil.empresa_id).ilike('rfc', datos.rfc).limit(1)
      if (ya && ya.length) {
        // Al vincular, los datos fiscales de ESTA ficha pisan los de la otra.
        // Se avisa antes porque la ficha de proveedor puede traer una direccion
        // mas cuidada que la del cliente.
        if (!window.confirm(`Ya existe el proveedor "${ya[0].nombre}" con el RFC ${datos.rfc}.\n\nVincularlo con este cliente?\n\nOJO: al vincular, la razon social y la direccion de ESTE cliente van a sobrescribir las de esa ficha de proveedor. De ahi en adelante los dos lados se mantienen iguales.\n\nSi cancelas no se crea ni se vincula nada.`)) {
          return { cancelado: true }
        }
        provId = ya[0].id
      }
    }

    if (!provId) {
      const { data: nuevo, error: e1 } = await supabase.from('proveedores').insert({
        empresa_id: perfil.empresa_id,
        nombre: datos.nombre,
        razon_social: datos.razon_social || datos.nombre,
        rfc: datos.rfc || null,
        direccion: datos.direccion,
        contacto: datos.contacto,
        email: datos.email,
        telefono: datos.telefono,
        activo: true,
      }).select('id').single()
      if (e1) return { error: 'No se pudo crear la ficha de proveedor: ' + e1.message }
      provId = nuevo.id
    }

    const { error: e2 } = await supabase.from('clientes').update({ proveedor_id: provId }).eq('id', clienteId)
    if (e2) {
      return {
        error: e2.message.includes('clientes_proveedor_vinculado_uq')
          ? 'Ese proveedor ya esta vinculado con otro cliente. Revisa el catalogo de proveedores.'
          : 'No se pudo vincular: ' + e2.message,
      }
    }
    return { ok: true }
  }

  const desvincular = async (c) => {
    if (!window.confirm(`Desvincular a "${c.nombre}" de su ficha de proveedor "${c.prov?.nombre}"?\n\nLa ficha de proveedor NO se borra: deja de estar ligada y dejan de sincronizarse los datos fiscales.`)) return
    setError(''); setExito('')
    const { error } = await supabase.from('clientes').update({ proveedor_id: null }).eq('id', c.id)
    if (error) { setError(error.message); return }
    setExito('Cliente desvinculado. La ficha de proveedor sigue existiendo por separado.')
    await cargarClientes()
    setTimeout(() => setExito(''), 4000)
  }

  const guardar = async () => {
    if (!form.nombre) { setError('El nombre del cliente es obligatorio'); return }
    if (tambienProveedor && !editando?.proveedor_id && !form.rfc) {
      setError('Para habilitarlo tambien como proveedor hace falta el RFC: es lo unico que permite saber si ya existe esa empresa en el catalogo de proveedores.')
      return
    }
    setError('')
    setLoading(true)

    const payload = {
      clave: form.clave || null,
      nombre: form.nombre,
      // La razon social nunca queda vacia: es el dato que viaja a la ficha de
      // proveedor y sincronizar un nulo borraria el dato bueno del otro lado.
      razon_social: form.razon_social || form.nombre,
      rfc: form.rfc || null,
      email: form.email || null,
      direccion: form.direccion,
      contacto: form.contacto,
      telefono: form.telefono,
    }

    let clienteId = editando?.id
    let error
    if (editando) {
      const r = await supabase.from('clientes').update(payload).eq('id', editando.id)
      error = r.error
    } else {
      const r = await supabase.from('clientes').insert({ ...payload, empresa_id: perfil.empresa_id }).select('id').single()
      error = r.error
      clienteId = r.data?.id
    }

    if (error) {
      setError(error.message.includes('clientes_empresa_clave_uq') ? 'Ya existe otro cliente con esa clave'
        : error.message.includes('clientes_empresa_rfc_uq') ? 'Ya existe otro cliente con ese RFC'
          : error.message)
      setLoading(false)
      return
    }

    let aviso = editando ? 'Cliente actualizado' : 'Cliente creado'

    // Vincular o desvincular segun la casilla.
    const estabaVinculado = !!editando?.proveedor_id
    if (tambienProveedor && !estabaVinculado && clienteId) {
      const r = await vincularComoProveedor(clienteId, payload)
      if (r.error) { setError(r.error); setLoading(false); await cargarClientes(); return }
      aviso += r.cancelado ? '. No se vinculo como proveedor.' : '. Tambien quedo dado de alta como proveedor.'
    } else if (!tambienProveedor && estabaVinculado) {
      await supabase.from('clientes').update({ proveedor_id: null }).eq('id', clienteId)
      aviso += '. Se desvinculo de su ficha de proveedor (la ficha no se borro).'
    }

    setExito(aviso)
    setMostrarForm(false)
    await cargarClientes()
    setLoading(false)
    setTimeout(() => setExito(''), 5000)
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
    const extra = c.proveedor_id
      ? `\n\nOJO: esta vinculado con el proveedor "${c.prov?.nombre}". Esa ficha NO se borra, se queda como proveedor normal.`
      : ''
    if (!window.confirm(`Eliminar definitivamente a "${c.nombre}"?\n\nEsta accion no se puede deshacer. Si el cliente ya opero alguna vez, usa Desactivar.${extra}`)) return
    const { error } = await supabase.from('clientes').delete().eq('id', c.id)
    if (error) { setError(error.message); await cargarClientes(); return }
    setExito('Cliente eliminado')
    await cargarClientes()
    setTimeout(() => setExito(''), 3000)
  }

  const clientesFiltrados = clientes.filter(c =>
    c.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (c.clave || '').toLowerCase().includes(busqueda.toLowerCase()) ||
    (c.razon_social || '').toLowerCase().includes(busqueda.toLowerCase()) ||
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
          notas={[
            'Los clientes se dan de alta como Activos.',
            'Si una clave, un RFC o un nombre ya existe, esa fila se rechaza y el resto si se carga.',
            'La plantilla no habilita a nadie como proveedor: eso se hace uno por uno desde la ficha, porque hay que revisar si esa empresa ya existe en el catalogo de proveedores.',
          ]}
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
              <label style={styles.label}>Nombre comercial *</label>
              <input style={styles.input} value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Como le decimos aqui adentro" />
            </div>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Razon social</label>
              <input style={styles.input} value={form.razon_social} onChange={e => setForm({ ...form, razon_social: e.target.value })} placeholder="Como aparece en la factura" />
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

          <div style={styles.bloqueVinculo}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#334155', cursor: 'pointer' }}>
              <input type="checkbox" checked={tambienProveedor} onChange={e => setTambienProveedor(e.target.checked)} />
              Habilitar tambien como proveedor
            </label>
            <p style={styles.ayudaVinculo}>
              Marcalo cuando ademas de comprarnos nos vende algo: normalmente la materia prima con la que le fabricamos.
              Se crea su ficha de proveedor con los mismos datos fiscales y queda ligada a esta, para poder levantarle ordenes de compra.
              Si esa empresa ya existe como proveedor, se pregunta antes de crear nada.
              {' '}El RFC, la razon social y la direccion se mantienen iguales en las dos fichas; el contacto, el telefono y las condiciones de pago son independientes.
            </p>
            {editando?.proveedor_id && (
              <p style={styles.vinculoActual}>
                Vinculado con el proveedor <b>{editando.prov?.nombre}</b>.
                {' '}Si desmarcas la casilla y guardas, se desliga (la ficha de proveedor no se borra).
              </p>
            )}
            {tambienProveedor && !editando?.proveedor_id && !form.rfc && (
              <p style={styles.avisoVinculo}>Captura el RFC: sin el no hay forma de saber si esa empresa ya esta en el catalogo de proveedores.</p>
            )}
          </div>

          <div style={styles.botones}>
            <button style={styles.boton} onClick={guardar} disabled={loading}>{loading ? 'Guardando...' : 'Guardar'}</button>
          </div>
        </div>
      )}

      <div style={styles.buscador}>
        <input style={styles.inputBusqueda} value={busqueda} onChange={e => setBusqueda(e.target.value)} placeholder="Buscar por clave, nombre, razon social o RFC..." />
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
              <span style={{ flex: 2 }}>
                <p style={{ margin: 0, fontSize: '14px' }}>{c.nombre}</p>
                {c.razon_social && c.razon_social !== c.nombre &&
                  <p style={{ margin: 0, fontSize: '11px', color: '#94a3b8' }}>{c.razon_social}</p>}
                {c.proveedor_id && (
                  <span style={styles.badgeVinculo} title={`Tambien esta dado de alta como proveedor: ${c.prov?.nombre}`}>
                    tambien proveedor
                  </span>
                )}
              </span>
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
                {puedeEditar && c.proveedor_id && <button style={styles.botonAccion} onClick={() => desvincular(c)}>Desvincular</button>}
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
  bloqueVinculo: { backgroundColor: '#f8fafc', border: '1px solid #eef2f7', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' },
  ayudaVinculo: { fontSize: '12px', color: '#64748b', margin: '8px 0 0', lineHeight: 1.6, maxWidth: '860px' },
  vinculoActual: { fontSize: '12px', color: '#0f766e', backgroundColor: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '6px', padding: '8px 10px', margin: '10px 0 0' },
  avisoVinculo: { fontSize: '12px', color: '#b45309', margin: '10px 0 0' },
  botones: { display: 'flex', justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '9px 20px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  botonEliminar: { padding: '4px 10px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  botonBloqueado: { padding: '4px 10px', backgroundColor: '#f8fafc', color: '#cbd5e1', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'not-allowed' },
  buscador: { marginBottom: '16px' },
  inputBusqueda: { padding: '9px 14px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '340px' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  badgeVinculo: { display: 'inline-block', marginTop: '3px', padding: '1px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '600', backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
  pie: { fontSize: '12px', color: '#64748b', marginTop: '12px', maxWidth: '820px', lineHeight: 1.6 },
}
