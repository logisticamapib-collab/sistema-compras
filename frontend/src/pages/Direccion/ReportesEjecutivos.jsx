import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// Reportes ejecutivos, tres audiencias:
//  - Director: salud general de la empresa (estrategico)
//  - Gerente de Planta / Administrativo: operacion del piso (tactico)
//  - Gerente de Area: detalle por area operativa
// Los KPIs se calculan sobre las tablas reales del sistema, filtrados por
// empresa y por el periodo elegido (hoy / semana / mes).

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtPct = (n) => (n == null || isNaN(n)) ? '-' : (Number(n)).toFixed(1) + '%'
const fmtDin = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 0 })

function rango(periodo, ini, fin) {
  const hoy = new Date(); const h = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate())
  // Rango personalizado: se toma tal cual lo capturado (hasta = fin + 1 dia, para incluirlo)
  if (periodo === 'rango' && ini && fin) {
    const d = new Date(ini + 'T00:00:00')
    const f = new Date(fin + 'T00:00:00'); f.setDate(f.getDate() + 1)
    return { desde: d.toISOString(), hasta: f.toISOString(), desdeF: ini }
  }
  let desde = new Date(h)
  if (periodo === 'semana') { const d = (h.getDay() + 6) % 7; desde.setDate(h.getDate() - d) }
  else if (periodo === 'mes') { desde = new Date(h.getFullYear(), h.getMonth(), 1) }
  const hasta = new Date(h); hasta.setDate(h.getDate() + 1)
  return { desde: desde.toISOString(), hasta: hasta.toISOString(), desdeF: desde.toISOString().slice(0, 10) }
}
const hoyISO = () => new Date().toISOString().slice(0, 10)
const haceDias = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }

