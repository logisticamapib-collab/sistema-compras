import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// KPI de variacion de demanda (Customer Service). Lee la bitacora release_cambios
// via RPC kpi_variacion_demanda y muestra incrementos/decrementos/neto por
// cliente, articulo, periodo, tipo y origen. Base para medir estabilidad de la
// demanda del cliente (alta/incremento/decremento/cancelacion; manual/excel).

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtPct = (n) => n == null ? '-' : (Number(n)).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
const hoy = () => new Date().toISOString().split('T')[0]
const haceDias = (d) => { const f = new Date(); f.setDate(f.getDate() - d); return f.toISOString().split('T')[0] }

const TIPOS = [
  { value: 'alta', label: 'Alta' },
  { value: 'incremento', label: 'Incremento' },
  { value: 'decremento', label: 'Decremento' },
  { value: 'cancelacion', label: 'Cancelacion' },
]
const ORIGENES = [{ value: 'manual', label: 'Manual' }, { value: 'excel', label: 'Carga Excel' }]

export default function VariacionDemanda() {
  const { perfil } = useAuth()

  const [clientes, setClientes] = useState([])
  const [articulos, setArticulos] = useState([])
  const [filas, setFilas] = useState([])           // grano crudo del RPC
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [vista, setVista] = useState('resumen')

  // filtros
  const [desde, setDesde] = useState(haceDias(180))
  const [hasta, setHasta] = useState(hoy())
  const [cliente, setCliente] = useState('')
  const [articulo, setArticulo] = useState('')
  const [tipo, setTipo] = useState('')            // '' = todos
  const [origen, setOrigen] = useState('')        // '' = todos

  useEffect(() => { cargarCatalogos().then(consultar) }, [])

  const cargarCatalogos = async () => {
    const [c, a] = await Promise.all([
      supabase.from('clientes').select('id, nombre').order('nombre'),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', perfil.empresa_id),
    ])
    setClientes(c.data || []); setArticulos(a.data || [])
  }

  const consultar = async () => {
    setLoading(true); setError('')
    const { data, error: e } = await supabase.rpc('kpi_variacion_demanda', {
      p_empresa: perfil.empresa_id,
      p_desde: desde || null,
      p_hasta: hasta || null,
      p_cliente: cliente ? Number(cliente) : null,
      p_articulo: articulo ? Number(articulo) : null,
    })
    if (e) { setError('Error al consultar: ' + e.message); setFilas([]); setLoading(false); return }
    setFilas(data || [])
    setLoading(false)
  }

  const cliDe = (id) => clientes.find(c => c.id === id)?.nombre || `Cliente ${id}`
  const artDe = (id) => articulos.find(a => a.id === id)
  const codArt = (id) => artDe(id)?.codigo_interno || `Art ${id}`

  // filtros client-side sobre el grano (tipo/origen viven en el grano)
  const filasFiltradas = filas.filter(f =>
    (!tipo || f.tipo === tipo) && (!origen || f.origen === origen))

  const num = (x) => Number(x) || 0

  const agrupar = (llave) => {
    const m = new Map()
    for (const f of filasFiltradas) {
      const k = llave(f)
      const g = m.get(k) || { k, n: 0, incr: 0, decr: 0, neto: 0, base: 0 }
      g.n += num(f.n); g.incr += num(f.incrementos); g.decr += num(f.decrementos)
      g.neto += num(f.neto); g.base += num(f.base_anterior)
      m.set(k, g)
    }
    return [...m.values()].map(g => ({ ...g, pct: g.base > 0 ? (g.neto / g.base) * 100 : null }))
  }

  const total = filasFiltradas.reduce((t, f) => ({
    n: t.n + num(f.n), incr: t.incr + num(f.incrementos), decr: t.decr + num(f.decrementos),
    neto: t.neto + num(f.neto), base: t.base + num(f.base_anterior),
  }), { n: 0, incr: 0, decr: 0, neto: 0, base: 0 })
  const pctGlobal = total.base > 0 ? (total.neto / total.base) * 100 : null

  const porCliente = agrupar(f => f.cliente_id).sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto))
  const porArticulo = agrupar(f => f.articulo_id).sort((a, b) => Math.abs(b.neto) - Math.abs(a.neto))
  const porPeriodo = agrupar(f => f.periodo || 'Sin fecha').sort((a, b) => String(a.k).localeCompare(String(b.k)))
  const porTipo = agrupar(f => f.tipo)
  const porOrigen = agrupar(f => f.origen)

  const exportar = () => {
    const wb = XLSX.utils.book_new()
    const resumen = [
      ['Variacion de Demanda', ''],
      ['Rango', `${desde || 'inicio'} a ${hasta || 'hoy'}`],
      ['Cliente', cliente ? cliDe(Number(cliente)) : 'Todos'],
      ['Articulo', articulo ? codArt(Number(articulo)) : 'Todos'],
      ['Tipo', tipo || 'Todos'], ['Origen', origen || 'Todos'],
      [], ['Cambios', total.n], ['Incrementos', total.incr], ['Decrementos', total.decr],
      ['Neto', total.neto], ['Base anterior', total.base], ['% Variacion', pctGlobal == null ? '-' : pctGlobal.toFixed(1) + '%'],
    ]
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumen), 'Resumen')
    const tabla = (rows, etiqueta, nombreLlave) => {
      const aoa = [[etiqueta, 'Cambios', 'Incrementos', 'Decrementos', 'Neto', 'Base ant.', '% Var']]
      rows.forEach(r => aoa.push([nombreLlave(r.k), r.n, r.incr, r.decr, r.neto, r.base, r.pct == null ? '-' : r.pct.toFixed(1) + '%']))
      return XLSX.utils.aoa_to_sheet(aoa)
    }
    XLSX.utils.book_append_sheet(wb, tabla(porCliente, 'Cliente', k => cliDe(k)), 'Por Cliente')
    XLSX.utils.book_append_sheet(wb, tabla(porArticulo, 'Articulo', k => codArt(k)), 'Por Articulo')
    XLSX.utils.book_append_sheet(wb, tabla(porPeriodo, 'Periodo', k => k), 'Por Periodo')
    XLSX.writeFile(wb, `variacion_demanda_${hoy()}.xlsx`)
  }

  const netoColor = (n) => n > 0 ? '#16a34a' : n < 0 ? '#dc2626' : '#64748b'

  const TablaAgrupada = ({ rows, etiqueta, nombreLlave }) => (
    <div style={styles.tabla}>
      <div style={styles.tablaHeader}>
        <span style={{ flex: 2 }}>{etiqueta}</span>
        <span style={{ flex: 1, textAlign: 'right' }}>Cambios</span>
        <span style={{ flex: 1.2, textAlign: 'right' }}>Incrementos</span>
        <span style={{ flex: 1.2, textAlign: 'right' }}>Decrementos</span>
        <span style={{ flex: 1, textAlign: 'right' }}>Neto</span>
        <span style={{ flex: 1, textAlign: 'right' }}>% Var</span>
      </div>
      {rows.length === 0 && <div style={styles.vacio}>Sin datos en el rango/filtos.</div>}
      {rows.map((r, i) => (
        <div key={i} style={styles.tablaFila}>
          <span style={{ flex: 2, fontWeight: '500' }}>{nombreLlave(r.k)}</span>
          <span style={{ flex: 1, textAlign: 'right', color: '#64748b' }}>{fmtNum(r.n)}</span>
          <span style={{ flex: 1.2, textAlign: 'right', color: '#16a34a' }}>+{fmtNum(r.incr)}</span>
          <span style={{ flex: 1.2, textAlign: 'right', color: '#dc2626' }}>{fmtNum(r.decr)}</span>
          <span style={{ flex: 1, textAlign: 'right', fontWeight: '600', color: netoColor(r.neto) }}>{r.neto > 0 ? '+' : ''}{fmtNum(r.neto)}</span>
          <span style={{ flex: 1, textAlign: 'right', color: netoColor(r.neto) }}>{fmtPct(r.pct)}</span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Variacion de Demanda</h2>
        <button style={styles.botonSec} onClick={exportar} disabled={filas.length === 0}>Exportar Excel</button>
      </div>
      <p style={styles.intro}>
        Mide como cambia la demanda del cliente en los releases: <b>altas</b>, <b>incrementos</b>, <b>decrementos</b> y
        <b> cancelaciones</b>, por captura <b>manual</b> o <b>carga de Excel</b>. El rango filtra por fecha del cambio.
      </p>

      <div style={styles.filtros}>
        <div style={styles.campo}><label style={styles.label}>Desde</label>
          <input type="date" style={styles.input} value={desde} onChange={e => setDesde(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.label}>Hasta</label>
          <input type="date" style={styles.input} value={hasta} onChange={e => setHasta(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.label}>Cliente</label>
          <select style={styles.input} value={cliente} onChange={e => setCliente(e.target.value)}>
            <option value="">Todos</option>
            {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
          </select></div>
        <div style={styles.campo}><label style={styles.label}>Articulo</label>
          <select style={styles.input} value={articulo} onChange={e => setArticulo(e.target.value)}>
            <option value="">Todos</option>
            {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno}</option>)}
          </select></div>
        <div style={styles.campo}><label style={styles.label}>Tipo</label>
          <select style={styles.input} value={tipo} onChange={e => setTipo(e.target.value)}>
            <option value="">Todos</option>
            {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select></div>
        <div style={styles.campo}><label style={styles.label}>Origen</label>
          <select style={styles.input} value={origen} onChange={e => setOrigen(e.target.value)}>
            <option value="">Todos</option>
            {ORIGENES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select></div>
        <button style={styles.boton} onClick={consultar} disabled={loading}>{loading ? 'Consultando...' : 'Consultar'}</button>
      </div>

      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.cards}>
        <div style={styles.card}><span style={styles.cardLabel}>Cambios</span><span style={styles.cardValor}>{fmtNum(total.n)}</span></div>
        <div style={styles.card}><span style={styles.cardLabel}>Incrementos</span><span style={{ ...styles.cardValor, color: '#16a34a' }}>+{fmtNum(total.incr)}</span></div>
        <div style={styles.card}><span style={styles.cardLabel}>Decrementos</span><span style={{ ...styles.cardValor, color: '#dc2626' }}>{fmtNum(total.decr)}</span></div>
        <div style={styles.card}><span style={styles.cardLabel}>Neto</span><span style={{ ...styles.cardValor, color: netoColor(total.neto) }}>{total.neto > 0 ? '+' : ''}{fmtNum(total.neto)}</span></div>
        <div style={styles.card}><span style={styles.cardLabel}>% Variacion (neto/base)</span><span style={{ ...styles.cardValor, color: netoColor(total.neto) }}>{fmtPct(pctGlobal)}</span></div>
      </div>

      <div style={styles.tabs}>
        {[['resumen', 'Por tipo / origen'], ['cliente', 'Por cliente'], ['articulo', 'Por articulo'], ['periodo', 'Por periodo']].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{n}</button>
        ))}
      </div>

      {vista === 'resumen' && (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '320px' }}>
            <h3 style={styles.subtitulo}>Por tipo de cambio</h3>
            <TablaAgrupada rows={porTipo} etiqueta="Tipo" nombreLlave={k => TIPOS.find(t => t.value === k)?.label || k} />
          </div>
          <div style={{ flex: 1, minWidth: '320px' }}>
            <h3 style={styles.subtitulo}>Por origen</h3>
            <TablaAgrupada rows={porOrigen} etiqueta="Origen" nombreLlave={k => ORIGENES.find(o => o.value === k)?.label || k} />
          </div>
        </div>
      )}
      {vista === 'cliente' && <TablaAgrupada rows={porCliente} etiqueta="Cliente" nombreLlave={k => cliDe(k)} />}
      {vista === 'articulo' && <TablaAgrupada rows={porArticulo} etiqueta="Articulo" nombreLlave={k => `${codArt(k)}`} />}
      {vista === 'periodo' && <TablaAgrupada rows={porPeriodo} etiqueta="Periodo (mes requerido)" nombreLlave={k => k} />}

      {!loading && filas.length === 0 && !error && (
        <p style={styles.nota}>
          No hay cambios registrados en el rango. La bitacora se llena al <b>editar lineas de release</b> o al <b>cargar releases por Excel</b> en Customer Service.
        </p>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  intro: { fontSize: '13px', color: '#64748b', margin: '0 0 16px', lineHeight: 1.5 },
  filtros: { display: 'flex', gap: '12px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '18px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '8px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  boton: { padding: '9px 18px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '8px 16px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  cards: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' },
  card: { flex: 1, minWidth: '150px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '6px' },
  cardLabel: { fontSize: '12px', color: '#64748b', fontWeight: '500' },
  cardValor: { fontSize: '22px', fontWeight: '700', color: '#1a1a2e' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActiva: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#2563eb', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #2563eb' },
  subtitulo: { fontSize: '14px', fontWeight: '600', color: '#334155', margin: '0 0 8px' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '11px 18px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11.5px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '10px 18px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '14px 18px', color: '#94a3b8', fontSize: '13px' },
  nota: { marginTop: '16px', fontSize: '13px', color: '#94a3b8', lineHeight: 1.5 },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
}
