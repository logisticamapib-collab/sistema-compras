import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import CargaMasivaCatalogo from '../../components/CargaMasivaCatalogo'

const COLS_PROV = [
  { label: 'Nombre', get: p => p.nombre },
  { label: 'Razon social', get: p => p.razon_social },
  { label: 'RFC', get: p => p.rfc },
  { label: 'Contacto', get: p => p.contacto },
  { label: 'Telefono', get: p => p.telefono },
  { label: 'Email', get: p => p.email },
  { label: 'Condiciones', get: p => p.condiciones_pago },
  { label: 'Dias credito', get: p => p.dias_credito },
  { label: 'Maquilador', get: p => p.es_maquilador ? 'Si' : 'No' },
  { label: 'Estatus', get: p => p.activo ? 'Activo' : 'Inactivo' },
]

const CONDICIONES = ['contado', '15 dias', '30 dias', '45 dias', '60 dias', '90 dias']

// Especificacion de la plantilla de carga masiva. El orden manda: asi salen las
// columnas en el Excel.
const COLS_CARGA = [
  { campo: 'nombre', req: true, ayuda: 'Nombre comercial con el que se le conoce.' },
  { campo: 'razon_social', ayuda: 'Razon social completa, como aparece en la factura.' },
  { campo: 'rfc', upper: true, ayuda: 'RFC. Dejalo vacio si el proveedor es extranjero.' },
  { campo: 'contacto', ayuda: 'Nombre de la persona con quien se trata.' },
  { campo: 'email' },
  { campo: 'telefono' },
  { campo: 'direccion', ayuda: 'Calle, numero y colonia.' },
  { campo: 'ciudad' },
  { campo: 'estado' },
  { campo: 'cp' },
  { campo: 'condiciones_pago', tipo: 'lista', opciones: CONDICIONES },
  { campo: 'dias_credito', tipo: 'num', defecto: 0, ayuda: 'Numero de dias. Si no aplica, escribe 0.' },
  { campo: 'forma_pago', ayuda: 'Ej: Transferencia, 03.' },
  { campo: 'numero_cuenta', ayuda: 'Cuenta o CLABE del proveedor.' },
  { campo: 'es_maquilador', tipo: 'bool', ayuda: 'si / no. Solo un maquilador puede recibir ordenes de maquila.' },
]
const EJEMPLOS_CARGA = [
  ['Resinas del Centro', 'Resinas del Centro SA de CV', 'RCE050101AB2', 'Ing. Pedro Lara', 'ventas@resinascentro.com', '442 987 6543', 'Av. Peñuelas 25', 'Queretaro', 'Queretaro', '76148', '30 dias', 30, 'Transferencia', '012680001234567890', 'no'],
  ['Maquilados Bajio', 'Maquilados del Bajio SA de CV', 'MBA110315CD4', 'Lic. Ana Torres', 'contacto@maquiladosbajio.com', '477 111 2233', 'Blvd. Aeropuerto 500', 'Leon', 'Guanajuato', '37545', '45 dias', 45, 'Transferencia', '', 'si'],
]

const formVacio = {
  nombre: '', razon_social: '', rfc: '', contacto: '',
  email: '', telefono: '', direccion: '', ciudad: '',
  estado: '', cp: '', condiciones_pago: '', dias_credito: 0,
  forma_pago: '', numero_cuenta: '', es_maquilador: false,
}

