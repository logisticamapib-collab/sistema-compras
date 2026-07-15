import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import * as XLSX from 'xlsx'
import { calcularRangoFechas, etiquetaPeriodo } from '../../lib/periodos'
import SelectorPeriodo from '../Compras/SelectorPeriodo'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend
} from 'recharts'

// Estatus de OC que ya representan gasto comprometido (no borrador ni en aprobacion, no cancelada)
const ESTATUS_COMPROMETIDOS = ['aprobada', 'enviada_proveedor', 'confirmada', 'en_transito', 'recibida_parcial', 'recibida']

const COLORES = ['#2563eb', '#7c3aed', '#0891b2', '#d97706', '#dc2626', '#16a34a', '#c2410c', '#64748b']

export default function Reportes() {
  const { perfil } = useAuth()
  const [loading, setLoading] = useState(true)
  const [sites, setSites] = useState([])
  const [siteFiltro, setSiteFiltro] = useState('todos')
  const [periodo, setPeriodo] = useState({ tipo: 'ultimos_n_meses', valor: 6 })

  const [ordenes, setOrdenes] = useState([])
  const [ocLineas, setOcLineas] = useState([])
  const [aprobacionesOC, setAprobacionesOC] = useState([])
  const [requisicionesUrgentes, setRequisicionesUrgentes] = useState([])

  const puedeVerTodosLosSites = ['admin', 'gerente_compras', 'direccion'].includes(perfil?.rol)

  useEffect(() => { cargarSites() }, [])
  useEffect(() => { cargarDatos() }, [siteFiltro, periodo, perfil])

  const cargarSites = async () => {
    if (!puedeVerTodosLosSites) return
    const { data } = await supabase.from('sites').select('id, nombre, codigo').eq('empresa_id', perfil.empresa_id)
    setSites(data || [])
  }

  const cargarDatos = async () => {
    if (!perfil) return
    setLoading(true)

    const { desde, hasta } = calcularRangoFechas(periodo)
    const desdeISO = desde.toISOString()
    const hastaISO = hasta.toISOString()

    let queryOrdenes = supabase
      .from('ordenes_compra')
      .select('*, proveedores(nombre), sites(nombre, codigo), requisiciones(criticidad)')
      .eq('empresa_id', perfil.empresa_id)
      .gte('fecha_emision', desdeISO)
      .lte('fecha_emision', hastaISO)

    if (!puedeVerTodosLosSites) {
      queryOrdenes = queryOrdenes.eq('site_id', perfil.site_id)
    } else if (siteFiltro !== 'todos') {
      queryOrdenes = queryOrdenes.eq('site_id', parseInt(siteFiltro))
    }

    const { data: ords } = await queryOrdenes
    setOrdenes(ords || [])

    const idsOrdenes = (ords || []).map(o => o.id)

    const [{ data: lineas }, { data: aprobs }] = await Promise.all([
      idsOrdenes.length > 0
        ? supabase.from('oc_lineas')
            .select('*, centros_costos(codigo, nombre), cuentas_gastos(codigo, nombre)')
            .in('oc_id', idsOrdenes)
        : Promise.resolve({ data: [] }),
      idsOrdenes.length > 0
        ? supabase.from('aprobaciones')
            .select('*')
            .eq('tipo', 'orden_compra')
            .eq('decision', 'aprobada')
            .in('referencia_id', idsOrdenes)
            .order('fecha_decision')
        : Promise.resolve({ data: [] })
    ])
    setOcLineas(lineas || [])
    setAprobacionesOC(aprobs || [])

    // Requisiciones criticidad alta que siguen activas (no completadas/rechazadas/canceladas)
    let queryReq = supabase
      .from('requisiciones')
      .select('*, solicitante:solicitante_id(nombre), sites(nombre, codigo)')
      .eq('empresa_id', perfil.empresa_id)
      .eq('criticidad', 'alta')
      .not('estatus', 'in', '(completada,rechazada,cancelada)')

    if (!puedeVerTodosLosSites) {
      queryReq = queryReq.eq('site_id', perfil.site_id)
    } else if (siteFiltro !== 'todos') {
      queryReq = queryReq.eq('site_id', parseInt(siteFiltro))
    }

    const { data: reqs } = await queryReq
    setRequisicionesUrgentes(reqs || [])

    setLoading(false)
  }

  const ordenesComprometidas = ordenes.filter(o => ESTATUS_COMPROMETIDOS.includes(o.estatus))

  // 1. Gasto total por mes
  const gastoPorMes = (() => {
    const mapa = {}
    for (const o of ordenesComprometidas) {
      const fecha = new Date(o.fecha_emision)
      const clave = `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`
      mapa[clave] = (mapa[clave] || 0) + parseFloat(o.total || 0)
    }
    return Object.entries(mapa)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([mes, total]) => ({ mes, total: parseFloat(total.toFixed(2)) }))
  })()

  // 2. Top proveedores por gasto
  const topProveedores = (() => {
    const mapa = {}
    for (const o of ordenesComprometidas) {
      const nombre = o.proveedores?.nombre || 'Sin proveedor'
      mapa[nombre] = (mapa[nombre] || 0) + parseFloat(o.total || 0)
    }
    return Object.entries(mapa)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([nombre, total]) => ({ nombre, total: parseFloat(total.toFixed(2)) }))
  })()

  // 3. Tiempo promedio de aprobacion por nivel (horas entre paso y paso)
  const tiempoPorNivel = (() => {
    const porOrden = {}
    for (const a of aprobacionesOC) {
      if (!porOrden[a.referencia_id]) porOrden[a.referencia_id] = []
      porOrden[a.referencia_id].push(a)
    }
    const acumulado = {}
    for (const [ordenId, pasos] of Object.entries(porOrden)) {
      const orden = ordenes.find(o => o.id === parseInt(ordenId))
      if (!orden) continue
      pasos.sort((a, b) => new Date(a.fecha_decision) - new Date(b.fecha_decision))
      let anterior = new Date(orden.fecha_emision)
      for (const paso of pasos) {
        const horas = (new Date(paso.fecha_decision) - anterior) / 3600000
        const nivel = paso.rol_requerido || 'otro'
        if (!acumulado[nivel]) acumulado[nivel] = []
        acumulado[nivel].push(horas)
        anterior = new Date(paso.fecha_decision)
      }
    }
    const labels = {
      gerente_area: 'Gerente de Area', gerente_planta: 'Gerente de Planta',
      gerente_administrativo: 'Gerente Administrativo', gerente_compras: 'Gerente de Compras',
      direccion: 'Direccion'
    }
    return Object.entries(acumulado).map(([nivel, horas]) => ({
      nivel: labels[nivel] || nivel,
      horasPromedio: parseFloat((horas.reduce((a, b) => a + b, 0) / horas.length).toFixed(1))
    }))
  })()

  // 4. Entregas a tiempo vs tarde (solo ordenes ya recibidas por completo)
  const entregas = (() => {
    const recibidas = ordenes.filter(o => o.estatus === 'recibida' && o.fecha_entrega_estimada && o.fecha_entrega_real)
    let aTiempo = 0
    let tarde = 0
    for (const o of recibidas) {
      if (new Date(o.fecha_entrega_real) <= new Date(o.fecha_entrega_estimada)) aTiempo++
      else tarde++
    }
    return { aTiempo, tarde, total: recibidas.length }
  })()

  // 5. Urgencias: requisiciones alta pendientes + OC con entrega vencida o proxima (3 dias) sin recibir
  const hoy = new Date()
  const en3dias = new Date()
  en3dias.setDate(hoy.getDate() + 3)
  const ocPorVencer = ordenes.filter(o =>
    !['recibida', 'cancelada'].includes(o.estatus) &&
    o.fecha_entrega_estimada &&
    new Date(o.fecha_entrega_estimada) <= en3dias
  )

  // 6. Gasto por centro de costos y cuenta de gastos
  const gastoPorCC = (() => {
    const mapa = {}
    for (const l of ocLineas) {
      const nombre = l.centros_costos ? `${l.centros_costos.codigo} - ${l.centros_costos.nombre}` : 'Sin centro de costos'
      mapa[nombre] = (mapa[nombre] || 0) + parseFloat(l.subtotal || 0)
    }
    return Object.entries(mapa).sort((a, b) => b[1] - a[1]).map(([nombre, total]) => ({ nombre, total: parseFloat(total.toFixed(2)) }))
  })()

  const gastoPorCG = (() => {
    const mapa = {}
    for (const l of ocLineas) {
      const nombre = l.cuentas_gastos ? `${l.cuentas_gastos.codigo} - ${l.cuentas_gastos.nombre}` : 'Sin cuenta de gastos'
      mapa[nombre] = (mapa[nombre] || 0) + parseFloat(l.subtotal || 0)
    }
    return Object.entries(mapa).sort((a, b) => b[1] - a[1]).map(([nombre, total]) => ({ nombre, total: parseFloat(total.toFixed(2)) }))
  })()

  const gastoTotal = ordenesComprometidas.reduce((sum, o) => sum + parseFloat(o.total || 0), 0)

  const exportarExcel = () => {
    const wb = XLSX.utils.book_new()

    const resumen = [
      ['Reporte KPI de Compras'],
      ['Alcance', puedeVerTodosLosSites ? (siteFiltro === 'todos' ? 'Todos los sites' : sites.find(s => s.id.toString() === siteFiltro)?.nombre) : perfil?.sites?.nombre],
      ['Periodo', etiquetaPeriodo(periodo)],
      ['Generado', new Date().toLocaleString('es-MX')],
      [],
      ['Gasto total comprometido', gastoTotal],
      ['Ordenes en el periodo', ordenesComprometidas.length],
      ['% Entregas a tiempo', entregas.total > 0 ? Math.round((entregas.aTiempo / entregas.total) * 100) + '%' : '-'],
      ['Urgencias activas', requisicionesUrgentes.length + ocPorVencer.length],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen')

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastoPorMes), 'Gasto por mes')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(topProveedores), 'Top proveedores')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastoPorCC), 'Gasto por centro costos')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(gastoPorCG), 'Gasto por cuenta gastos')

    const ordenesDetalle = ordenes.map(o => ({
      Folio: o.folio,
      Tipo: o.tipo,
      Proveedor: o.proveedores?.nombre,
      Site: o.sites?.nombre,
      Estatus: o.estatus,
      Fecha_emision: o.fecha_emision ? new Date(o.fecha_emision).toLocaleDateString('es-MX') : '',
      Entrega_estimada: o.fecha_entrega_estimada ? new Date(o.fecha_entrega_estimada).toLocaleDateString('es-MX') : '',
      Entrega_real: o.fecha_entrega_real ? new Date(o.fecha_entrega_real).toLocaleDateString('es-MX') : '',
      Subtotal: parseFloat(o.subtotal || 0),
      IVA: parseFloat(o.iva || 0),
      Total: parseFloat(o.total || 0),
      Moneda: o.moneda,
    }))
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ordenesDetalle), 'Ordenes (detalle)')

    const urgenciasDetalle = [
      ...requisicionesUrgentes.map(r => ({ Tipo: 'Requisicion Alta', Folio: r.folio, Solicitante: r.solicitante?.nombre, Site: r.sites?.nombre, Fecha_requerida: new Date(r.fecha_requerida).toLocaleDateString('es-MX') })),
      ...ocPorVencer.map(o => ({ Tipo: 'OC por vencer', Folio: o.folio, Proveedor: o.proveedores?.nombre, Site: o.sites?.nombre, Entrega_estimada: new Date(o.fecha_entrega_estimada).toLocaleDateString('es-MX') })),
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(urgenciasDetalle), 'Urgencias')

    XLSX.writeFile(wb, `Reporte_KPI_Compras_${new Date().toISOString().split('T')[0]}.xlsx`)
  }

  const exportarPDF = () => {
    window.print()
  }

  return (
    <div style={styles.container}>
      <div style={styles.encabezado}>
        <div>
          <h2 style={styles.titulo}>Reportes KPI de Compras</h2>
          <p style={styles.subtitulo}>
            {puedeVerTodosLosSites
              ? (siteFiltro === 'todos' ? 'Mostrando todos los sites' : `Site: ${sites.find(s => s.id.toString() === siteFiltro)?.nombre || ''}`)
              : `Site: ${perfil?.sites?.nombre || ''}`}
          </p>
        </div>
        <div style={styles.filtros}>
          {puedeVerTodosLosSites && (
            <select style={styles.select} value={siteFiltro} onChange={e => setSiteFiltro(e.target.value)}>
              <option value="todos">Todos los sites</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          )}
          <SelectorPeriodo periodo={periodo} setPeriodo={setPeriodo} />
          <button style={styles.botonExportar} className="no-imprimir" onClick={exportarExcel}>
            Descargar Excel
          </button>
          <button style={styles.botonExportarPDF} className="no-imprimir" onClick={exportarPDF}>
            Descargar PDF
          </button>
        </div>
      </div>

      <style>{`
        @media print {
          .no-imprimir { display: none !important; }
        }
      `}</style>

      {loading ? <p style={{ color: '#666' }}>Cargando...</p> : (
        <>
          <div style={styles.resumenGrid}>
            <div style={styles.tarjetaResumen}>
              <p style={styles.resumenLabel}>Gasto total comprometido</p>
              <p style={styles.resumenValor}>${gastoTotal.toLocaleString('es-MX', { minimumFractionDigits: 2 })}</p>
            </div>
            <div style={styles.tarjetaResumen}>
              <p style={styles.resumenLabel}>Ordenes en el periodo</p>
              <p style={styles.resumenValor}>{ordenesComprometidas.length}</p>
            </div>
            <div style={styles.tarjetaResumen}>
              <p style={styles.resumenLabel}>Entregas a tiempo</p>
              <p style={styles.resumenValor}>
                {entregas.total > 0 ? `${Math.round((entregas.aTiempo / entregas.total) * 100)}%` : '-'}
              </p>
            </div>
            <div style={{ ...styles.tarjetaResumen, backgroundColor: requisicionesUrgentes.length + ocPorVencer.length > 0 ? '#fef2f2' : '#fff' }}>
              <p style={styles.resumenLabel}>Urgencias activas</p>
              <p style={{ ...styles.resumenValor, color: requisicionesUrgentes.length + ocPorVencer.length > 0 ? '#dc2626' : '#1a1a2e' }}>
                {requisicionesUrgentes.length + ocPorVencer.length}
              </p>
            </div>
          </div>

          <div style={styles.grid2}>
            <div style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Gasto total por mes</h3>
              {gastoPorMes.length === 0 ? <p style={styles.sinDatos}>Sin datos en el periodo</p> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={gastoPorMes}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="mes" style={{ fontSize: '11px' }} />
                    <YAxis style={{ fontSize: '11px' }} />
                    <Tooltip formatter={v => `$${v.toLocaleString('es-MX')}`} />
                    <Bar dataKey="total" fill="#2563eb" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Top proveedores por gasto</h3>
              {topProveedores.length === 0 ? <p style={styles.sinDatos}>Sin datos en el periodo</p> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={topProveedores} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" style={{ fontSize: '11px' }} />
                    <YAxis type="category" dataKey="nombre" width={120} style={{ fontSize: '10px' }} />
                    <Tooltip formatter={v => `$${v.toLocaleString('es-MX')}`} />
                    <Bar dataKey="total" fill="#7c3aed" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div style={styles.grid2}>
            <div style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Tiempo promedio de aprobacion por nivel (horas)</h3>
              {tiempoPorNivel.length === 0 ? <p style={styles.sinDatos}>Sin aprobaciones registradas en el periodo</p> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={tiempoPorNivel}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="nivel" style={{ fontSize: '10px' }} />
                    <YAxis style={{ fontSize: '11px' }} />
                    <Tooltip formatter={v => `${v} hrs`} />
                    <Bar dataKey="horasPromedio" fill="#0891b2" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>

            <div style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Entregas a tiempo vs tarde</h3>
              {entregas.total === 0 ? <p style={styles.sinDatos}>Aun no hay ordenes recibidas en el periodo</p> : (
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={[{ name: 'A tiempo', value: entregas.aTiempo }, { name: 'Tarde', value: entregas.tarde }]}
                      dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={90} label>
                      <Cell fill="#16a34a" />
                      <Cell fill="#dc2626" />
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          <div style={styles.grid2}>
            <div style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Gasto por centro de costos</h3>
              {gastoPorCC.length === 0 ? <p style={styles.sinDatos}>Sin datos en el periodo</p> : (
                <div style={styles.tablaSimple}>
                  {gastoPorCC.map((c, i) => (
                    <div key={c.nombre} style={styles.filaSimple}>
                      <span style={{ ...styles.puntoColor, backgroundColor: COLORES[i % COLORES.length] }} />
                      <span style={{ flex: 1 }}>{c.nombre}</span>
                      <span style={{ fontWeight: '600' }}>${c.total.toLocaleString('es-MX')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={styles.seccion}>
              <h3 style={styles.seccionTitulo}>Gasto por cuenta de gastos</h3>
              {gastoPorCG.length === 0 ? <p style={styles.sinDatos}>Sin datos en el periodo</p> : (
                <div style={styles.tablaSimple}>
                  {gastoPorCG.map((c, i) => (
                    <div key={c.nombre} style={styles.filaSimple}>
                      <span style={{ ...styles.puntoColor, backgroundColor: COLORES[i % COLORES.length] }} />
                      <span style={{ flex: 1 }}>{c.nombre}</span>
                      <span style={{ fontWeight: '600' }}>${c.total.toLocaleString('es-MX')}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div style={styles.seccion}>
            <h3 style={styles.seccionTitulo}>Urgencias activas</h3>
            {requisicionesUrgentes.length === 0 && ocPorVencer.length === 0 ? (
              <p style={styles.sinDatos}>No hay urgencias activas en este momento</p>
            ) : (
              <>
                {requisicionesUrgentes.map(r => (
                  <div key={'req-' + r.id} style={styles.urgenciaItem}>
                    <span style={styles.badgeUrgencia}>REQ Alta</span>
                    <span style={{ flex: 1 }}>{r.folio} - {r.solicitante?.nombre} ({r.sites?.nombre})</span>
                    <span style={{ color: '#666', fontSize: '12px' }}>
                      Requerida: {new Date(r.fecha_requerida).toLocaleDateString('es-MX')}
                    </span>
                  </div>
                ))}
                {ocPorVencer.map(o => (
                  <div key={'oc-' + o.id} style={styles.urgenciaItem}>
                    <span style={{ ...styles.badgeUrgencia, backgroundColor: '#fef3c7', color: '#c2410c' }}>OC por vencer</span>
                    <span style={{ flex: 1 }}>{o.folio} - {o.proveedores?.nombre} ({o.sites?.nombre})</span>
                    <span style={{ color: '#666', fontSize: '12px' }}>
                      Entrega estimada: {new Date(o.fecha_entrega_estimada).toLocaleDateString('es-MX')}
                    </span>
                  </div>
                ))}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 4px 0' },
  subtitulo: { fontSize: '13px', color: '#666', margin: '0' },
  filtros: { display: 'flex', gap: '10px' },
  select: { padding: '8px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', backgroundColor: '#fff' },
  botonExportar: { padding: '8px 16px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  botonExportarPDF: { padding: '8px 16px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  resumenGrid: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '20px' },
  tarjetaResumen: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  resumenLabel: { fontSize: '12px', color: '#666', margin: '0 0 6px 0' },
  resumenValor: { fontSize: '22px', fontWeight: '700', color: '#1a1a2e', margin: '0' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' },
  seccion: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  seccionTitulo: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 14px 0' },
  sinDatos: { color: '#94a3b8', fontSize: '13px' },
  tablaSimple: { display: 'flex', flexDirection: 'column', gap: '10px' },
  filaSimple: { display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' },
  puntoColor: { width: '10px', height: '10px', borderRadius: '50%', flexShrink: 0 },
  urgenciaItem: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' },
  badgeUrgencia: { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600', backgroundColor: '#fef2f2', color: '#dc2626' },
}
