import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'

// Reportes y KPIs de produccion. OEE (Disponibilidad x Rendimiento x Calidad),
// estatus de maquina (paros por causa), cambios de molde y fuera de plan, scrap
// (registros y productos sobre el % permitido), OT y programa de piso imprimible.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 1 })
const pct = (n) => n == null ? '-' : (Number(n) * 100).toLocaleString('es-MX', { maximumFractionDigits: 1 }) + '%'
const hoy = () => new Date().toISOString().split('T')[0]
const haceDias = (d) => { const f = new Date(); f.setDate(f.getDate() - d); return f.toISOString().split('T')[0] }
const isoDow = (d) => ((d.getDay() + 6) % 7) + 1
const semanaISO = (ds) => { const d = new Date(ds + 'T00:00:00'); const t = new Date(d); t.setDate(d.getDate() + 4 - isoDow(d)); const y = new Date(t.getFullYear(), 0, 1); const w = Math.ceil(((t - y) / 86400000 + 1) / 7); return `${t.getFullYear()}-S${String(w).padStart(2, '0')}` }

export default function ReportesKPI() {
  const { perfil } = useAuth()
  const [desde, setDesde] = useState(haceDias(30))
  const [hasta, setHasta] = useState(hoy())
  const [tab, setTab] = useState('oee')
  const [aggCambios, setAggCambios] = useState('dia')
  const [semanaId, setSemanaId] = useState('')
  const [loading, setLoading] = useState(false)

  const [ots, setOts] = useState([])
  const [repArt, setRepArt] = useState([])
  const [repScrap, setRepScrap] = useState([])
  const [paros, setParos] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [articulos, setArticulos] = useState([])
  const [rutas, setRutas] = useState([])
  const [cav, setCav] = useState([])
  const [cal, setCal] = useState([])
  const [prog, setProg] = useState([])
  const [param, setParam] = useState({ pct_scrap_default: 3 })
  const [semanas, setSemanas] = useState([])

  useEffect(() => { cargarCat().then(consultar) }, [])
  const cargarCat = async () => {
    const emp = perfil.empresa_id
    const [mq, ar, ru, cv, ca, pa, se] = await Promise.all([
      supabase.from('maquinas').select('id, clave, nombre').eq('empresa_id', emp),
      supabase.from('articulos').select('id, codigo_interno, descripcion, pct_scrap_aprobado').eq('empresa_id', emp),
      supabase.from('rutas_fabricacion').select('articulo_id, tipo_operacion, tiempo_estandar_seg'),
      supabase.from('molde_cavidades').select('molde_id, articulo_id, activa').eq('activa', true),
      supabase.from('mrp_calendario').select('dia_semana, trabaja, horas_efectivas').eq('empresa_id', emp),
      supabase.from('produccion_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('semanas_produccion').select('*').eq('empresa_id', emp).order('semana_inicio', { ascending: false }),
    ])
    setMaquinas(mq.data || []); setArticulos(ar.data || []); setRutas(ru.data || []); setCav(cv.data || [])
    setCal(ca.data || []); setParam(pa.data || { pct_scrap_default: 3 }); setSemanas(se.data || [])
    if (se.data && se.data[0]) setSemanaId(String(se.data[0].id))
  }
  const consultar = async () => {
    setLoading(true)
    const emp = perfil.empresa_id
    const [ot, ra, rs, pr, pc] = await Promise.all([
      supabase.from('ordenes_trabajo').select('*, maq:maquinas(clave), art:articulos(codigo_interno), molde:moldes(clave)').eq('empresa_id', emp).order('fecha_programada', { ascending: false }).limit(1000),
      supabase.from('ot_reporte_articulos').select('*, reporte:ot_reportes(fecha, turno, ot:ordenes_trabajo(maquina_id, molde_id, empresa_id))'),
      supabase.from('ot_reporte_scrap').select('*, causa:causas_scrap(nombre), reporte:ot_reportes(fecha, ot:ordenes_trabajo(maquina_id, empresa_id))'),
      supabase.from('ot_paros').select('*, causa:causas_paro(nombre), ot:ordenes_trabajo(maquina_id, empresa_id)').gte('fecha', desde).lte('fecha', hasta + 'T23:59:59'),
      supabase.from('programa_cambios').select('*').eq('empresa_id', emp).gte('at', desde).lte('at', hasta + 'T23:59:59'),
    ])
    const inRango = (f) => f && f.split('T')[0] >= desde && f.split('T')[0] <= hasta
    setOts(ot.data || [])
    setRepArt((ra.data || []).filter(r => r.reporte?.ot?.empresa_id === emp && inRango(r.reporte?.fecha)))
    setRepScrap((rs.data || []).filter(r => r.reporte?.ot?.empresa_id === emp && inRango(r.reporte?.fecha)))
    setParos((pr.data || []).filter(p => p.ot?.empresa_id === emp))
    setProg(pc.data || [])
    setLoading(false)
  }

  // ---- helpers de calculo ----
  const artDe = (id) => articulos.find(a => a.id === id)
  const maqClave = (id) => maquinas.find(m => m.id === id)?.clave || ('Maq ' + id)
  const cavDe = (artId) => cav.filter(c => c.articulo_id === artId).length || 1
  const cicloDe = (artId) => { const r = rutas.find(x => x.articulo_id === artId && x.tipo_operacion === 'inyeccion') || rutas.find(x => x.articulo_id === artId); return Number(r?.tiempo_estandar_seg || 0) }

  const plannedMin = () => {
    let m = 0; const d = new Date(desde + 'T00:00:00'); const end = new Date(hasta + 'T00:00:00')
    while (d <= end) { const c = cal.find(x => x.dia_semana === isoDow(d)); if (c && c.trabaja) m += Number(c.horas_efectivas || 0) * 60; d.setDate(d.getDate() + 1) }
    return m
  }

  // OEE por maquina
  const oeePorMaquina = () => {
    const planned = plannedMin()
    const map = {}
    const g = (id) => (map[id] = map[id] || { maq: id, ok: 0, scrap: 0, down: 0, earned: 0 })
    for (const p of paros) { if (p.ot?.maquina_id) g(p.ot.maquina_id).down += Number(p.minutos || 0) }
    for (const r of repArt) {
      const mid = r.reporte?.ot?.maquina_id; if (!mid) continue
      const o = g(mid); const ok = Number(r.cantidad_ok || 0), sc = Number(r.cantidad_scrap || 0)
      o.ok += ok; o.scrap += sc
      const ciclo = cicloDe(r.articulo_id), cv = cavDe(r.articulo_id)
      if (ciclo > 0 && cv > 0) o.earned += (ok + sc) * (ciclo / cv) / 60  // minutos ganados
    }
    return Object.values(map).map(o => {
      const oper = Math.max(0, planned - o.down)
      const A = planned > 0 ? oper / planned : null
      const P = oper > 0 ? Math.min(1.5, o.earned / oper) : null
      const Q = (o.ok + o.scrap) > 0 ? o.ok / (o.ok + o.scrap) : null
      const OEE = (A != null && P != null && Q != null) ? A * P * Q : null
      return { ...o, planned, oper, A, P, Q, OEE }
    }).sort((a, b) => (b.OEE || 0) - (a.OEE || 0))
  }

  const parosPorCausa = () => {
    const map = {}
    for (const p of paros) { const k = p.causa?.nombre || 'Sin causa'; const g = map[k] = map[k] || { k, n: 0, min: 0 }; g.n++; g.min += Number(p.minutos || 0) }
    return Object.values(map).sort((a, b) => b.min - a.min)
  }
  const estatusMaquina = () => {
    const planned = plannedMin(); const map = {}
    for (const m of maquinas) map[m.id] = { maq: m.id, down: 0, nParos: 0 }
    for (const p of paros) { if (!p.ot?.maquina_id) continue; const g = map[p.ot.maquina_id] = map[p.ot.maquina_id] || { maq: p.ot.maquina_id, down: 0, nParos: 0 }; g.down += Number(p.minutos || 0); g.nParos++ }
    return Object.values(map).map(o => ({ ...o, planned, trabajando: Math.max(0, planned - o.down) })).sort((a, b) => b.down - a.down)
  }

  const cambios = () => {
    const key = (o) => { const f = o.fecha_programada || (o.created_at || '').split('T')[0]; if (!f) return '-'; if (aggCambios === 'turno') return `${f} · T${o.turno || '-'}`; if (aggCambios === 'dia') return f; if (aggCambios === 'semana') return semanaISO(f); return f.slice(0, 7) }
    const map = {}
    for (const o of ots.filter(x => Number(x.cambio_molde_min || 0) > 0 && (x.fecha_programada || '') >= desde && (x.fecha_programada || '') <= hasta)) {
      const k = key(o); const g = map[k] = map[k] || { k, n: 0, min: 0 }; g.n++; g.min += Number(o.cambio_molde_min || 0)
    }
    return Object.values(map).sort((a, b) => String(a.k).localeCompare(String(b.k)))
  }

  const scrapSobreLimite = () => {
    const map = {}
    for (const r of repArt) { const g = map[r.articulo_id] = map[r.articulo_id] || { art: r.articulo_id, ok: 0, scrap: 0 }; g.ok += Number(r.cantidad_ok || 0); g.scrap += Number(r.cantidad_scrap || 0) }
    return Object.values(map).map(o => {
      const tot = o.ok + o.scrap; const p = tot > 0 ? o.scrap / tot : 0
      const lim = Number(artDe(o.art)?.pct_scrap_aprobado ?? param.pct_scrap_default) / 100
      return { ...o, tot, p, lim, excede: p > lim }
    }).filter(o => o.tot > 0).sort((a, b) => (b.p - b.lim) - (a.p - a.lim))
  }
  const scrapPorCausa = () => {
    const map = {}
    for (const r of repScrap) { const k = r.causa?.nombre || 'Sin causa'; const g = map[k] = map[k] || { k, cant: 0 }; g.cant += Number(r.cantidad || 0) }
    return Object.values(map).sort((a, b) => b.cant - a.cant)
  }

  const otsRango = ots.filter(o => (o.fecha_programada || '') >= desde && (o.fecha_programada || '') <= hasta)
  const otsSemana = ots.filter(o => String(o.semana_id) === String(semanaId))
    .sort((a, b) => (a.maquina_id - b.maquina_id) || (Number(a.secuencia || 0) - Number(b.secuencia || 0)))

  const imprimirPrograma = () => {
    const sem = semanas.find(s => String(s.id) === String(semanaId))
    const cols = [
      { label: 'Maquina', get: o => o.maq?.clave || o.maquina_id },
      { label: 'Sec', get: o => o.secuencia },
      { label: 'Turno', get: o => o.turno },
      { label: 'Articulo', get: o => o.art?.codigo_interno },
      { label: 'Molde', get: o => o.molde?.clave || '' },
      { label: 'Cantidad', get: o => o.cantidad_programada },
      { label: 'Cambio molde', get: o => Number(o.cambio_molde_min || 0) > 0 ? `SI (${o.cambio_molde_min}m)` : '' },
      { label: 'Fecha', get: o => o.fecha_programada || '' },
    ]
    imprimirTablaPDF(`Programa de piso · semana ${sem?.semana_inicio || ''}`, cols, otsSemana)
  }

  const T = ({ id, children }) => <button style={tab === id ? styles.tabAct : styles.tab} onClick={() => setTab(id)}>{children}</button>

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Reportes de produccion / KPIs</h2>
      <div style={styles.filtros} className="no-imprimir">
        <div style={styles.campo}><label style={styles.lbl}>Desde</label><input type="date" style={styles.input} value={desde} onChange={e => setDesde(e.target.value)} /></div>
        <div style={styles.campo}><label style={styles.lbl}>Hasta</label><input type="date" style={styles.input} value={hasta} onChange={e => setHasta(e.target.value)} /></div>
        <button style={styles.boton} onClick={consultar} disabled={loading}>{loading ? 'Consultando...' : 'Consultar'}</button>
      </div>
      <div style={styles.tabs} className="no-imprimir">
        <T id="oee">OEE</T><T id="maquinas">Estatus maquina</T><T id="cambios">Cambios</T><T id="scrap">Scrap</T><T id="ot">OT</T><T id="programa">Programa piso</T>
      </div>

      {tab === 'oee' && (() => { const rows = oeePorMaquina(); return (
        <div>
          <div style={styles.expBar} className="no-imprimir"><button style={styles.bExcel} onClick={() => exportarExcel('oee', [{ label: 'Maquina', get: r => maqClave(r.maq) }, { label: 'OEE', get: r => pct(r.OEE) }, { label: 'Disponibilidad', get: r => pct(r.A) }, { label: 'Rendimiento', get: r => pct(r.P) }, { label: 'Calidad', get: r => pct(r.Q) }, { label: 'Min plan', get: r => r.planned }, { label: 'Min paro', get: r => r.down }, { label: 'OK', get: r => r.ok }, { label: 'Scrap', get: r => r.scrap }], rows)}>Excel</button><button style={styles.bPdf} onClick={() => imprimirTablaPDF('OEE por maquina', [{ label: 'Maquina', get: r => maqClave(r.maq) }, { label: 'OEE', get: r => pct(r.OEE) }, { label: 'Disp', get: r => pct(r.A) }, { label: 'Rend', get: r => pct(r.P) }, { label: 'Cal', get: r => pct(r.Q) }], rows)}>PDF</button></div>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 1.4 }}>Maquina</span><span style={{ flex: 1, textAlign: 'right' }}>OEE</span><span style={{ flex: 1, textAlign: 'right' }}>Disp.</span><span style={{ flex: 1, textAlign: 'right' }}>Rend.</span><span style={{ flex: 1, textAlign: 'right' }}>Calidad</span><span style={{ flex: 1, textAlign: 'right' }}>Min paro</span><span style={{ flex: 1, textAlign: 'right' }}>OK</span><span style={{ flex: 1, textAlign: 'right' }}>Scrap</span></div>
            {rows.map(r => (<div key={r.maq} style={styles.tr}><span style={{ flex: 1.4, fontWeight: 600 }}>{maqClave(r.maq)}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 700, color: (r.OEE || 0) >= 0.85 ? '#16a34a' : (r.OEE || 0) >= 0.6 ? '#b45309' : '#dc2626' }}>{pct(r.OEE)}</span><span style={{ flex: 1, textAlign: 'right' }}>{pct(r.A)}</span><span style={{ flex: 1, textAlign: 'right' }}>{pct(r.P)}</span><span style={{ flex: 1, textAlign: 'right' }}>{pct(r.Q)}</span><span style={{ flex: 1, textAlign: 'right', color: '#dc2626' }}>{fmt(r.down)}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(r.ok)}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(r.scrap)}</span></div>))}
            {rows.length === 0 && <div style={styles.vacio}>Sin datos en el rango.</div>}
          </div>
          <p style={styles.hint}>OEE = Disponibilidad x Rendimiento x Calidad. Tiempo planeado = horas efectivas del calendario x dias laborables. Disponibilidad = (plan - paros)/plan. Rendimiento = tiempo ganado (piezas x ciclo estandar / cavidades) / tiempo operativo. Calidad = OK/(OK+scrap).</p>
        </div>
      ) })()}

      {tab === 'maquinas' && (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '320px' }}>
            <p style={styles.sub2}>Por maquina (minutos)</p>
            <div style={styles.tabla}><div style={styles.th}><span style={{ flex: 1.4 }}>Maquina</span><span style={{ flex: 1, textAlign: 'right' }}>Trabajando</span><span style={{ flex: 1, textAlign: 'right' }}>Parada</span><span style={{ flex: 1, textAlign: 'right' }}>#Paros</span></div>
              {estatusMaquina().map(r => (<div key={r.maq} style={styles.tr}><span style={{ flex: 1.4, fontWeight: 600 }}>{maqClave(r.maq)}</span><span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>{fmt(r.trabajando)}</span><span style={{ flex: 1, textAlign: 'right', color: '#dc2626' }}>{fmt(r.down)}</span><span style={{ flex: 1, textAlign: 'right' }}>{r.nParos}</span></div>))}</div>
          </div>
          <div style={{ flex: 1, minWidth: '320px' }}>
            <p style={styles.sub2}>Paros por causa</p>
            <div style={styles.tabla}><div style={styles.th}><span style={{ flex: 2 }}>Causa</span><span style={{ flex: 1, textAlign: 'right' }}>Min</span><span style={{ flex: 1, textAlign: 'right' }}>#</span></div>
              {parosPorCausa().map((r, i) => (<div key={i} style={styles.tr}><span style={{ flex: 2 }}>{r.k}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{fmt(r.min)}</span><span style={{ flex: 1, textAlign: 'right' }}>{r.n}</span></div>))}
              {parosPorCausa().length === 0 && <div style={styles.vacio}>Sin paros.</div>}</div>
          </div>
        </div>
      )}

      {tab === 'cambios' && (
        <div>
          <div style={styles.expBar} className="no-imprimir">
            <select style={styles.input} value={aggCambios} onChange={e => setAggCambios(e.target.value)}><option value="turno">Por turno</option><option value="dia">Por dia</option><option value="semana">Por semana</option><option value="mes">Por mes</option></select>
            <div style={{ marginLeft: 'auto' }}><b>{prog.length}</b> cambios fuera de plan (reprogramaciones)</div>
          </div>
          <div style={styles.tabla}><div style={styles.th}><span style={{ flex: 2 }}>Periodo</span><span style={{ flex: 1, textAlign: 'right' }}>Cambios de molde</span><span style={{ flex: 1, textAlign: 'right' }}>Min cambio</span></div>
            {cambios().map((r, i) => (<div key={i} style={styles.tr}><span style={{ flex: 2 }}>{r.k}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{r.n}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(r.min)}</span></div>))}
            {cambios().length === 0 && <div style={styles.vacio}>Sin cambios de molde en el rango.</div>}</div>
          <p style={styles.hint}>Cambios de molde = OT con cambio de molde marcado. Fuera de plan = reprogramaciones registradas (programa_cambios) en el rango.</p>
        </div>
      )}

      {tab === 'scrap' && (
        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1.3, minWidth: '360px' }}>
            <p style={styles.sub2}>Productos sobre el % de scrap permitido</p>
            <div style={styles.tabla}><div style={styles.th}><span style={{ flex: 1.6 }}>Articulo</span><span style={{ flex: 1, textAlign: 'right' }}>OK</span><span style={{ flex: 1, textAlign: 'right' }}>Scrap</span><span style={{ flex: 1, textAlign: 'right' }}>% scrap</span><span style={{ flex: 1, textAlign: 'right' }}>Limite</span></div>
              {scrapSobreLimite().map(r => (<div key={r.art} style={{ ...styles.tr, backgroundColor: r.excede ? '#fef2f2' : '#fff' }}><span style={{ flex: 1.6, fontWeight: 600 }}>{artDe(r.art)?.codigo_interno}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(r.ok)}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(r.scrap)}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 700, color: r.excede ? '#dc2626' : '#334155' }}>{pct(r.p)}</span><span style={{ flex: 1, textAlign: 'right', color: '#94a3b8' }}>{pct(r.lim)}</span></div>))}
              {scrapSobreLimite().length === 0 && <div style={styles.vacio}>Sin registros de produccion.</div>}</div>
            <p style={styles.hint}>Limite = % aprobado del articulo (o {param.pct_scrap_default}% global si no tiene). En rojo los que exceden.</p>
          </div>
          <div style={{ flex: 1, minWidth: '280px' }}>
            <p style={styles.sub2}>Scrap por causa</p>
            <div style={styles.tabla}><div style={styles.th}><span style={{ flex: 2 }}>Causa</span><span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span></div>
              {scrapPorCausa().map((r, i) => (<div key={i} style={styles.tr}><span style={{ flex: 2 }}>{r.k}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{fmt(r.cant)}</span></div>))}
              {scrapPorCausa().length === 0 && <div style={styles.vacio}>Sin scrap.</div>}</div>
          </div>
        </div>
      )}

      {tab === 'ot' && (
        <div>
          <div style={styles.expBar} className="no-imprimir"><button style={styles.bExcel} onClick={() => exportarExcel('ordenes_trabajo', colsOT, otsRango)}>Excel</button><button style={styles.bPdf} onClick={() => imprimirTablaPDF('Ordenes de Trabajo', colsOT, otsRango)}>PDF</button></div>
          <div style={styles.tabla}><div style={styles.th}><span style={{ flex: 1.1 }}>Folio</span><span style={{ flex: 1 }}>Maquina</span><span style={{ flex: 1.2 }}>Articulo</span><span style={{ flex: 1, textAlign: 'right' }}>Prog.</span><span style={{ flex: 1, textAlign: 'right' }}>Prod.</span><span style={{ flex: 1, textAlign: 'right' }}>Scrap</span><span style={{ flex: 1 }}>Estatus</span></div>
            {otsRango.map(o => (<div key={o.id} style={styles.tr}><span style={{ flex: 1.1, fontWeight: 600 }}>{o.folio}</span><span style={{ flex: 1 }}>{o.maq?.clave || '-'}</span><span style={{ flex: 1.2 }}>{o.art?.codigo_interno}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(o.cantidad_programada)}</span><span style={{ flex: 1, textAlign: 'right', color: '#16a34a' }}>{fmt(o.cantidad_producida)}</span><span style={{ flex: 1, textAlign: 'right', color: '#dc2626' }}>{fmt(o.cantidad_scrap)}</span><span style={{ flex: 1, fontSize: '12px' }}>{(o.estatus || '').replace(/_/g, ' ')}</span></div>))}
            {otsRango.length === 0 && <div style={styles.vacio}>Sin OT en el rango.</div>}</div>
        </div>
      )}

      {tab === 'programa' && (
        <div>
          <div style={styles.expBar} className="no-imprimir">
            <select style={styles.input} value={semanaId} onChange={e => setSemanaId(e.target.value)}>{semanas.map(s => <option key={s.id} value={s.id}>Semana {s.semana_inicio} ({s.estatus})</option>)}</select>
            <button style={styles.bPdf} onClick={imprimirPrograma} disabled={otsSemana.length === 0}>Imprimir programa</button>
          </div>
          <div style={styles.tabla}><div style={styles.th}><span style={{ flex: 1 }}>Maquina</span><span style={{ flex: 0.6, textAlign: 'center' }}>Sec</span><span style={{ flex: 0.7, textAlign: 'center' }}>Turno</span><span style={{ flex: 1.3 }}>Articulo</span><span style={{ flex: 1 }}>Molde</span><span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span><span style={{ flex: 1 }}>Cambio</span><span style={{ flex: 1 }}>Fecha</span></div>
            {otsSemana.map(o => (<div key={o.id} style={styles.tr}><span style={{ flex: 1, fontWeight: 600 }}>{o.maq?.clave || '-'}</span><span style={{ flex: 0.6, textAlign: 'center' }}>{o.secuencia}</span><span style={{ flex: 0.7, textAlign: 'center' }}>{o.turno}</span><span style={{ flex: 1.3 }}>{o.art?.codigo_interno}</span><span style={{ flex: 1 }}>{o.molde?.clave || ''}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(o.cantidad_programada)}</span><span style={{ flex: 1 }}>{Number(o.cambio_molde_min || 0) > 0 ? <span style={styles.pillCam}>cambio {o.cambio_molde_min}m</span> : ''}</span><span style={{ flex: 1, fontSize: '12px' }}>{o.fecha_programada}</span></div>))}
            {otsSemana.length === 0 && <div style={styles.vacio}>Selecciona una semana con OT programadas.</div>}</div>
          <p style={styles.hint}>Vista de apoyo para piso: que producir por maquina, secuencia, turno y los cambios de molde programados. Usa "Imprimir programa" para el PDF.</p>
        </div>
      )}
    </div>
  )
}

