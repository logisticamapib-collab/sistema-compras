import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'

// Capa 3 - Consultas de Inventario: reportes combinables y bajos de inventario.
// Filtros: texto, categoria (tipo de mercancia), origen, cliente, almacen, estatus de calidad.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const NOMBRE_CALIDAD = { retenido: 'Retenido', liberado: 'Liberado', rechazado: 'Rechazado' }

export default function ConsultasInventario() {
  const { perfil } = useAuth()
  const [vista, setVista] = useState('existencias')
  const [site, setSite] = useState('')
  const [articulos, setArticulos] = useState([])
  const [categorias, setCategorias] = useState([])
  const [clientes, setClientes] = useState([])
  const [artCliente, setArtCliente] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [artProveedor, setArtProveedor] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [lotes, setLotes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [loading, setLoading] = useState(true)

  const [fTexto, setFTexto] = useState('')
  const [fCategoria, setFCategoria] = useState('')
  const [fOrigen, setFOrigen] = useState('')
  const [fCliente, setFCliente] = useState('')
  const [fProveedor, setFProveedor] = useState('')
  const [fAlmacen, setFAlmacen] = useState('')
  const [fCalidad, setFCalidad] = useState('')
  const [expandido, setExpandido] = useState(null)
  const [almAbierto, setAlmAbierto] = useState({})
  const [contenedores, setContenedores] = useState([])

  useEffect(() => { cargarDatos() }, [site])

  const cargarDatos = async () => {
    setLoading(true)
    const [art, cat, cli, ac, alm, cont, ubi, lot, ex, prov, ap] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, categoria_id, origen, es_consigna, stock_minimo').eq('empresa_id', perfil.empresa_id).eq('activo', true),
      supabase.from('categorias').select('*'),
      supabase.from('clientes').select('id, nombre').eq('activo', true),
      supabase.from('articulo_cliente').select('articulo_id, cliente_id').eq('activo', true),
      supabase.from('almacenes').select('*'),
      supabase.from('contenedores').select('id, folio, tipo, lote_id, articulo_id, cantidad, almacen_id, ubicacion_id').eq('empresa_id', perfil.empresa_id).eq('estatus', 'activo'),
      supabase.from('ubicaciones').select('*'),
      supabase.from('lotes').select('id, articulo_id, codigo_lote, estatus_calidad'),
      supabase.from('existencias').select('*'),
      supabase.from('proveedores').select('id, nombre').eq('activo', true),
      supabase.from('articulo_proveedor').select('articulo_id, proveedor_id').eq('activo', true),
    ])
    const _sid = siteEfectivo(perfil, site)
    setArticulos(art.data || [])
    setCategorias(cat.data || [])
    setClientes(cli.data || [])
    setArtCliente(ac.data || [])
    setAlmacenes(alm.data || [])
    setUbicaciones(ubi.data || [])
    setLotes(lot.data || [])
    setContenedores(cont.data || [])
    setExistencias(((ex.data) || []).filter(x => { if (!_sid) return true; const _a = (alm.data || []).find(z => z.id === x.almacen_id); return _a && _a.site_id === _sid }))
    setProveedores(prov.data || [])
    setArtProveedor(ap.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const catDe = (id) => categorias.find(c => c.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const clientesDeArt = (artId) => artCliente.filter(x => x.articulo_id === artId).map(x => x.cliente_id)
  const proveedoresDeArt = (artId) => artProveedor.filter(x => x.articulo_id === artId).map(x => x.proveedor_id)

  // Existencias enriquecidas + filtradas
  const filas = existencias.map(e => {
    const lote = loteDe(e.lote_id); const art = lote ? artDe(lote.articulo_id) : null
    return { ...e, _lote: lote, _art: art }
  }).filter(e => e._art)
    .filter(e => !fCategoria || e._art.categoria_id === Number(fCategoria))
    .filter(e => !fOrigen || (fOrigen === 'consigna' ? e._art.es_consigna : (e._art.origen === fOrigen && !e._art.es_consigna)))
    .filter(e => !fProveedor || proveedoresDeArt(e._art.id).includes(Number(fProveedor)))
    .filter(e => !fCliente || clientesDeArt(e._art.id).includes(Number(fCliente)))
    .filter(e => !fAlmacen || e.almacen_id === Number(fAlmacen))
    .filter(e => !fCalidad || e._lote.estatus_calidad === fCalidad)
    .filter(e => {
      if (!fTexto) return true
      const t = fTexto.toLowerCase()
      return e._art.codigo_interno.toLowerCase().includes(t) || e._art.descripcion.toLowerCase().includes(t) || e._lote.codigo_lote.toLowerCase().includes(t)
    })

  const colsInv = [{ label: 'Codigo', get: e => e._art.codigo_interno }, { label: 'Descripcion', get: e => e._art.descripcion }, { label: 'Lote', get: e => e._lote.codigo_lote }, { label: 'Calidad', get: e => e._lote.estatus_calidad }, { label: 'Almacen', get: e => almacenes.find(a => a.id === e.almacen_id)?.clave || '' }, { label: 'Cantidad', get: e => e.cantidad }, { label: 'Unidad', get: e => e._art.unidad_medida }]
  const totalGeneral = filas.reduce((s, e) => s + Number(e.cantidad), 0)
  // Encabezado: cuanto esta DISPONIBLE (liberado) y cuanto DETENIDO (retenido, cuarentena, rechazado)
  const ESTADOS_DETENIDO = ['retenido', 'cuarentena', 'rechazado', 'scrap']
  const totDisponible = filas.filter(e => e._lote.estatus_calidad === 'liberado').reduce((s, e) => s + Number(e.cantidad), 0)
  const totDetenido = filas.filter(e => ESTADOS_DETENIDO.includes(e._lote.estatus_calidad)).reduce((s, e) => s + Number(e.cantidad), 0)
  // Lote PADRE: agrupa el lote original con sus hijos (-Q, -R) para ver la corrida completa
  const raizDe = (lote) => {
    let l = lote, guard = 0
    while (l?.lote_padre_id && guard < 10) { const p = lotes.find(x => x.id === l.lote_padre_id); if (!p) break; l = p; guard++ }
    return l || lote
  }

  // Agrupacion por articulo (solo para la vista; el export sigue usando 'filas')
  const grupos = []
  filas.forEach(e => {
    let g = grupos.find(x => x.articulo_id === e._art.id)
    if (!g) { g = { articulo_id: e._art.id, art: e._art, total: 0, lotes: new Set(), filas: [] }; grupos.push(g) }
    g.total += Number(e.cantidad)
    g.lotes.add(e._lote.codigo_lote)
    g.filas.push(e)
  })
  grupos.forEach(g => {
    g.filas.sort((a, b) => (almDe(a.almacen_id)?.clave || '').localeCompare(almDe(b.almacen_id)?.clave || ''))
    // Nivel 2: LOTE PADRE (corrida)  |  Nivel 3: lote-caja por ubicacion
    const porPadre = {}
    g.filas.forEach(f => {
      const raiz = raizDe(f._lote)
      const p = (porPadre[raiz.id] = porPadre[raiz.id] || { padre: raiz, total: 0, disponible: 0, detenido: 0, hijos: [] })
      p.total += Number(f.cantidad)
      if (f._lote.estatus_calidad === 'liberado') p.disponible += Number(f.cantidad)
      if (ESTADOS_DETENIDO.includes(f._lote.estatus_calidad)) p.detenido += Number(f.cantidad)
      const cajas = contenedores.filter(c => c.lote_id === f.lote_id && c.almacen_id === f.almacen_id
        && (c.ubicacion_id || null) === (f.ubicacion_id || null) && c.tipo === 'caja')
      p.hijos.push({ ...f, cajas, esHijo: raiz.id !== f._lote.id })
    })
    g.padres = Object.values(porPadre).sort((x, y) => (x.padre.codigo_lote || '').localeCompare(y.padre.codigo_lote || ''))
    g.retenido = g.filas.filter(f => f._lote.estatus_calidad === 'retenido').reduce((s, f) => s + Number(f.cantidad), 0)
    g.liberado = g.filas.filter(f => f._lote.estatus_calidad === 'liberado').reduce((s, f) => s + Number(f.cantidad), 0)
    g.rechazado = g.filas.filter(f => f._lote.estatus_calidad === 'rechazado').reduce((s, f) => s + Number(f.cantidad), 0)
  })
  grupos.sort((a, b) => a.art.codigo_interno.localeCompare(b.art.codigo_interno))

  // VISTA POR LOTE-CAJA: una fila por caja (o por lote si el material es granel)
  const filasCaja = []
  filas.forEach(e => {
    const raiz = raizDe(e._lote)
    const detenido = ESTADOS_DETENIDO.includes(e._lote.estatus_calidad)
    const cajas = contenedores.filter(c => c.lote_id === e.lote_id && c.almacen_id === e.almacen_id
      && (c.ubicacion_id || null) === (e.ubicacion_id || null) && c.tipo === 'caja')
    if (cajas.length > 0) {
      cajas.forEach(c => filasCaja.push({
        key: `c${c.id}`, art: e._art, loteCaja: c.folio, lotePadre: raiz.codigo_lote,
        almacen_id: e.almacen_id, ubicacion_id: c.ubicacion_id, cantidad: Number(c.cantidad),
        detenido, estatusCal: e._lote.estatus_calidad,
      }))
    } else {
      filasCaja.push({
        key: `e${e.id}`, art: e._art, loteCaja: '(granel)', lotePadre: raiz.codigo_lote,
        almacen_id: e.almacen_id, ubicacion_id: e.ubicacion_id, cantidad: Number(e.cantidad),
        detenido, estatusCal: e._lote.estatus_calidad,
      })
    }
  })
  filasCaja.sort((a, b) => (a.art.codigo_interno || '').localeCompare(b.art.codigo_interno || '')
    || String(a.loteCaja).localeCompare(String(b.loteCaja)))
  const colsCajas = [
    { label: 'Articulo', get: r => r.art.codigo_interno },
    { label: 'Descripcion', get: r => r.art.descripcion },
    { label: 'Lote de caja', get: r => r.loteCaja },
    { label: 'Lote padre', get: r => r.lotePadre },
    { label: 'Almacen', get: r => almDe(r.almacen_id)?.clave || '' },
    { label: 'Cantidad', get: r => r.cantidad },
    { label: 'Estatus', get: r => r.detenido ? 'Detenido' : 'Disponible' },
  ]

  // VISTA POR UBICACION (plana): almacen > ubicacion, un renglon por lote-caja
  const filasUbic = [...filasCaja].sort((a, b) =>
    (almDe(a.almacen_id)?.clave || '').localeCompare(almDe(b.almacen_id)?.clave || '')
    || (ubiDe(a.ubicacion_id)?.clave || '').localeCompare(ubiDe(b.ubicacion_id)?.clave || '')
    || (a.art.codigo_interno || '').localeCompare(b.art.codigo_interno || '')
    || String(a.loteCaja).localeCompare(String(b.loteCaja)))
  const colsUbic = [
    { label: 'Almacen', get: r => almDe(r.almacen_id)?.clave || '' },
    { label: 'Ubicacion', get: r => ubiDe(r.ubicacion_id)?.clave || '' },
    { label: 'Lote de caja', get: r => r.loteCaja },
    { label: 'Lote padre', get: r => r.lotePadre },
    { label: 'Articulo', get: r => r.art.codigo_interno },
    { label: 'Descripcion', get: r => r.art.descripcion },
    { label: 'Cantidad', get: r => r.cantidad },
    { label: 'Estatus', get: r => r.detenido ? 'Detenido' : 'Disponible' },
  ]

  // Bajos de inventario: total por articulo vs stock_minimo (>0)
  const totalesPorArt = {}
  existencias.forEach(e => {
    const lote = loteDe(e.lote_id); if (!lote) return
    totalesPorArt[lote.articulo_id] = (totalesPorArt[lote.articulo_id] || 0) + Number(e.cantidad)
  })
  const bajos = articulos
    .filter(a => Number(a.stock_minimo) > 0)
    .map(a => ({ art: a, total: totalesPorArt[a.id] || 0, min: Number(a.stock_minimo) }))
    .filter(x => x.total < x.min)
    .filter(x => !fCategoria || x.art.categoria_id === Number(fCategoria))
    .filter(x => !fOrigen || (fOrigen === 'consigna' ? x.art.es_consigna : (x.art.origen === fOrigen && !x.art.es_consigna)))
    .sort((a, b) => (a.total / a.min) - (b.total / b.min))

  const exportar = () => {
    const datos = filas.map(e => ({
      'Codigo': e._art.codigo_interno, 'Descripcion': e._art.descripcion,
      'Categoria': catDe(e._art.categoria_id)?.nombre || '', 'Origen': e._art.origen,
      'Lote': e._lote.codigo_lote, 'Almacen': almDe(e.almacen_id)?.clave || '',
      'Ubicacion': e.ubicacion_id ? ubiDe(e.ubicacion_id)?.clave : '',
      'Cantidad': Number(e.cantidad), 'UM': e._art.unidad_medida || '', 'Calidad': NOMBRE_CALIDAD[e._lote.estatus_calidad],
    }))
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(datos), 'Existencias')
    XLSX.writeFile(wb, `consulta_inventario_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const limpiar = () => { setFTexto(''); setFCategoria(''); setFOrigen(''); setFCliente(''); setFProveedor(''); setFAlmacen(''); setFCalidad('') }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Consultas de Inventario</h2>
        {vista === 'cajas' && filasCaja.length > 0 && <button style={styles.botonSec} onClick={() => exportarExcel('inventario_por_caja', colsCajas, filasCaja)}>Exportar Excel</button>}
        {vista === 'ubicacion' && filasUbic.length > 0 && <button style={styles.botonSec} onClick={() => exportarExcel('inventario_por_ubicacion', colsUbic, filasUbic)}>Exportar Excel</button>}
        {vista === 'existencias' && filas.length > 0 && <button style={styles.botonSec} onClick={exportar}>Exportar Excel</button>}
        {vista === 'cajas' && filasCaja.length > 0 && <button style={styles.botonSec} onClick={() => imprimirTablaPDF('Inventario por lote-caja', colsCajas, filasCaja)}>PDF</button>}
        {vista === 'ubicacion' && filasUbic.length > 0 && <button style={styles.botonSec} onClick={() => imprimirTablaPDF('Inventario por ubicacion', colsUbic, filasUbic)}>PDF</button>}
        {vista === 'existencias' && filas.length > 0 && <button style={styles.botonSec} onClick={() => imprimirTablaPDF('Inventario', colsInv, filas)}>PDF</button>}
      </div>

      <div style={styles.tabs}>
        {[['existencias', 'Existencias'], ['cajas', 'Por lote-caja'], ['ubicacion', 'Por ubicacion'], ['bajos', `Bajos de inventario${bajos.length ? ` (${bajos.length})` : ''}`]].map(([id, nombre]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{nombre}</button>
        ))}
      </div>

      <div style={styles.filtros}>
        <FiltroSite value={site} onChange={setSite} />
        <input style={{ ...styles.input, flex: 1.3 }} placeholder="Codigo, descripcion o lote..." value={fTexto} onChange={e => setFTexto(e.target.value)} />
        <select style={styles.input} value={fCategoria} onChange={e => setFCategoria(e.target.value)}>
          <option value="">Toda categoria</option>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <select style={styles.input} value={fOrigen} onChange={e => setFOrigen(e.target.value)}>
          <option value="">Todo origen</option>
          <option value="comprado">Comprado</option>
          <option value="fabricado">Fabricado</option>
          <option value="consigna">Consigna</option>
        </select>
        {vista === 'existencias' && (
        <div style={styles.resumenTot}>
          <span>Inventario total: <b>{fmtNum(totalGeneral)}</b></span>
          <span style={{ color: '#15803d' }}>Disponible: <b>{fmtNum(totDisponible)}</b></span>
          <span style={{ color: '#b45309' }}>Detenido: <b>{fmtNum(totDetenido)}</b></span>
          <span style={{ color: '#64748b' }}>{grupos.length} articulo(s)</span>
        </div>
      )}
      {vista === 'existencias' && (
          <>
            <select style={styles.input} value={fCliente} onChange={e => setFCliente(e.target.value)}>
              <option value="">Todo cliente</option>
              {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
            </select>
            <select style={styles.input} value={fProveedor} onChange={e => setFProveedor(e.target.value)}>
              <option value="">Todo proveedor</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
            <select style={styles.input} value={fAlmacen} onChange={e => setFAlmacen(e.target.value)}>
              <option value="">Todo almacen</option>
              {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave}</option>)}
            </select>
            <select style={styles.input} value={fCalidad} onChange={e => setFCalidad(e.target.value)}>
              <option value="">Toda calidad</option>
              <option value="liberado">Liberado</option>
              <option value="retenido">Retenido</option>
              <option value="rechazado">Rechazado</option>
            </select>
          </>
        )}
        <button style={styles.botonSec} onClick={limpiar}>Limpiar</button>
      </div>

      {/* ==================== EXISTENCIAS ==================== */}
      {vista === 'existencias' && (
        filas.length === 0 ? (
          <p style={{ color: '#666', padding: '10px 4px' }}>Sin resultados con estos filtros.</p>
        ) : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 2.6 }}>Articulo</span>
              <span style={{ flex: 1 }}>Categoria</span>
              <span style={{ flex: 0.8, textAlign: 'center' }}>Ubicaciones</span>
              <span style={{ flex: 0.7, textAlign: 'center' }}>Lotes</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Existencia</span>
              <span style={{ flex: 1.5, textAlign: 'center' }}>Por estatus</span>
            </div>
            {grupos.map(g => {
              const abierto = expandido === g.articulo_id
              return (
                <div key={g.articulo_id}>
                  <div style={{ ...styles.tablaFila, cursor: 'pointer' }} className="fila-hover" onClick={() => setExpandido(abierto ? null : g.articulo_id)}>
                    <span style={{ flex: 2.6 }}>{abierto ? '\u25BC' : '\u25B6'} <b>{g.art.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {g.art.descripcion}</span></span>
                    <span style={{ flex: 1, color: '#64748b', fontSize: '13px' }}>{catDe(g.art.categoria_id)?.nombre || '-'}</span>
                    <span style={{ flex: 0.8, textAlign: 'center', fontWeight: '600' }}>{g.filas.length}</span>
                    <span style={{ flex: 0.7, textAlign: 'center', color: '#64748b' }}>{g.lotes.size}</span>
                    <span style={{ flex: 1, textAlign: 'right', fontWeight: '600' }}>{fmtNum(g.total)} {g.art.unidad_medida || ''}</span>
                    <span style={{ flex: 1.5, textAlign: 'center', display: 'flex', gap: '4px', justifyContent: 'center', flexWrap: 'wrap' }}>
                      {g.liberado > 0 && <span style={{ ...styles.badge, ...styles.badgeVerde }}>Lib {fmtNum(g.liberado)}</span>}
                      {g.retenido > 0 && <span style={{ ...styles.badge, ...styles.badgeAmbar }}>Ret {fmtNum(g.retenido)}</span>}
                      {g.rechazado > 0 && <span style={{ ...styles.badge, ...styles.badgeRojo }}>Rech {fmtNum(g.rechazado)}</span>}
                    </span>
                  </div>
                  {abierto && (
                    <div style={styles.subTabla}>
                      {g.padres.map(p => {
                        const key = `${g.articulo_id}-${p.padre.id}`
                        const abiertoP = !!almAbierto[key]
                        return (
                          <div key={p.padre.id}>
                            {/* NIVEL 2: lote padre (corrida) */}
                            <div style={{ ...styles.tablaFila, padding: '8px 20px', fontSize: '13px', cursor: 'pointer', backgroundColor: '#f8fafc' }}
                              onClick={() => setAlmAbierto({ ...almAbierto, [key]: !abiertoP })}>
                              <span style={{ flex: 2, fontWeight: 600 }}>{abiertoP ? '\u25BC' : '\u25B6'} Lote {p.padre.codigo_lote}</span>
                              <span style={{ flex: 1.4, textAlign: 'center' }}>
                                {p.disponible > 0 && <span style={{ ...styles.badge, ...styles.badgeVerde }}>Disp {fmtNum(p.disponible)}</span>}
                                {p.detenido > 0 && <span style={{ ...styles.badge, ...styles.badgeAmbar, marginLeft: '4px' }}>Detenido {fmtNum(p.detenido)}</span>}
                              </span>
                              <span style={{ flex: 0.9, textAlign: 'center', color: '#64748b' }}>{p.hijos.length} ubic./lote</span>
                              <span style={{ flex: 1, textAlign: 'right', fontWeight: 700 }}>{fmtNum(p.total)} {g.art.unidad_medida || ''}</span>
                            </div>
                            {/* NIVEL 3: lote-caja por ubicacion */}
                            {abiertoP && p.hijos.map(h => (
                              <div key={h.id} style={{ padding: '6px 20px 6px 44px', borderBottom: '1px solid #f1f5f9', fontSize: '12.5px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                  <span style={{ flex: 1.4, fontWeight: 600 }}>{h._lote.codigo_lote}{h.esHijo && <span style={{ ...styles.badge, ...styles.badgeAmbar, marginLeft: '4px' }}>hijo</span>}</span>
                                  <span style={{ flex: 1.4, color: '#64748b' }}>{almDe(h.almacen_id)?.clave}{h.ubicacion_id ? ` / ${ubiDe(h.ubicacion_id)?.clave}` : ''}</span>
                                  <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 600 }}>{fmtNum(h.cantidad)}</span>
                                  <span style={{ flex: 0.8, textAlign: 'center' }}>
                                    <span style={{ ...styles.badge, ...(h._lote.estatus_calidad === 'liberado' ? styles.badgeVerde : h._lote.estatus_calidad === 'rechazado' ? styles.badgeRojo : styles.badgeAmbar) }}>{NOMBRE_CALIDAD[h._lote.estatus_calidad] || h._lote.estatus_calidad}</span>
                                  </span>
                                </div>
                                {h.cajas.length > 0 ? (
                                  <div style={{ marginTop: '4px', display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                    {h.cajas.map(c => <span key={c.id} style={styles.cajaChip}>{c.folio} · {fmtNum(c.cantidad)}</span>)}
                                  </div>
                                ) : <div style={{ color: '#94a3b8', fontSize: '11.5px', marginTop: '3px' }}>sin cajas registradas (granel o sin etiquetar)</div>}
                              </div>
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            <div style={{ ...styles.tablaFila, backgroundColor: '#f8fafc', fontWeight: '600' }}>
              <span style={{ flex: 5.1 }}>Total: {grupos.length} articulo(s) en {filas.length} ubicacion(es)</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(totalGeneral)}</span>
              <span style={{ flex: 1.5 }}></span>
            </div>
          </div>
        )
      )}

      {/* ==================== BAJOS ==================== */}
      {vista === 'cajas' && (
        <>
          <div style={styles.resumenTot}>
            <span>Lotes-caja: <b>{fmtNum(filasCaja.length)}</b></span>
            <span>Total: <b>{fmtNum(filasCaja.reduce((s, r) => s + r.cantidad, 0))}</b></span>
            <span style={{ color: '#15803d' }}>Disponible: <b>{fmtNum(filasCaja.filter(r => !r.detenido).reduce((s, r) => s + r.cantidad, 0))}</b></span>
            <span style={{ color: '#b45309' }}>Detenido: <b>{fmtNum(filasCaja.filter(r => r.detenido).reduce((s, r) => s + r.cantidad, 0))}</b></span>
          </div>
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1.1 }}>Articulo</span>
              <span style={{ flex: 1.8 }}>Descripcion</span>
              <span style={{ flex: 1.2 }}>Lote de caja</span>
              <span style={{ flex: 1.1 }}>Lote padre</span>
              <span style={{ flex: 1 }}>Almacen</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>Cantidad</span>
              <span style={{ flex: 0.9, textAlign: 'center' }}>Estatus</span>
            </div>
            {filasCaja.map(r => (
              <div key={r.key} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
                <span style={{ flex: 1.1, fontWeight: 600 }}>{r.art.codigo_interno}</span>
                <span style={{ flex: 1.8, color: '#64748b' }}>{r.art.descripcion}</span>
                <span style={{ flex: 1.2, fontWeight: 600, color: r.loteCaja === '(granel)' ? '#94a3b8' : '#1a1a2e' }}>{r.loteCaja}</span>
                <span style={{ flex: 1.1, color: '#64748b' }}>{r.lotePadre}</span>
                <span style={{ flex: 1, color: '#64748b' }}>{almDe(r.almacen_id)?.clave}{r.ubicacion_id ? ` / ${ubiDe(r.ubicacion_id)?.clave}` : ''}</span>
                <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 600 }}>{fmtNum(r.cantidad)} {r.art.unidad_medida || ''}</span>
                <span style={{ flex: 0.9, textAlign: 'center' }}>
                  <span style={{ ...styles.badge, ...(r.detenido ? styles.badgeAmbar : styles.badgeVerde) }}>{r.detenido ? 'Detenido' : 'Disponible'}</span>
                </span>
              </div>
            ))}
            {filasCaja.length === 0 && <p style={{ color: '#666', padding: '12px 18px' }}>Sin material con estos filtros.</p>}
          </div>
        </>
      )}

      {vista === 'ubicacion' && (
        <>
          <div style={styles.resumenTot}>
            <span>Renglones: <b>{fmtNum(filasUbic.length)}</b></span>
            <span>Ubicaciones: <b>{fmtNum(new Set(filasUbic.map(r => `${r.almacen_id}-${r.ubicacion_id || 0}`)).size)}</b></span>
            <span>Total: <b>{fmtNum(filasUbic.reduce((s2, r) => s2 + r.cantidad, 0))}</b></span>
            <span style={{ color: '#15803d' }}>Disponible: <b>{fmtNum(filasUbic.filter(r => !r.detenido).reduce((s2, r) => s2 + r.cantidad, 0))}</b></span>
            <span style={{ color: '#b45309' }}>Detenido: <b>{fmtNum(filasUbic.filter(r => r.detenido).reduce((s2, r) => s2 + r.cantidad, 0))}</b></span>
          </div>
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 1 }}>Almacen</span>
              <span style={{ flex: 1 }}>Ubicacion</span>
              <span style={{ flex: 1.2 }}>Lote de caja</span>
              <span style={{ flex: 1.1 }}>Lote padre</span>
              <span style={{ flex: 1.1 }}>Articulo</span>
              <span style={{ flex: 1.7 }}>Descripcion</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>Cantidad</span>
              <span style={{ flex: 0.9, textAlign: 'center' }}>Estatus</span>
            </div>
            {filasUbic.map(r => (
              <div key={`u-${r.key}`} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
                <span style={{ flex: 1, fontWeight: 600 }}>{almDe(r.almacen_id)?.clave}</span>
                <span style={{ flex: 1, color: '#64748b' }}>{ubiDe(r.ubicacion_id)?.clave || '(sin ubicacion)'}</span>
                <span style={{ flex: 1.2, fontWeight: 600, color: r.loteCaja === '(granel)' ? '#94a3b8' : '#1a1a2e' }}>{r.loteCaja}</span>
                <span style={{ flex: 1.1, color: '#64748b' }}>{r.lotePadre}</span>
                <span style={{ flex: 1.1, fontWeight: 600 }}>{r.art.codigo_interno}</span>
                <span style={{ flex: 1.7, color: '#64748b' }}>{r.art.descripcion}</span>
                <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 600 }}>{fmtNum(r.cantidad)} {r.art.unidad_medida || ''}</span>
                <span style={{ flex: 0.9, textAlign: 'center' }}>
                  <span style={{ ...styles.badge, ...(r.detenido ? styles.badgeAmbar : styles.badgeVerde) }}>{r.detenido ? 'Detenido' : 'Disponible'}</span>
                </span>
              </div>
            ))}
            {filasUbic.length === 0 && <p style={{ color: '#666', padding: '12px 18px' }}>Sin material con estos filtros.</p>}
          </div>
        </>
      )}

      {vista === 'bajos' && (
        bajos.length === 0 ? (
          <p style={{ color: '#666', padding: '10px 4px' }}>No hay articulos por debajo de su stock minimo (define el stock minimo en Articulos).</p>
        ) : (
          <div style={styles.tabla}>
            <div style={styles.tablaHeader}>
              <span style={{ flex: 2.4 }}>Articulo</span>
              <span style={{ flex: 1 }}>Categoria</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Existencia</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Stock minimo</span>
              <span style={{ flex: 1, textAlign: 'right' }}>Faltante</span>
            </div>
            {bajos.map(x => (
              <div key={x.art.id} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
                <span style={{ flex: 2.4 }}><b>{x.art.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {x.art.descripcion}</span></span>
                <span style={{ flex: 1, color: '#64748b' }}>{catDe(x.art.categoria_id)?.nombre || '-'}</span>
                <span style={{ flex: 1, textAlign: 'right', fontWeight: '600', color: x.total === 0 ? '#dc2626' : '#b45309' }}>{fmtNum(x.total)}</span>
                <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(x.min)}</span>
                <span style={{ flex: 1, textAlign: 'right', fontWeight: '600', color: '#dc2626' }}>{fmtNum(x.min - x.total)}</span>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActiva: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#2563eb', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #2563eb' },
  filtros: { display: 'flex', gap: '10px', marginBottom: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flexWrap: 'wrap', alignItems: 'center' },
  input: { padding: '8px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botonSec: { padding: '8px 16px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  subTabla: { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '2px 0 6px' },
  resumenTot: { display: 'flex', gap: '22px', flexWrap: 'wrap', padding: '12px 18px', backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '10px', marginBottom: '12px', fontSize: '13.5px' },
  cajaChip: { display: 'inline-block', padding: '2px 8px', borderRadius: '5px', backgroundColor: '#eef2ff', color: '#4338ca', fontSize: '11px', fontWeight: 600, border: '1px solid #e0e7ff' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeRojo: { backgroundColor: '#fee2e2', color: '#dc2626' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
}
