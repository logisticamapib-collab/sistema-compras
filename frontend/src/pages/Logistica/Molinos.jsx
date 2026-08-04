import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// MOLINOS.
//
// El area muele las piezas NG y de ahi sale MOLIDO, que segun el articulo se
// puede reincorporar a la mezcla o venderse, y BARREDURA, que es resina del
// piso o de limpiar tolvas y ya no entra a proceso.
//
// El molido entra al inventario a un porcentaje de recuperacion sobre el
// costo de la resina virgen: el scrap ya se cargo como perdida en la OT, asi
// que valuarlo a costo pleno duplicaria el valor. La barredura lleva su
// propio porcentaje, mucho menor.
//
// Molinos tiene almacen propio pero es de TRANSITO: lo que se muele se
// entrega despues al almacen de resguardo.

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const din = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const hoyISO = () => new Date().toISOString().slice(0, 10)

export default function Molinos() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeCapturar = tienePermiso('log_molinos', 'crear')
  const puedeConfig = tienePermiso('log_molinos', 'aprobar')

  const [tab, setTab] = useState('captura')
  const [site, setSite] = useState('')
  const [param, setParam] = useState(null)
  const [almacenes, setAlmacenes] = useState([])
  const [derivados, setDerivados] = useState([])   // articulos molido / barredura
  const [virgenes, setVirgenes] = useState([])
  const [fabricados, setFabricados] = useState([])
  const [clientes, setClientes] = useState([])
  const [politicas, setPoliticas] = useState([])
  const [movs, setMovs] = useState([])
  const [reporte, setReporte] = useState([])
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 29); return d.toISOString().slice(0, 10) })
  const [hasta, setHasta] = useState(hoyISO())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [nuevoDeriv, setNuevoDeriv] = useState({ virgen_id: '', tipo: 'molido' })

  const capVacia = { fecha: hoyISO(), turno: '1o', articulo_molido_id: '', kg: '', articulo_ng_id: '', piezas_ng: '', cliente_id: '' }
  const [cap, setCap] = useState(capVacia)

  useEffect(() => { cargar() }, [site, desde, hasta])

  const cargar = async () => {
    setLoading(true); setError('')
    const sid = siteEfectivo(perfil, site)
    const [pa, al, ar, cl, po, mv, rp] = await Promise.all([
      supabase.from('molino_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('almacenes').select('id, clave, nombre, site_id').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, tipo_material, articulo_virgen_id, origen, es_consigna, costo, admite_molido')
        .eq('empresa_id', emp).eq('activo', true).order('codigo_interno'),
      supabase.from('clientes').select('id, nombre').eq('empresa_id', emp).eq('activo', true).order('nombre'),
      supabase.from('cliente_molido_politica').select('*').eq('empresa_id', emp),
      supabase.from('molienda').select('*, art:articulos!molienda_articulo_molido_id_fkey(codigo_interno, tipo_material), lote:lotes(codigo_lote), cli:clientes(nombre)')
        .eq('empresa_id', emp).gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }).order('id', { ascending: false }),
      supabase.rpc('molino_reporte', { p_empresa_id: emp, p_desde: desde, p_hasta: hasta, p_site_id: sid || null }),
    ])
    setParam(pa.data || null)
    setAlmacenes(al.data || [])
    const arts = ar.data || []
    setDerivados(arts.filter(a => a.tipo_material === 'molido' || a.tipo_material === 'barredura'))
    setVirgenes(arts.filter(a => a.origen === 'comprado' && a.tipo_material !== 'molido' && a.tipo_material !== 'barredura'))
    setFabricados(arts.filter(a => a.origen === 'fabricado' && !a.tipo_material))
    setClientes(cl.data || []); setPoliticas(po.data || [])
    setMovs(mv.data || [])
    if (rp.error) setError('No se pudo calcular el reporte: ' + rp.error.message)
    setReporte(rp.data || [])
    setLoading(false)
  }

  // ---------- Captura diaria ----------
  const guardarCaptura = async () => {
    setError(''); setExito('')
    if (!param?.almacen_molinos_id) { setError('Primero configura el almacen de Molinos en la pestana de Configuracion.'); return }
    if (!cap.articulo_molido_id || !cap.kg) { setError('Elige el material y captura los kilos'); return }
    if (Number(cap.kg) <= 0) { setError('Los kilos deben ser mayores a cero'); return }
    const { error: e } = await supabase.rpc('registrar_molienda', {
      p_empresa_id: emp, p_site_id: siteEfectivo(perfil, site) || perfil.site_id || null,
      p_fecha: cap.fecha, p_turno: cap.turno,
      p_articulo_molido_id: Number(cap.articulo_molido_id), p_kg: Number(cap.kg),
      p_articulo_ng_id: cap.articulo_ng_id ? Number(cap.articulo_ng_id) : null,
      p_piezas_ng: cap.piezas_ng ? Number(cap.piezas_ng) : null,
      p_cliente_id: cap.cliente_id ? Number(cap.cliente_id) : null,
      p_usuario: perfil.id,
    })
    if (e) { setError('No se pudo registrar: ' + e.message); return }
    setExito(`Registrados ${fmt(cap.kg)} kg`)
    setCap({ ...capVacia, fecha: cap.fecha, turno: cap.turno })
    cargar()
  }

  // ---------- Alta del articulo derivado ----------
  const crearDerivado = async () => {
    setError(''); setExito('')
    if (!nuevoDeriv.virgen_id) { setError('Elige la resina virgen'); return }
    const { data, error: e } = await supabase.rpc('crear_articulo_molido', {
      p_empresa_id: emp, p_articulo_virgen_id: Number(nuevoDeriv.virgen_id), p_tipo: nuevoDeriv.tipo,
    })
    if (e) { setError('No se pudo crear: ' + e.message); return }
    setExito(data ? 'Articulo listo' : 'Articulo creado')
    setNuevoDeriv({ virgen_id: '', tipo: 'molido' }); cargar()
  }

  // ---------- Configuracion ----------
  const guardarParam = async (campo, valor) => {
    const v = campo === 'almacen_molinos_id' ? (valor ? Number(valor) : null) : Number(valor)
    if (campo !== 'almacen_molinos_id' && (isNaN(v) || v < 0 || v > 100)) {
      setError('El porcentaje debe estar entre 0 y 100'); return
    }
    setError('')
    const { error: e } = await supabase.from('molino_parametros')
      .upsert({ empresa_id: emp, [campo]: v, updated_at: new Date().toISOString(), updated_by: perfil.id })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setParam(p => ({ ...p, [campo]: v })); setExito('Configuracion actualizada'); cargar()
  }

  const guardarPolitica = async (clienteId, campo, valor) => {
    setError('')
    const actual = politicas.find(p => p.cliente_id === clienteId) || {}
    const { error: e } = await supabase.from('cliente_molido_politica').upsert({
      empresa_id: emp, cliente_id: clienteId,
      permite_mezcla: actual.permite_mezcla ?? true,
      permite_venta: actual.permite_venta ?? false,
      retorna_cliente: actual.retorna_cliente ?? true,
      [campo]: valor,
    }, { onConflict: 'empresa_id,cliente_id' })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setExito('Politica actualizada'); cargar()
  }

  const politicaDe = (cid) => politicas.find(p => p.cliente_id === cid) || { permite_mezcla: true, permite_venta: false, retorna_cliente: true }

  // ---------- Totales ----------
  const tot = reporte.reduce((a, r) => ({
    gen: a.gen + Number(r.kg_generado || 0),
    monto: a.monto + Number(r.monto_generado || 0),
    rec: a.rec + Number(r.kg_recuperado || 0),
    ven: a.ven + Number(r.kg_vendido || 0),
    ret: a.ret + Number(r.kg_retornado || 0),
    piso: a.piso + Number(r.kg_en_piso || 0),
  }), { gen: 0, monto: 0, rec: 0, ven: 0, ret: 0, piso: 0 })
  const pctRec = tot.gen > 0 ? (100 * tot.rec / tot.gen) : 0

  const COLS_REP = [
    { label: 'Codigo', get: r => r.codigo_interno },
    { label: 'Descripcion', get: r => r.descripcion },
    { label: 'Tipo', get: r => r.tipo_material },
    { label: 'Resina virgen', get: r => r.virgen_codigo || '' },
    { label: 'Consigna', get: r => r.es_consigna ? 'Si' : 'No' },
    { label: 'Costo por kg', get: r => r.costo_unitario },
    { label: 'Kg generado', get: r => r.kg_generado },
    { label: 'Monto generado', get: r => r.monto_generado },
    { label: 'Kg recuperado', get: r => r.kg_recuperado },
    { label: 'Kg vendido', get: r => r.kg_vendido },
    { label: 'Kg retornado', get: r => r.kg_retornado },
    { label: 'Kg en piso', get: r => r.kg_en_piso },
    { label: '% recuperado', get: r => r.pct_recuperado },
  ]
  const COLS_MOV = [
    { label: 'Fecha', get: m => m.fecha },
    { label: 'Turno', get: m => m.turno || '' },
    { label: 'Material', get: m => m.art?.codigo_interno || '' },
    { label: 'Tipo', get: m => m.art?.tipo_material || '' },
    { label: 'Kg', get: m => m.kg },
    { label: 'Costo por kg', get: m => m.costo_unitario },
    { label: 'Monto', get: m => m.costo_total },
    { label: 'Lote', get: m => m.lote?.codigo_lote || '' },
    { label: 'Cliente (consigna)', get: m => m.cli?.nombre || '' },
    { label: 'Piezas NG', get: m => m.piezas_ng || '' },
  ]

  const almMolinos = almacenes.find(a => a.id === param?.almacen_molinos_id)

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Molinos</h2>
          <p style={S.sub}>
            Registro de lo que se muele, su costo y a donde se va. El molido entra a un
            <b> porcentaje de recuperacion</b> sobre el costo de la resina virgen, porque el scrap ya se
            cargo como perdida en la OT y valuarlo a costo pleno duplicaria el inventario. Molinos es un
            almacen de <b>transito</b>: lo que se muele se entrega despues al almacen de resguardo.
          </p>
        </div>
        <FiltroSite value={site} onChange={setSite} />
      </div>

      {!param?.almacen_molinos_id && (
        <p style={S.avisoCfg}>
          Falta configurar el <b>almacen de Molinos</b>. Hasta que lo definas no se puede registrar
          molienda, porque el material no tendria donde quedar. Se configura en la pestana de Configuracion.
        </p>
      )}

      <div style={S.tabs}>
        {[['captura', 'Captura diaria'], ['reporte', 'Recuperacion'], ['materiales', 'Materiales'], ['config', 'Configuracion']].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => setTab(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      {/* ================= CAPTURA ================= */}
      {tab === 'captura' && (
        <>
          {puedeCapturar && (
            <div style={S.card}>
              <p style={S.cardTit}>Registrar lo molido</p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Fecha</label>
                  <input type="date" style={S.input} value={cap.fecha} onChange={e => setCap({ ...cap, fecha: e.target.value })} />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Turno</label>
                  <select style={S.input} value={cap.turno} onChange={e => setCap({ ...cap, turno: e.target.value })}>
                    <option value="1o">1o</option><option value="2o">2o</option><option value="3o">3o</option>
                  </select>
                </div>
                <div style={{ ...S.campo, flex: 2.4 }}>
                  <label style={S.label}>Material obtenido *</label>
                  <select style={S.input} value={cap.articulo_molido_id} onChange={e => setCap({ ...cap, articulo_molido_id: e.target.value })}>
                    <option value="">Selecciona...</option>
                    {derivados.map(a => (
                      <option key={a.id} value={a.id}>
                        {a.codigo_interno} — {a.tipo_material}{a.es_consigna ? ' (consigna)' : ''}
                      </option>
                    ))}
                  </select>
                  {derivados.length === 0 && (
                    <span style={S.ayuda}>No hay materiales dados de alta. Crealos en la pestana Materiales.</span>
                  )}
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Kilos *</label>
                  <input type="number" min="0" step="0.01" style={S.input} value={cap.kg}
                    onChange={e => setCap({ ...cap, kg: e.target.value })} />
                </div>
              </div>

              <p style={S.subTit}>Opcional, para poder medir el rendimiento del molino</p>
              <div style={S.fila}>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Pieza NG que se molio</label>
                  <select style={S.input} value={cap.articulo_ng_id} onChange={e => setCap({ ...cap, articulo_ng_id: e.target.value })}>
                    <option value="">No se especifica</option>
                    {fabricados.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
                  </select>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Piezas que entraron</label>
                  <input type="number" min="0" style={S.input} value={cap.piezas_ng}
                    onChange={e => setCap({ ...cap, piezas_ng: e.target.value })} />
                </div>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Cliente (si el material es en consigna)</label>
                  <select style={S.input} value={cap.cliente_id} onChange={e => setCap({ ...cap, cliente_id: e.target.value })}>
                    <option value="">No aplica</option>
                    {clientes.map(c => {
                      const p = politicaDe(c.id)
                      return <option key={c.id} value={c.id}>{c.nombre}{p.permite_venta ? '' : ' — no se puede vender'}</option>
                    })}
                  </select>
                </div>
              </div>

              {(() => {
                const a = derivados.find(x => String(x.id) === String(cap.articulo_molido_id))
                const v = a && virgenes.find(x => x.id === a.articulo_virgen_id)
                if (!a || !cap.kg) return null
                const pct = a.tipo_material === 'barredura'
                  ? Number(param?.pct_recuperacion_barredura ?? 5)
                  : Number(param?.pct_recuperacion_default ?? 40)
                const cu = (Number(v?.costo) || 0) * pct / 100
                return (
                  <div style={S.previo}>
                    Entrara al inventario a <b>{din(cu)}/kg</b> ({pct}% del costo de la resina virgen
                    {v ? ` ${din(v.costo)}/kg` : ''}) &rarr; <b>{din(cu * Number(cap.kg))}</b> por los {fmt(cap.kg)} kg.
                    {almMolinos && <> Queda en <b>{almMolinos.clave}</b> hasta que se entregue al almacen de resguardo.</>}
                  </div>
                )
              })()}

              <div style={S.acciones}>
                <button style={S.boton} onClick={guardarCaptura} disabled={!param?.almacen_molinos_id}>Registrar</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={S.cardHead}>
              <p style={S.cardTit}>Capturas del periodo &middot; {movs.length}</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" style={S.inputMini} value={desde} onChange={e => setDesde(e.target.value)} />
                <input type="date" style={S.inputMini} value={hasta} onChange={e => setHasta(e.target.value)} />
                <button style={S.expBtn} onClick={() => exportarExcel(`molienda_${desde}_${hasta}`, COLS_MOV, movs)}>Excel</button>
                <button style={S.expBtn} onClick={() => imprimirTablaPDF('Molienda', COLS_MOV, movs)}>PDF</button>
              </div>
            </div>
            {movs.length === 0 && <p style={S.vacio}>Sin capturas en el periodo.</p>}
            {movs.length > 0 && (
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Fecha</th><th style={S.th}>Turno</th><th style={S.th}>Material</th>
                    <th style={S.thR}>Kg</th><th style={S.thR}>$/kg</th><th style={S.thR}>Monto</th>
                    <th style={S.th}>Lote</th><th style={S.th}>Consigna</th><th style={S.thR}>Pz NG</th>
                  </tr>
                </thead>
                <tbody>
                  {movs.map(m => (
                    <tr key={m.id}>
                      <td style={S.td}>{m.fecha}</td>
                      <td style={S.td}>{m.turno || '-'}</td>
                      <td style={S.td}>
                        {m.art?.codigo_interno}
                        <span style={m.art?.tipo_material === 'barredura' ? S.tagBar : S.tagMol}>{m.art?.tipo_material}</span>
                      </td>
                      <td style={S.tdR}>{fmt(m.kg)}</td>
                      <td style={S.tdR}>{din(m.costo_unitario)}</td>
                      <td style={S.tdR}>{din(m.costo_total)}</td>
                      <td style={S.td}>{m.lote?.codigo_lote || '-'}</td>
                      <td style={S.td}>{m.cli?.nombre || '-'}</td>
                      <td style={S.tdR}>{m.piezas_ng ? fmt(m.piezas_ng) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ================= REPORTE ================= */}
      {tab === 'reporte' && (
        <>
          <div style={S.kpis}>
            <div style={S.kpi}><span style={S.kpiTit}>Generado</span><b style={S.kpiVal}>{fmt(tot.gen)} kg</b><span style={S.kpiPie}>{din(tot.monto)}</span></div>
            <div style={S.kpi}><span style={S.kpiTit}>Recuperado a proceso</span><b style={{ ...S.kpiVal, color: '#15803d' }}>{fmt(tot.rec)} kg</b><span style={S.kpiPie}>{pctRec.toFixed(1)}% de lo generado</span></div>
            <div style={S.kpi}><span style={S.kpiTit}>Vendido</span><b style={S.kpiVal}>{fmt(tot.ven)} kg</b></div>
            <div style={S.kpi}><span style={S.kpiTit}>Retornado a cliente</span><b style={S.kpiVal}>{fmt(tot.ret)} kg</b></div>
            <div style={S.kpi}><span style={S.kpiTit}>En piso</span><b style={{ ...S.kpiVal, color: '#b45309' }}>{fmt(tot.piso)} kg</b><span style={S.kpiPie}>sin usar ni vender</span></div>
          </div>

          <div style={S.card}>
            <div style={S.cardHead}>
              <p style={S.cardTit}>Detalle por material</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="date" style={S.inputMini} value={desde} onChange={e => setDesde(e.target.value)} />
                <input type="date" style={S.inputMini} value={hasta} onChange={e => setHasta(e.target.value)} />
                <button style={S.expBtn} onClick={() => exportarExcel(`molinos_${desde}_${hasta}`, COLS_REP, reporte)}>Excel</button>
                <button style={S.expBtn} onClick={() => imprimirTablaPDF('Recuperacion de molinos', COLS_REP, reporte)}>PDF</button>
              </div>
            </div>
            {reporte.length === 0 && <p style={S.vacio}>Sin movimiento de molido en el periodo.</p>}
            {reporte.length > 0 && (
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Material</th><th style={S.th}>Tipo</th><th style={S.th}>Virgen</th>
                    <th style={S.thR}>$/kg</th><th style={S.thR}>Generado</th><th style={S.thR}>Monto</th>
                    <th style={S.thR}>Recuperado</th><th style={S.thR}>Vendido</th>
                    <th style={S.thR}>Retornado</th><th style={S.thR}>En piso</th><th style={S.thR}>% rec.</th>
                  </tr>
                </thead>
                <tbody>
                  {reporte.map(r => (
                    <tr key={r.articulo_id}>
                      <td style={S.td}>{r.codigo_interno}{r.es_consigna && <span style={S.tagCons}>consigna</span>}</td>
                      <td style={S.td}><span style={r.tipo_material === 'barredura' ? S.tagBar : S.tagMol}>{r.tipo_material}</span></td>
                      <td style={S.td}>{r.virgen_codigo || '-'}</td>
                      <td style={S.tdR}>{din(r.costo_unitario)}</td>
                      <td style={S.tdR}>{fmt(r.kg_generado)}</td>
                      <td style={S.tdR}>{din(r.monto_generado)}</td>
                      <td style={{ ...S.tdR, color: '#15803d' }}>{fmt(r.kg_recuperado)}</td>
                      <td style={S.tdR}>{fmt(r.kg_vendido)}</td>
                      <td style={S.tdR}>{fmt(r.kg_retornado)}</td>
                      <td style={S.tdR}>{fmt(r.kg_en_piso)}</td>
                      <td style={S.tdR}>{r.pct_recuperado != null ? r.pct_recuperado + '%' : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ================= MATERIALES ================= */}
      {tab === 'materiales' && (
        <>
          {puedeCapturar && (
            <div style={S.card}>
              <p style={S.cardTit}>Dar de alta el material derivado</p>
              <p style={S.ayuda}>
                Se crea a partir de la resina virgen con el prefijo <b>M-</b> para el molido y <b>B-</b> para
                la barredura, para identificarlo de un vistazo. Hereda unidad, categoria y si es consigna.
              </p>
              <div style={S.fila}>
                <div style={{ ...S.campo, flex: 3 }}>
                  <label style={S.label}>Resina virgen</label>
                  <select style={S.input} value={nuevoDeriv.virgen_id} onChange={e => setNuevoDeriv({ ...nuevoDeriv, virgen_id: e.target.value })}>
                    <option value="">Selecciona...</option>
                    {virgenes.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion} ({din(a.costo)}/kg)</option>)}
                  </select>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Tipo</label>
                  <select style={S.input} value={nuevoDeriv.tipo} onChange={e => setNuevoDeriv({ ...nuevoDeriv, tipo: e.target.value })}>
                    <option value="molido">Molido</option>
                    <option value="barredura">Barredura</option>
                  </select>
                </div>
                <div style={{ ...S.campo, justifyContent: 'flex-end' }}>
                  <button style={S.boton} onClick={crearDerivado}>Crear</button>
                </div>
              </div>
            </div>
          )}

          <div style={S.card}>
            <p style={S.cardTit}>Materiales dados de alta &middot; {derivados.length}</p>
            {derivados.length === 0 && <p style={S.vacio}>Aun no hay materiales de molido ni barredura.</p>}
            {derivados.length > 0 && (
              <table style={S.tabla}>
                <thead>
                  <tr><th style={S.th}>Codigo</th><th style={S.th}>Descripcion</th><th style={S.th}>Tipo</th>
                    <th style={S.th}>Virgen</th><th style={S.th}>Se puede mezclar</th><th style={S.thR}>$/kg</th></tr>
                </thead>
                <tbody>
                  {derivados.map(a => {
                    const v = virgenes.find(x => x.id === a.articulo_virgen_id)
                    const pct = a.tipo_material === 'barredura'
                      ? Number(param?.pct_recuperacion_barredura ?? 5)
                      : Number(param?.pct_recuperacion_default ?? 40)
                    return (
                      <tr key={a.id}>
                        <td style={{ ...S.td, fontWeight: 600 }}>{a.codigo_interno}</td>
                        <td style={S.td}>{a.descripcion}</td>
                        <td style={S.td}><span style={a.tipo_material === 'barredura' ? S.tagBar : S.tagMol}>{a.tipo_material}</span></td>
                        <td style={S.td}>{v?.codigo_interno || '-'}</td>
                        <td style={S.td}>{a.tipo_material === 'barredura'
                          ? <span style={{ color: '#b91c1c' }}>No, ya no entra a proceso</span>
                          : <span style={{ color: '#15803d' }}>Si, segun el % de la pieza</span>}</td>
                        <td style={S.tdR}>{din((Number(v?.costo) || 0) * pct / 100)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ================= CONFIGURACION ================= */}
      {tab === 'config' && (
        <>
          <div style={S.card}>
            <p style={S.cardTit}>Parametros de Molinos</p>
            <div style={S.fila}>
              <div style={{ ...S.campo, flex: 2 }}>
                <label style={S.label}>Almacen de Molinos (transito)</label>
                <select style={S.input} disabled={!puedeConfig} value={param?.almacen_molinos_id || ''}
                  onChange={e => guardarParam('almacen_molinos_id', e.target.value)}>
                  <option value="">Sin definir</option>
                  {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                </select>
                <span style={S.ayuda}>Ahi queda lo molido hasta que se entrega al almacen de resguardo.</span>
              </div>
              <div style={S.campo}>
                <label style={S.label}>% de recuperacion del molido</label>
                <input type="number" min="0" max="100" step="0.1" style={S.input} disabled={!puedeConfig}
                  defaultValue={param?.pct_recuperacion_default ?? 40}
                  onBlur={e => guardarParam('pct_recuperacion_default', e.target.value)} />
                <span style={S.ayuda}>Sobre el costo de la resina virgen.</span>
              </div>
              <div style={S.campo}>
                <label style={S.label}>% de la barredura</label>
                <input type="number" min="0" max="100" step="0.1" style={S.input} disabled={!puedeConfig}
                  defaultValue={param?.pct_recuperacion_barredura ?? 5}
                  onBlur={e => guardarParam('pct_recuperacion_barredura', e.target.value)} />
                <span style={S.ayuda}>Mucho menor: ya no entra a proceso.</span>
              </div>
            </div>
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>Que se puede hacer con el molido de cada cliente</p>
            <p style={S.ayuda}>
              En consigna el material es del cliente. Venderlo sin que el contrato lo permita es el riesgo,
              por eso se marca aqui cliente por cliente.
            </p>
            <table style={S.tabla}>
              <thead>
                <tr><th style={S.th}>Cliente</th><th style={S.th}>Mezclar</th><th style={S.th}>Vender</th><th style={S.th}>Retornar</th></tr>
              </thead>
              <tbody>
                {clientes.map(c => {
                  const p = politicaDe(c.id)
                  return (
                    <tr key={c.id}>
                      <td style={S.td}>{c.nombre}</td>
                      {['permite_mezcla', 'permite_venta', 'retorna_cliente'].map(k => (
                        <td key={k} style={S.td}>
                          <input type="checkbox" disabled={!puedeConfig} checked={!!p[k]}
                            onChange={e => guardarPolitica(c.id, k, e.target.checked)} />
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '14px', marginBottom: '12px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '820px', lineHeight: 1.5 },
  avisoCfg: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#92400e', marginBottom: '12px', lineHeight: 1.5 },
  tabs: { display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' },
  tab: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  tabAct: { padding: '8px 15px', background: '#0f766e', color: '#fff', border: '1px solid #0f766e', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '15px 17px', marginBottom: '13px' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: 0 },
  subTit: { fontSize: '12px', fontWeight: 600, color: '#64748b', margin: '10px 0 6px' },
  fila: { display: 'flex', gap: '13px', flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '140px', marginBottom: '8px' },
  label: { fontSize: '12px', color: '#444', fontWeight: 500 },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13.5px', outline: 'none', background: '#fff' },
  inputMini: { padding: '7px 9px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '12.5px', outline: 'none' },
  ayuda: { fontSize: '11px', color: '#64748b', lineHeight: 1.45 },
  previo: { background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: '8px', padding: '9px 12px', fontSize: '12.5px', color: '#115e59', marginTop: '6px', lineHeight: 1.5 },
  acciones: { display: 'flex', justifyContent: 'flex-end', marginTop: '10px' },
  boton: { padding: '9px 20px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13.5px', cursor: 'pointer', fontWeight: 500 },
  expBtn: { padding: '7px 13px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '12.5px', cursor: 'pointer' },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px' },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  vacio: { color: '#64748b', fontSize: '13px', margin: 0 },
  kpis: { display: 'flex', gap: '11px', flexWrap: 'wrap', marginBottom: '13px' },
  kpi: { flex: 1, minWidth: '150px', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '13px 16px' },
  kpiTit: { fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
  kpiVal: { fontSize: '21px', color: '#1a1a2e', margin: '3px 0 1px' },
  kpiPie: { fontSize: '11px', color: '#64748b' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right', whiteSpace: 'nowrap' },
  tagMol: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#ccfbf1', color: '#115e59', marginLeft: '6px' },
  tagBar: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#fee2e2', color: '#b91c1c', marginLeft: '6px' },
  tagCons: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#e0e7ff', color: '#4338ca', marginLeft: '6px' },
}