export default function ReportesEjecutivos() {
  const { perfil } = useAuth()
  const emp = perfil.empresa_id
  const [tab, setTab] = useState('director')
  const [periodo, setPeriodo] = useState('mes')
  const [site, setSite] = useState('')
  const [fIni, setFIni] = useState(haceDias(30))
  const [fFin, setFFin] = useState(hoyISO())
  const [area, setArea] = useState('produccion')
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { if (periodo !== 'rango' || (fIni && fFin)) cargar() }, [periodo, site, fIni, fFin])

  const TABLAS_CON_SITE = ['ordenes_trabajo', 'ordenes_compra', 'embarques', 'requisiciones', 'maquinas', 'recibos', 'ordenes_maquila', 'consigna_autorizaciones', 'suministros', 'semanas_produccion']
  const cnt = async (tabla, fn) => {
    const sid = siteEfectivo(perfil, site)
    let q = supabase.from(tabla).select('*', { count: 'exact', head: true }).eq('empresa_id', emp)
    if (sid && TABLAS_CON_SITE.includes(tabla)) q = q.eq('site_id', sid)
    if (fn) q = fn(q)
    const { count } = await q
    return count || 0
  }

  const cargar = async () => {
    setLoading(true)
    const { desde, hasta } = rango(periodo, fIni, fFin)
    try {
      // Produccion del periodo (piezas ok / scrap) via ot_reportes -> ordenes_trabajo
      const { data: rep } = await supabase
        .from('ot_reportes')
        .select('cantidad_ok, cantidad_scrap, ordenes_trabajo!inner(empresa_id, articulo_id, site_id)')
        .gte('fecha', desde).lt('fecha', hasta)
        .eq('ordenes_trabajo.empresa_id', emp)
      // (site se aplica abajo con sidRep)
      const sidRep = siteEfectivo(perfil, site)
      const rows = (rep || []).filter(r => !sidRep || r.ordenes_trabajo?.site_id === sidRep)
      let ok = 0, scrap = 0
      const porArt = {}
      rows.forEach(r => {
        ok += Number(r.cantidad_ok) || 0; scrap += Number(r.cantidad_scrap) || 0
        const a = r.ordenes_trabajo?.articulo_id
        if (a) { porArt[a] = porArt[a] || { ok: 0, scrap: 0 }; porArt[a].ok += Number(r.cantidad_ok) || 0; porArt[a].scrap += Number(r.cantidad_scrap) || 0 }
      })
      const total = ok + scrap
      const scrapPct = total > 0 ? (scrap / total) * 100 : 0

      // Limite de scrap: por articulo + default de empresa
      const { data: pars } = await supabase.from('produccion_parametros').select('pct_scrap_default').eq('empresa_id', emp).maybeSingle()
      const defScrap = Number(pars?.pct_scrap_default) || 0
      const { data: arts } = await supabase.from('articulos').select('id, pct_scrap_aprobado').eq('empresa_id', emp)
      const limMap = {}; (arts || []).forEach(a => { limMap[a.id] = a.pct_scrap_aprobado })
      let sobreScrap = 0
      Object.entries(porArt).forEach(([a, v]) => {
        const t = v.ok + v.scrap; if (!t) return
        const p = (v.scrap / t) * 100
        const lim = limMap[a] != null ? Number(limMap[a]) : defScrap
        if (lim > 0 && p > lim) sobreScrap++
      })

      // Estado de maquinas ahora
      const sidM = siteEfectivo(perfil, site)
      let qEst = supabase.from('maquina_estado').select('estado, maquina:maquinas!inner(site_id)').eq('empresa_id', emp)
      if (sidM) qEst = qEst.eq('maquina.site_id', sidM)
      const { data: est } = await qEst
      const em = { trabajando: 0, parada: 0, cambio_molde: 0, sin_programa: 0 }
      ;(est || []).forEach(e => { if (em[e.estado] != null) em[e.estado]++ })
      const totMaq = await cnt('maquinas', q => q.eq('activo', true))

      // OT del periodo
      const otProg = await cnt('ordenes_trabajo', q => q.gte('fecha_programada', desde).lt('fecha_programada', hasta))
      const otCerr = await cnt('ordenes_trabajo', q => q.gte('fecha_programada', desde).lt('fecha_programada', hasta).eq('estatus', 'cerrada'))
      const reprog = await cnt('programa_cambios', q => q.gte('at', desde).lt('at', hasta))

      // Calidad
      const ncAb = await cnt('no_conformidades', q => q.neq('estatus', 'cerrada'))
      const ncPer = await cnt('no_conformidades', q => q.gte('fecha', desde).lt('fecha', hasta))
      const alertas = await cnt('calidad_alertas', q => q.eq('vigente', true))
      const cuar = await cnt('cuarentena_eventos', q => q.is('salida_at', null))

      // Moldes
      const { data: moldes } = await supabase.from('moldes').select('activo, shots_acumulados, shots_alerta_min').eq('empresa_id', emp)
      const moldesAct = (moldes || []).filter(m => m.activo).length
      const moldesAlerta = (moldes || []).filter(m => m.activo && Number(m.shots_alerta_min) > 0 && Number(m.shots_acumulados) >= Number(m.shots_alerta_min)).length
      const mmAb = await cnt('molde_mtto', q => q.is('fecha_fin', null))
      const avisosAb = await cnt('molde_avisos', q => q.is('mtto_id', null))

      // Mantenimiento general
      const mgAb = await cnt('mtto_gen_ordenes', q => q.neq('estatus', 'cerrada'))
      const mgExt = await cnt('mtto_gen_ordenes', q => q.neq('estatus', 'cerrada').eq('es_externo', true))

      // Logistica / comercial
      const embarques = await cnt('embarques', q => q.gte('fecha', desde).lt('fecha', hasta))
      const relVig = await cnt('release_lineas', () => supabase.from('release_lineas').select('*', { count: 'exact', head: true }).eq('vigente', true))
      const movFuera = await cnt('movimientos', q => q.gte('fecha', desde).lt('fecha', hasta).eq('fuera_flujo', true))

      // Compras / subcontrato
      let qOc = supabase.from('ordenes_compra').select('total, tipo, estatus').eq('empresa_id', emp).gte('fecha_emision', desde).lt('fecha_emision', hasta)
      if (sidM) qOc = qOc.eq('site_id', sidM)
      const { data: ocs } = await qOc
      const ocTotal = (ocs || []).reduce((s, o) => s + (Number(o.total) || 0), 0)
      const ocSub = (ocs || []).filter(o => o.tipo === 'subcontrato')
      const ocSubMonto = ocSub.reduce((s, o) => s + (Number(o.total) || 0), 0)
      const omAbiertas = await cnt('ordenes_maquila', q => q.neq('estatus', 'cerrada'))

      // Costo mtto moldes cobrable del periodo
      const { data: mmCob } = await supabase.from('molde_mtto').select('monto_cobrado, es_cobrable, created_at').eq('empresa_id', emp).gte('created_at', desde).lt('created_at', hasta)
      const cobrable = (mmCob || []).filter(m => m.es_cobrable).reduce((s, m) => s + (Number(m.monto_cobrado) || 0), 0)

      setD({ ok, scrap, total, scrapPct, sobreScrap, em, totMaq, otProg, otCerr, reprog, ncAb, ncPer, alertas, cuar, moldesAct, moldesAlerta, mmAb, avisosAb, mgAb, mgExt, embarques, relVig, movFuera, ocTotal, ocSubMonto, ocSubN: ocSub.length, omAbiertas, cobrable })
    } catch (e) {
      setD({ error: e.message })
    }
    setLoading(false)
  }

  const fmtDia = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('es-MX') : ''
  const periodoLbl = periodo === 'hoy' ? 'Hoy'
    : periodo === 'semana' ? 'Esta semana'
    : periodo === 'mes' ? 'Este mes'
    : `${fmtDia(fIni)} al ${fmtDia(fFin)}`

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.top} className="no-imprimir">
        <div>
          <h2 style={styles.titulo}>Reportes Ejecutivos</h2>
          <p style={styles.sub}>{perfil?.empresas?.nombre || ''} - {periodoLbl}</p>
        </div>
        <div style={styles.controles}>
          <div style={styles.segment}>
            {['hoy', 'semana', 'mes', 'rango'].map(p => (
              <button key={p} onClick={() => setPeriodo(p)} style={{ ...styles.segBtn, ...(periodo === p ? styles.segOn : {}) }}>
                {p === 'hoy' ? 'Hoy' : p === 'semana' ? 'Semana' : p === 'mes' ? 'Mes' : 'Rango'}
              </button>
            ))}
          </div>
          {periodo === 'rango' && (
            <span style={styles.rangoBox}>
              <label style={styles.rangoLbl}>Del</label>
              <input type="date" style={styles.fecha} value={fIni} max={fFin} onChange={e => setFIni(e.target.value)} />
              <label style={styles.rangoLbl}>al</label>
              <input type="date" style={styles.fecha} value={fFin} min={fIni} max={hoyISO()} onChange={e => setFFin(e.target.value)} />
            </span>
          )}
          <FiltroSite value={site} onChange={setSite} />
          <button style={styles.print} onClick={() => window.print()}>Imprimir</button>
        </div>
      </div>

      <div style={styles.tabs} className="no-imprimir">
        {[['director', 'Director'], ['planta', 'Gerente de Planta / Admin'], ['area', 'Gerente de Area']].map(([id, lbl]) => (
          <button key={id} onClick={() => setTab(id)} style={{ ...styles.tab, ...(tab === id ? styles.tabOn : {}) }}>{lbl}</button>
        ))}
      </div>

      {loading && <p style={{ color: '#666', padding: '20px' }}>Calculando indicadores...</p>}
      {!loading && d?.error && <p style={styles.err}>No se pudieron calcular los KPIs: {d.error}</p>}
      {!loading && d && !d.error && (
        <>
          {tab === 'director' && (
            <Grid>
              <Card t="Produccion (piezas OK)" v={fmt(d.ok)} sub={periodoLbl} c="#0369a1" />
              <Card t="Scrap" v={fmtPct(d.scrapPct)} sub={fmt(d.scrap) + ' pzs de ' + fmt(d.total)} c={d.scrapPct > 3 ? '#dc2626' : '#16a34a'} />
              <Card t="Productos sobre % scrap" v={fmt(d.sobreScrap)} sub="articulos exceden su limite" c={d.sobreScrap ? '#dc2626' : '#16a34a'} />
              <Card t="No conformidades abiertas" v={fmt(d.ncAb)} sub={fmt(d.ncPer) + ' nuevas en periodo'} c={d.ncAb ? '#b91c1c' : '#16a34a'} />
              <Card t="Cuarentena activa" v={fmt(d.cuar)} sub="lotes retenidos" c={d.cuar ? '#d97706' : '#16a34a'} />
              <Card t="Embarques" v={fmt(d.embarques)} sub={periodoLbl} c="#0891b2" />
              <Card t="Moldes en mantenimiento" v={fmt(d.mmAb)} sub={fmt(d.moldesAlerta) + ' con alerta de shots'} c={d.mmAb ? '#a16207' : '#16a34a'} />
              <Card t="Compras del periodo" v={fmtDin(d.ocTotal)} sub={fmtDin(d.ocSubMonto) + ' en subcontrato'} c="#2563eb" />
              <Card t="Mtto de molde cobrable" v={fmtDin(d.cobrable)} sub="recuperable a cliente" c="#7c3aed" />
            </Grid>
          )}

          {tab === 'planta' && (
            <>
              <h3 style={styles.h3}>Estado de maquinas ahora ({fmt(d.totMaq)} activas)</h3>
              <Grid>
                <Card t="Trabajando" v={fmt(d.em.trabajando)} c="#16a34a" />
                <Card t="Paro" v={fmt(d.em.parada)} c="#dc2626" />
                <Card t="Cambio de molde" v={fmt(d.em.cambio_molde)} c="#d97706" />
                <Card t="Sin programa" v={fmt(d.em.sin_programa)} c="#475569" />
              </Grid>
              <h3 style={styles.h3}>Operacion del periodo</h3>
              <Grid>
                <Card t="OT programadas" v={fmt(d.otProg)} sub={fmt(d.otCerr) + ' cerradas'} c="#c2410c" />
                <Card t="Reprogramaciones" v={fmt(d.reprog)} sub="cambios fuera de plan" c={d.reprog ? '#d97706' : '#16a34a'} />
                <Card t="Scrap" v={fmtPct(d.scrapPct)} sub={fmt(d.sobreScrap) + ' productos sobre limite'} c={d.scrapPct > 3 ? '#dc2626' : '#16a34a'} />
                <Card t="Moldes con alerta shots" v={fmt(d.moldesAlerta)} sub="requieren preventivo" c={d.moldesAlerta ? '#a16207' : '#16a34a'} />
                <Card t="Avisos de molde por atender" v={fmt(d.avisosAb)} c={d.avisosAb ? '#b45309' : '#16a34a'} />
                <Card t="Mtto general abierto" v={fmt(d.mgAb)} sub={fmt(d.mgExt) + ' externos'} c={d.mgAb ? '#57534e' : '#16a34a'} />
                <Card t="No conformidades abiertas" v={fmt(d.ncAb)} c={d.ncAb ? '#b91c1c' : '#16a34a'} />
                <Card t="Cuarentena activa" v={fmt(d.cuar)} c={d.cuar ? '#d97706' : '#16a34a'} />
              </Grid>
            </>
          )}

          {tab === 'area' && (
            <>
              <div style={styles.segment} className="no-imprimir">
                {[['produccion', 'Produccion'], ['calidad', 'Calidad'], ['logistica', 'Logistica'], ['moldes', 'Moldes'], ['mantenimiento', 'Mantenimiento'], ['compras', 'Compras']].map(([id, lbl]) => (
                  <button key={id} onClick={() => setArea(id)} style={{ ...styles.segBtn, ...(area === id ? styles.segOn : {}) }}>{lbl}</button>
                ))}
              </div>
              {area === 'produccion' && (
                <Grid>
                  <Card t="Piezas OK" v={fmt(d.ok)} sub={periodoLbl} c="#0369a1" />
                  <Card t="Scrap" v={fmtPct(d.scrapPct)} sub={fmt(d.scrap) + ' pzs'} c={d.scrapPct > 3 ? '#dc2626' : '#16a34a'} />
                  <Card t="OT programadas" v={fmt(d.otProg)} sub={fmt(d.otCerr) + ' cerradas'} c="#c2410c" />
                  <Card t="Maquinas en paro" v={fmt(d.em.parada)} c={d.em.parada ? '#dc2626' : '#16a34a'} />
                  <Card t="Reprogramaciones" v={fmt(d.reprog)} c="#d97706" />
                  <Card t="Productos sobre % scrap" v={fmt(d.sobreScrap)} c={d.sobreScrap ? '#dc2626' : '#16a34a'} />
                </Grid>
              )}
              {area === 'calidad' && (
                <Grid>
                  <Card t="NC abiertas" v={fmt(d.ncAb)} sub={fmt(d.ncPer) + ' nuevas'} c={d.ncAb ? '#b91c1c' : '#16a34a'} />
                  <Card t="Alertas vigentes" v={fmt(d.alertas)} c={d.alertas ? '#be123c' : '#16a34a'} />
                  <Card t="Cuarentena activa" v={fmt(d.cuar)} c={d.cuar ? '#d97706' : '#16a34a'} />
                  <Card t="Scrap del periodo" v={fmtPct(d.scrapPct)} c={d.scrapPct > 3 ? '#dc2626' : '#16a34a'} />
                </Grid>
              )}
              {area === 'logistica' && (
                <Grid>
                  <Card t="Embarques" v={fmt(d.embarques)} sub={periodoLbl} c="#0891b2" />
                  <Card t="Releases vigentes" v={fmt(d.relVig)} c="#0e7490" />
                  <Card t="Movimientos fuera de flujo" v={fmt(d.movFuera)} c={d.movFuera ? '#d97706' : '#16a34a'} />
                  <Card t="Cuarentena activa" v={fmt(d.cuar)} c={d.cuar ? '#d97706' : '#16a34a'} />
                </Grid>
              )}
              {area === 'moldes' && (
                <Grid>
                  <Card t="Moldes activos" v={fmt(d.moldesAct)} c="#a16207" />
                  <Card t="En mantenimiento" v={fmt(d.mmAb)} c={d.mmAb ? '#b45309' : '#16a34a'} />
                  <Card t="Con alerta de shots" v={fmt(d.moldesAlerta)} c={d.moldesAlerta ? '#dc2626' : '#16a34a'} />
                  <Card t="Avisos por atender" v={fmt(d.avisosAb)} c={d.avisosAb ? '#b45309' : '#16a34a'} />
                  <Card t="Mtto cobrable (periodo)" v={fmtDin(d.cobrable)} c="#7c3aed" />
                </Grid>
              )}
              {area === 'mantenimiento' && (
                <Grid>
                  <Card t="Ordenes abiertas" v={fmt(d.mgAb)} c={d.mgAb ? '#57534e' : '#16a34a'} />
                  <Card t="Externas" v={fmt(d.mgExt)} c="#78716c" />
                  <Card t="Maquinas en paro" v={fmt(d.em.parada)} c={d.em.parada ? '#dc2626' : '#16a34a'} />
                </Grid>
              )}
              {area === 'compras' && (
                <Grid>
                  <Card t="Compras del periodo" v={fmtDin(d.ocTotal)} c="#2563eb" />
                  <Card t="Subcontrato" v={fmtDin(d.ocSubMonto)} sub={fmt(d.ocSubN) + ' OC'} c="#1d4ed8" />
                  <Card t="Ordenes de maquila abiertas" v={fmt(d.omAbiertas)} c="#3b82f6" />
                </Grid>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

function Grid({ children }) { return <div style={styles.grid}>{children}</div> }
function Card({ t, v, sub, c }) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.cardBar, backgroundColor: c || '#334155' }} />
      <div style={styles.cardBody}>
        <p style={styles.cardT}>{t}</p>
        <p style={{ ...styles.cardV, color: c || '#1a1a2e' }}>{v}</p>
        {sub && <p style={styles.cardSub}>{sub}</p>}
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '24px' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '12px', marginBottom: '16px' },
  titulo: { fontSize: '19px', fontWeight: '700', color: '#1a1a2e', margin: '0 0 2px' },
  sub: { fontSize: '13px', color: '#64748b', margin: 0 },
  controles: { display: 'flex', gap: '10px', alignItems: 'center' },
  segment: { display: 'inline-flex', backgroundColor: '#f1f5f9', borderRadius: '8px', padding: '3px', gap: '2px', marginBottom: '10px', flexWrap: 'wrap' },
  segBtn: { padding: '7px 14px', border: 'none', backgroundColor: 'transparent', borderRadius: '6px', fontSize: '13px', color: '#475569', cursor: 'pointer' },
  segOn: { backgroundColor: '#fff', color: '#1a1a2e', fontWeight: '600', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' },
  rangoBox: { display: 'inline-flex', alignItems: 'center', gap: '6px', marginBottom: '10px' },
  rangoLbl: { fontSize: '12px', color: '#64748b' },
  fecha: { padding: '7px 10px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none' },
  print: { padding: '8px 16px', backgroundColor: '#1a1a2e', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '6px', borderBottom: '2px solid #e2e8f0', marginBottom: '18px', flexWrap: 'wrap' },
  tab: { padding: '10px 18px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent', marginBottom: '-2px' },
  tabOn: { color: '#1a1a2e', fontWeight: '600', borderBottom: '2px solid #1a1a2e' },
  h3: { fontSize: '13px', fontWeight: '600', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', margin: '20px 0 10px' },
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' },
  card: { backgroundColor: '#fff', borderRadius: '10px', boxShadow: '0 1px 5px rgba(0,0,0,0.07)', overflow: 'hidden', display: 'flex' },
  cardBar: { width: '5px' },
  cardBody: { padding: '16px 18px', flex: 1 },
  cardT: { fontSize: '12.5px', color: '#64748b', margin: '0 0 8px', fontWeight: '500' },
  cardV: { fontSize: '28px', fontWeight: '700', margin: 0, lineHeight: 1 },
  cardSub: { fontSize: '11.5px', color: '#94a3b8', margin: '6px 0 0' },
  err: { color: '#dc2626', fontSize: '13px', padding: '14px' },
}
