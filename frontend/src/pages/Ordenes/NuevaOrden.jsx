import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import NuevaOrdenDirecta from './NuevaOrdenDirecta'

const unidades = ['PZA','KG','LT','MT','CJ','RLL','PAR','JGO','SRV','TON','GR','ML','CM','M2','M3']

export default function NuevaOrden({ onVolver, onGuardado }) {
  const { perfil } = useAuth()
  const [tipo, setTipo] = useState(null)
  const [paso, setPaso] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [requisiciones, setRequisiciones] = useState([])
  const [requisicionSeleccionada, setRequisicionSeleccionada] = useState(null)
  const [solicitanteInfo, setSolicitanteInfo] = useState(null)
  const [lineasRequisicion, setLineasRequisicion] = useState([])
  const [lineasSeleccionadas, setLineasSeleccionadas] = useState([])
  const [proveedorPorLinea, setProveedorPorLinea] = useState({})
  const [proveedores, setProveedores] = useState([])
  const [articuloProveedores, setArticuloProveedores] = useState({})
  const [mostrarConfirmacion, setMostrarConfirmacion] = useState(false)
  const [ordenesAgrupadas, setOrdenesAgrupadas] = useState({})
  const [descuentos, setDescuentos] = useState({})
  const [cotizaciones, setCotizaciones] = useState({})
  const [articulosCatalogo, setArticulosCatalogo] = useState([])
  const [vinculandoLineaId, setVinculandoLineaId] = useState(null)
  const [modoVinculo, setModoVinculo] = useState('seleccionar')
  const [articuloSeleccionadoVinculo, setArticuloSeleccionadoVinculo] = useState('')
  const [nuevoArticuloForm, setNuevoArticuloForm] = useState({
    codigo_interno: '', descripcion: '', unidad_medida: 'PZA'
  })
  const [form, setForm] = useState({
    fecha_entrega_estimada: '',
    condiciones_pago: '',
    moneda: 'MXN',
    notas: ''
  })

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: r }, { data: p }, { data: a }] = await Promise.all([
      supabase.from('requisiciones')
        .select('*, solicitante:solicitante_id(nombre), sites(nombre,codigo)')
        .eq('empresa_id', perfil.empresa_id)
        .in('estatus', ['en_proceso'])
        .order('created_at', { ascending: false }),
      supabase.from('proveedores')
        .select('*')
        .eq('empresa_id', perfil.empresa_id)
        .eq('activo', true),
      supabase.from('articulos')
        .select('*')
        .eq('empresa_id', perfil.empresa_id)
        .eq('activo', true)
        .order('codigo_interno')
    ])

    let requisicionesConPendientes = r || []
    if (requisicionesConPendientes.length > 0) {
      const { data: lineasPendientes } = await supabase
        .from('requisicion_lineas')
        .select('requisicion_id')
        .in('requisicion_id', requisicionesConPendientes.map(x => x.id))
        .eq('estatus_linea', 'pendiente')
      const idsConPendientes = new Set((lineasPendientes || []).map(l => l.requisicion_id))
      requisicionesConPendientes = requisicionesConPendientes.filter(x => idsConPendientes.has(x.id))
    }

    setRequisiciones(requisicionesConPendientes)
    setProveedores(p || [])
    setArticulosCatalogo(a || [])
    setLoading(false)
  }

  const cargarProveedoresDeArticulo = async (articuloId, lineaId) => {
    const { data: aps } = await supabase
      .from('articulo_proveedor')
      .select('*, proveedores(nombre)')
      .eq('articulo_id', articuloId)
      .eq('activo', true)
    setArticuloProveedores(prev => ({ ...prev, [lineaId]: aps || [] }))
    if (aps?.length === 1) {
      setProveedorPorLinea(prev => ({ ...prev, [lineaId]: aps[0].proveedor_id.toString() }))
    }
  }

  const abrirVinculo = (lineaId) => {
    setVinculandoLineaId(lineaId)
    setModoVinculo('seleccionar')
    setArticuloSeleccionadoVinculo('')
    setNuevoArticuloForm({ codigo_interno: '', descripcion: '', unidad_medida: 'PZA' })
    setError('')
  }

  const cancelarVinculo = () => {
    setVinculandoLineaId(null)
    setArticuloSeleccionadoVinculo('')
  }

  const confirmarVincularExistente = async () => {
    if (!articuloSeleccionadoVinculo) {
      setError('Selecciona un articulo del catalogo')
      return
    }
    const articuloId = parseInt(articuloSeleccionadoVinculo)

    const { error: errorUpdate } = await supabase
      .from('requisicion_lineas')
      .update({ articulo_id: articuloId })
      .eq('id', vinculandoLineaId)

    if (errorUpdate) {
      setError('Error al vincular articulo: ' + errorUpdate.message)
      return
    }

    const articuloInfo = articulosCatalogo.find(a => a.id === articuloId)
    setLineasRequisicion(prev => prev.map(l =>
      l.id === vinculandoLineaId
        ? { ...l, articulo_id: articuloId, articulos: articuloInfo, unidad_medida: articuloInfo?.unidad_medida || l.unidad_medida }
        : l
    ))

    await cargarProveedoresDeArticulo(articuloId, vinculandoLineaId)
    setError('')
    cancelarVinculo()
  }

  const confirmarCrearYVincular = async () => {
    if (!nuevoArticuloForm.codigo_interno || !nuevoArticuloForm.descripcion) {
      setError('Codigo interno y descripcion son obligatorios')
      return
    }

    const { data: nuevoArticulo, error: errorCrear } = await supabase
      .from('articulos')
      .insert({
        empresa_id: perfil.empresa_id,
        codigo_interno: nuevoArticuloForm.codigo_interno.toUpperCase(),
        descripcion: nuevoArticuloForm.descripcion,
        unidad_medida: nuevoArticuloForm.unidad_medida,
        tipo_moneda: 'MXN',
        iva_porcentaje: 16
      })
      .select()
      .single()

    if (errorCrear) {
      setError(errorCrear.message.includes('unique') ? 'El codigo interno ya existe' : 'Error al crear articulo: ' + errorCrear.message)
      return
    }

    setArticulosCatalogo(prev => [...prev, nuevoArticulo])

    const { error: errorUpdate } = await supabase
      .from('requisicion_lineas')
      .update({ articulo_id: nuevoArticulo.id })
      .eq('id', vinculandoLineaId)

    if (errorUpdate) {
      setError('Articulo creado pero error al vincular: ' + errorUpdate.message)
      return
    }

    setLineasRequisicion(prev => prev.map(l =>
      l.id === vinculandoLineaId
        ? { ...l, articulo_id: nuevoArticulo.id, articulos: nuevoArticulo, unidad_medida: nuevoArticulo.unidad_medida }
        : l
    ))

    setArticuloProveedores(prev => ({ ...prev, [vinculandoLineaId]: [] }))
    setError('')
    cancelarVinculo()
  }

  const seleccionarRequisicion = async (req) => {
    setRequisicionSeleccionada(req)
    setLoading(true)

    const { data: solicitanteData } = await supabase
      .from('usuarios')
      .select('id, nombre, rol, gerente_id')
      .eq('id', req.solicitante_id)
      .single()
    setSolicitanteInfo(solicitanteData)

    const { data: lineas } = await supabase
      .from('requisicion_lineas')
      .select('*, articulos(codigo_interno, descripcion, unidad_medida, tipo_moneda, iva_porcentaje), proveedores(nombre)')
      .eq('requisicion_id', req.id)
      .eq('estatus_linea', 'pendiente')

    setLineasRequisicion(lineas || [])
    setLineasSeleccionadas(lineas?.map(l => l.id) || [])

    const provMap = {}
    for (const linea of lineas || []) {
      if (linea.articulo_id) {
        const { data: aps } = await supabase
          .from('articulo_proveedor')
          .select('*, proveedores(nombre)')
          .eq('articulo_id', linea.articulo_id)
          .eq('activo', true)
        provMap[linea.id] = aps || []
      }
    }
    setArticuloProveedores(provMap)

    const provPorLinea = {}
    for (const linea of lineas || []) {
      if (linea.proveedor_sugerido_id) {
        provPorLinea[linea.id] = linea.proveedor_sugerido_id.toString()
      } else if (provMap[linea.id]?.length === 1) {
        provPorLinea[linea.id] = provMap[linea.id][0].proveedor_id.toString()
      } else {
        provPorLinea[linea.id] = ''
      }
    }
    setProveedorPorLinea(provPorLinea)
    setLoading(false)
    setPaso(2)
  }

  const toggleLinea = (lineaId) => {
    setLineasSeleccionadas(prev =>
      prev.includes(lineaId)
        ? prev.filter(id => id !== lineaId)
        : [...prev, lineaId]
    )
  }

  const calcularDescuentoMonto = (linea, precio) => {
    const d = descuentos[linea.id]
    if (!d || !d.valor) return 0
    const importeBase = precio * parseFloat(linea.cantidad)
    if (d.tipo === 'porcentaje') return importeBase * (parseFloat(d.valor) / 100)
    return parseFloat(d.valor) || 0
  }

  const actualizarDescuento = (lineaId, campo, valor) => {
    setDescuentos(prev => ({
      ...prev,
      [lineaId]: { ...(prev[lineaId] || { tipo: 'porcentaje', valor: 0 }), [campo]: valor }
    }))
  }

  const actualizarCotizacion = (provId, campo, valor) => {
    setCotizaciones(prev => ({
      ...prev,
      [provId]: { ...(prev[provId] || { referencia: '', archivo: null }), [campo]: valor }
    }))
  }

  const prepararOrdenes = () => {
    const lineasActivas = lineasRequisicion.filter(l => lineasSeleccionadas.includes(l.id))
    const sinProveedor = lineasActivas.filter(l => !proveedorPorLinea[l.id])
    if (sinProveedor.length > 0) {
      setError('Debes asignar un proveedor a todas las lineas seleccionadas')
      return
    }
    if (!form.fecha_entrega_estimada) {
      setError('La fecha de entrega estimada es obligatoria')
      return
    }
    setError('')

    const agrupadas = {}
    for (const linea of lineasActivas) {
      const provId = proveedorPorLinea[linea.id]
      if (!agrupadas[provId]) {
        const prov = proveedores.find(p => p.id.toString() === provId)
        agrupadas[provId] = { proveedor: prov, lineas: [] }
      }
      const apData = articuloProveedores[linea.id]?.find(ap => ap.proveedor_id.toString() === provId)
      agrupadas[provId].lineas.push({ ...linea, apData })
    }
    setOrdenesAgrupadas(agrupadas)
    setMostrarConfirmacion(true)
  }

  const generarFolioOC = async () => {
    const anio = new Date().getFullYear()
    const codigo = perfil.sites?.codigo || 'GEN'
    const empresa = perfil.empresas?.nombre?.substring(0, 5).toUpperCase() || 'EMP'
    const { count } = await supabase
      .from('ordenes_compra')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', perfil.site_id)
    const consecutivo = String((count || 0) + 1).padStart(4, '0')
    return `OC-${empresa}-${codigo}-${anio}-${consecutivo}`
  }

  const confirmarOrdenes = async () => {
    setLoading(true)
    setError('')

    const esGerenteAlto = ['gerente_planta', 'gerente_administrativo'].includes(solicitanteInfo?.rol)
    const estatusInicial = esGerenteAlto ? 'aprobacion_gerente_planta' : 'aprobacion_gerente_area'
    const aprobadorInicialId = esGerenteAlto
      ? solicitanteInfo.id
      : (requisicionSeleccionada.gerente_area_id || solicitanteInfo?.gerente_id || null)

    for (const [provId, grupo] of Object.entries(ordenesAgrupadas)) {
      const folio = await generarFolioOC()
      const subtotal = grupo.lineas.reduce((sum, l) => {
        const precio = l.apData?.precio || 0
        const importe = precio * parseFloat(l.cantidad)
        return sum + (importe - calcularDescuentoMonto(l, precio))
      }, 0)
      const iva = subtotal * 0.16
      const total = subtotal + iva

      const cot = cotizaciones[provId] || { referencia: '', archivo: null }
      let cotizacionArchivoUrl = null
      if (cot.archivo) {
        const extension = cot.archivo.name.split('.').pop()
        const ruta = `cotizaciones/${folio}-${Date.now()}.${extension}`
        const { error: errorSubida } = await supabase.storage.from('cotizaciones').upload(ruta, cot.archivo)
        if (!errorSubida) {
          const { data: urlData } = supabase.storage.from('cotizaciones').getPublicUrl(ruta)
          cotizacionArchivoUrl = urlData.publicUrl
        }
      }

      const { data: oc, error: errorOC } = await supabase
        .from('ordenes_compra')
        .insert({
          folio,
          tipo: 'con_requisicion',
          empresa_id: perfil.empresa_id,
          site_id: perfil.site_id,
          requisicion_id: requisicionSeleccionada.id,
          proveedor_id: parseInt(provId),
          comprador_id: perfil.id,
          fecha_entrega_estimada: form.fecha_entrega_estimada,
          condiciones_pago: form.condiciones_pago,
          moneda: form.moneda,
          subtotal,
          iva,
          total,
          notas: form.notas,
          referencia_cotizacion: cot.referencia || null,
          cotizacion_archivo_url: cotizacionArchivoUrl,
          estatus: estatusInicial,
          aprobador_actual_id: aprobadorInicialId
        })
        .select()
        .single()

      if (errorOC) {
        setError('Error al crear orden: ' + errorOC.message)
        setLoading(false)
        return
      }

      const lineasOC = grupo.lineas.map(l => {
        const precio = l.apData?.precio || 0
        const montoDescuento = calcularDescuentoMonto(l, precio)
        return {
          oc_id: oc.id,
          requisicion_linea_id: l.id,
          articulo_id: l.articulo_id,
          descripcion: l.articulos?.descripcion || l.descripcion_libre,
          cantidad: parseFloat(l.cantidad),
          unidad_medida: l.unidad_medida,
          precio_unitario: precio,
          descuento: montoDescuento,
          iva_porcentaje: l.articulos?.iva_porcentaje || 16,
          subtotal: (precio * parseFloat(l.cantidad)) - montoDescuento,
          centro_costo_id: l.centro_costo_id,
          cuenta_gasto_id: l.cuenta_gasto_id
        }
      })

      await supabase.from('oc_lineas').insert(lineasOC)

      await supabase.from('requisicion_lineas')
        .update({ estatus_linea: 'en_oc' })
        .in('id', grupo.lineas.map(l => l.id))
    }

    const todasEnOC = lineasRequisicion.every(l => lineasSeleccionadas.includes(l.id))
    if (todasEnOC) {
      await supabase.from('requisiciones')
        .update({ estatus: 'en_proceso' })
        .eq('id', requisicionSeleccionada.id)
    }

    setLoading(false)
    onGuardado()
  }

  if (tipo === 'directa') {
    return <NuevaOrdenDirecta
      onVolver={() => setTipo(null)}
      onGuardado={onGuardado}
    />
  }

  if (tipo === null) {
    return (
      <div style={styles.container}>
        <div style={styles.encabezado}>
          <button style={styles.botonVolver} onClick={onVolver}>
            &larr; Volver a ordenes
          </button>
          <h2 style={styles.titulo}>Nueva orden de compra</h2>
        </div>
        <div style={styles.seleccionTipo}>
          <p style={styles.seleccionTexto}>Selecciona el tipo de orden de compra a generar:</p>
          <div style={styles.tiposGrid}>
            <div style={styles.tarjetaTipo} onClick={() => setTipo('requisicion')}>
              <div style={styles.tarjetaTipoIcono}>REQ</div>
              <p style={styles.tarjetaTipoTitulo}>Con requisicion</p>
              <p style={styles.tarjetaTipoDesc}>Genera una OC a partir de una requisicion aprobada. Sigue el flujo de aprobacion normal.</p>
            </div>
            <div style={styles.tarjetaTipo} onClick={() => setTipo('directa')}>
              <div style={{ ...styles.tarjetaTipoIcono, backgroundColor: '#7c3aed' }}>OCD</div>
              <p style={styles.tarjetaTipoTitulo}>Orden directa</p>
              <p style={styles.tarjetaTipoDesc}>Genera una OC sin requisicion previa. Requiere justificacion y va directo a aprobacion de Direccion.</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (mostrarConfirmacion) {
    return (
      <div style={styles.container}>
        <div style={styles.encabezado}>
          <button style={styles.botonVolver} onClick={() => setMostrarConfirmacion(false)}>
            &larr; Volver a seleccion
          </button>
          <h2 style={styles.titulo}>Confirmar ordenes de compra</h2>
        </div>
        <div style={styles.alertaInfo}>
          Se generaran {Object.keys(ordenesAgrupadas).length} orden(es) de compra agrupadas por proveedor.
        </div>
        {error && <p style={styles.error}>{error}</p>}
        {Object.entries(ordenesAgrupadas).map(([provId, grupo]) => {
          const subtotal = grupo.lineas.reduce((sum, l) => {
            const precio = l.apData?.precio || 0
            const importe = precio * parseFloat(l.cantidad)
            return sum + (importe - calcularDescuentoMonto(l, precio))
          }, 0)
          const cot = cotizaciones[provId] || { referencia: '', archivo: null }
          return (
            <div key={provId} style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Proveedor: {grupo.proveedor?.nombre}</h3>
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 3 }}>Articulo</span>
                  <span style={{ flex: 1 }}>Cantidad</span>
                  <span style={{ flex: 1 }}>Unidad</span>
                  <span style={{ flex: 1 }}>Precio unit.</span>
                  <span style={{ flex: 1.5 }}>Descuento</span>
                  <span style={{ flex: 1 }}>Subtotal</span>
                </div>
                {grupo.lineas.map(l => {
                  const precio = l.apData?.precio || 0
                  const d = descuentos[l.id] || { tipo: 'porcentaje', valor: 0 }
                  const montoDescuento = calcularDescuentoMonto(l, precio)
                  const subtotalLinea = (precio * parseFloat(l.cantidad)) - montoDescuento
                  return (
                    <div key={l.id} style={styles.tablaFila}>
                      <span style={{ flex: 3, fontSize: '13px' }}>
                        {l.articulos?.codigo_interno} - {l.articulos?.descripcion || l.descripcion_libre}
                      </span>
                      <span style={{ flex: 1, fontSize: '13px' }}>{l.cantidad}</span>
                      <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{l.unidad_medida}</span>
                      <span style={{ flex: 1, fontSize: '13px' }}>
                        {precio ? `$${parseFloat(precio).toFixed(2)}` : 'Sin precio'}
                      </span>
                      <span style={{ flex: 1.5, display: 'flex', gap: '4px' }}>
                        <input style={styles.inputDescuento} type="number" min="0" value={d.valor}
                          onChange={e => actualizarDescuento(l.id, 'valor', e.target.value)} />
                        <select style={styles.selectDescuento} value={d.tipo}
                          onChange={e => actualizarDescuento(l.id, 'tipo', e.target.value)}>
                          <option value="porcentaje">%</option>
                          <option value="monto">$</option>
                        </select>
                      </span>
                      <span style={{ flex: 1, fontSize: '13px', fontWeight: '500' }}>
                        {precio ? `$${subtotalLinea.toFixed(2)}` : '-'}
                      </span>
                    </div>
                  )
                })}
                <div style={styles.totalFila}>
                  <span>Subtotal: ${subtotal.toFixed(2)}</span>
                  <span>IVA 16%: ${(subtotal * 0.16).toFixed(2)}</span>
                  <span style={{ fontWeight: '700' }}>Total: ${(subtotal * 1.16).toFixed(2)}</span>
                </div>
              </div>
              <div style={styles.filaCotizacion}>
                <div style={styles.campo}>
                  <label style={styles.label}>Referencia a cotizacion (opcional)</label>
                  <input style={styles.input} value={cot.referencia}
                    onChange={e => actualizarCotizacion(provId, 'referencia', e.target.value)}
                    placeholder="Numero de cotizacion o referencia" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Adjuntar cotizacion (PDF o foto, opcional)</label>
                  <input type="file" accept=".pdf,image/*"
                    onChange={e => actualizarCotizacion(provId, 'archivo', e.target.files[0])} />
                </div>
              </div>
            </div>
          )
        })}
        <div style={styles.botones}>
          <button style={styles.botonSecundario} onClick={() => setMostrarConfirmacion(false)}>Modificar</button>
          <button style={styles.boton} onClick={confirmarOrdenes} disabled={loading}>
            {loading ? 'Generando ordenes...' : 'Confirmar y generar ordenes'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <button style={styles.botonVolver} onClick={() => setTipo(null)}>
          &larr; Volver a seleccion de tipo
        </button>
        <h2 style={styles.titulo}>OC con requisicion</h2>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      {paso === 1 && (
        <div style={styles.seccion}>
          <h3 style={styles.seccionTitulo}>Selecciona la requisicion aprobada</h3>
          {loading ? <p style={{ color: '#666' }}>Cargando...</p>
            : requisiciones.length === 0 ? (
              <div style={styles.alertaInfo}>
                No hay requisiciones aprobadas disponibles. Las requisiciones deben pasar por el flujo de aprobacion completo antes de poder generar una orden de compra.
              </div>
            ) : (
              <div style={styles.tabla}>
                <div style={styles.tablaHeader}>
                  <span style={{ flex: 1.5 }}>Folio</span>
                  <span style={{ flex: 2 }}>Solicitante</span>
                  <span style={{ flex: 1 }}>Site</span>
                  <span style={{ flex: 1 }}>Fecha req.</span>
                  <span style={{ flex: 1 }}>Criticidad</span>
                  <span style={{ flex: 1 }}>Accion</span>
                </div>
                {requisiciones.map(r => (
                  <div key={r.id} style={styles.tablaFila}>
                    <span style={{ flex: 1.5, fontWeight: '600', color: '#2563eb', fontSize: '13px' }}>{r.folio}</span>
                    <span style={{ flex: 2, fontSize: '13px' }}>{r.solicitante?.nombre}</span>
                    <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{r.sites?.codigo}</span>
                    <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>
                      {new Date(r.fecha_requerida).toLocaleDateString('es-MX')}
                    </span>
                    <span style={{ flex: 1 }}>
                      <span style={{ padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '500', backgroundColor: r.criticidad === 'alta' ? '#fef2f2' : r.criticidad === 'media' ? '#fef9c3' : '#f0fdf4', color: r.criticidad === 'alta' ? '#dc2626' : r.criticidad === 'media' ? '#854d0e' : '#16a34a' }}>
                        {r.criticidad?.toUpperCase()}
                      </span>
                    </span>
                    <span style={{ flex: 1 }}>
                      <button style={styles.boton} onClick={() => seleccionarRequisicion(r)}>
                        Seleccionar
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {paso === 2 && requisicionSeleccionada && (
        <>
          <div style={styles.seccion}>
            <h3 style={styles.seccionTitulo}>
              Requisicion: {requisicionSeleccionada.folio} — Selecciona las lineas a ordenar
            </h3>
            <p style={styles.nota}>Puedes seleccionar todas o solo algunas lineas. Se agruparan automaticamente por proveedor.</p>
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 0.5 }}>Sel.</span>
                <span style={{ flex: 3 }}>Articulo</span>
                <span style={{ flex: 1 }}>Cantidad</span>
                <span style={{ flex: 1 }}>Unidad</span>
                <span style={{ flex: 2 }}>Proveedor</span>
              </div>
              {lineasRequisicion.map(linea => (
                <div key={linea.id}>
                  <div style={{ ...styles.tablaFila, backgroundColor: lineasSeleccionadas.includes(linea.id) ? '#f0f9ff' : '#fff' }}>
                    <span style={{ flex: 0.5 }}>
                      <input type="checkbox"
                        checked={lineasSeleccionadas.includes(linea.id)}
                        onChange={() => toggleLinea(linea.id)} />
                    </span>
                    <span style={{ flex: 3, fontSize: '13px' }}>
                      {linea.articulos ? (
                        `${linea.articulos.codigo_interno} - ${linea.articulos.descripcion}`
                      ) : (
                        <span>
                          <span style={{ color: '#dc2626' }}>{linea.descripcion_libre}</span>
                          <br />
                          <button style={styles.botonVincular} onClick={() => abrirVinculo(linea.id)}>
                            Vincular a articulo del catalogo
                          </button>
                        </span>
                      )}
                    </span>
                    <span style={{ flex: 1, fontSize: '13px' }}>{linea.cantidad}</span>
                    <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{linea.unidad_medida}</span>
                    <span style={{ flex: 2 }}>
                      {lineasSeleccionadas.includes(linea.id) && linea.articulo_id && (
                        <select style={styles.inputSmall}
                          value={proveedorPorLinea[linea.id] || ''}
                          onChange={e => setProveedorPorLinea({ ...proveedorPorLinea, [linea.id]: e.target.value })}>
                          <option value="">Selecciona proveedor</option>
                          {(articuloProveedores[linea.id]?.length > 0
                            ? articuloProveedores[linea.id].map(ap => (
                              <option key={ap.proveedor_id} value={ap.proveedor_id}>
                                {ap.proveedores?.nombre} - ${parseFloat(ap.precio).toFixed(2)}
                              </option>
                            ))
                            : proveedores.map(p => (
                              <option key={p.id} value={p.id}>{p.nombre}</option>
                            ))
                          )}
                        </select>
                      )}
                      {lineasSeleccionadas.includes(linea.id) && !linea.articulo_id && (
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>Vincula un articulo primero</span>
                      )}
                    </span>
                  </div>

                  {vinculandoLineaId === linea.id && (
                    <div style={styles.panelVinculo}>
                      <div style={styles.tabsVinculo}>
                        <button
                          style={modoVinculo === 'seleccionar' ? styles.tabVinculoActivo : styles.tabVinculo}
                          onClick={() => setModoVinculo('seleccionar')}>
                          Buscar en catalogo
                        </button>
                        <button
                          style={modoVinculo === 'crear' ? styles.tabVinculoActivo : styles.tabVinculo}
                          onClick={() => setModoVinculo('crear')}>
                          + Crear articulo nuevo
                        </button>
                      </div>

                      {modoVinculo === 'seleccionar' ? (
                        <div style={styles.filaVinculo}>
                          <select style={{ ...styles.input, flex: 2 }}
                            value={articuloSeleccionadoVinculo}
                            onChange={e => setArticuloSeleccionadoVinculo(e.target.value)}>
                            <option value="">Selecciona articulo del catalogo</option>
                            {articulosCatalogo.map(a => (
                              <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>
                            ))}
                          </select>
                          <button style={styles.botonPequeno} onClick={confirmarVincularExistente}>
                            Vincular
                          </button>
                          <button style={styles.botonPequenoSecundario} onClick={cancelarVinculo}>
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <div style={styles.filaVinculo}>
                          <input style={{ ...styles.input, flex: 1 }}
                            value={nuevoArticuloForm.codigo_interno}
                            onChange={e => setNuevoArticuloForm({ ...nuevoArticuloForm, codigo_interno: e.target.value.toUpperCase() })}
                            placeholder="Codigo interno" />
                          <input style={{ ...styles.input, flex: 2 }}
                            value={nuevoArticuloForm.descripcion}
                            onChange={e => setNuevoArticuloForm({ ...nuevoArticuloForm, descripcion: e.target.value })}
                            placeholder="Descripcion" />
                          <select style={{ ...styles.input, flex: 1 }}
                            value={nuevoArticuloForm.unidad_medida}
                            onChange={e => setNuevoArticuloForm({ ...nuevoArticuloForm, unidad_medida: e.target.value })}>
                            {unidades.map(u => <option key={u} value={u}>{u}</option>)}
                          </select>
                          <button style={styles.botonPequeno} onClick={confirmarCrearYVincular}>
                            Crear y vincular
                          </button>
                          <button style={styles.botonPequenoSecundario} onClick={cancelarVinculo}>
                            Cancelar
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={styles.seccion}>
            <h3 style={styles.seccionTitulo}>Datos generales</h3>
            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Fecha entrega estimada *</label>
                <input style={styles.input} type="date" value={form.fecha_entrega_estimada}
                  onChange={e => setForm({ ...form, fecha_entrega_estimada: e.target.value })}
                  min={new Date().toISOString().split('T')[0]} />
              </div>
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
                <label style={styles.label}>Moneda</label>
                <select style={styles.input} value={form.moneda}
                  onChange={e => setForm({ ...form, moneda: e.target.value })}>
                  <option value="MXN">MXN - Peso mexicano</option>
                  <option value="USD">USD - Dolar americano</option>
                  <option value="EUR">EUR - Euro</option>
                </select>
              </div>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Notas</label>
              <textarea style={styles.textarea} value={form.notas}
                onChange={e => setForm({ ...form, notas: e.target.value })}
                placeholder="Instrucciones adicionales..."
                rows={2} />
            </div>
          </div>

          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={() => setPaso(1)}>Atras</button>
            <button style={styles.boton} onClick={prepararOrdenes} disabled={loading}>
              Previsualizar ordenes
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { marginBottom: '20px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '4px 0 0 0' },
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' },
  seleccionTipo: { backgroundColor: '#fff', borderRadius: '10px', padding: '32px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', textAlign: 'center' },
  seleccionTexto: { fontSize: '15px', color: '#444', marginBottom: '24px' },
  tiposGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', maxWidth: '600px', margin: '0 auto' },
  tarjetaTipo: { border: '2px solid #e2e8f0', borderRadius: '10px', padding: '24px', cursor: 'pointer', textAlign: 'left', transition: 'border-color 0.2s' },
  tarjetaTipoIcono: { width: '48px', height: '48px', borderRadius: '10px', backgroundColor: '#2563eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', marginBottom: '12px' },
  tarjetaTipoTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px 0' },
  tarjetaTipoDesc: { fontSize: '13px', color: '#666', margin: '0' },
  seccion: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  seccionTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  nota: { fontSize: '13px', color: '#666', backgroundColor: '#f8fafc', padding: '10px 14px', borderRadius: '7px', marginBottom: '16px' },
  alertaInfo: { backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '7px', padding: '12px 16px', fontSize: '13px', color: '#2563eb', marginBottom: '16px' },
  fila: { display: 'flex', gap: '16px', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  inputSmall: { padding: '6px 10px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px', outline: 'none', width: '100%' },
  textarea: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', resize: 'vertical', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  tabla: { overflowX: 'auto' },
  tablaHeader: { display: 'flex', padding: '10px 16px', backgroundColor: '#f8fafc', borderRadius: '7px', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', marginBottom: '4px' },
  tablaFila: { display: 'flex', padding: '12px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  totalFila: { display: 'flex', justifyContent: 'flex-end', gap: '24px', padding: '12px 16px', backgroundColor: '#f8fafc', fontSize: '13px', borderTop: '2px solid #e2e8f0' },
  inputDescuento: { width: '55px', padding: '5px 6px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '12px' },
  selectDescuento: { padding: '5px 4px', borderRadius: '5px', border: '1px solid #ddd', fontSize: '12px' },
  filaCotizacion: { display: 'flex', gap: '16px', marginTop: '12px' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '9px 20px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonVincular: { padding: '4px 10px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '5px', fontSize: '11px', cursor: 'pointer', marginTop: '4px' },
  botonPequeno: { padding: '8px 16px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', fontWeight: '500' },
  botonPequenoSecundario: { padding: '8px 16px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '6px', fontSize: '13px', cursor: 'pointer' },
  panelVinculo: { backgroundColor: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '14px', margin: '4px 16px 12px 16px' },
  tabsVinculo: { display: 'flex', gap: '8px', marginBottom: '10px' },
  tabVinculo: { padding: '6px 12px', backgroundColor: '#fff', color: '#666', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  tabVinculoActivo: { padding: '6px 12px', backgroundColor: '#2563eb', color: '#fff', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  filaVinculo: { display: 'flex', gap: '8px', alignItems: 'center' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
}                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               