export default function Proveedores() {
  const { perfil, tienePermiso } = useAuth()
  const [proveedores, setProveedores] = useState([])
  // bloqueos[id] = texto que dice donde esta usado el proveedor. Si trae algo,
  // no se puede eliminar. Lo contesta la base, no la pantalla.
  const [bloqueos, setBloqueos] = useState({})
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [mostrarCarga, setMostrarCarga] = useState(false)
  const [proveedorEditando, setProveedorEditando] = useState(null)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [form, setForm] = useState(formVacio)

  // Esta pantalla no validaba permisos: cualquiera que alcanzara el menu podia
  // dar de alta y editar proveedores.
  const puedeCrear = tienePermiso('proveedores', 'crear')
  const puedeEditar = tienePermiso('proveedores', 'editar')
  const puedeEliminar = tienePermiso('proveedores', 'eliminar')

  useEffect(() => { cargarProveedores() }, [])

  const cargarProveedores = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('proveedores')
      .select('*')
      .eq('empresa_id', perfil.empresa_id)
      .order('nombre')
    const lista = data || []
    setProveedores(lista)

    // Una sola llamada para toda la lista, no una por renglon.
    if (lista.length) {
      const { data: refs } = await supabase.rpc('referencias_resumen', {
        p_tabla: 'proveedores',
        p_ids: lista.map(p => p.id),
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
    setProveedorEditando(null)
    setForm(formVacio)
    setMostrarForm(true)
    setMostrarCarga(false)
    setError('')
  }

  const abrirEditar = (p) => {
    setProveedorEditando(p)
    setForm({
      nombre: p.nombre || '', razon_social: p.razon_social || '', rfc: p.rfc || '',
      contacto: p.contacto || '', email: p.email || '', telefono: p.telefono || '',
      direccion: p.direccion || '', ciudad: p.ciudad || '', estado: p.estado || '', cp: p.cp || '',
      condiciones_pago: p.condiciones_pago || '', dias_credito: p.dias_credito || 0,
      forma_pago: p.forma_pago || '', numero_cuenta: p.numero_cuenta || '', es_maquilador: !!p.es_maquilador,
    })
    setMostrarForm(true)
    setMostrarCarga(false)
    setError('')
  }

  const guardar = async () => {
    if (!form.nombre) {
      setError('El nombre del proveedor es obligatorio')
      return
    }
    setError('')
    setLoading(true)

    const payload = { ...form, rfc: form.rfc || null, dias_credito: parseInt(form.dias_credito) || 0 }

    let error
    if (proveedorEditando) {
      const resultado = await supabase.from('proveedores').update(payload).eq('id', proveedorEditando.id)
      error = resultado.error
    } else {
      const resultado = await supabase.from('proveedores').insert({ ...payload, empresa_id: perfil.empresa_id })
      error = resultado.error
    }

    if (error) {
      // La base rechaza RFC repetidos; el mensaje crudo no se entiende.
      setError(error.message.includes('proveedores_empresa_rfc_uq')
        ? 'Ya existe otro proveedor con ese RFC'
        : 'Error al guardar: ' + error.message)
      setLoading(false)
      return
    }

    setExito(proveedorEditando ? 'Proveedor actualizado correctamente' : 'Proveedor guardado correctamente')
    setMostrarForm(false)
    setProveedorEditando(null)
    setForm(formVacio)
    await cargarProveedores()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (p) => {
    await supabase.from('proveedores').update({ activo: !p.activo }).eq('id', p.id)
    await cargarProveedores()
  }

  // Eliminar es irreversible y por eso solo existe mientras nadie use al
  // proveedor. El candado real vive en un disparador de la base: aunque esta
  // pantalla se equivoque, el borrado no pasa.
  const eliminar = async (p) => {
    setError(''); setExito('')
    if (!window.confirm(`Eliminar definitivamente a "${p.nombre}"?\n\nEsta accion no se puede deshacer. Si el proveedor ya opero alguna vez, usa Desactivar.`)) return
    const { error } = await supabase.from('proveedores').delete().eq('id', p.id)
    if (error) { setError(error.message); await cargarProveedores(); return }
    setExito('Proveedor eliminado')
    await cargarProveedores()
    setTimeout(() => setExito(''), 3000)
  }

  const proveedoresFiltrados = proveedores.filter(p =>
    p.nombre.toLowerCase().includes(busqueda.toLowerCase()) ||
    (p.rfc && p.rfc.toLowerCase().includes(busqueda.toLowerCase()))
  )

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Proveedores</h2>
        {puedeCrear && (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={styles.botonSecundario} onClick={() => { setMostrarCarga(!mostrarCarga); setMostrarForm(false) }}>
              {mostrarCarga ? 'Cerrar carga masiva' : 'Carga masiva'}
            </button>
            <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
              {mostrarForm ? 'Cancelar' : '+ Nuevo proveedor'}
            </button>
          </div>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarCarga && puedeCrear && (
        <CargaMasivaCatalogo
          titulo="Proveedores"
          tabla="proveedores"
          columnas={COLS_CARGA}
          dedupe={[{ campo: 'rfc', etiqueta: 'RFC' }, { campo: 'nombre', etiqueta: 'Nombre' }]}
          ejemplos={EJEMPLOS_CARGA}
          notas={[
            'Los proveedores se dan de alta como Activos.',
            'Si un RFC o un nombre ya existe, esa fila se rechaza y el resto si se carga.',
            'es_maquilador = si habilita al proveedor para ordenes de maquila. Dejalo en no si solo te vende material.',
          ]}
          existentes={proveedores}
          empresaId={perfil.empresa_id}
          puedeCargar={puedeCrear}
          onCargado={cargarProveedores}
          onCerrar={() => setMostrarCarga(false)}
        />
      )}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{proveedorEditando ? `Editando: ${proveedorEditando.nombre}` : 'Nuevo proveedor'}</h3>
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
                onChange={e => setForm({ ...form, rfc: e.target.value.toUpperCase() })}
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
                {CONDICIONES.map(c => <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Dias de credito</label>
              <input style={styles.input} type="number" value={form.dias_credito}
                onChange={e => setForm({ ...form, dias_credito: e.target.value })}
                placeholder="0" min="0" />
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Forma de pago</label>
              <input style={styles.input} value={form.forma_pago}
                onChange={e => setForm({ ...form, forma_pago: e.target.value })}
                placeholder="Ej: Transferencia, 03" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Numero de cuenta</label>
              <input style={styles.input} value={form.numero_cuenta}
                onChange={e => setForm({ ...form, numero_cuenta: e.target.value })}
                placeholder="Cuenta o CLABE del proveedor" />
            </div>
          </div>
          <div style={styles.fila}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#334155', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!form.es_maquilador} onChange={e => setForm({ ...form, es_maquilador: e.target.checked })} />
              Es maquilador (subcontratacion): habilita este proveedor para ordenes de maquila
            </label>
          </div>
          <div style={styles.botones}>
            <button style={styles.botonSecundarioGris} onClick={() => setMostrarForm(false)}>Cancelar</button>
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

      <div className="no-imprimir" style={{ display: 'flex', gap: '8px', marginBottom: '12px', justifyContent: 'flex-end' }}>
        <button style={{ padding: '9px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => exportarExcel('proveedores', COLS_PROV, proveedoresFiltrados)}>Excel</button>
        <button style={{ padding: '9px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => imprimirTablaPDF('Proveedores', COLS_PROV, proveedoresFiltrados)}>PDF</button>
      </div>
      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Nombre</span>
          <span style={{ flex: 1 }}>RFC</span>
          <span style={{ flex: 1 }}>Contacto</span>
          <span style={{ flex: 1 }}>Telefono</span>
          <span style={{ flex: 1 }}>Condiciones</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 2 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : proveedoresFiltrados.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay proveedores registrados</p>
        ) : (
          proveedoresFiltrados.map(p => {
            const bloqueo = bloqueos[p.id]
            return (
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
                <span style={{ flex: 2, display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
                  {puedeEditar && <button style={styles.botonAccion} onClick={() => abrirEditar(p)}>Editar</button>}
                  {puedeEditar && <button style={styles.botonAccion} onClick={() => toggleActivo(p)}>{p.activo ? 'Desactivar' : 'Activar'}</button>}
                  {puedeEliminar && (bloqueo
                    ? <button style={styles.botonBloqueado} disabled title={`No se puede eliminar: ya tiene registros en ${bloqueo}. Solo se puede desactivar.`}>Eliminar</button>
                    : <button style={styles.botonEliminar} onClick={() => eliminar(p)} title="Este proveedor no tiene ningun registro asociado todavia">Eliminar</button>)}
                </span>
              </div>
            )
          })
        )}
      </div>
      {puedeEliminar && (
        <p style={styles.pie}>
          Eliminar solo esta disponible mientras el proveedor no tenga ningun registro asociado (ordenes de compra, recibos, maquilas, articulos ligados, no conformidades…).
          En cuanto tiene historia, la unica opcion es Desactivar: borrarlo romperia la trazabilidad de las compras.
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
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  buscador: { marginBottom: '16px' },
  inputBusqueda: { padding: '9px 14px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '300px' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '9px 20px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonSecundarioGris: { padding: '9px 20px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  botonEliminar: { padding: '4px 10px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fecaca', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  botonBloqueado: { padding: '4px 10px', backgroundColor: '#f8fafc', color: '#cbd5e1', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'not-allowed' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
  pie: { fontSize: '12px', color: '#64748b', marginTop: '12px', maxWidth: '820px', lineHeight: 1.6 },
}
