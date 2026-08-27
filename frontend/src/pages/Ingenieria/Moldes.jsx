import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, exportarExcelHojas, imprimirTablaPDF, imprimirFichaPDF } from '../../lib/exportar'
import CargaMasivaCatalogo from '../../components/CargaMasivaCatalogo'

const ESTADOS_MOLDE = ['disponible', 'en_produccion', 'en_reparacion', 'en_mantenimiento', 'en_maquila', 'fuera_servicio']

// Las columnas del reporte y las de la plantilla se llaman IGUAL a proposito:
// el archivo que baja es el que se vuelve a subir, sin rearmar encabezados.
const COLS_REP_MOLDES = [
  { label: 'clave', get: m => m.clave },
  { label: 'nombre', get: m => m.nombre },
  { label: 'num_cavidades', get: m => m.num_cavidades },
  { label: 'estado', get: m => m.estado },
  { label: 'ubicacion_fisica', get: m => m.ubicacion_fisica },
  { label: 'site', get: m => m.site?.nombre || '' },
  { label: 'maquina_asignada', get: m => m.maq?.clave || '' },
  { label: 'periodicidad_mtto_dias', get: m => m.periodicidad_mtto_dias },
  { label: 'shots_alerta_min', get: m => m.shots_alerta_min },
  { label: 'shots_alerta_max', get: m => m.shots_alerta_max },
  { label: 'shots_acumulados', get: m => m.shots_acumulados },
  { label: 'activo', get: m => m.activo ? 'si' : 'no' },
]

const formVacio = {
  clave: '', nombre: '', num_cavidades: 1,
  shots_alerta_min: '', shots_alerta_max: '', ubicacion_fisica: '',
  site_id: '', maquina_asignada_id: ''
}

