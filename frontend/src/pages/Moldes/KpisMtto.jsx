import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// KPIs de mantenimiento de molde: facturacion por trabajos cobrados, danos por
// maquina/operador/turno/supervisor, mantenimientos diarios, efectividad y reincidencias.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const hoy = () => new Date().toISOString().split('T')[0]
const haceDias = (d) => { const f = new Date(); f.setDate(f.getDate() - d); return f.toISOString().split('T')[0] }
const dia = (ts) => ts ? new Date(ts).toISOString().split('T')[0] : '-'

function agrupar(rows, keyFn, labelFn) {
  const m = new Map()
  for (const r of rows) { const k = keyFn(r); if (k == null || k === '') continue; const g = m.get(k) || { k, label: labelFn(r, k), n: 0 }; g.n += 1; m.set(k, g) }
  return [...m.values()].sort((a, b) => b.n - a.n)
}

const EXP_BTN = { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }

export default function KpisMtto() {
  const { perfil } = useAuth()
  const [desde, setDesde] = useState(haceDias(90))
  const [site, setSite] = useState('')
  const [hasta, setHasta] = useState(hoy())
  const [mtto, setMtto] = useState([])
  const [avisos, setAvisos] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [turnos, setTurnos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { cargarCat().then(consultar) }, [site])
  const cargarCat = async () => {
    const sid = siteEfectivo(perfil, site)
    const emp = perfil.empresa_id
    const [mq, tu, us] = await Promise.all([
      (sid ? supabase.from('maquinas').select('id, clave, site_id').eq('empresa_id', emp).eq('site_id', sid) : supabase.from('maquinas').select('id, clave, site_id').eq('empresa_id', emp)),
      supabase.from('turnos').select('*').eq('empresa_id', emp),
      supabase.from('usuarios').select('id, nombre').eq('empresa_id', emp),
    ])
    setMaquinas(mq.data || []); setTurnos(tu.data || []); setUsuarios(us.data || [])
  }
  const consultar = async () => {
    setLoading(true); setError('')
    const emp = perfil.empresa_id
    const [mm, av] = await Promise.all([
      supabase.from('molde_mtto').select('*, tipo:mtto_tipos(clase)').eq('empresa_id', emp).gte('created_at', desde + 'T00:00:00').lte('created_at', hasta + 'T23:59:59'),
      supabase.from('molde_avisos').select('*').eq('empresa_id', emp).gte('fecha', desde).lte('fecha', hasta),
    ])
    setMtto(mm.data || []); setAvisos(av.data || []); setLoading(false)
  }

  const maqDe = (id) => maquinas.find(m => m.id === id)?.clave || `Maq ${id}`
  const turDe = (id) => { const t = turnos.find(x => x.id === id); return t?.nombre || t?.clave || `Turno ${id}` }
  const usrDe = (id) => usuarios.find(u => u.id === id)?.nombre || '-'

  // KPIs
  const cerradas = mtto.filter(m => m.estatus === 'cerrada')
  const efectivas = cerradas.filter(m => m.tryout_efectiva === true).length
  const pctEfect = cerradas.length ? (efectivas / cerradas.length) * 100 : null
  const reincidencias = mtto.filter(m => Number(m.reintentos || 0) > 0).length
  const correctivos = mtto.filter(m => m.tipo?.clase === 'correctivo').length
  const preventivos = mtto.filter(m => (m.tipo?.clase || '').startsWith('preventivo')).length
  const facturacion = mtto.filter(m => m.es_cobrable).reduce((s, m) => s + Number(m.monto_cobrado || 0), 0)
  const facturado = mtto.filter(m => m.es_cobrable && m.facturado).reduce((s, m) => s + Number(m.monto_cobrado || 0), 0)

  const danosMaquina = agrupar(avisos.filter(a => a.maquina_id), a => a.maquina_id, (a, k) => maqDe(k))
  const danosOperador = agrupar(avisos.filter(a => a.operador_id), a => a.operador_id, (a, k) => usrDe(k))
  const danosTurno = agrupar(avisos.filter(a => a.turno_id), a => a.turno_id, (a, k) => turDe(k))
  const danosSupervisor = agrupar(mtto.filter(m => m.supervisor_id), m => m.supervisor_id, (m, k) => usrDe(k))
  const porDia = agrupar(mtto, m => dia(m.fecha_inicio || m.created_at), (m, k) => k).sort((a, b) => String(a.k).localeCompare(String(b.k)))

  // Export consolidado de todos los cortes de KPI
  const colsExp = [
    { label: 'Indicador', get: r => r.grupo }, { label: 'Concepto', get: r => r.label }, { label: 'Cantidad', get: r => r.n },
  ]
  const filasExp = [
    ...danosMaquina.map(r => ({ grupo: 'Danos por maquina', ...r })),
    ...danosTurno.map(r => ({ grupo: 'Danos por turno', ...r })),
    ...danosSupervisor.map(r => ({ grupo: 'Danos por supervisor', ...r })),
    ...porDia.map(r => ({ grupo: 'Ordenes por dia', label: r.k, n: r.n })),
  ]

  const Tabla = ({ titulo, rows, col }) => (
    <div style={{ flex: 1, minWidth: '260px' }}>
      <p style={styles.tsub}>{titulo}</p>
      <div style={styles.tabla}>
        <div style={styles.th}><span style={{ flex: 2 }}>{col}</span><span style={{ flex: 1, textAlign: 'right' }}>Avisos/Ordenes</span></div>
        {rows.length === 0 && <div style={styles.vacio}>Sin datos.</div>}
        {rows.slice(0, 8).map((r, i) => (
          <div key={i} style={styles.tr}><span style={{ flex: 2 }}>{r.label}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{fmt(r.n)}</span></div>
        ))}
      </div>
    </div>
  )

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>KPIs de mantenimiento de molde</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '8px 0 0' }} className="no-imprimir">
        <button style={EXP_BTN} onClick={() => exportarExcel('kpis_mtto_molde', colsExp, filasExp)}>Excel</button>
        <button style={EXP_BTN} onClick={() => imprimirTablaPDF('KPIs de Mantenimiento de Molde', colsExp, filasExp)}>PDF</button>
      </div>
      <div style={{ marginBottom: 10 }} className="no-imprimir"><FiltroSite value={site} onChange={setSite} /></div>
      <div style={styles.filtros}>
        <div style={styles.campo}><label style={styles.lbl}>Desde</label><input type="date" style={styles.input} value={desde} onChange={e => setDesde(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.lbl}>Hasta</label><input type="date" style={styles.input} value={hasta} onChange={e => setHasta(e.target.value)} /></div>
        <button style={styles.boton} onClick={consultar} disabled={loading}>{loading ? 'Consultando...' : 'Consultar'}</button>
      </div>
      {error && <p style={styles.error}>{error}</p>}

      <div style={styles.cards}>
        <Card label="Ordenes" v={fmt(mtto.length)} />
        <Card label="Correctivos" v={fmt(correctivos)} />
        <Card label="Preventivos" v={fmt(preventivos)} />
        <Card label="% Efectividad" v={pctEfect == null ? '-' : fmt(pctEfect) + '%'} color="#16a34a" />
        <Card label="Reincidencias" v={fmt(reincidencias)} color="#dc2626" />
        <Card label="Facturacion cobrable" v={'$' + fmt(facturacion)} color="#7c3aed" sub={`$${fmt(facturado)} facturado`} />
      </div>

      <div style={styles.grid}>
        <Tabla titulo="Danos por maquina" rows={danosMaquina} col="Maquina" />
        <Tabla titulo="Danos por operador" rows={danosOperador} col="Operador" />
      </div>
      <div style={styles.grid}>
        <Tabla titulo="Danos por turno" rows={danosTurno} col="Turno" />
        <Tabla titulo="Ordenes por supervisor" rows={danosSupervisor} col="Supervisor" />
      </div>

      <p style={styles.tsub}>Mantenimientos por dia</p>
      <div style={styles.tabla}>
        <div style={styles.th}><span style={{ flex: 2 }}>Dia</span><span style={{ flex: 1, textAlign: 'right' }}>Ordenes</span></div>
        {porDia.length === 0 && <div style={styles.vacio}>Sin datos.</div>}
        {porDia.map((r, i) => (<div key={i} style={styles.tr}><span style={{ flex: 2 }}>{r.k}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{fmt(r.n)}</span></div>))}
      </div>
      <p style={styles.hint}>Los "danos por maquina/operador/turno" salen de los avisos (piezas NC atribuidas al molde). Efectividad = ordenes cerradas con try-out efectivo. Facturacion = suma de montos cobrables al cliente en el rango.</p>
    </div>
  )
}

function Card({ label, v, color, sub }) {
  return (<div style={styles.card}><span style={styles.cardLabel}>{label}</span><span style={{ ...styles.cardV, color: color || '#1a1a2e' }}>{v}</span>{sub && <span style={styles.cardSub}>{sub}</span>}</div>)
}

const styles = {
  container: { padding: '28px', maxWidth: '1080px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 14px' },
  filtros: { display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '18px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  lbl: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '8px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit' },
  boton: { padding: '9px 18px', backgroundColor: '#a16207', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  cards: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' },
  card: { flex: 1, minWidth: '150px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', gap: '4px' },
  cardLabel: { fontSize: '12px', color: '#64748b', fontWeight: 500 },
  cardV: { fontSize: '20px', fontWeight: 700 },
  cardSub: { fontSize: '11px', color: '#94a3b8' },
  grid: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
  tsub: { fontSize: '13px', fontWeight: 600, color: '#334155', margin: '6px 0 8px' },
  tabla: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden', marginBottom: '10px' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '9px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  hint: { fontSize: '12px', color: '#94a3b8', marginTop: '8px', lineHeight: 1.5 },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
}
