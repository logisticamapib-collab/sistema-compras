import { useState, useEffect } from 'react'
import { exportarExcel, imprimirTablaPDF, imprimirFichaPDF, abrirVentanaFicha, fallaEnVentana } from '../../lib/exportar'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const unidades = ['PZA','KG','LT','MT','CJ','RLL','PAR','JGO','SRV','TON','GR','ML','CM','M2','M3']
const monedas = ['MXN','USD','EUR']

const tiposProceso = [
  { value: 'solo_inyeccion', label: 'Solo Inyeccion' },
  { value: 'solo_ensamble', label: 'Solo Ensamble' },
  { value: 'inyeccion_y_ensamble', label: 'Inyeccion + Ensamble' },
  { value: 'doble_inyeccion', label: 'Doble Inyeccion' },
]

const tiposCategoriaComprado = ['materia_prima', 'empaque', 'servicio', 'toolcrib', 'consumible', 'refaccion', 'otro']
const tiposCategoriaFabricado = ['producto_terminado', 'wip', 'ensamble']

const formVacio = {
  codigo_interno: '', descripcion: '', unidad_medida: 'PZA',
  categoria_id: '', tipo_moneda: 'MXN', iva_porcentaje: 16,
  retencion_iva: 0,
  origen: 'comprado', es_consigna: false,
  lead_time_dias: '', moq: '', tiempo_transito_dias: '', stock_minimo: '', snp: '',
  dias_inventario_seguridad: '', multiplo_lote: '', costo: '',
  tipo_proceso: 'solo_inyeccion', articulo_wip_origen_id: '',
  se_maquila: false, maquilador_id: '', precio_maquila: '',
  peso_pieza_g: '', peso_colada_g: '', peso_purga_g: '',
  pct_scrap_aprobado: 0, admite_molido: false, pct_molido_max: 0,
  site_id: '', sites_destino: [],
  clasificacion_abc: '', abc_criterio: '', color_id: '', variante_codigo_id: '', parte_id: '',
  familia_resina_id: '', tipo_material: '',
}

