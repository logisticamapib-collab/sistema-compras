import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'
import { BarChart, Bar, ComposedChart, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

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
  const [empresa, setEmpresa] = useState(null)
  const [sitesCat, setSitesCat] = useState([])
  const [gMode, setGMode] = useState('anio')            // 'anio' | 'rango'
  const [gAnio, setGAnio] = useState(new Date().getFullYear())
  const [gDesde, setGDesde] = useState(new Date().getFullYear() - 2)
  const [gHasta, setGHasta] = useState(new Date().getFullYear())
  const [serie, setSerie] = useState([])
  const [cargandoG, setCargandoG] = useState(false)
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

  useEffect(() => {
    supabase.from('empresas').select('*').eq('id', emp).maybeSingle().then(({ data }) => setEmpresa(data || null))
    supabase.from('sites').select('id, nombre, codigo').eq('empresa_id', emp).then(({ data }) => setSitesCat(data || []))
  }, [])

  // ---------- Serie mensual para las graficas ----------
  useEffect(() => { cargarSerie() }, [gMode, gAnio, gDesde, gHasta, site])
  const cargarSerie = async () => {
    setCargandoG(true)
    try {
      const y1 = gMode === 'anio' ? Number(gAnio) : Math.min(Number(gDesde), Number(gHasta))
      const y2 = gMode === 'anio' ? Number(gAnio) : Math.max(Number(gDesde), Number(gHasta))
      const ini = `${y1}-01-01`, fin = `${y2 + 1}-01-01`
      const sid = siteEfectivo(perfil, site)

      const [rep, emb, embL, ocs, mm, ac] = await Promise.all([
        supabase.from('ot_reportes').select('fecha, cantidad_ok, cantidad_scrap, ordenes_trabajo!inner(empresa_id, site_id)')
          .eq('ordenes_trabajo.empresa_id', emp).gte('fecha', ini).lt('fecha', fin),
        supabase.from('embarques').select('id, fecha, site_id').eq('empresa_id', emp).gte('fecha', ini).lt('fecha', fin),
        supabase.from('embarque_lineas').select('embarque_id, articulo_id, cantidad'),
        supabase.from('ordenes_compra').select('total, fecha_emision, site_id, estatus').eq('empresa_id', emp).gte('fecha_emision', ini).lt('fecha_emision', fin),
        supabase.from('molde_mtto').select('monto_cobrado, es_cobrable, created_at').eq('empresa_id', emp).gte('created_at', ini).lt('created_at', fin),
        supabase.from('articulo_cliente').select('articulo_id, precio').eq('activo', true),
      ])

      const precio = {}; (ac.data || []).forEach(x => { if (precio[x.articulo_id] == null) precio[x.articulo_id] = Number(x.precio) || 0 })
      const meses = {}
      const key = (d) => String(d).slice(0, 7)
      const bucket = (k) => (meses[k] = meses[k] || { k, produccion: 0, scrap: 0, embPz: 0, embMonto: 0, compras: 0, mttoCobrable: 0 })
      for (let y = y1; y <= y2; y++) for (let m = 1; m <= 12; m++) bucket(`${y}-${String(m).padStart(2, '0')}`)

      ;(rep.data || []).filter(r => !sid || r.ordenes_trabajo?.site_id === sid).forEach(r => {
        const b = bucket(key(r.fecha)); b.produccion += Number(r.cantidad_ok) || 0; b.scrap += Number(r.cantidad_scrap) || 0
      })
      const embOK = (emb.data || []).filter(e => !sid || e.site_id === sid)
      const embMap = {}; embOK.forEach(e => { embMap[e.id] = key(e.fecha) })
      ;(embL.data || []).forEach(l => {
        const k = embMap[l.embarque_id]; if (!k) return
        const b = bucket(k); const q = Number(l.cantidad) || 0
        b.embPz += q; b.embMonto += q * (precio[l.articulo_id] || 0)
      })
      ;(ocs.data || []).filter(o => (!sid || o.site_id === sid) && o.estatus !== 'cancelada').forEach(o => {
        bucket(key(o.fecha_emision)).compras += Number(o.total) || 0
      })
      ;(mm.data || []).filter(m => m.es_cobrable).forEach(m => {
        bucket(key(m.created_at)).mttoCobrable += Number(m.monto_cobrado) || 0
      })

      const MES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
      setSerie(Object.values(meses).sort((a, b) => a.k.localeCompare(b.k)).map(x => {
        const [yy, mm2] = x.k.split('-')
        return { ...x, mes: y1 === y2 ? MES[Number(mm2) - 1] : `${MES[Number(mm2) - 1]} ${yy.slice(2)}` }
      }))
    } catch (e) { setSerie([]) }
    setCargandoG(false)
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


  // ---------- Bloque de graficas mensuales ----------
  const anios = []
  for (let y = new Date().getFullYear(); y >= new Date().getFullYear() - 6; y--) anios.push(y)
  const tot = (campo) => serie.reduce((a, b) => a + (Number(b[campo]) || 0), 0)
  const pctScrap = tot('produccion') + tot('scrap') > 0 ? (tot('scrap') / (tot('produccion') + tot('scrap')) * 100) : 0

  const graficas = (
    <div style={styles.graficas}>
      <div style={styles.gHead}>
        <h3 style={styles.gTitulo}>Tendencia mensual</h3>
        <div style={styles.gFiltros} className="no-imprimir">
          <div style={styles.segment}>
            {[['anio', 'Ano actual'], ['rango', 'Rango de anos']].map(([k, l]) => (
              <button key={k} onClick={() => setGMode(k)} style={{ ...styles.segBtn, ...(gMode === k ? styles.segOn : {}) }}>{l}</button>
            ))}
          </div>
          {gMode === 'anio' ? (
            <select style={styles.fecha} value={gAnio} onChange={e => setGAnio(Number(e.target.value))}>
              {anios.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          ) : (
            <span style={styles.rangoBox}>
              <label style={styles.rangoLbl}>De</label>
              <select style={styles.fecha} value={gDesde} onChange={e => setGDesde(Number(e.target.value))}>
                {anios.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
              <label style={styles.rangoLbl}>a</label>
              <select style={styles.fecha} value={gHasta} onChange={e => setGHasta(Number(e.target.value))}>
                {anios.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </span>
          )}
        </div>
        <span style={styles.gPeriodo}>{gMode === 'anio' ? gAnio : `${Math.min(gDesde, gHasta)} - ${Math.max(gDesde, gHasta)}`}</span>
      </div>

      {cargandoG ? <p style={{ color: '#94a3b8', fontSize: 13 }}>Calculando tendencia...</p> : (
        <>
          <div style={styles.gGrid}>
            <div style={styles.gCard}>
              <p style={styles.gSub}>Produccion vs Scrap (piezas) · scrap {pctScrap.toFixed(1)}%</p>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="produccion" name="Produccion OK" fill="#0369a1" />
                  <Bar dataKey="scrap" name="Scrap" fill="#dc2626" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div style={styles.gCard}>
              <p style={styles.gSub}>Embarques - piezas y monto</p>
              <ResponsiveContainer width="100%" height={240}>
                <ComposedChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v, n) => n === 'Monto' ? fmtDin(v) : fmt(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar yAxisId="l" dataKey="embPz" name="Piezas" fill="#0891b2" />
                  <Line yAxisId="r" type="monotone" dataKey="embMonto" name="Monto" stroke="#15803d" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div style={{ ...styles.gCard, gridColumn: '1 / -1' }}>
              <p style={styles.gSub}>Compras y mantenimiento de molde cobrable (monto)</p>
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={serie}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                  <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip formatter={(v) => fmtDin(v)} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="compras" name="Compras" stroke="#2563eb" strokeWidth={2} />
                  <Line type="monotone" dataKey="mttoCobrable" name="Mtto molde cobrable" stroke="#7c3aed" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div style={styles.gTotales}>
            <span>Produccion: <b>{fmt(tot('produccion'))}</b></span>
            <span style={{ color: '#dc2626' }}>Scrap: <b>{fmt(tot('scrap'))}</b> ({pctScrap.toFixed(1)}%)</span>
            <span style={{ color: '#0891b2' }}>Embarcado: <b>{fmt(tot('embPz'))}</b> pz · <b>{fmtDin(tot('embMonto'))}</b></span>
            <span style={{ color: '#2563eb' }}>Compras: <b>{fmtDin(tot('compras'))}</b></span>
            <span style={{ color: '#7c3aed' }}>Mtto cobrable: <b>{fmtDin(tot('mttoCobrable'))}</b></span>
          </div>
        </>
      )}
    </div>
  )

  return (
    <div style={styles.container} className="aparecer">
      {/* Encabezado que SOLO aparece al imprimir */}
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 12mm; }
          .solo-imprimir { display: flex !important; }
          .no-imprimir { display: none !important; }
        }
      `}</style>
      <div style={styles.hojaHead} className="solo-imprimir">
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {empresa?.logo_url && <img src={empresa.logo_url} alt="" style={{ height: '52px', objectFit: 'contain' }} />}
          <div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#1a1a2e' }}>{empresa?.nombre || 'SYNTIA'}</div>
            <div style={{ fontSize: '13px', color: '#334155' }}>Reporte Ejecutivo - {tab === 'director' ? 'Direccion' : tab === 'planta' ? 'Gerencia de Planta / Administrativa' : 'Gerencia de Area'}</div>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: '11.5px', color: '#475569', lineHeight: 1.6 }}>
          <div><b>Site:</b> {siteEfectivo(perfil, site) ? (sitesCat.find(x => x.id === siteEfectivo(perfil, site))?.nombre || '-') : 'Todos los sites'}</div>
          <div><b>Filtro:</b> {periodo === 'hoy' ? 'Hoy' : periodo === 'semana' ? 'Semana' : periodo === 'mes' ? 'Mes' : 'Rango'} - {periodoLbl}</div>
          <div><b>Impreso:</b> {new Date().toLocaleString('es-MX')}</div>
        </div>
      </div>

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

      {!loading && !d?.error && graficas}
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
  hojaHead: { display: 'none', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid #1a1a2e', paddingBottom: '10px', marginBottom: '14px' },
  graficas: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '12px', padding: '16px 18px', marginTop: '18px' },
  gHead: { display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap', marginBottom: '10px' },
  gTitulo: { fontSize: '15px', fontWeight: 700, color: '#1a1a2e', margin: 0 },
  gFiltros: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  gPeriodo: { marginLeft: 'auto', fontSize: '12px', color: '#64748b', fontWeight: 600 },
  gGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: '16px' },
  gCard: { border: '1px solid #f1f5f9', borderRadius: '10px', padding: '10px 8px 4px' },
  gSub: { fontSize: '12.5px', fontWeight: 600, color: '#334155', margin: '0 0 6px 8px' },
  gTotales: { display: 'flex', gap: '20px', flexWrap: 'wrap', marginTop: '12px', paddingTop: '10px', borderTop: '1px solid #f1f5f9', fontSize: '13px', color: '#334155' },
  err: { color: '#dc2626', fontSize: '13px', padding: '14px' },
}