export default function Moldes() {
  const { perfil, tienePermiso } = useAuth()
  const [moldes, setMoldes] = useState([])
  const [sites, setSites] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [filtroMol, setFiltroMol] = useState('')
  const [articulos, setArticulos] = useState([])
  const [loading, setLoading] = useState(true)
  const [mostrarForm, setMostrarForm] = useState(false)
  const [editando, setEditando] = useState(null)
  const [moldeCavidades, setMoldeCavidades] = useState(null)
  const [form, setForm] = useState(formVacio)
  const [error, setError] = useState('')
  const [colores, setColores] = useState([])
  const [variantes, setVariantes] = useState([])
  // articulo_id -> molde_id, de todos los moldes. Un articulo pertenece a un
  // solo molde: puede ocupar varias cavidades de ese molde, pero no vivir en
  // dos. De las cavidades de un articulo sale cuantas piezas entrega cada
  // disparo, y de ahi los shots de una orden; repetido en dos moldes esa
  // cuenta deja de tener un solo significado.
  const [moldeDeArt, setMoldeDeArt] = useState(new Map())
  // Todas las cavidades de todos los moldes: alimenta el mapa de arriba y el
  // reporte, que necesita el detalle y no solo el articulo.
  const [cavidadesTodas, setCavidadesTodas] = useState([])
  const [mostrarCarga, setMostrarCarga] = useState(false)
  const [vistaCarga, setVistaCarga] = useState('moldes')
  const [exito, setExito] = useState('')

  const puedeCrear = tienePermiso('ing_moldes', 'crear')
  const puedeEditar = tienePermiso('ing_moldes', 'editar')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    // El orden de las variables DEBE seguir el orden de las consultas.
    const [{ data: mol }, { data: sit }, { data: maq }, { data: art }, { data: cols }, { data: vars_ }, { data: asig }] = await Promise.all([
      supabase.from('moldes').select('*, site:sites(nombre), maq:maquinas(clave)').eq('empresa_id', perfil.empresa_id).order('clave'),
      supabase.from('sites').select('id, nombre, codigo').eq('empresa_id', perfil.empresa_id).order('nombre'),
      supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('clave'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, color_id, variante_codigo_id').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('codigo_interno'),
      supabase.from('colores').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('orden_secuencia'),
      supabase.from('variantes_codigo').select('*').eq('empresa_id', perfil.empresa_id).eq('activo', true).order('clave'),
      supabase.from('molde_cavidades').select('id, molde_id, numero_cavidad, articulo_id, activa'),
    ])
    setMoldes(mol || [])
    setSites(sit || [])
    setMaquinas(maq || [])
    setArticulos(art || [])
    setColores(cols || [])
    setVariantes(vars_ || [])
    setCavidadesTodas(asig || [])
    const mapa = new Map()
    for (const x of asig || []) if (x.articulo_id != null) mapa.set(x.articulo_id, x.molde_id)
    setMoldeDeArt(mapa)
    setLoading(false)
  }

  const moldesFiltrados = moldes.filter(m => !filtroMol || (`${m.clave} ${m.nombre}`).toLowerCase().includes(filtroMol.toLowerCase()))
  const colsMol = [{ label: 'Clave', get: m => m.clave }, { label: 'Nombre', get: m => m.nombre }, { label: 'Cavidades', get: m => m.num_cavidades }, { label: 'Shots acum.', get: m => m.shots_acumulados }, { label: 'Estado', get: m => m.estado }, { label: 'Site', get: m => m.site?.nombre || '' }, { label: 'Maquina PPAP', get: m => m.maq?.clave || '' }, { label: 'Ubicacion', get: m => m.ubicacion_fisica || '' }, { label: 'Estatus', get: m => m.activo ? 'Activo' : 'Inactivo' }]
  const artDe = (id) => articulos.find(a => a.id === id)
  const molDe = (id) => moldes.find(m => m.id === id)
  const claveColor = (a) => colores.find(c => c.id === a?.color_id)?.clave || ''
  const claveVar = (a) => variantes.find(v => v.id === a?.variante_codigo_id)?.clave || ''

  // Cavidades de un molde, ordenadas y con el articulo resuelto.
  const cavidadesDe = (moldeId) => cavidadesTodas
    .filter(c => c.molde_id === moldeId)
    .sort((a, b) => a.numero_cavidad - b.numero_cavidad || (a.id - b.id))

  const COLS_REP_CAV = [
    { label: 'molde', get: c => molDe(c.molde_id)?.clave || '' },
    { label: 'numero_cavidad', get: c => c.numero_cavidad },
    { label: 'articulo', get: c => artDe(c.articulo_id)?.codigo_interno || '' },
    { label: 'descripcion', get: c => artDe(c.articulo_id)?.descripcion || '' },
    { label: 'color', get: c => claveColor(artDe(c.articulo_id)) },
    { label: 'variante_codigo', get: c => claveVar(artDe(c.articulo_id)) },
    { label: 'estado_cavidad', get: c => c.activa === false ? 'tapada' : 'activa' },
  ]

  // Un molde y sus cavidades son dos niveles distintos: aplanarlos repetiria
  // el encabezado del molde en cada renglon. Por eso van en dos hojas.
  const descargarReporte = () => {
    const ids = new Set(moldesFiltrados.map(m => m.id))
    // Cuantas cavidades quedaron sin nadie: es el dato que se pierde al no
    // llevar los renglones vacios a la hoja de Cavidades.
    const sinAsignar = (m) => {
      const suyas = cavidadesTodas.filter(c => c.molde_id === m.id)
      const conArt = new Set(suyas.filter(c => c.articulo_id != null).map(c => c.numero_cavidad))
      let n = 0
      for (let i = 1; i <= (m.num_cavidades || 0); i++) if (!conArt.has(i)) n++
      return n
    }
    const colsMoldes = [...COLS_REP_MOLDES, { label: 'cavidades_sin_asignar', get: sinAsignar }]
    exportarExcelHojas('moldes_y_cavidades', [
      { nombre: 'Moldes', columnas: colsMoldes, filas: moldesFiltrados },
      {
        nombre: 'Cavidades', columnas: COLS_REP_CAV,
        // Solo las asignadas: con los renglones vacios adentro, volver a subir
        // este mismo archivo marcaria cada uno como "articulo vacio". El hueco
        // no se pierde, se ve en la hoja de Moldes y con detalle en la ficha.
        filas: cavidadesTodas
          .filter(c => ids.has(c.molde_id) && c.articulo_id != null)
          .sort((a, b) => (molDe(a.molde_id)?.clave || '').localeCompare(molDe(b.molde_id)?.clave || '')
            || a.numero_cavidad - b.numero_cavidad),
      },
    ])
  }

  // Ficha de un molde: lo que se pega en el tooling o se le entrega al auditor.
  const imprimirFicha = (m) => {
    const cavs = cavidadesDe(m.id)
    // Corridas: agrupadas por color + variante. Cada grupo es un disparo
    // distinto y de ahi salen las piezas por shot de cada codigo.
    const grupos = new Map()
    cavs.filter(c => c.articulo_id && c.activa !== false).forEach(c => {
      const a = artDe(c.articulo_id); if (!a) return
      const k = `${a.color_id ?? 'sc'}|${a.variante_codigo_id ?? 'sv'}`
      if (!grupos.has(k)) grupos.set(k, { color: claveColor(a), variante: claveVar(a), porArt: new Map() })
      const g = grupos.get(k)
      g.porArt.set(a.id, (g.porArt.get(a.id) || 0) + 1)
    })
    const corridas = [...grupos.values()].map(g => ({
      color: g.color || 'sin color',
      variante: g.variante || 'sin variante',
      codigos: [...g.porArt.entries()].map(([id, n]) => `${artDe(id)?.codigo_interno || id} (${n} pz/disparo)`).join(', '),
      cubre: [...g.porArt.values()].reduce((x, y) => x + y, 0),
    }))
    imprimirFichaPDF(
      `Molde ${m.clave}${m.nombre ? ' — ' + m.nombre : ''}`,
      `Ficha de molde y asignacion de cavidades`,
      [
        ['Clave', m.clave], ['Nombre', m.nombre || '-'],
        ['Cavidades', m.num_cavidades], ['Estado', m.estado || '-'],
        ['Planta', m.site?.nombre || '-'], ['Maquina asignada', m.maq?.clave || '-'],
        ['Ubicacion fisica', m.ubicacion_fisica || '-'],
        ['Shots acumulados', m.shots_acumulados ?? 0],
        ['Alerta de shots', `${m.shots_alerta_min ?? '-'} / ${m.shots_alerta_max ?? '-'}`],
        ['Periodicidad mtto (dias)', m.periodicidad_mtto_dias ?? '-'],
        ['Ultimo mantenimiento', m.fecha_ultimo_mtto || '-'],
        ['Estatus', m.activo ? 'Activo' : 'Inactivo'],
      ],
      [
        {
          titulo: 'Cavidades', columnas: [
            { label: 'Cavidad', get: c => `#${c.numero_cavidad}` },
            { label: 'Articulo', get: c => artDe(c.articulo_id)?.codigo_interno || 'sin asignar' },
            { label: 'Descripcion', get: c => artDe(c.articulo_id)?.descripcion || '' },
            { label: 'Color', get: c => claveColor(artDe(c.articulo_id)) },
            { label: 'Variante', get: c => claveVar(artDe(c.articulo_id)) },
            { label: 'Estado', get: c => c.activa === false ? 'TAPADA' : 'activa' },
          ], filas: cavs, vacio: 'Este molde no tiene cavidades capturadas.',
        },
        {
          titulo: `Corridas separadas (${corridas.length})`, columnas: [
            { label: 'Color', get: c => c.color },
            { label: 'Variante', get: c => c.variante },
            { label: 'Codigos del disparo', get: c => c.codigos },
            { label: 'Cavidades', get: c => `${c.cubre} de ${m.num_cavidades}` },
          ], filas: corridas,
          vacio: 'Sin articulos asignados: el molde no tiene corridas definidas.',
        },
      ],
    )
  }

  // Reglas que solo este catalogo conoce. Se pide una nueva por archivo para
  // que lo ya visto arranque limpio y no se contamine entre cargas.
  const crearValidadorCavidades = () => {
    const triplesArchivo = new Set()
    // articulo -> molde, arrancando con lo que ya hay en la base y creciendo
    // con lo que trae el propio archivo.
    const moldeDeArtArchivo = new Map(moldeDeArt)
    const triplesSistema = new Set(
      cavidadesTodas.filter(c => c.articulo_id != null)
        .map(c => `${c.molde_id}|${c.numero_cavidad}|${c.articulo_id}`)
    )

    return (payload) => {
      const err = []
      const { molde_id: mid, numero_cavidad: cav, articulo_id: aid } = payload
      if (!mid || !aid) return err   // el error de referencia ya lo puso el componente

      const m = molDe(mid)
      if (cav == null || !Number.isInteger(cav) || cav < 1) {
        err.push('numero_cavidad debe ser un entero de 1 en adelante')
      } else if (m && m.num_cavidades && cav > m.num_cavidades) {
        err.push(`el molde ${m.clave} tiene ${m.num_cavidades} cavidades: la ${cav} no existe`)
      }

      // Un articulo pertenece a un solo molde. Se revisa contra la base y
      // contra lo que va trayendo el archivo, porque la base todavia no lo sabe.
      const yaEn = moldeDeArtArchivo.get(aid)
      if (yaEn != null && yaEn !== mid) {
        err.push(`el articulo ya esta asignado al molde ${molDe(yaEn)?.clave || yaEn}`)
      } else {
        moldeDeArtArchivo.set(aid, mid)
      }

      const triple = `${mid}|${cav}|${aid}`
      if (triplesArchivo.has(triple)) err.push('ese articulo ya viene en esa misma cavidad en el archivo')
      else triplesArchivo.add(triple)
      if (triplesSistema.has(triple)) err.push('ese articulo ya esta asignado a esa cavidad')

      return err
    }
  }

  // Despues de una carga masiva hay que dejar la tabla como la deja la pantalla:
  // cada molde con sus renglones de cavidad, y sin renglones vacios en las
  // cavidades que ya tienen articulo. Sin esto la pantalla de cavidades sale en
  // blanco tras cargar moldes, y con renglones fantasma tras cargar cavidades.
  const reconciliarCavidades = async () => {
    const { data: mol } = await supabase.from('moldes').select('id, num_cavidades').eq('empresa_id', perfil.empresa_id)
    const { data: cav } = await supabase.from('molde_cavidades').select('id, molde_id, numero_cavidad, articulo_id')
    const porMolde = new Map()
    for (const c of cav || []) {
      if (!porMolde.has(c.molde_id)) porMolde.set(c.molde_id, [])
      porMolde.get(c.molde_id).push(c)
    }

    const faltantes = []
    for (const m of mol || []) {
      const suyas = porMolde.get(m.id) || []
      const nums = new Set(suyas.map(c => c.numero_cavidad))
      for (let i = 1; i <= (m.num_cavidades || 0); i++) {
        if (!nums.has(i)) faltantes.push({ molde_id: m.id, numero_cavidad: i })
      }
    }
    if (faltantes.length) await supabase.from('molde_cavidades').insert(faltantes)

    // Renglon vacio de una cavidad que ya tiene articulo: sobra.
    const sobran = []
    for (const [, suyas] of porMolde) {
      const conArt = new Set(suyas.filter(c => c.articulo_id != null).map(c => c.numero_cavidad))
      suyas.filter(c => c.articulo_id == null && conArt.has(c.numero_cavidad)).forEach(c => sobran.push(c.id))
    }
    if (sobran.length) await supabase.from('molde_cavidades').delete().in('id', sobran)

    await cargarDatos()
  }

  const abrirNuevo = () => { setEditando(null); setForm(formVacio); setMostrarForm(true); setError('') }
  const abrirEditar = (m) => {
    setEditando(m)
    setForm({
      clave: m.clave, nombre: m.nombre || '', num_cavidades: m.num_cavidades,
      shots_alerta_min: m.shots_alerta_min || '', shots_alerta_max: m.shots_alerta_max || '',
      ubicacion_fisica: m.ubicacion_fisica || '',
      site_id: m.site_id?.toString() || '', maquina_asignada_id: m.maquina_asignada_id?.toString() || '',
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
      site_id: form.site_id ? parseInt(form.site_id) : null,
      maquina_asignada_id: form.maquina_asignada_id ? parseInt(form.maquina_asignada_id) : null,
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

  // Una cavidad fisica produce siempre la misma geometria, pero el codigo de
  // articulo cambia con el color. Por eso una cavidad puede tener varias
  // filas: una por cada color que se corre en ese molde.
  const actualizarCavidad = (key, articuloId) => {
    setMoldeCavidades(prev => ({
      ...prev,
      cavidades: prev.cavidades.map(c => (c._key || c.id) === key
        ? { ...c, articulo_id: articuloId ? parseInt(articuloId) : null } : c)
    }))
  }

  const agregarVariante = (numeroCavidad) => {
    setMoldeCavidades(prev => ({
      ...prev,
      cavidades: [...prev.cavidades, {
        _key: `n${Date.now()}${Math.random()}`, _nuevo: true,
        molde_id: prev.molde.id, numero_cavidad: numeroCavidad, articulo_id: null, activa: true,
      }],
    }))
  }

  const quitarVariante = (key) => {
    setMoldeCavidades(prev => ({
      ...prev,
      cavidades: prev.cavidades
        .filter(c => !((c._key || c.id) === key && c._nuevo))
        .map(c => (c._key || c.id) === key ? { ...c, _borrar: true } : c),
    }))
  }

  // Tapar una cavidad afecta a TODOS sus colores a la vez: se tapa la cavidad
  // fisica, no el codigo. Al bajar el conteo suben los disparos, asi que el
  // plan de capacidad se alarga solo y el costo por pieza sube.
  const alternarBloqueo = async (numeroCavidad, bloquear) => {
    let motivo = null
    if (bloquear) {
      motivo = prompt(`Motivo por el que se tapa la cavidad #${numeroCavidad} (dano, balanceo de sets, etc.)`)
      if (motivo === null) return
    }
    setLoading(true); setError('')
    const { error: e } = await supabase.rpc('bloquear_cavidad', {
      p_molde_id: moldeCavidades.molde.id, p_numero_cavidad: numeroCavidad,
      p_bloquear: bloquear, p_motivo: motivo, p_usuario: perfil.id,
    })
    setLoading(false)
    if (e) { setError('No se pudo actualizar la cavidad: ' + e.message); return }
    setExito(bloquear ? `Cavidad #${numeroCavidad} tapada` : `Cavidad #${numeroCavidad} liberada`)
    setTimeout(() => setExito(''), 3000)
    abrirCavidades(moldeCavidades.molde)
  }

  const guardarCavidades = async () => {
    setLoading(true); setError('')
    try {
      for (const c of moldeCavidades.cavidades) {
        if (c._borrar && c.id) {
          const { error: e } = await supabase.from('molde_cavidades').delete().eq('id', c.id)
          if (e) throw e
        } else if (c._nuevo) {
          if (!c.articulo_id) continue
          const { error: e } = await supabase.from('molde_cavidades')
            .insert({ molde_id: c.molde_id, numero_cavidad: c.numero_cavidad, articulo_id: c.articulo_id, activa: true })
          if (e) throw e
        } else if (c.id) {
          const { error: e } = await supabase.from('molde_cavidades')
            .update({ articulo_id: c.articulo_id }).eq('id', c.id)
          if (e) throw e
        }
      }
    } catch (err) {
      setLoading(false)
      setError(err.message?.includes('ya esta asignado al molde')
        ? err.message
        : (err.message?.includes('duplicate') || err.message?.includes('unq')
          ? 'Ese articulo ya esta asignado a esa cavidad. Cada color debe capturarse una sola vez por cavidad.'
          : 'No se pudo guardar: ' + err.message))
      return
    }
    setLoading(false)
    setExito('Cavidades actualizadas correctamente')
    setMoldeCavidades(null)
    // El mapa de articulo -> molde acaba de cambiar: hay que releerlo o el
    // siguiente molde ofreceria articulos que ya se ocuparon.
    await cargarDatos()
    setTimeout(() => setExito(''), 3000)
  }

  if (moldeCavidades) {
    return (
      <div style={styles.container}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
          <button style={styles.botonVolver} onClick={() => setMoldeCavidades(null)}>&larr; Volver a moldes</button>
          <button style={styles.botonAccion} onClick={() => imprimirFicha(moldeCavidades.molde)}>Imprimir ficha del molde</button>
        </div>
        <h2 style={styles.titulo}>Cavidades: {moldeCavidades.molde.clave}</h2>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '6px', lineHeight: 1.55 }}>
          Asigna que articulo produce cada cavidad. Si el molde produce piezas espejo (izquierda / derecha),
          asigna el articulo que corresponde a cada cavidad.
        </p>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px', lineHeight: 1.55 }}>
          <b>Una cavidad puede tener varias lineas.</b> Agrega una por cada color y por cada variante de
          codigo que corra en esa misma cavidad. Salen juntos en un disparo los articulos del <b>mismo color
          y la misma variante</b>; los de <b>distinto color</b> se corren por separado con purga, y los de
          <b>distinta variante de codigo</b> tambien por separado pero sin purga.
        </p>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px', lineHeight: 1.55 }}>
          <b>Solo aparecen los articulos libres y los de este molde.</b> Un articulo pertenece a un solo
          molde: si no encuentras un codigo en la lista es porque ya esta asignado a otro. Quitalo de ahi
          primero. Cuando son dos moldes que hacen la misma pieza, cada uno lleva su propio codigo y se
          ligan por el catalogo de <b>Partes equivalentes</b>, que es lo que hace que el MRP los netee
          juntos y el FIFO los ordene como una sola fila.
        </p>
        <p style={{ fontSize: '13px', color: '#666', marginBottom: '20px', lineHeight: 1.55 }}>
          <b>Ojo con esto:</b> si las 4 cavidades sacan el mismo codigo, ese codigo va en <b>las 4 lineas</b>,
          no en una. De ahi sale cuantas piezas entrega cada disparo, y de ahi salen los shots que necesita
          una orden. Capturar una sola cavidad por codigo multiplica los shots calculados y el plan de
          maquina se va al doble o al cuadruple de lo real.
        </p>
        {(() => {
          const activas = [...new Set(moldeCavidades.cavidades.filter(c => c.activa !== false).map(c => c.numero_cavidad))].length
          const nominal = moldeCavidades.molde.num_cavidades
            || [...new Set(moldeCavidades.cavidades.map(c => c.numero_cavidad))].length
          if (activas >= nominal) return null
          return (
            <div style={styles.avisoCav}>
              <b>{nominal - activas} de {nominal} cavidades tapadas.</b> El molde entrega {activas} piezas por
              disparo en vez de {nominal}, asi que las OT tardan mas y el costo por pieza sube. El plan de
              capacidad ya lo considera; el OEE sigue midiendo contra las {nominal} nominales para que la
              perdida de capacidad se vea como caida de desempeno.
            </div>
          )
        })()}
        {(() => {
          // Agrupa las lineas por corrida (color + variante). Cada grupo es un
          // disparo distinto, y dentro del grupo cada codigo aporta las
          // cavidades que tenga asignadas.
          //
          // El aviso importante: si una corrida no cubre todas las cavidades
          // del molde, o falta capturar lineas o hay cavidades tapadas. Ese es
          // el error de captura que multiplica los shots de las ordenes.
          const nominal = moldeCavidades.molde.num_cavidades
            || [...new Set(moldeCavidades.cavidades.map(c => c.numero_cavidad))].length
          const grupos = new Map()
          moldeCavidades.cavidades
            .filter(c => c.articulo_id && !c._borrar && c.activa !== false)
            .forEach(c => {
              const art = articulos.find(x => x.id === c.articulo_id)
              if (!art) return
              const k = `${art.color_id ?? 'sc'}|${art.variante_codigo_id ?? 'sv'}`
              if (!grupos.has(k)) grupos.set(k, { color_id: art.color_id ?? null, variante_codigo_id: art.variante_codigo_id ?? null, porArt: new Map() })
              const g = grupos.get(k)
              g.porArt.set(art.id, (g.porArt.get(art.id) || 0) + 1)
            })
          if (grupos.size === 0) return null
          const lista = [...grupos.values()].map(g => ({
            ...g,
            color: colores.find(x => x.id === g.color_id) || null,
            variante: variantes.find(x => x.id === g.variante_codigo_id) || null,
            cubiertas: [...g.porArt.values()].reduce((a, b) => a + b, 0),
          }))
          return (
            <div style={styles.corridasCaja}>
              <p style={styles.corridasTit}>
                Corridas de este molde ({lista.length}) &middot; el molde tiene {nominal} cavidades
              </p>
              <p style={styles.corridasSub}>
                Cada renglon es un disparo distinto: no salen juntos aunque compartan molde.
              </p>
              {lista.map((g, i) => (
                <div key={i} style={styles.corridaFila}>
                  <span style={{ minWidth: 150 }}>
                    {g.color
                      ? <span style={styles.chip}><span style={{ width: 11, height: 11, borderRadius: 3, border: '1px solid #cbd5e1', background: g.color.hex || '#fff' }} />{g.color.clave}</span>
                      : <span style={styles.chipVacio}>sin color</span>}
                    {g.variante
                      ? <span style={styles.chipVar}>{g.variante.clave}</span>
                      : <span style={styles.chipVacio}>sin variante</span>}
                  </span>
                  <span style={{ flex: 1, fontSize: 12.5, color: '#334155' }}>
                    {[...g.porArt.entries()].map(([artId, cav]) => {
                      const a = articulos.find(x => x.id === artId)
                      return `${a ? a.codigo_interno : artId}: ${cav} ${cav === 1 ? 'cavidad' : 'cavidades'} (${cav} ${cav === 1 ? 'pieza' : 'piezas'} por disparo)`
                    }).join('  ·  ')}
                  </span>
                  <span style={{ minWidth: 130, textAlign: 'right' }}>
                    {g.cubiertas === nominal
                      ? <span style={styles.chipOk}>{g.cubiertas} de {nominal} cavidades</span>
                      : <span style={styles.chipAlerta}>{g.cubiertas} de {nominal} cavidades</span>}
                  </span>
                </div>
              ))}
              {lista.some(g => g.cubiertas !== nominal) && (
                <div style={styles.avisoCav}>
                  <b>Hay corridas que no cubren las {nominal} cavidades del molde.</b> Si es porque hay
                  cavidades tapadas, esta bien y el plan ya lo considera. Si no, faltan lineas por capturar:
                  cuando las {nominal} cavidades sacan el mismo codigo, ese codigo debe aparecer en las {nominal} lineas.
                  Capturado a medias, el sistema cree que cada disparo entrega menos piezas y calcula de mas los
                  shots de cada orden.
                </div>
              )}
            </div>
          )
        })()}

        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Cavidad</span>
            <span style={{ flex: 3 }}>Articulo que produce</span>
            <span style={{ width: '190px' }}></span>
          </div>
          {[...new Set(moldeCavidades.cavidades.map(c => c.numero_cavidad))].sort((a, b) => a - b).map(num => {
            const filas = moldeCavidades.cavidades.filter(c => c.numero_cavidad === num && !c._borrar)
            return (
              <div key={num} style={{ borderBottom: '1px solid #f1f5f9', padding: '4px 0' }}>
                {filas.map((c, i) => {
                  const key = c._key || c.id
                  const art = articulos.find(x => x.id === c.articulo_id)
                  const col = colores.find(x => x.id === art?.color_id)
                  const vr = variantes.find(x => x.id === art?.variante_codigo_id)
                  return (
                    <div key={key} style={{ ...styles.tablaFila, borderBottom: 'none', opacity: c.activa === false ? 0.45 : 1 }}>
                      <span style={{ flex: 1, fontWeight: '600' }}>{i === 0 ? `#${num}` : ''}</span>
                      <span style={{ flex: 3, display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <select style={{ ...styles.input, flex: 1 }} value={c.articulo_id || ''}
                          onChange={e => actualizarCavidad(key, e.target.value)}>
                          <option value="">Sin asignar</option>
                          {articulos
                            .filter(a =>
                              // libre, o ya es de ESTE molde (puede ocupar varias
                              // cavidades), o es el valor actual del renglon para
                              // que el selector nunca se quede en blanco.
                              !moldeDeArt.has(a.id)
                              || moldeDeArt.get(a.id) === moldeCavidades.molde.id
                              || a.id === c.articulo_id)
                            .map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
                        </select>
                        {col && (
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: '#475569', whiteSpace: 'nowrap' }}>
                            <span style={{ width: '14px', height: '14px', borderRadius: '4px', border: '1px solid #cbd5e1', background: col.hex || '#fff' }} />
                            {col.clave}
                          </span>
                        )}
                        {vr && <span style={styles.chipVar}>{vr.clave}</span>}
                      </span>
                      <span style={{ width: '90px', textAlign: 'right' }}>
                        {filas.length > 1 && (
                          <button style={styles.botonAccion} onClick={() => quitarVariante(key)}>Quitar</button>
                        )}
                      </span>
                    </div>
                  )
                })}
                <div style={{ padding: '2px 0 6px 12px', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button style={{ ...styles.botonAccion, fontSize: '11.5px' }} onClick={() => agregarVariante(num)}>
                    + Variante de color en la cavidad #{num}
                  </button>
                  {(() => {
                    const tapada = moldeCavidades.cavidades.some(c => c.numero_cavidad === num && c.activa === false)
                    const conMotivo = moldeCavidades.cavidades.find(c => c.numero_cavidad === num && c.motivo_bloqueo)
                    return tapada ? (
                      <>
                        <span style={styles.tapadaTag}>Tapada{conMotivo?.motivo_bloqueo ? `: ${conMotivo.motivo_bloqueo}` : ''}</span>
                        <button style={{ ...styles.botonAccion, fontSize: '11.5px' }} onClick={() => alternarBloqueo(num, false)}>Liberar</button>
                      </>
                    ) : (
                      <button style={{ ...styles.botonAccion, fontSize: '11.5px', color: '#b45309', borderColor: '#fcd34d' }}
                        onClick={() => alternarBloqueo(num, true)}>Tapar cavidad</button>
                    )
                  })()}
                </div>
              </div>
            )
          })}
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
          <div style={{ display: 'flex', gap: '8px' }}>
            <button style={styles.botonSec} onClick={() => { setMostrarCarga(!mostrarCarga); setMostrarForm(false) }}>
              {mostrarCarga ? 'Cerrar carga masiva' : 'Carga masiva'}
            </button>
            <button style={styles.boton} onClick={() => mostrarForm ? setMostrarForm(false) : abrirNuevo()}>
              {mostrarForm ? 'Cancelar' : '+ Nuevo molde'}
            </button>
          </div>
        )}
      </div>

      {mostrarCarga && puedeCrear && (
        <div style={styles.cargaCaja}>
          <div style={styles.cargaTabs}>
            {[['moldes', 'Moldes'], ['cavidades', 'Cavidades']].map(([id, n]) => (
              <button key={id} style={vistaCarga === id ? styles.cargaTabAct : styles.cargaTab}
                onClick={() => setVistaCarga(id)}>{n}</button>
            ))}
          </div>
          <p style={styles.cargaAyuda}>
            Primero los <b>moldes</b>, despues las <b>cavidades</b>: una cavidad no se puede asignar a un molde
            que todavia no existe. El reporte de Excel que baja de esta pantalla trae exactamente estas dos
            hojas con los mismos encabezados, asi que sirve de respaldo y se puede volver a subir sin rearmar nada.
          </p>

          {vistaCarga === 'moldes' && (
            <CargaMasivaCatalogo
              titulo="Moldes"
              tabla="moldes"
              columnas={[
                { campo: 'clave', req: true, upper: true, ayuda: 'Ej: BK007. Identifica al molde y no puede repetirse.' },
                { campo: 'nombre', ayuda: 'Nombre o descripcion del molde.' },
                { campo: 'num_cavidades', tipo: 'num', req: true, ayuda: 'Cuantas cavidades tiene fisicamente. Se crean solas para asignarlas despues.' },
                { campo: 'estado', tipo: 'lista', opciones: ESTADOS_MOLDE, ayuda: ESTADOS_MOLDE.join(' / ') + '. Vacio = disponible.' },
                { campo: 'ubicacion_fisica', ayuda: 'Rack, estante, area donde se guarda.' },
                { campo: 'site_id', columna: 'site', tipo: 'ref', ref: { lista: sites, por: 'nombre', etiqueta: 'site' }, ayuda: 'Nombre de la planta. Vacio si no aplica.' },
                { campo: 'maquina_asignada_id', columna: 'maquina_asignada', tipo: 'ref', ref: { lista: maquinas, por: 'clave', etiqueta: 'maquina' }, ayuda: 'Clave de la maquina donde se corrio el PPAP.' },
                { campo: 'periodicidad_mtto_dias', tipo: 'num', ayuda: 'Dias entre mantenimientos preventivos.' },
                { campo: 'shots_alerta_min', tipo: 'num', ayuda: 'Disparos a los que se avisa que se acerca el preventivo.' },
                { campo: 'shots_alerta_max', tipo: 'num', ayuda: 'Disparos a los que ya se vencio.' },
                { campo: 'shots_acumulados', tipo: 'num', ayuda: 'Disparos que ya trae el molde. Sirve para migrar desde otro sistema.' },
              ]}
              dedupe={[{ campo: 'clave', etiqueta: 'Clave' }]}
              ejemplos={[
                ['BK007', 'Tapa frontal familiar', 4, 'disponible', 'Rack A-12', '', '', 90, 250000, 300000, 0],
                ['BK012', 'Clip lateral', 8, 'en_produccion', 'Rack B-03', '', '', 180, 400000, 500000, 125000],
              ]}
              notas={[
                'Los moldes se dan de alta como Activos.',
                'Al cargarlos se crean sus renglones de cavidad vacios, listos para asignar articulos en la hoja de Cavidades.',
                'shots_acumulados solo se usa para migrar: de ahi en adelante los cuenta el sistema con cada reporte de produccion.',
              ]}
              existentes={moldes}
              camposBase={{ empresa_id: perfil.empresa_id, activo: true }}
              empresaId={perfil.empresa_id}
              puedeCargar={puedeCrear}
              onCargado={reconciliarCavidades}
              onCerrar={() => setMostrarCarga(false)}
            />
          )}

          {vistaCarga === 'cavidades' && (
            <CargaMasivaCatalogo
              titulo="Cavidades"
              tabla="molde_cavidades"
              columnas={[
                { campo: 'molde_id', columna: 'molde', tipo: 'ref', req: true, ref: { lista: moldes, por: 'clave', etiqueta: 'molde' }, ayuda: 'Clave del molde. Tiene que existir ya.' },
                { campo: 'numero_cavidad', tipo: 'num', req: true, ayuda: 'Numero de cavidad, de 1 al numero de cavidades del molde.' },
                { campo: 'articulo_id', columna: 'articulo', tipo: 'ref', req: true, ref: { lista: articulos, por: 'codigo_interno', etiqueta: 'articulo' }, ayuda: 'Codigo del articulo que sale de esa cavidad.' },
              ]}
              ejemplos={[
                ['BK007', 1, 'QG1HA005A0000L10'],
                ['BK007', 2, 'QG1HA005A0000L10'],
                ['BK007', 3, 'QG1HA005A0000L10'],
                ['BK007', 4, 'QG1HA005A0000L10'],
              ]}
              notas={[
                'Un renglon por cavidad y por articulo. Si las 4 cavidades sacan el MISMO codigo, van los 4 renglones con ese codigo: de ahi sale cuantas piezas entrega cada disparo.',
                'Si el molde saca izquierda y derecha, pon el codigo que corresponde a cada cavidad.',
                'Si la misma cavidad corre varios colores o varias variantes de codigo, agrega un renglon por cada uno.',
                'Un articulo pertenece a UN SOLO molde. Si ya esta en otro, la fila se rechaza y te dice en cual.',
                'Solo agrega lo que falta: lo que ya estaba capturado se respeta y se reporta como repetido.',
              ]}
              crearValidador={crearValidadorCavidades}
              camposBase={{ activa: true }}
              empresaId={perfil.empresa_id}
              puedeCargar={puedeCrear}
              onCargado={reconciliarCavidades}
              onCerrar={() => setMostrarCarga(false)}
            />
          )}
        </div>
      )}

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
              <label style={styles.label}>Site (planta a la que pertenece)</label>
              <select style={styles.input} value={form.site_id} onChange={e => setForm({ ...form, site_id: e.target.value, maquina_asignada_id: '' })}>
                <option value="">Sin asignar</option>
                {sites.map(x => <option key={x.id} value={x.id}>{x.codigo ? x.codigo + ' - ' : ''}{x.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Maquina asignada (PPAP)</label>
              <select style={styles.input} value={form.maquina_asignada_id} onChange={e => setForm({ ...form, maquina_asignada_id: e.target.value })}>
                <option value="">Sin asignar</option>
                {maquinas.filter(x => !form.site_id || x.site_id === Number(form.site_id)).map(x => <option key={x.id} value={x.id}>{x.clave} - {x.nombre}</option>)}
              </select>
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

      <div className="no-imprimir" style={{ display: 'flex', gap: '8px', marginBottom: '12px', alignItems: 'center' }}>
        <input style={{ padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', width: '260px' }} value={filtroMol} onChange={e => setFiltroMol(e.target.value)} placeholder="Filtrar por clave o nombre..." />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '8px' }}>
          <button style={{ padding: '9px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }}
            title="Dos hojas: los moldes y el detalle de que articulo va en cada cavidad. Es el mismo formato de la plantilla de carga."
            onClick={descargarReporte}>Excel: moldes + cavidades</button>
          <button style={{ padding: '9px 14px', backgroundColor: '#fff', color: '#16a34a', border: '1px solid #16a34a', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => exportarExcel('moldes', colsMol, moldesFiltrados)}>Excel: solo moldes</button>
          <button style={{ padding: '9px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }} onClick={() => imprimirTablaPDF('Moldes', colsMol, moldesFiltrados)}>PDF</button>
        </div>
      </div>
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
        ) : moldesFiltrados.map(m => {
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
                <button style={{ ...styles.botonAccion, marginLeft: '6px' }} title="Ficha imprimible del molde con sus cavidades y sus corridas" onClick={() => imprimirFicha(m)}>Ficha</button>
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
  corridasCaja: { background: '#fff', border: '1px solid #eef2f7', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' },
  corridasTit: { fontSize: '13px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 2px' },
  corridasSub: { fontSize: '12px', color: '#94a3b8', margin: '0 0 10px' },
  corridaFila: { display: 'flex', gap: '12px', alignItems: 'center', padding: '7px 0', borderTop: '1px solid #f8fafc' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '11.5px', color: '#475569', whiteSpace: 'nowrap', marginRight: '6px' },
  chipVar: { display: 'inline-block', padding: '1px 8px', borderRadius: '20px', fontSize: '10.5px', fontWeight: 600, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe', whiteSpace: 'nowrap' },
  chipVacio: { display: 'inline-block', fontSize: '11.5px', color: '#cbd5e1', marginRight: '6px', whiteSpace: 'nowrap' },
  chipOk: { display: 'inline-block', padding: '1px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0', whiteSpace: 'nowrap' },
  chipAlerta: { display: 'inline-block', padding: '1px 9px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a', whiteSpace: 'nowrap' },
  avisoCav: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#92400e', marginBottom: '12px', lineHeight: 1.5 },
  tapadaTag: { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: '#fef3c7', color: '#b45309' },
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
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  cargaCaja: { backgroundColor: '#f8fafc', border: '1px solid #eef2f7', borderRadius: '10px', padding: '16px', marginBottom: '20px' },
  cargaTabs: { display: 'flex', gap: '4px', borderBottom: '1px solid #e2e8f0', marginBottom: '10px' },
  cargaTab: { padding: '7px 16px', border: 'none', background: 'transparent', fontSize: '13.5px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  cargaTabAct: { padding: '7px 16px', border: 'none', background: 'transparent', fontSize: '13.5px', color: '#2563eb', fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid #2563eb' },
  cargaAyuda: { fontSize: '12.5px', color: '#64748b', margin: '0 0 12px', lineHeight: 1.6, maxWidth: '900px' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '500' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
