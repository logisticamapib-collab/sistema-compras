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

const COLS_CARGA = [
  { campo: 'nombre', req: true, ayuda: 'Nombre comercial: como le decimos aqui adentro.' },
  { campo: 'razon_social', ayuda: 'Como aparece en la factura. Si lo dejas vacio se copia del nombre.' },
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
  // vinculos[proveedor_id] = { id, nombre } de la ficha de cliente ligada.
  // El enlace vive en clientes.proveedor_id: una sola columna para los dos
  // sentidos, para que no haya dos banderas que se contradigan.
  const [vinculos, setVinculos] = useState({})
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [mostrarCarga, setMostrarCarga] = useState(false)
  const [proveedorEditando, setProveedorEditando] = useState(null)
  const [tambienCliente, setTambienCliente] = useState(false)
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
    // Ojo: el orden de las variables sigue el orden de las consultas.
    const [rProv, rVinc] = await Promise.all([
      supabase.from('proveedores').select('*').eq('empresa_id', perfil.empresa_id).order('nombre'),
      supabase.from('clientes').select('id, nombre, proveedor_id').eq('empresa_id', perfil.empresa_id).not('proveedor_id', 'is', null),
    ])
    const lista = rProv.data || []
    setProveedores(lista)

    const mapaVinc = {}
    for (const c of rVinc.data || []) mapaVinc[c.proveedor_id] = { id: c.id, nombre: c.nombre }
    setVinculos(mapaVinc)

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
    setProveedorEditando(null); setForm(formVacio); setTambienCliente(false)
    setMostrarForm(true); setMostrarCarga(false); setError('')
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
    setTambienCliente(!!vinculos[p.id])
    setMostrarForm(true); setMostrarCarga(false); setError('')
  }

  // Crea la ficha de cliente de la MISMA empresa y la enlaza, o enlaza una que
  // ya exista. Nunca da de alta un tercer registro a ciegas.
  const vincularComoCliente = async (provId, datos) => {
    if (datos.rfc) {
      const { data: ya } = await supabase.from('clientes')
        .select('id, nombre, proveedor_id').eq('empresa_id', perfil.empresa_id).ilike('rfc', datos.rfc).limit(1)
      if (ya && ya.length) {
        if (ya[0].proveedor_id && ya[0].proveedor_id !== provId) {
          return { error: `El cliente "${ya[0].nombre}" ya esta vinculado con otro proveedor. Revisa el catalogo de clientes antes de continuar.` }
        }
        // Al vincular, los datos fiscales de ESTA ficha pisan los de la otra.
        if (!window.confirm(`Ya existe el cliente "${ya[0].nombre}" con el RFC ${datos.rfc}.\n\nVincularlo con este proveedor?\n\nOJO: al vincular, la razon social y la direccion de ESTE proveedor van a sobrescribir las de esa ficha de cliente. De ahi en adelante los dos lados se mantienen iguales.\n\nSi cancelas no se crea ni se vincula nada.`)) {
          return { cancelado: true }
        }
        const { error: e } = await supabase.from('clientes').update({ proveedor_id: provId }).eq('id', ya[0].id)
        if (e) return { error: 'No se pudo vincular: ' + e.message }
        return { ok: true }
      }
    }

    const { error: e1 } = await supabase.from('clientes').insert({
      empresa_id: perfil.empresa_id,
      nombre: datos.nombre,
      razon_social: datos.razon_social || datos.nombre,
      rfc: datos.rfc || null,
      direccion: datos.direccion,
      contacto: datos.contacto,
      email: datos.email,
      telefono: datos.telefono,
      proveedor_id: provId,
      activo: true,
    })
    if (e1) {
      return {
        error: e1.message.includes('clientes_empresa_rfc_uq')
          ? 'Ya existe un cliente con ese RFC. Vinculalo desde el catalogo de clientes.'
          : 'No se pudo crear la ficha de cliente: ' + e1.message,
      }
    }
    return { ok: true }
  }

  const desvincular = async (p) => {
    const v = vinculos[p.id]
    if (!v) return
    if (!window.confirm(`Desvincular a "${p.nombre}" de su ficha de cliente "${v.nombre}"?\n\nLa ficha de cliente NO se borra: deja de estar ligada y dejan de sincronizarse los datos fiscales.`)) return
    setError(''); setExito('')
    const { error } = await supabase.from('clientes').update({ proveedor_id: null }).eq('id', v.id)
    if (error) { setError(error.message); return }
    setExito('Proveedor desvinculado. La ficha de cliente sigue existiendo por separado.')
    await cargarProveedores()
    setTimeout(() => setExito(''), 4000)
  }

  const guardar = async () => {
    if (!form.nombre) {
      setError('El nombre del proveedor es obligatorio')
      return
    }
    const yaVinculado = proveedorEditando ? !!vinculos[proveedorEditando.id] : false
    if (tambienCliente && !yaVinculado && !form.rfc) {
      setError('Para habilitarlo tambien como cliente hace falta el RFC: es lo unico que permite saber si ya existe esa empresa en el catalogo de clientes.')
      return
    }
    setError('')
    setLoading(true)

    const payload = {
      ...form,
      // La razon social nunca queda vacia: es el dato que viaja a la ficha de
      // cliente y sincronizar un nulo borraria el dato bueno del otro lado.
      razon_social: form.razon_social || form.nombre,
      rfc: form.rfc || null,
      dias_credito: parseInt(form.dias_credito) || 0,
    }

    let provId = proveedorEditando?.id
    let error
    if (proveedorEditando) {
      const resultado = await supabase.from('proveedores').update(payload).eq('id', proveedorEditando.id)
      error = resultado.error
    } else {
      const resultado = await supabase.from('proveedores').insert({ ...payload, empresa_id: perfil.empresa_id }).select('id').single()
      error = resultado.error
      provId = resultado.data?.id
    }

    if (error) {
      setError(error.message.includes('proveedores_empresa_rfc_uq')
        ? 'Ya existe otro proveedor con ese RFC'
        : 'Error al guardar: ' + error.message)
      setLoading(false)
      return
    }

    let aviso = proveedorEditando ? 'Proveedor actualizado correctamente' : 'Proveedor guardado correctamente'

    if (tambienCliente && !yaVinculado && provId) {
      const r = await vincularComoCliente(provId, payload)
      if (r.error) { setError(r.error); setLoading(false); await cargarProveedores(); return }
      aviso += r.cancelado ? '. No se vinculo como cliente.' : '. Tambien quedo dado de alta como cliente.'
    } else if (!tambienCliente && yaVinculado) {
      await supabase.from('clientes').update({ proveedor_id: null }).eq('id', vinculos[proveedorEditando.id].id)
      aviso += '. Se desvinculo de su ficha de cliente (la ficha no se borro).'
    }

    setExito(aviso)
    setMostrarForm(false)
    setProveedorEditando(null)
    setForm(formVacio)
    await cargarProveedores()
    setLoading(false)
    setTimeout(() => setExito(''), 5000)
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
    (p.razon_social || '').toLowerCase().includes(busqueda.toLowerCase()) ||
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
            'La plantilla no habilita a nadie como cliente: eso se hace uno por uno desde la ficha, porque hay que revisar si esa empresa ya existe en el catalogo de clientes.',
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
                placeholder="Como le decimos aqui adentro" />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Razon social</label>
              <input style={styles.input} value={form.razon_social}
                onChange={e => setForm({ ...form, razon_social: e.target.value })}
                placeholder="Como aparece en la factura" />
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

          <div style={styles.bloqueVinculo}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#334155', cursor: 'pointer' }}>
              <input type="checkbox" checked={tambienCliente} onChange={e => setTambienCliente(e.target.checked)} />
              Habilitar tambien como cliente
            </label>
            <p style={styles.ayudaVinculo}>
              Marcalo cuando ademas de vendernos nos compra. Se crea su ficha de cliente con los mismos datos fiscales y queda ligada a esta.
              Si esa empresa ya existe como cliente, se pregunta antes de crear nada.
              {' '}El RFC, la razon social y la direccion se mantienen iguales en las dos fichas; el contacto, el telefono y las condiciones de pago son independientes.
            </p>
            {proveedorEditando && vinculos[proveedorEditando.id] && (
              <p style={styles.vinculoActual}>
                Vinculado con el cliente <b>{vinculos[proveedorEditando.id].nombre}</b>.
                {' '}Si desmarcas la casilla y guardas, se desliga (la ficha de cliente no se borra).
              </p>
            )}
            {tambienCliente && !(proveedorEditando && vinculos[proveedorEditando.id]) && !form.rfc && (
              <p style={styles.avisoVinculo}>Captura el RFC: sin el no hay forma de saber si esa empresa ya esta en el catalogo de clientes.</p>
            )}
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
          placeholder="Buscar por nombre, razon social o RFC..." />
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
            const vinc = vinculos[p.id]
            return (
              <div key={p.id} style={styles.tablaFila}>
                <span style={{ flex: 2 }}>
                  <p style={{ margin: '0', fontWeight: '500' }}>{p.nombre}</p>
                  {p.razon_social && p.razon_social !== p.nombre &&
                    <p style={{ margin: '0', fontSize: '11px', color: '#94a3b8' }}>{p.razon_social}</p>}
                  {vinc && (
                    <span style={styles.badgeVinculo} title={`Tambien esta dado de alta como cliente: ${vinc.nombre}`}>
                      tambien cliente
                    </span>
                  )}
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
                  {puedeEditar && vinc && <button style={styles.botonAccion} onClick={() => desvincular(p)}>Desvincular</button>}
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
  bloqueVinculo: { backgroundColor: '#f8fafc', border: '1px solid #eef2f7', borderRadius: '8px', padding: '14px 16px', marginBottom: '16px' },
  ayudaVinculo: { fontSize: '12px', color: '#64748b', margin: '8px 0 0', lineHeight: 1.6, maxWidth: '860px' },
  vinculoActual: { fontSize: '12px', color: '#0f766e', backgroundColor: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '6px', padding: '8px 10px', margin: '10px 0 0' },
  avisoVinculo: { fontSize: '12px', color: '#b45309', margin: '10px 0 0' },
  buscador: { marginBottom: '16px' },
  inputBusqueda: { padding: '9px 14px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '340px' },
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
  badgeVinculo: { display: 'inline-block', marginTop: '3px', padding: '1px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '600', backgroundColor: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
  pie: { fontSize: '12px', color: '#64748b', marginTop: '12px', maxWidth: '820px', lineHeight: 1.6 },
}