const colsOT = [{ label: 'Folio', get: o => o.folio }, { label: 'Maquina', get: o => o.maq?.clave || '' }, { label: 'Articulo', get: o => o.art?.codigo_interno }, { label: 'Programado', get: o => o.cantidad_programada }, { label: 'Producido', get: o => o.cantidad_producida }, { label: 'Scrap', get: o => o.cantidad_scrap }, { label: 'Turno', get: o => o.turno }, { label: 'Estatus', get: o => o.estatus }]

const styles = {
  container: { padding: '28px', maxWidth: '1120px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 14px' },
  filtros: { display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '14px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  lbl: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '8px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit' },
  boton: { padding: '9px 18px', backgroundColor: '#c2410c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' },
  tab: { padding: '8px 14px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 14px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#c2410c', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #c2410c' },
  expBar: { display: 'flex', gap: '8px', marginBottom: '10px', alignItems: 'center' },
  bExcel: { padding: '8px 14px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  bPdf: { padding: '8px 14px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  sub2: { fontSize: '13px', fontWeight: 600, color: '#334155', margin: '2px 0 8px' },
  tabla: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '9px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  hint: { fontSize: '12px', color: '#94a3b8', marginTop: '8px', lineHeight: 1.5 },
  pillCam: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#b45309' },
}