export default function Articulos() {
  const { perfil, tienePermiso } = useAuth()
  const [articulos, setArticulos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [clientes, setClientes] = useState([])
  const [sites, setSites] = useState([])
  const [sitesDestinoPorArticulo, setSitesDestinoPorArticulo] = useState({})
  const [siteFiltro, setSiteFiltro] = useState('propio')
  const [filtroOrigen, setFiltroOrigen] = useState('todos')
  const [filtroProveedor, setFiltroProveedor] = useState('')
  const [filtroCliente, setFiltroCliente] = useState('')
  const [artProv, setArtProv] = useState({})
  const [artCli, setArtCli] = useState({})
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [articuloEditando, setArticuloEditando] = useState(null)
  const [articuloSeleccionado, setArticuloSeleccionado] = useState(null)
  const [mostrarProveedores, setMostrarProveedores] = useState(false)
  const [mostrarClientes, setMostrarClientes] = useState(false)
  const [busqueda, setBusqueda] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [formProveedor, setFormProveedor] = useState({
    proveedor_id: '', codigo_proveedor: '', precio: '',
    minimo_compra: 1, tiempo_entrega_dias: '', tiempo_trayecto_dias: ''
  })
  const [formCliente, setFormCliente] = useState({ cliente_id: '', codigo_cliente: '', precio: '' })
  const [colores, setColores] = useState([])
  const [variantes, setVariantes] = useState([])
  const [partes, setPartes] = useState([])
  const [familias, setFamilias] = useState([])
  const [form, setForm] = useState(formVacio)

  const puedeCrear = tienePermiso('articulos', 'crear')
  const puedeEditar = tienePermiso('articulos', 'editar')
  const puedeEliminar = tienePermiso('articulos', 'eliminar')
  const puedeVerTodosLosSites = ['admin', 'gerente_compras', 'direccion'].includes(perfil?.rol)

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: a }, { data: c }, { data: p }, { data: cl }, { data: s }, { data: destinos }, { data: cols }, { data: prts }, { data: fams }, { data: vars_ }] = await Promise.all([
      supabase.from('articulos').select('*, categorias(nombre), sites(nombre, codigo)').eq('empresa_id', perfil.empresa_id).order('codigo_interno'),
      supabase.from('categorias').select('*').eq('empresa_id', perfil.empresa_id),
      supabase.from('proveedores').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true),
      supabase.from('clientes').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true),
      supabase.from('sites').select('id, nombre').eq('empresa_id', perfil.empresa_id),
      supabase.from('articulo_sites_destino').select('articulo_id, site_id'),
      supabase.from('colores').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('orden_secuencia'),
      supabase.from('partes').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('clave'),
      supabase.from('familias_resina').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('orden').order('clave'),
      supabase.from('variantes_codigo').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('clave'),
    ])
    setArticulos(a || [])
    setColores(cols || [])
    setVariantes(vars_ || [])
    setPartes(prts || [])
    setFamilias(fams || [])
    setCategorias(c || [])
    setProveedores(p || [])
    setClientes(cl || [])
    setSites(s || [])
    const mapaDestinos = {}
    for (const d of destinos || []) {
      if (!mapaDestinos[d.articulo_id]) mapaDestinos[d.articulo_id] = []
      mapaDestinos[d.articulo_id].push(d.site_id)
    }
    setSitesDestinoPorArticulo(mapaDestinos)
    const [{ data: ap }, { data: ac }] = await Promise.all([
      supabase.from('articulo_proveedor').select('articulo_id, proveedor_id'),
      supabase.from('articulo_cliente').select('articulo_id, cliente_id'),
    ])
    const mp = {}; (ap || []).forEach(x => { (mp[x.articulo_id] = mp[x.articulo_id] || new Set()).add(x.proveedor_id) })
    const mc = {}; (ac || []).forEach(x => { (mc[x.articulo_id] = mc[x.articulo_id] || new Set()).add(x.cliente_id) })
    setArtProv(mp); setArtCli(mc)
    setLoading(false)
  }

  const abrirNuevo = () => {
    setArticuloEditando(null)
    setForm({ ...formVacio, site_id: perfil.site_id?.toString() || '' })
    setMostrarForm(true)
    setError('')
  }

  const abrirEditar = async (articulo) => {
    setArticuloEditando(articulo)
    const { data: destinos } = await supabase.from('articulo_sites_destino').select('site_id').eq('articulo_id', articulo.id)
    setForm({
      codigo_interno: articulo.codigo_interno,
      descripcion: articulo.descripcion,
      unidad_medida: articulo.unidad_medida,
      categoria_id: articulo.categoria_id?.toString() || '',
      tipo_moneda: articulo.tipo_moneda,
      iva_porcentaje: articulo.iva_porcentaje,
      retencion_iva: articulo.retencion_iva,
      origen: articulo.origen || 'comprado',
      es_consigna: articulo.es_consigna || false,
      lead_time_dias: articulo.lead_time_dias ?? '',
      moq: articulo.moq ?? '',
      tiempo_transito_dias: articulo.tiempo_transito_dias ?? '',
      stock_minimo: articulo.stock_minimo ?? '',
      snp: articulo.snp ?? '',
      dias_inventario_seguridad: articulo.dias_inventario_seguridad ?? '',
      multiplo_lote: articulo.multiplo_lote ?? '',
      costo: articulo.costo ?? '',
      tipo_proceso: articulo.tipo_proceso || 'solo_inyeccion',
      se_maquila: articulo.se_maquila || false, maquilador_id: articulo.maquilador_id?.toString() || '', precio_maquila: articulo.precio_maquila ?? '',
      articulo_wip_origen_id: articulo.articulo_wip_origen_id?.toString() || '',
      peso_pieza_g: articulo.peso_pieza_g ?? '',
      peso_colada_g: articulo.peso_colada_g ?? '',
      peso_purga_g: articulo.peso_purga_g ?? '',
      pct_scrap_aprobado: articulo.pct_scrap_aprobado ?? 0,
      admite_molido: articulo.admite_molido || false,
      pct_molido_max: articulo.pct_molido_max ?? 0,
      site_id: articulo.site_id?.toString() || '',
      clasificacion_abc: articulo.clasificacion_abc || '',
      color_id: articulo.color_id?.toString() || '',
      variante_codigo_id: articulo.variante_codigo_id?.toString() || '',
      parte_id: articulo.parte_id?.toString() || '',
      familia_resina_id: articulo.familia_resina_id?.toString() || '',
      tipo_material: articulo.tipo_material || '',
      abc_criterio: articulo.abc_criterio || '',
      sites_destino: (destinos || []).map(d => d.site_id.toString()),
    })
    setMostrarForm(true)
    setError('')
  }

  const cancelarForm = () => {
    setMostrarForm(false)
    setArticuloEditando(null)
    setForm(formVacio)
    setError('')
  }

  const guardarArticulo = async () => {
    if (!form.codigo_interno || !form.descripcion || !form.unidad_medida) {
      setError('Codigo, descripcion y unidad de medida son obligatorios')
      return
    }
    setError('')
    setLoading(true)

    const esFabricado = form.origen === 'fabricado'
    const esDerivadoMolino = form.tipo_material === 'molido' || form.tipo_material === 'barredura'
    const esPieza = esFabricado && !esDerivadoMolino
    const llevaResina = !esFabricado || esDerivadoMolino
    // Sin criterio explicito, cada tipo de articulo toma el suyo: el fabricado
    // se mide por lo que se le embarco al cliente y el comprado por el dinero
    // que amarra en almacen. 'manual' es una palanca para forzar un numero de
    // parte, no un valor de arranque: mientras diga manual y no tenga clase,
    // el ciclico lo cuenta como C, o sea lo menos posible.
    const criterioABC = form.abc_criterio || (esFabricado ? 'piezas' : 'costo')

    const payload = {
      codigo_interno: form.codigo_interno,
      descripcion: form.descripcion,
      unidad_medida: form.unidad_medida,
      categoria_id: form.categoria_id ? parseInt(form.categoria_id) : null,
      tipo_moneda: form.tipo_moneda,
      iva_porcentaje: parseFloat(form.iva_porcentaje),
      retencion_iva: parseFloat(form.retencion_iva),
      origen: form.origen,
      es_consigna: !esFabricado ? form.es_consigna : false,
      lead_time_dias: !esFabricado && form.lead_time_dias !== '' ? parseInt(form.lead_time_dias) : 0,
      moq: !esFabricado && form.moq !== '' ? parseFloat(form.moq) : 0,
      tiempo_transito_dias: !esFabricado && form.tiempo_transito_dias !== '' ? parseInt(form.tiempo_transito_dias) : 0,
      stock_minimo: form.stock_minimo !== '' ? parseFloat(form.stock_minimo) : 0,
      snp: form.snp !== '' ? parseFloat(form.snp) : 0,
      dias_inventario_seguridad: form.dias_inventario_seguridad !== '' ? parseFloat(form.dias_inventario_seguridad) : 0,
      multiplo_lote: form.multiplo_lote !== '' ? parseFloat(form.multiplo_lote) : 0,
      costo: form.costo !== '' ? parseFloat(form.costo) : 0,
      tipo_proceso: esFabricado ? form.tipo_proceso : null,
      se_maquila: esFabricado ? !!form.se_maquila : false,
      maquilador_id: esFabricado && form.se_maquila && form.maquilador_id ? parseInt(form.maquilador_id) : null,
      precio_maquila: esFabricado && form.se_maquila && form.precio_maquila !== '' ? parseFloat(form.precio_maquila) : null,
      articulo_wip_origen_id: esFabricado && form.articulo_wip_origen_id ? parseInt(form.articulo_wip_origen_id) : null,
      peso_pieza_g: esFabricado && form.peso_pieza_g !== '' ? parseFloat(form.peso_pieza_g) : null,
      peso_colada_g: esFabricado && form.peso_colada_g !== '' ? parseFloat(form.peso_colada_g) : null,
      peso_purga_g: esFabricado && form.peso_purga_g !== '' ? parseFloat(form.peso_purga_g) : null,
      pct_scrap_aprobado: esFabricado ? (parseFloat(form.pct_scrap_aprobado) || 0) : 0,
      admite_molido: esFabricado ? form.admite_molido : false,
      pct_molido_max: esFabricado && form.admite_molido ? (parseFloat(form.pct_molido_max) || 0) : 0,
      site_id: form.site_id ? parseInt(form.site_id) : null,
      clasificacion_abc: form.clasificacion_abc || null,
      // Color y parte equivalente describen una PIEZA moldeada: no aplican a
      // una resina comprada ni al molido. La familia de resina es al reves,
      // describe el MATERIAL: va en la resina y en sus derivados de molino,
      // no en la pieza, cuyo material sale de su lista de materiales.
      color_id: esPieza && form.color_id ? parseInt(form.color_id) : null,
      variante_codigo_id: esPieza && form.variante_codigo_id ? parseInt(form.variante_codigo_id) : null,
      parte_id: esPieza && form.parte_id ? parseInt(form.parte_id) : null,
      familia_resina_id: llevaResina && form.familia_resina_id ? parseInt(form.familia_resina_id) : null,
      abc_criterio: criterioABC,
    }

    let error, articuloId
    if (articuloEditando) {
      const resultado = await supabase.from('articulos').update(payload).eq('id', articuloEditando.id)
      error = resultado.error
      articuloId = articuloEditando.id
    } else {
      const resultado = await supabase.from('articulos').insert({ ...payload, empresa_id: perfil.empresa_id, costo_inicial: form.costo !== '' ? parseFloat(form.costo) : 0 }).select().single()
      error = resultado.error
      articuloId = resultado.data?.id
    }

    if (error) {
      setError(error.message.includes('unique') ? 'El codigo interno ya existe' : error.message)
      setLoading(false)
      return
    }

    // Sincronizar sites de destino (transferencia interplanta) solo si es fabricado
    if (articuloId) {
      await supabase.from('articulo_sites_destino').delete().eq('articulo_id', articuloId)
      if (esFabricado && form.sites_destino.length > 0) {
        await supabase.from('articulo_sites_destino').insert(
          form.sites_destino.map(sid => ({ articulo_id: articuloId, site_id: parseInt(sid) }))
        )
      }
    }

    setExito(articuloEditando ? 'Articulo actualizado correctamente' : 'Articulo guardado correctamente')
    cancelarForm()
    await cargarDatos()
    setLoading(false)
    setTimeout(() => setExito(''), 3000)
  }

  // Revisa si el articulo tiene algun movimiento asociado (requisiciones, ordenes de compra o precios de proveedor).
  // Si tiene movimientos, solo se puede desactivar, nunca borrar.
  const tieneMovimientos = async (articuloId) => {
    const [{ count: c1 }, { count: c2 }, { count: c3 }] = await Promise.all([
      supabase.from('requisicion_lineas').select('id', { count: 'exact', head: true }).eq('articulo_id', articuloId),
      supabase.from('oc_lineas').select('id', { count: 'exact', head: true }).eq('articulo_id', articuloId),
      supabase.from('articulo_proveedor').select('id', { count: 'exact', head: true }).eq('articulo_id', articuloId)
    ])
    return (c1 || 0) > 0 || (c2 || 0) > 0 || (c3 || 0) > 0
  }

  const eliminarArticulo = async (articulo) => {
    setError('')
    const tieneMov = await tieneMovimientos(articulo.id)

    if (tieneMov) {
      setError(`"${articulo.codigo_interno}" ya tiene movimientos asociados (requisiciones, ordenes de compra o proveedores). No se puede eliminar, solo desactivar.`)
      return
    }

    if (!confirm(`Seguro que deseas eliminar permanentemente "${articulo.codigo_interno}"? Esta accion no se puede deshacer.`)) return

    const { error } = await supabase.from('articulos').delete().eq('id', articulo.id)
    if (error) {
      setError('Error al eliminar: ' + error.message)
      return
    }
    setExito('Articulo eliminado correctamente')
    await cargarDatos()
    setTimeout(() => setExito(''), 3000)
  }

  const abrirProveedores = async (articulo) => {
    setArticuloSeleccionado(articulo)
    setMostrarProveedores(true)
  }

  const abrirClientes = async (articulo) => {
    setArticuloSeleccionado(articulo)
    setMostrarClientes(true)
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

  const guardarClienteArticulo = async () => {
    if (!formCliente.cliente_id) {
      setError('El cliente es obligatorio')
      return
    }
    setError('')

    const { error } = await supabase.from('articulo_cliente').insert({
      articulo_id: articuloSeleccionado.id,
      cliente_id: parseInt(formCliente.cliente_id),
      codigo_cliente: formCliente.codigo_cliente,
      precio: formCliente.precio ? parseFloat(formCliente.precio) : null,
    })

    if (error) {
      setError(error.message.includes('unique') ? 'Este cliente ya esta asignado al articulo' : error.message)
      return
    }

    setExito('Cliente asignado correctamente')
    setFormCliente({ cliente_id: '', codigo_cliente: '', precio: '' })
    setTimeout(() => setExito(''), 3000)
  }

  const toggleActivo = async (a) => {
    await supabase.from('articulos').update({ activo: !a.activo }).eq('id', a.id)
    await cargarDatos()
  }

  const articulosFiltrados = articulos.filter(a => {
    const matchBusqueda = a.codigo_interno.toLowerCase().includes(busqueda.toLowerCase()) ||
      a.descripcion.toLowerCase().includes(busqueda.toLowerCase())
    if (!matchBusqueda) return false
    if (filtroOrigen !== 'todos' && a.origen !== filtroOrigen) return false
    if (filtroProveedor && !(artProv[a.id] && artProv[a.id].has(Number(filtroProveedor)))) return false
    if (filtroCliente && !(artCli[a.id] && artCli[a.id].has(Number(filtroCliente)))) return false

    if (puedeVerTodosLosSites) {
      return siteFiltro === 'todos' || (siteFiltro === 'propio' ? true : a.site_id?.toString() === siteFiltro)
    }
    // Usuario normal: solo su site, articulos compartidos (sin site), o donde su site sea destino de transferencia
    return !a.site_id || a.site_id === perfil.site_id || (sitesDestinoPorArticulo[a.id] || []).includes(perfil.site_id)
  })

  // ---------------- Ficha del articulo ----------------
  //
  // Junta en un solo papel lo que hoy vive repartido en seis pantallas: de que
  // molde sale, en que maquina corre, su ruta, su lista de materiales, como se
  // empaca, a quien se le vende y con que otros codigos es intercambiable.
  //
  // Cubre la FAMILIA completa, no solo el codigo: si de ese disparo salen la
  // izquierda y la derecha, las dos van en la misma ficha, porque en el piso se
  // corren juntas y separarlas obliga a imprimir dos papeles de una sola
  // corrida.
  //
  // Los datos se consultan al momento en vez de cargarlos con la pantalla: son
  // siete consultas que casi nunca se ocupan y encarecerian cada entrada al
  // modulo.
  const imprimirFichaArticulo = async (art) => {
    // La ventana se abre AQUI, dentro del clic. Abrirla despues de esperar las
    // consultas la bloquea el navegador por no venir de un gesto del usuario.
    const w = abrirVentanaFicha(`Preparando la ficha de ${art.codigo_interno}...`)
    if (!w) return

    try {
      // 1) El molde del articulo y todas las cavidades de ese molde: de ahi
      //    sale la familia y cuantas piezas entrega cada disparo.
      const { data: cavPropias } = await supabase
        .from('molde_cavidades').select('molde_id').eq('articulo_id', art.id).limit(1)
      const moldeId = cavPropias?.[0]?.molde_id || null

      let cavMolde = []
      let molde = null
      if (moldeId) {
        const [rCav, rMol] = await Promise.all([
          supabase.from('molde_cavidades').select('*').eq('molde_id', moldeId).order('numero_cavidad'),
          supabase.from('moldes').select('*, site:sites(nombre), maq:maquinas(clave, nombre)').eq('id', moldeId).maybeSingle(),
        ])
        cavMolde = rCav.data || []
        molde = rMol.data || null
      }

      // 2) Familia del disparo: mismo molde, mismo color, misma variante.
      const idsMolde = [...new Set(cavMolde.filter(c => c.articulo_id).map(c => c.articulo_id))]
      let artsMolde = []
      if (idsMolde.length) {
        const { data } = await supabase.from('articulos')
          .select('id, codigo_interno, descripcion, color_id, variante_codigo_id, parte_id, unidad_medida')
          .in('id', idsMolde)
        artsMolde = data || []
      }
      const mismo = (x, y) => (x ?? null) === (y ?? null)
      const familia = idsMolde.length
        ? artsMolde.filter(x => mismo(x.color_id, art.color_id) && mismo(x.variante_codigo_id, art.variante_codigo_id))
        : [{ id: art.id, codigo_interno: art.codigo_interno, descripcion: art.descripcion, parte_id: art.parte_id }]
      const idsFam = familia.map(x => x.id)
      const cavDe = (aid) => cavMolde.filter(c => c.articulo_id === aid && c.activa !== false).length

      // 3) Todo lo que cuelga de la familia. El orden de las variables sigue el
      //    orden de las consultas.
      // Consultas planas y los nombres se resuelven en JS, como en el resto
      // del sistema. Los embebidos de PostgREST se vuelven ambiguos en cuanto
      // una tabla tiene dos llaves al mismo destino -- bom apunta dos veces a
      // articulos y la solicitud de maquina alterna dos veces a maquinas -- y
      // ese error solo se ve en tiempo de ejecucion.
      // El orden de las variables sigue el orden de las consultas.
      const [rRutas, rBom, rNormas, rCli, rAlt, rEquiv, rMaq] = await Promise.all([
        supabase.from('rutas_fabricacion').select('*').in('articulo_id', idsFam).order('secuencia'),
        supabase.from('bom').select('*').in('articulo_padre_id', idsFam),
        supabase.from('normas_empaque').select('*').in('articulo_id', idsFam),
        supabase.from('articulo_cliente').select('*').in('articulo_id', idsFam),
        supabase.from('solicitudes_maquina_alterna').select('*')
          .in('articulo_id', idsFam).eq('registrar_como_alterna', true).eq('estatus', 'aprobada'),
        art.parte_id
          ? supabase.from('articulos').select('id, codigo_interno, descripcion').eq('parte_id', art.parte_id)
          : Promise.resolve({ data: [] }),
        supabase.from('maquinas').select('id, clave, nombre').eq('empresa_id', perfil.empresa_id),
      ])
      const maquinas = rMaq.data || []
      const nomMaq = (id) => maquinas.find(m => m.id === id)
      const nomArt = (id) => articulos.find(x => x.id === id) || artsMolde.find(x => x.id === id)
      const nomCli = (id) => clientes.find(c => c.id === id)

      // Variantes de codigo hermanas: mismo molde, otras corridas.
      const hermanas = new Map()
      artsMolde.filter(x => !idsFam.includes(x.id)).forEach(x => {
        const k = `${x.color_id ?? 'sc'}|${x.variante_codigo_id ?? 'sv'}`
        if (!hermanas.has(k)) hermanas.set(k, { color_id: x.color_id, variante_codigo_id: x.variante_codigo_id, codigos: [] })
        hermanas.get(k).codigos.push(`${x.codigo_interno} (${cavDe(x.id)} cav)`)
      })

      const cod = (id) => articulos.find(x => x.id === id)?.codigo_interno || familia.find(x => x.id === id)?.codigo_interno || id
      const nomColor = (id) => colores.find(c => c.id === id)?.clave || ''
      const nomVar = (id) => variantes.find(v => v.id === id)?.clave || ''
      const parte = partes.find(pp => pp.id === art.parte_id)
      const varios = familia.length > 1
      const colArt = varios ? [{ label: 'Articulo', get: r => cod(r.articulo_id ?? r.articulo_padre_id) }] : []

      imprimirFichaPDF(
        `Articulo ${art.codigo_interno}`,
        art.descripcion,
        [
          ['Codigo', art.codigo_interno],
          ['Descripcion', art.descripcion],
          ['Categoria', art.categorias?.nombre || '-'],
          ['Origen', art.origen], ['Unidad', art.unidad_medida],
          ['Tipo de proceso', art.tipo_proceso || '-'],
          ['Color', nomColor(art.color_id) || '-'],
          ['Variante de codigo', nomVar(art.variante_codigo_id) || '-'],
          ['Parte equivalente', parte ? parte.clave : '-'],
          ['Familia de resina', familias.find(f => f.id === art.familia_resina_id)?.clave || '-'],
          ['Planta', art.sites?.nombre || 'Compartido'],
          ['Costo estandar', `${art.tipo_moneda || ''} ${art.costo ?? 0}`],
          ['Peso pieza / colada (g)', `${art.peso_pieza_g ?? '-'} / ${art.peso_colada_g ?? '-'}`],
          ['Scrap aprobado', `${art.pct_scrap_aprobado ?? 0}%`],
          ['Admite molido', art.admite_molido ? `si, hasta ${art.pct_molido_max ?? 0}%` : 'no'],
          ['SNP / stock minimo', `${art.snp ?? 0} / ${art.stock_minimo ?? 0}`],
          ['Clasificacion ABC', art.clasificacion_abc || '-'],
          ['Estatus', art.activo ? 'Activo' : 'Inactivo'],
        ],
        [
          {
            titulo: molde ? `Molde ${molde.clave} — que sale de cada disparo` : 'Molde',
            columnas: [
              { label: 'Articulo', get: r => r.codigo_interno },
              { label: 'Descripcion', get: r => r.descripcion },
              { label: 'Color', get: r => nomColor(r.color_id) },
              { label: 'Variante', get: r => nomVar(r.variante_codigo_id) },
              { label: 'Cavidades', get: r => cavDe(r.id) },
              { label: 'Piezas por disparo', get: r => cavDe(r.id) },
            ],
            filas: moldeId ? familia : [],
            vacio: 'Este articulo no tiene molde ni cavidades asignadas.',
          },
          {
            titulo: 'Otras corridas del mismo molde',
            columnas: [
              { label: 'Color', get: r => nomColor(r.color_id) || 'sin color' },
              { label: 'Variante', get: r => nomVar(r.variante_codigo_id) || 'sin variante' },
              { label: 'Codigos', get: r => r.codigos.join(', ') },
            ],
            filas: [...hermanas.values()],
            vacio: 'El molde no corre otros colores ni otras variantes de codigo.',
          },
          {
            titulo: 'Ruta de fabricacion',
            columnas: [
              ...colArt,
              { label: 'Sec', get: r => r.secuencia },
              { label: 'Operacion', get: r => r.tipo_operacion },
              { label: 'Maquina', get: r => nomMaq(r.maquina_principal_id)?.clave || '' },
              { label: 'Molde', get: r => r.molde_id === moldeId ? (molde?.clave || '') : '' },
              { label: 'Personal', get: r => r.personal_requerido },
              { label: 'Tiempo est. (seg)', get: r => r.tiempo_estandar_seg },
            ],
            filas: rRutas.data || [],
            vacio: 'Sin ruta capturada. Sin tiempo estandar no hay plan de maquina ni costo.',
          },
          {
            titulo: 'Maquinas alternas aprobadas',
            columnas: [
              ...colArt,
              { label: 'Maquina', get: r => nomMaq(r.maquina_solicitada_id)?.clave || '' },
              { label: 'Nombre', get: r => nomMaq(r.maquina_solicitada_id)?.nombre || '' },
              { label: 'Aprobada por cliente', get: r => r.aprobada_por_cliente ? 'si' : 'no' },
              { label: 'Vigencia', get: r => r.doc_vigencia || '-' },
            ],
            filas: rAlt.data || [],
            vacio: 'Solo puede correr en su maquina principal.',
          },
          {
            titulo: 'Lista de materiales',
            columnas: [
              ...(varios ? [{ label: 'Articulo', get: r => cod(r.articulo_padre_id) }] : []),
              { label: 'Componente', get: r => nomArt(r.componente_articulo_id)?.codigo_interno || '' },
              { label: 'Descripcion', get: r => nomArt(r.componente_articulo_id)?.descripcion || '' },
              { label: 'Tipo', get: r => r.tipo_componente },
              { label: 'Cantidad por pieza', get: r => r.cantidad_por_unidad },
              { label: 'Unidad', get: r => r.unidad_medida },
            ],
            filas: rBom.data || [],
            vacio: 'Sin lista de materiales.',
          },
          {
            titulo: 'Normas de empaque',
            columnas: [
              ...colArt,
              { label: 'Norma', get: r => r.nombre },
              { label: 'Tipo', get: r => r.tipo },
              { label: 'Piezas por empaque', get: r => r.piezas_por_empaque },
              { label: 'Piezas por tarima', get: r => r.piezas_por_tarima },
              { label: 'Aprobada por cliente', get: r => r.aprobada_cliente ? 'si' : 'no' },
              { label: 'Vigente', get: r => r.activa ? 'si' : 'no' },
            ],
            filas: rNormas.data || [],
            vacio: 'Sin norma de empaque capturada.',
          },
          {
            titulo: 'Clientes',
            columnas: [
              ...colArt,
              { label: 'Cliente', get: r => nomCli(r.cliente_id)?.nombre || '' },
              { label: 'Codigo del cliente', get: r => r.codigo_cliente || '' },
              { label: 'Precio', get: r => r.precio },
              { label: 'Vigente', get: r => r.activo ? 'si' : 'no' },
            ],
            filas: rCli.data || [],
            vacio: 'Sin clientes asignados.',
          },
          {
            titulo: parte ? `Partes equivalentes — ${parte.clave}` : 'Partes equivalentes',
            columnas: [
              { label: 'Codigo', get: r => r.codigo_interno },
              { label: 'Descripcion', get: r => r.descripcion },
              { label: 'Es este', get: r => r.id === art.id ? 'si' : '' },
            ],
            filas: (rEquiv.data || []),
            vacio: 'Este codigo no tiene equivalentes: se planea y se surte solo.',
          },
        ],
        w,
      )
    } catch (e) {
      fallaEnVentana(w, 'No se pudo armar la ficha: ' + (e?.message || e))
    }
  }

  const colsArt = [{ label: 'Codigo', get: a => a.codigo_interno }, { label: 'Descripcion', get: a => a.descripcion }, { label: 'Categoria', get: a => a.categorias?.nombre || '' }, { label: 'Tipo', get: a => a.origen }, { label: 'Unidad', get: a => a.unidad_medida }, { label: 'Moneda', get: a => a.tipo_moneda }, { label: 'Costo', get: a => a.costo }, { label: 'Site', get: a => a.sites?.nombre || 'Compartido' }, { label: 'Estatus', get: a => a.activo ? 'Activo' : 'Inactivo' }]

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

  if (mostrarClientes && articuloSeleccionado) {
    return <VistaClientesArticulo
      articulo={articuloSeleccionado}
      clientes={clientes}
      formCliente={formCliente}
      setFormCliente={setFormCliente}
      guardarClienteArticulo={guardarClienteArticulo}
      error={error}
      exito={exito}
      onVolver={() => { setMostrarClientes(false); setArticuloSeleccionado(null); setError(''); setExito('') }}
    />
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Articulos</h2>
        {puedeCrear && (
          <button style={styles.boton} onClick={() => mostrarForm ? cancelarForm() : abrirNuevo()}>
            {mostrarForm ? 'Cancelar' : '+ Nuevo articulo'}
          </button>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {mostrarForm && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>{articuloEditando ? `Editando: ${articuloEditando.codigo_interno}` : 'Nuevo articulo'}</h3>

          <div style={styles.origenBox}>
            <label style={styles.label}>Origen del articulo *</label>
            <div style={styles.origenOpciones}>
              <button type="button"
                style={form.origen === 'comprado' ? styles.origenBotonActivo : styles.origenBoton}
                onClick={() => setForm({ ...form, origen: 'comprado' })}>
                Comprado / Consigna
              </button>
              <button type="button"
                style={form.origen === 'fabricado' ? styles.origenBotonActivo : styles.origenBoton}
                onClick={() => setForm({ ...form, origen: 'fabricado', categoria_id: '' })}>
                Fabricado (se inyecta y/o ensambla)
              </button>
            </div>
            {form.origen === 'comprado' && (
              <div style={styles.filaCheckbox}>
                <input type="checkbox" id="esConsigna" checked={form.es_consigna}
                  onChange={e => setForm({ ...form, es_consigna: e.target.checked })} />
                <label htmlFor="esConsigna" style={styles.labelCheckbox}>
                  Es material a consigna (el cliente lo suministra, sin costo)
                </label>
              </div>
            )}
          </div>

          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Site *</label>
              <select style={styles.input} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value })}>
                <option value="">Selecciona el site (o vacio si es compartido entre todos)</option>
                {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
              </select>
            </div>
          </div>

          {form.origen === 'fabricado' && sites.length > 1 && (
            <div style={styles.transferenciaBox}>
              <label style={styles.label}>Se transfiere/usa como componente en estos otros sites (opcional)</label>
              <p style={styles.transferenciaDesc}>
                Marca los sites donde este producto terminado se recibe como materia prima/componente para otro proceso.
              </p>
              <div style={styles.transferenciaOpciones}>
                {sites.filter(s => s.id.toString() !== form.site_id).map(s => (
                  <label key={s.id} style={styles.checkboxTransferencia}>
                    <input type="checkbox"
                      checked={form.sites_destino.includes(s.id.toString())}
                      onChange={e => {
                        const marcado = e.target.checked
                        setForm({
                          ...form,
                          sites_destino: marcado
                            ? [...form.sites_destino, s.id.toString()]
                            : form.sites_destino.filter(x => x !== s.id.toString())
                        })
                      }} />
                    {s.nombre}
                  </label>
                ))}
              </div>
            </div>
          )}

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
                {categorias
                  .filter(c => (form.origen === 'fabricado' ? tiposCategoriaFabricado : tiposCategoriaComprado).includes(c.tipo))
                  .map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
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

          {/* Color y parte equivalente describen una pieza moldeada. Una resina
              comprada no tiene "color de molde" ni "parte equivalente", asi que
              estos campos solo salen cuando el articulo es fabricado, y no en el
              molido ni en la barredura, que son subproductos de material. */}
          {form.origen === 'fabricado' && form.tipo_material !== 'molido' && form.tipo_material !== 'barredura' && (
            <>
              <h3 style={{ ...styles.formTitulo, marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                Identificacion de la pieza
              </h3>
              <div style={styles.fila}>
                <div style={styles.campo}>
                  <label style={styles.label}>Color</label>
                  <select style={styles.input} value={form.color_id}
                    onChange={e => setForm({ ...form, color_id: e.target.value })}>
                    <option value="">Sin color / no aplica</option>
                    {colores.map(c => <option key={c.id} value={c.id}>{c.clave} - {c.nombre}</option>)}
                  </select>
                  <span style={styles.ayudaCampo}>
                    Si dos articulos comparten molde pero tienen distinto color, el sistema los corre por
                    separado con purga entre ellos, no como co-productos del mismo disparo.
                  </span>
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Variante de codigo</label>
                  <select style={styles.input} value={form.variante_codigo_id}
                    onChange={e => setForm({ ...form, variante_codigo_id: e.target.value })}>
                    <option value="">Sin variante / no aplica</option>
                    {variantes.map(v => <option key={v.id} value={v.id}>{v.clave} - {v.nombre}</option>)}
                  </select>
                  <span style={styles.ayudaCampo}>
                    Solo si el cliente pide esta MISMA pieza con otro codigo porque la manda a otro pais o
                    plataforma. Distingue corridas que comparten molde y color pero se programan aparte.
                    A diferencia del color, cambiar de codigo no cuesta purga.
                  </span>
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Parte equivalente</label>
                  <select style={styles.input} value={form.parte_id}
                    onChange={e => setForm({ ...form, parte_id: e.target.value })}>
                    <option value="">Sin parte / codigo unico</option>
                    {partes.map(x => <option key={x.id} value={x.id}>{x.clave}{x.nombre ? ` - ${x.nombre}` : ''}</option>)}
                  </select>
                  <span style={styles.ayudaCampo}>
                    Agrupa codigos que son la misma pieza aunque salgan de moldes distintos. El inventario se
                    ve junto, el FIFO cruza los dos codigos y se puede surtir un pedido con cualquiera.
                  </span>
                </div>
              </div>
            </>
          )}

          {/* La familia de resina es al reves: describe el MATERIAL, no la pieza.
              Va en la resina que se compra y en su molido y barredura. Una pieza
              fabricada no la lleva porque su material sale de su lista de
              materiales, y ponersela a mano abriria la puerta a que se
              contradigan. */}
          {(form.origen !== 'fabricado' || form.tipo_material === 'molido' || form.tipo_material === 'barredura') && (
            <>
              <h3 style={{ ...styles.formTitulo, marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                Material base
              </h3>
              <div style={styles.fila}>
                <div style={styles.campo}>
                  <label style={styles.label}>Familia de resina</label>
                  <select style={styles.input} value={form.familia_resina_id}
                    onChange={e => setForm({ ...form, familia_resina_id: e.target.value })}>
                    <option value="">Sin asignar</option>
                    {familias.map(f => <option key={f.id} value={f.id}>{f.clave} - {f.nombre}</option>)}
                  </select>
                  <span style={styles.ayudaCampo}>
                    Polipropileno, poliamida, ABS. Es lo que permite ver el molino por tipo de resina sin
                    importar de que pieza vino. Capturala aqui en la resina virgen: su molido y su
                    barredura la heredan solos.
                  </span>
                </div>
                <div style={{ ...styles.campo, flex: 2 }} />
              </div>
            </>
          )}

          {/* El conteo ciclico aplica a todo lo que tiene existencia, no solo a
              lo comprado. Un producto terminado sin clase caia a C por omision
              y se contaba cada 180 dias, que para lo que se le embarca al
              cliente es justo al reves de lo que conviene. */}
          <h3 style={{ ...styles.formTitulo, marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
            Conteo ciclico
          </h3>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Clasificacion ABC</label>
              <select style={styles.input} value={form.clasificacion_abc}
                onChange={e => setForm({ ...form, clasificacion_abc: e.target.value })}>
                <option value="">Sin clasificar (se cuenta como C)</option>
                <option value="A">A - alta rotacion / valor</option>
                <option value="B">B - media</option>
                <option value="C">C - baja</option>
              </select>
              <span style={styles.ayudaCampo}>
                Define cada cuantos dias toca contarlo. Los dias de cada clase se configuran en
                Inventario Ciclico y son los mismos para materia prima y para producto terminado.
              </span>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Criterio ABC</label>
              <select style={styles.input}
                value={form.abc_criterio || (form.origen === 'fabricado' ? 'piezas' : 'costo')}
                onChange={e => setForm({ ...form, abc_criterio: e.target.value })}>
                <option value="piezas">Por piezas embarcadas</option>
                <option value="costo">Por costo (valor de consumo)</option>
                <option value="manual">Manual (lo fijo yo)</option>
              </select>
              <span style={styles.ayudaCampo}>
                Con piezas o costo, el recalculo del Pareto le asigna la clase solo. Con
                <b> manual</b> nadie se la mueve, para cuando quieras forzar un numero de parte a
                contarse mas seguido por alguna situacion en particular.
              </span>
            </div>
            <div style={{ ...styles.campo, flex: 1 }} />
          </div>

          {form.origen === 'comprado' && (
            <>
              <h3 style={{ ...styles.formTitulo, marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                Datos de abastecimiento (planeacion MRP)
              </h3>
              <div style={styles.fila}>
                <div style={styles.campo}>
                  <label style={styles.label}>Lead time (dias)</label>
                  <input style={styles.input} type="number" min="0" value={form.lead_time_dias}
                    onChange={e => setForm({ ...form, lead_time_dias: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>MOQ (minimo de compra)</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.moq}
                    onChange={e => setForm({ ...form, moq: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Tiempo de transito (dias)</label>
                  <input style={styles.input} type="number" min="0" value={form.tiempo_transito_dias}
                    onChange={e => setForm({ ...form, tiempo_transito_dias: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Stock minimo (alerta)</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.stock_minimo}
                    onChange={e => setForm({ ...form, stock_minimo: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>SNP (cantidad por empaque)</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.snp}
                    onChange={e => setForm({ ...form, snp: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Dias de inventario de seguridad</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.dias_inventario_seguridad}
                    onChange={e => setForm({ ...form, dias_inventario_seguridad: e.target.value })} placeholder="0 = usa politica del grupo" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Multiplo de lote</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.multiplo_lote}
                    onChange={e => setForm({ ...form, multiplo_lote: e.target.value })} placeholder="0 = usa MOQ" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Costo unitario inicial</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.costo}
                    onChange={e => setForm({ ...form, costo: e.target.value })} placeholder="0.00 (se actualiza con compras)" />
                </div>
              </div>
            </>
          )}

          {form.origen === 'fabricado' && (
            <>
              <div style={styles.fila}>
                <div style={styles.campo}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '13px', color: '#334155' }}>
                    <input type="checkbox" checked={!!form.se_maquila} onChange={e => setForm({ ...form, se_maquila: e.target.checked })} />
                    Se maquila (subcontratado): el MRP lo programa como maquila (OC al maquilador) en vez de OT interna
                  </label>
                </div>
                {form.se_maquila && (
                  <div style={styles.campo}>
                    <label style={styles.label}>Maquilador</label>
                    <select style={styles.input} value={form.maquilador_id} onChange={e => setForm({ ...form, maquilador_id: e.target.value })}>
                      <option value="">Selecciona...</option>
                      {proveedores.filter(p => p.es_maquilador).map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
                    </select>
                  </div>
                )}
                {form.se_maquila && (
                  <div style={styles.campo}>
                    <label style={styles.label}>Precio de compra (maquila)</label>
                    <input style={styles.input} type="number" step="0.0001" value={form.precio_maquila} onChange={e => setForm({ ...form, precio_maquila: e.target.value })} placeholder="Precio unitario al maquilador" />
                  </div>
                )}
              </div>
              <h3 style={{ ...styles.formTitulo, marginTop: '24px', paddingTop: '20px', borderTop: '1px solid #f1f5f9' }}>
                Datos de Ingenieria
              </h3>
              <div style={styles.fila}>
                <div style={styles.campo}>
                  <label style={styles.label}>Tipo de proceso</label>
                  <select style={styles.input} value={form.tipo_proceso}
                    onChange={e => setForm({ ...form, tipo_proceso: e.target.value })}>
                    {tiposProceso.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
                {['inyeccion_y_ensamble', 'doble_inyeccion'].includes(form.tipo_proceso) && (
                  <div style={styles.campo}>
                    <label style={styles.label}>Articulo WIP de origen</label>
                    <select style={styles.input} value={form.articulo_wip_origen_id}
                      onChange={e => setForm({ ...form, articulo_wip_origen_id: e.target.value })}>
                      <option value="">Selecciona el articulo WIP previo</option>
                      {articulos.filter(a => a.id !== articuloEditando?.id).map(a => (
                        <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>
                      ))}
                    </select>
                  </div>
                )}
                <div style={styles.campo}>
                  <label style={styles.label}>Stock minimo (alerta)</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.stock_minimo}
                    onChange={e => setForm({ ...form, stock_minimo: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Dias de inventario de seguridad</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.dias_inventario_seguridad}
                    onChange={e => setForm({ ...form, dias_inventario_seguridad: e.target.value })} placeholder="0 = usa politica del grupo" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Multiplo de lote (OT)</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.multiplo_lote}
                    onChange={e => setForm({ ...form, multiplo_lote: e.target.value })} placeholder="0" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Costo unitario (declarado)</label>
                  <input style={styles.input} type="number" min="0" step="0.01" value={form.costo}
                    onChange={e => setForm({ ...form, costo: e.target.value })} placeholder="0.00" />
                </div>
              </div>

              <div style={styles.fila}>
                <div style={styles.campo}>
                  <label style={styles.label}>Peso de pieza (g)</label>
                  <input style={styles.input} type="number" step="0.01" value={form.peso_pieza_g}
                    onChange={e => setForm({ ...form, peso_pieza_g: e.target.value })} placeholder="0.00" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Peso de colada (g)</label>
                  <input style={styles.input} type="number" step="0.01" value={form.peso_colada_g}
                    onChange={e => setForm({ ...form, peso_colada_g: e.target.value })} placeholder="0.00" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>Peso de purga por arranque (g)</label>
                  <input style={styles.input} type="number" step="0.01" value={form.peso_purga_g}
                    onChange={e => setForm({ ...form, peso_purga_g: e.target.value })} placeholder="0.00" />
                </div>
                <div style={styles.campo}>
                  <label style={styles.label}>% Scrap aprobado</label>
                  <input style={styles.input} type="number" step="0.01" value={form.pct_scrap_aprobado}
                    onChange={e => setForm({ ...form, pct_scrap_aprobado: e.target.value })} placeholder="0" min="0" max="100" />
                </div>
              </div>
              <div style={styles.filaCheckbox}>
                <input type="checkbox" id="admiteMolido" checked={form.admite_molido}
                  onChange={e => setForm({ ...form, admite_molido: e.target.checked })} />
                <label htmlFor="admiteMolido" style={styles.labelCheckbox}>Admite molido en la mezcla</label>
                {form.admite_molido && (
                  <input style={{ ...styles.input, width: '90px', marginLeft: '10px' }} type="number" min="0" max="100"
                    value={form.pct_molido_max}
                    onChange={e => setForm({ ...form, pct_molido_max: e.target.value })}
                    placeholder="% max" />
                )}
              </div>
            </>
          )}

          <div style={styles.botones}>
            <button style={styles.botonSecundario} onClick={cancelarForm}>Cancelar</button>
            <button style={styles.boton} onClick={guardarArticulo} disabled={loading}>
              {loading ? 'Guardando...' : articuloEditando ? 'Actualizar articulo' : 'Guardar articulo'}
            </button>
          </div>
        </div>
      )}

      <div style={styles.buscador}>
        <input style={styles.inputBusqueda} value={busqueda}
          onChange={e => setBusqueda(e.target.value)}
          placeholder="Buscar por codigo o descripcion..." />
        <select style={styles.selectSite} value={filtroOrigen} onChange={e => setFiltroOrigen(e.target.value)}>
          <option value="todos">Todos los tipos</option>
          <option value="comprado">Comprado</option>
          <option value="fabricado">Fabricado</option>
        </select>
        <select style={styles.selectSite} value={filtroProveedor} onChange={e => setFiltroProveedor(e.target.value)}>
          <option value="">Todos los proveedores</option>
          {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
        </select>
        <select style={styles.selectSite} value={filtroCliente} onChange={e => setFiltroCliente(e.target.value)}>
          <option value="">Todos los clientes</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        {puedeVerTodosLosSites && (
          <select style={styles.selectSite} value={siteFiltro} onChange={e => setSiteFiltro(e.target.value)}>
            <option value="todos">Todos los sites</option>
            {sites.map(s => <option key={s.id} value={s.id.toString()}>{s.nombre}</option>)}
          </select>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }} className="no-imprimir">
          <button style={styles.btnExcel} onClick={() => exportarExcel('articulos', colsArt, articulosFiltrados)}>Excel</button>
          <button style={styles.btnPdf} onClick={() => imprimirTablaPDF('Articulos', colsArt, articulosFiltrados)}>PDF</button>
        </div>
      </div>

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 1 }}>Codigo</span>
          <span style={{ flex: 3 }}>Descripcion</span>
          <span style={{ flex: 1 }}>Site</span>
          <span style={{ flex: 1 }}>Unidad</span>
          <span style={{ flex: 1 }}>Moneda</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 3 }}>Acciones</span>
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
              <span style={{ flex: 1, fontSize: '12px', color: '#666' }}>{a.sites?.nombre || 'Compartido'}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{a.unidad_medida}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{a.tipo_moneda}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: a.activo ? '#f0fdf4' : '#fef2f2', color: a.activo ? '#16a34a' : '#dc2626' }}>
                  {a.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 3, display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                <button style={styles.botonAccion} title="Ficha imprimible: molde, maquina, ruta, BOM, empaque, clientes y equivalentes"
                  onClick={() => imprimirFichaArticulo(a)}>
                  Ficha
                </button>
                {a.origen === 'fabricado' ? (
                  <button style={styles.botonAccion} onClick={() => abrirClientes(a)}>
                    Clientes
                  </button>
                ) : (
                  <button style={styles.botonAccion} onClick={() => abrirProveedores(a)}>
                    Proveedores
                  </button>
                )}
                {puedeEditar && (
                  <button style={styles.botonAccion} onClick={() => abrirEditar(a)}>
                    Editar
                  </button>
                )}
                {puedeEditar && (
                  <button style={styles.botonAccion} onClick={() => toggleActivo(a)}>
                    {a.activo ? 'Desactivar' : 'Activar'}
                  </button>
                )}
                {puedeEliminar && (
                  <button style={styles.botonAccionEliminar} onClick={() => eliminarArticulo(a)}>
                    Eliminar
                  </button>
                )}
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

function VistaClientesArticulo({ articulo, clientes, formCliente, setFormCliente, guardarClienteArticulo, error, exito, onVolver }) {
  const [clientesAsignados, setClientesAsignados] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { cargarClientesAsignados() }, [])

  const cargarClientesAsignados = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('articulo_cliente')
      .select('*, clientes(nombre)')
      .eq('articulo_id', articulo.id)
    setClientesAsignados(data || [])
    setLoading(false)
  }

  const toggleActivoCliente = async (ac) => {
    await supabase.from('articulo_cliente').update({ activo: !ac.activo }).eq('id', ac.id)
    await cargarClientesAsignados()
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <div>
          <button style={styles.botonVolver} onClick={onVolver}>
            &larr; Volver a articulos
          </button>
          <h2 style={styles.titulo}>Clientes del articulo</h2>
          <p style={styles.subtituloArticulo}>{articulo.codigo_interno} - {articulo.descripcion}</p>
        </div>
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.form}>
        <h3 style={styles.formTitulo}>Asignar cliente</h3>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Cliente *</label>
            <select style={styles.input} value={formCliente.cliente_id}
              onChange={e => setFormCliente({ ...formCliente, cliente_id: e.target.value })}>
              <option value="">Selecciona cliente</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Codigo del cliente para este articulo</label>
            <input style={styles.input} value={formCliente.codigo_cliente}
              onChange={e => setFormCliente({ ...formCliente, codigo_cliente: e.target.value })}
              placeholder="Numero de parte segun el cliente" />
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Precio de venta</label>
            <input style={styles.input} type="number" value={formCliente.precio}
              onChange={e => setFormCliente({ ...formCliente, precio: e.target.value })}
              placeholder="0.00" min="0" step="0.01" />
          </div>
        </div>
        <div style={styles.botones}>
          <button style={styles.boton} onClick={async () => { await guardarClienteArticulo(); await cargarClientesAsignados() }}>
            Asignar cliente
          </button>
        </div>
      </div>

      <div style={styles.tabla}>
        <div style={styles.tablaHeader}>
          <span style={{ flex: 2 }}>Cliente</span>
          <span style={{ flex: 1 }}>Codigo cliente</span>
          <span style={{ flex: 1 }}>Precio</span>
          <span style={{ flex: 1 }}>Estatus</span>
          <span style={{ flex: 1 }}>Acciones</span>
        </div>
        {loading ? (
          <p style={{ padding: '20px', color: '#666' }}>Cargando...</p>
        ) : clientesAsignados.length === 0 ? (
          <p style={{ padding: '20px', color: '#666' }}>No hay clientes asignados a este articulo</p>
        ) : (
          clientesAsignados.map(ac => (
            <div key={ac.id} style={styles.tablaFila}>
              <span style={{ flex: 2, fontWeight: '500' }}>{ac.clientes?.nombre}</span>
              <span style={{ flex: 1, fontSize: '13px', color: '#666' }}>{ac.codigo_cliente}</span>
              <span style={{ flex: 1, fontSize: '13px' }}>{ac.precio ? `$${parseFloat(ac.precio).toFixed(2)}` : '-'}</span>
              <span style={{ flex: 1 }}>
                <span style={{ ...styles.badge, backgroundColor: ac.activo ? '#f0fdf4' : '#fef2f2', color: ac.activo ? '#16a34a' : '#dc2626' }}>
                  {ac.activo ? 'Activo' : 'Inactivo'}
                </span>
              </span>
              <span style={{ flex: 1 }}>
                <button style={styles.botonAccion} onClick={() => toggleActivoCliente(ac)}>
                  {ac.activo ? 'Desactivar' : 'Activar'}
                </button>
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

const btnBase = { padding: '9px 14px', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' }
const styles = {
  ayudaCampo: { fontSize: '11px', color: '#64748b', lineHeight: 1.4 },
  btnExcel: { padding: '9px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  btnPdf: { padding: '9px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  filaCheckbox: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' },
  labelCheckbox: { fontSize: '13px', color: '#444' },
  origenBox: { marginBottom: '20px', paddingBottom: '16px', borderBottom: '1px solid #f1f5f9' },
  transferenciaBox: { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '14px', marginBottom: '16px' },
  transferenciaDesc: { fontSize: '11px', color: '#94a3b8', margin: '2px 0 10px 0' },
  transferenciaOpciones: { display: 'flex', gap: '16px', flexWrap: 'wrap' },
  checkboxTransferencia: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#444', cursor: 'pointer' },
  origenOpciones: { display: 'flex', gap: '10px', marginTop: '6px' },
  origenBoton: { padding: '10px 18px', backgroundColor: '#f8fafc', color: '#444', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' },
  origenBotonActivo: { padding: '10px 18px', backgroundColor: '#eff6ff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '8px', fontSize: '13px', fontWeight: '600', cursor: 'pointer' },
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
  buscador: { marginBottom: '16px', display: 'flex', gap: '10px', alignItems: 'center' },
  selectSite: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', backgroundColor: '#fff' },
  inputBusqueda: { padding: '9px 14px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '300px' },
  botones: { display: 'flex', gap: '12px', justifyContent: 'flex-end', marginTop: '8px' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSecundario: { padding: '9px 20px', backgroundColor: '#e2e8f0', color: '#444', border: 'none', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '8px' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  botonAccionEliminar: { padding: '4px 10px', backgroundColor: '#fef2f2', color: '#dc2626', border: '1px solid #fca5a5', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
