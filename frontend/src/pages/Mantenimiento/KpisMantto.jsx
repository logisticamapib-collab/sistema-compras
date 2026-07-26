import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// KPIs de mantenimiento general: tecnicos con mas eventos satisfactorios,
// tiempo de cierre, costos, por tipo de trabajo y externos.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const hoy = () => new Date().toISOString().split('T')[0]
const haceDias = (d) => { const f = new Date(); f.setDate(f.getDate() - d); return f.toISOString().split('T')[0] }
const dias = (a, b) => (a && b) ? Math.max(0, (new Date(b) - new Date(a)) / 86400000) : null

function top(rows, keyFn, labelFn, valFn) {
  const m = new Map()
  for (const r of rows) { const k = keyFn(r); if (k == null || k === '') continue; const g = m.get(k) || { k, label: labelFn(r, k), n: 0, v: 0 }; g.n += 1; g.v += (valFn ? valFn(r) : 0); m.set(k, g) }
  return [...m.values()].sort((a, b) => b.n - a.n)
}

export default function KpisMantto() {
  const { perfil } = useAuth()
  const [desde, setDesde] = useState(haceDias(90))
  const [hasta, setHasta] = useState(hoy())
  const [ordenes, setOrdenes] = useState([])
  const [insumos, setInsumos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => { cargarCat().then(consultar) }, [])
  const cargarCat = async () => {
    const emp = perfil.empresa_id
    const [us, pr] = await Promise.all([
      supabase.from('usuarios').select('id, nombre').eq('empresa_id', emp),
      supabase.from('proveedores').select('id, nombre').eq('empresa_id', emp),
    ])
    setUsuarios(us.data || []); setProveedores(pr.data || [])
  }
  const consultar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const { data: o } = await supabase.from('mtto_gen_ordenes').select('*').eq('empresa_id', emp).gte('created_at', desde + 'T00:00:00').lte('created_at', hasta + 'T23:59:59')
    const ords = o || []
    setOrdenes(ords)
    const ids = ords.map(x => x.id)
    const { data: ins } = ids.length ? await supabase.from('mtto_gen_insumos').select('orden_id, costo_total').in('orden_id', ids) : { data: [] }
    setInsumos(ins || [])
    setLoading(false)
  }

  const usrDe = (id) => usuarios.find(u => u.id === id)?.nombre || '-'
  const provDe = (id) => proveedores.find(p => p.id === id)?.nombre || '-'
  const costoInsumos = (ordenId) => insumos.filter(i => i.orden_id === ordenId).reduce((s, i) => s + Number(i.costo_total), 0)
  const costoOrden = (o) => costoInsumos(o.id) + Number(o.costo_externo || 0)

  const cerradas = ordenes.filter(o => o.estatus === 'cerrada')
  const satisfactorias = cerradas.filter(o => o.conforme_ok === true)
  const tiempos = cerradas.map(o => dias(o.created_at, o.fecha_cierre)).filter(x => x != null)
  const tPromedio = tiempos.length ? tiempos.reduce((a, b) => a + b, 0) / tiempos.length : null
  const costoTotal = ordenes.reduce((s, o) => s + costoOrden(o), 0)

  const tecnicos = top(satisfactorias.filter(o => !o.es_externo && o.asignado_a), o => o.asignado_a, (o, k) => usrDe(k))
  const porTipo = top(ordenes, o => o.tipo_trabajo, (o, k) => k)
  const externos = top(ordenes.filter(o => o.es_externo), o => o.proveedor_id, (o, k) => provDe(k), o => costoOrden(o))

  const Card = ({ label, v, color }) => (<div style={styles.card}><span style={styles.cl}>{label}</span><span style={{ ...styles.cv, color: color || '#1a1a2e' }}>{v}</span></div>)
  const Tabla = ({ titulo, rows, col, showCost }) => (
    <div style={{ flex: 1, minWidth: '280px' }}>
      <p style={styles.tsub}>{titulo}</p>
      <div style={styles.tabla}>
        <div style={styles.th}><span style={{ flex: 2 }}>{col}</span><span style={{ flex: 1, textAlign: 'right' }}>Eventos</span>{showCost && <span style={{ flex: 1, textAlign: 'right' }}>Costo</span>}</div>
        {rows.length === 0 && <div style={styles.vacio}>Sin datos.</div>}
        {rows.slice(0, 8).map((r, i) => (<div key={i} style={styles.tr}><span style={{ flex: 2 }}>{r.label}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{fmt(r.n)}</span>{showCost && <span style={{ flex: 1, textAlign: 'right' }}>${fmt(r.v)}</span>}</div>))}
      </div>
    </div>
  )

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>KPIs de mantenimiento</h2>
      <div style={styles.filtros}>
        <div style={styles.campo}><label style={styles.lbl}>Desde</label><input type="date" style={styles.input} value={desde} onChange={e => setDesde(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.lbl}>Hasta</label><input type="date" style={styles.input} value={hasta} onChange={e => setHasta(e.target.value)} /></div>
        <button style={styles.boton} onClick={consultar} disabled={loading}>{loading ? 'Consultando...' : 'Consultar'}</button>
      </div>
      <div style={styles.cards}>
        <Card label="Ordenes" v={fmt(ordenes.length)} />
        <Card label="Cerradas" v={fmt(cerradas.length)} />
        <Card label="Satisfactorias" v={fmt(satisfactorias.length)} color="#16a34a" />
        <Card label="Tiempo prom. cierre" v={tPromedio == null ? '-' : fmt(tPromedio) + ' d'} />
        <Card label="Costo total" v={'$' + fmt(costoTotal)} color="#7c3aed" />
      </div>
      <div style={styles.grid}>
        <Tabla titulo="Tecnicos con mas eventos satisfactorios" rows={tecnicos} col="Tecnico" />
        <Tabla titulo="Por tipo de trabajo" rows={porTipo} col="Tipo" />
      </div>
      <div style={styles.grid}>
        <Tabla titulo="Trabajos externos por proveedor" rows={externos} col="Proveedor" showCost />
      </div>
      <p style={styles.hint}>Satisfactorias = ordenes cerradas con firma de conformidad. Tiempo de cierre = dias entre levantamiento y cierre. El costo suma insumos + costo externo.</p>
    </div>
  )
}

const styles = {
  container: { padding: '28px', maxWidth: '1060px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 14px' },
  filtros: { display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '18px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  lbl: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '8px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit' },
  boton: { padding: '9px 18px', backgroundColor: '#57534e', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  cards: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' },
  card: { flex: 1, minWidth: '150px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '4px' },
  cl: { fontSize: '12px', color: '#64748b', fontWeight: 500 }, cv: { fontSize: '20px', fontWeight: 700 },
  grid: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
  tsub: { fontSize: '13px', fontWeight: 600, color: '#334155', margin: '6px 0 8px' },
  tabla: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '9px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  hint: { fontSize: '12px', color: '#94a3b8', marginTop: '8px', lineHeight: 1.5 },
}
