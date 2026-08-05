import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts'

// CARTAS DE CONTROL Y CAPACIDAD
//
// Dos ideas que hay que tener separadas o el SPC no sirve:
//
//   Limites de ESPECIFICACION -> los pone el cliente en el dibujo y dicen si
//   la pieza sirve. Salen del plan de control.
//
//   Limites de CONTROL -> salen del propio proceso y dicen si el proceso esta
//   haciendo hoy lo mismo que hacia ayer. Se calculan de los datos.
//
// Un proceso puede estar perfectamente bajo control y aun asi producir piezas
// fuera de especificacion, y al reves. Por eso las dos cosas se dibujan juntas
// pero nunca se mezclan.
//
// Los limites de control se CONGELAN a partir de un estudio. Si se
// recalcularan con cada punto, perseguirian a los datos, se abririan solos
// conforme el proceso se degrada y la carta dejaria de detectar nada.

const hoyISO = () => new Date().toISOString().slice(0, 10)
const f3 = (n) => n == null ? '-' : Number(n).toLocaleString('es-MX', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
const f4 = (n) => n == null ? '-' : Number(n).toLocaleString('es-MX', { maximumFractionDigits: 4 })
const hora = (t) => new Date(t).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

export default function SPC() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeCapturar = tienePermiso('cal_spc', 'crear')
  const puedeCongelar = tienePermiso('cal_spc', 'aprobar')

  const [tab, setTab] = useState('captura')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [loading, setLoading] = useState(true)

  // Captura
  const [ots, setOts] = useState([])
  const [otSel, setOtSel] = useState('')
  const [caracs, setCaracs] = useState([])
  const [valores, setValores] = useState({})   // caracteristica_id -> [v1..vn]
  const [ultimo, setUltimo] = useState(null)

  // Cartas
  const [catalogo, setCatalogo] = useState([])  // caracteristicas de planes vigentes
  const [cSel, setCSel] = useState('')
  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) })
  const [hasta, setHasta] = useState(hoyISO())
  const [puntos, setPuntos] = useState([])
  const [cap, setCap] = useState(null)
  const [lim, setLim] = useState(null)
  const [param, setParam] = useState(null)

  useEffect(() => { cargar() }, [])
  useEffect(() => { if (otSel) cargarCaracs(otSel); else setCaracs([]) }, [otSel])
  useEffect(() => { if (cSel) cargarCarta() }, [cSel, desde, hasta])

  const cargar = async () => {
    setLoading(true); setError('')
    const [ot, cat, pa] = await Promise.all([
      supabase.from('ordenes_trabajo')
        .select('id, folio, articulo_id, estatus, turno, maquinas(clave), articulos(codigo_interno, descripcion)')
        .eq('empresa_id', emp).in('estatus', ['programada', 'en_proceso'])
        .order('fecha_programada', { ascending: false }).limit(120),
      supabase.from('plan_control_caracteristicas')
        .select('id, nombre, tipo, lie, nominal, lse, unidad, tamano_subgrupo, meta_cpk, meta_ppk, especial, requiere_spc, plan_id, planes_control!inner(id, estatus, version, articulo_id, empresa_id, articulos(codigo_interno))')
        .eq('planes_control.empresa_id', emp).eq('planes_control.estatus', 'vigente')
        .eq('activo', true).eq('tipo', 'variable').order('orden'),
      supabase.from('spc_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
    ])
    setOts(ot.data || [])
    setCatalogo(cat.data || [])
    setParam(pa.data || null)
    setLoading(false)
  }

  const cargarCaracs = async (otId) => {
    const { data, error: e } = await supabase.rpc('caracteristicas_ot', {
      p_empresa_id: emp, p_ot_id: Number(otId),
    })
    if (e) { setError('No se pudieron cargar las caracteristicas: ' + e.message); return }
    setCaracs(data || [])
    const v = {}
    ;(data || []).forEach(c => { v[c.caracteristica_id] = Array(c.tamano_subgrupo).fill('') })
    setValores(v)
  }

  const cargarCarta = async () => {
    setError('')
    const d = desde ? `${desde}T00:00:00` : null
    const h = hasta ? `${hasta}T23:59:59` : null
    const [pt, cp, lm] = await Promise.all([
      supabase.rpc('spc_carta', { p_empresa_id: emp, p_caracteristica_id: Number(cSel), p_maquina_id: null, p_desde: d, p_hasta: h }),
      supabase.rpc('spc_capacidad', { p_empresa_id: emp, p_caracteristica_id: Number(cSel), p_maquina_id: null, p_desde: d, p_hasta: h }),
      // Puede haber limites por maquina ademas de los generales, asi que se
      // toma el general y no se usa maybeSingle, que reventaria con dos filas.
      supabase.from('spc_limites').select('*').eq('caracteristica_id', Number(cSel))
        .eq('estatus', 'vigente').order('maquina_id', { nullsFirst: true }).limit(1),
    ])
    if (pt.error) { setError('No se pudo cargar la carta: ' + pt.error.message); return }
    setPuntos(pt.data || [])
    setCap((cp.data && cp.data[0]) || null)
    setLim((lm.data && lm.data[0]) || null)
  }

  // ---------- Captura ----------
  const setVal = (cid, i, v) => {
    setValores(prev => {
      const arr = [...(prev[cid] || [])]
      arr[i] = v
      return { ...prev, [cid]: arr }
    })
  }

  const registrar = async (c) => {
    setError(''); setExito(''); setUltimo(null)
    const arr = valores[c.caracteristica_id] || []
    if (arr.length !== c.tamano_subgrupo || arr.some(v => v === '' || isNaN(Number(v)))) {
      setError(`Captura las ${c.tamano_subgrupo} lecturas de "${c.nombre}" antes de registrar.`)
      return
    }
    const { data, error: e } = await supabase.rpc('registrar_subgrupo', {
      p_empresa_id: emp, p_caracteristica_id: c.caracteristica_id, p_ot_id: Number(otSel),
      p_valores: arr.map(Number), p_turno: null, p_lote_id: null,
      p_usuario: perfil.id, p_notas: null,
    })
    if (e) { setError(e.message); return }

    const { data: s } = await supabase.from('spc_subgrupos')
      .select('*, no_conformidades(folio)').eq('id', data).maybeSingle()
    setUltimo({ carac: c, sub: s })
    setExito(s?.fuera_especificacion || s?.fuera_control ? '' : `Subgrupo registrado. Media ${f4(s?.media)}.`)
    setValores(prev => ({ ...prev, [c.caracteristica_id]: Array(c.tamano_subgrupo).fill('') }))
  }

  const congelar = async () => {
    setError(''); setExito('')
    const min = param?.subgrupos_minimos ?? 25
    if (!confirm(`Se van a calcular los limites de control con los subgrupos del periodo y se van a CONGELAR.\n\nA partir de ahi, todo punto nuevo se juzga contra estos limites y no se recalculan solos. Hazlo sobre un periodo en que el proceso estuvo estable, no sobre uno con problemas: si no, los problemas quedan dentro de lo "normal".\n\nSe necesitan al menos ${min} subgrupos.`)) return
    const { data, error: e } = await supabase.rpc('calcular_limites_control', {
      p_empresa_id: emp, p_caracteristica_id: Number(cSel), p_maquina_id: null,
      p_desde: `${desde}T00:00:00`, p_hasta: `${hasta}T23:59:59`,
      p_usuario: perfil.id, p_notas: `Estudio ${desde} a ${hasta}`,
    })
    if (e) { setError(e.message); return }
    setExito('Limites calculados y congelados. La version anterior queda obsoleta.')
    cargarCarta()
  }

  // ---------- Derivados ----------
  const cInfo = catalogo.find(x => String(x.id) === String(cSel))
  const datos = puntos.map((p, i) => ({ ...p, i: i + 1, etiqueta: hora(p.fecha) }))
  const sinLimites = puntos.length > 0 && !lim

  const COLS = [
    { label: 'Fecha', get: p => p.fecha },
    { label: 'Turno', get: p => p.turno || '' },
    { label: 'OT', get: p => p.ot || '' },
    { label: 'Maquina', get: p => p.maquina || '' },
    { label: 'n', get: p => p.n },
    { label: 'Media', get: p => p.media },
    { label: 'Rango', get: p => p.rango },
    { label: 'Minimo', get: p => p.minimo },
    { label: 'Maximo', get: p => p.maximo },
    { label: 'Fuera de especificacion', get: p => p.fuera_especificacion ? 'Si' : 'No' },
    { label: 'Fuera de control', get: p => p.fuera_control ? 'Si' : 'No' },
    { label: 'Reglas', get: p => p.reglas || '' },
  ]

  const punto = (props) => {
    const { cx, cy, payload } = props
    if (cx == null || cy == null) return null
    const col = payload.fuera_especificacion ? '#b91c1c' : payload.fuera_control ? '#ea580c'
      : payload.reglas ? '#ca8a04' : '#0f766e'
    const r = (payload.fuera_especificacion || payload.fuera_control) ? 5 : 3.5
    return <circle cx={cx} cy={cy} r={r} fill={col} stroke="#fff" strokeWidth={1} />
  }

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Cartas de control y capacidad</h2>
          <p style={S.sub}>
            Los <b>limites de especificacion</b> los pone el cliente y dicen si la pieza sirve; los
            <b> limites de control</b> salen del proceso y dicen si esta haciendo hoy lo mismo que
            ayer. Un proceso puede estar bajo control y aun asi sacar piezas fuera de
            especificacion, y al reves, asi que se dibujan juntos pero nunca se mezclan.
          </p>
        </div>
      </div>

      <div style={S.tabs}>
        {[['captura', 'Captura en piso'], ['carta', 'Cartas y capacidad']].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => setTab(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      {/* ================= CAPTURA ================= */}
      {tab === 'captura' && (
        <>
          <div style={S.card}>
            <p style={S.cardTit}>Orden de trabajo</p>
            <select style={{ ...S.input, maxWidth: 560 }} value={otSel} onChange={e => { setOtSel(e.target.value); setUltimo(null) }}>
              <option value="">Elige la OT que se esta corriendo...</option>
              {ots.map(o => (
                <option key={o.id} value={o.id}>
                  {o.folio} · {o.articulos?.codigo_interno} · {o.maquinas?.clave || 'sin maquina'} · {o.estatus}
                </option>
              ))}
            </select>
            {otSel && caracs.length === 0 && (
              <p style={S.aviso}>
                Este articulo no tiene plan de control vigente, o su plan no tiene caracteristicas
                activas. Sin plan no hay que medir ni contra que comparar: dalo de alta en Plan de Control.
              </p>
            )}
          </div>

          {ultimo && (
            <div style={ultimo.sub?.fuera_especificacion ? S.resRojo : ultimo.sub?.fuera_control ? S.resNaranja : ultimo.sub?.reglas ? S.resAmbar : S.resVerde}>
              <b>{ultimo.carac.nombre}</b> · media {f4(ultimo.sub?.media)} · rango {f4(ultimo.sub?.rango)}
              {ultimo.sub?.reglas && <><br />{ultimo.sub.reglas}</>}
              {ultimo.sub?.no_conformidades?.folio && (
                <><br />Se levanto la no conformidad <b>{ultimo.sub.no_conformidades.folio}</b>.</>
              )}
              {(ultimo.sub?.fuera_especificacion || ultimo.sub?.fuera_control) && (
                <><br />Plan de reaccion: {ultimo.carac.plan_reaccion}</>
              )}
            </div>
          )}

          {caracs.map(c => {
            const arr = valores[c.caracteristica_id] || []
            const bloqueado = c.equipo_id && !c.equipo_ok
            return (
              <div key={c.caracteristica_id} style={S.card}>
                <div style={S.cardHead}>
                  <div>
                    <p style={S.cardTit}>
                      {c.orden}. {c.nombre}
                      {c.especial && <span style={S.tagEsp}>{c.especial}</span>}
                      {!c.requiere_spc && <span style={S.tagGris}>sin carta</span>}
                    </p>
                    <p style={S.ayuda}>
                      Especificacion {f4(c.lie)} / {f4(c.nominal)} / {f4(c.lse)} {c.unidad || ''} ·
                      subgrupo de {c.tamano_subgrupo} · {c.equipo_clave || 'sin equipo'}
                      {c.metodo_control ? ` · ${c.metodo_control}` : ''}
                    </p>
                  </div>
                </div>

                {bloqueado && (
                  <p style={S.avisoRojo}>
                    No se puede capturar: <b>{c.equipo_clave}</b> {c.equipo_motivo}. Un dato tomado con
                    un equipo asi se ve bien y no vale, asi que el sistema no lo acepta. Calibra el
                    equipo o cambia el que trae el plan.
                  </p>
                )}

                {c.tipo === 'atributo' && (
                  <p style={S.aviso}>
                    Esta caracteristica es por atributos (pasa / no pasa). Las cartas por variables no
                    aplican; se controla con el metodo del plan y su registro de inspeccion.
                  </p>
                )}

                {!bloqueado && c.tipo === 'variable' && (
                  <>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                      {Array.from({ length: c.tamano_subgrupo }).map((_, i) => {
                        const v = arr[i]
                        const n = v === '' || v == null ? null : Number(v)
                        const mal = n != null && !isNaN(n) &&
                          ((c.lie != null && n < c.lie) || (c.lse != null && n > c.lse))
                        return (
                          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <label style={S.labelMini}>Pieza {i + 1}</label>
                            <input type="number" step="any" style={{ ...S.inputNum, ...(mal ? S.inputMal : {}) }}
                              value={v ?? ''} onChange={e => setVal(c.caracteristica_id, i, e.target.value)} />
                          </div>
                        )
                      })}
                      {puedeCapturar && (
                        <button style={S.boton} onClick={() => registrar(c)}>Registrar subgrupo</button>
                      )}
                    </div>
                    <p style={S.ayuda}>
                      Plan de reaccion si sale mal: {c.plan_reaccion}
                    </p>
                  </>
                )}
              </div>
            )
          })}
        </>
      )}

      {/* ================= CARTAS ================= */}
      {tab === 'carta' && (
        <>
          <div style={S.card}>
            <div style={S.fila}>
              <div style={{ ...S.campo, flex: 3 }}>
                <label style={S.label}>Caracteristica</label>
                <select style={S.input} value={cSel} onChange={e => setCSel(e.target.value)}>
                  <option value="">Elige...</option>
                  {catalogo.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.planes_control?.articulos?.codigo_interno} · {c.nombre}
                      {c.especial ? ` (${c.especial})` : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div style={S.campo}>
                <label style={S.label}>Desde</label>
                <input type="date" style={S.input} value={desde} onChange={e => setDesde(e.target.value)} />
              </div>
              <div style={S.campo}>
                <label style={S.label}>Hasta</label>
                <input type="date" style={S.input} value={hasta} onChange={e => setHasta(e.target.value)} />
              </div>
              {cSel && puedeCongelar && (
                <div style={{ ...S.campo, justifyContent: 'flex-end' }}>
                  <button style={S.boton} onClick={congelar}>
                    {lim ? 'Recalcular limites' : 'Calcular y congelar limites'}
                  </button>
                </div>
              )}
            </div>
            {cSel && lim && (
              <p style={S.ayuda}>
                Limites congelados el {new Date(lim.created_at).toLocaleDateString('es-MX')} con {lim.subgrupos} subgrupo(s)
                de n={lim.n}. Los puntos nuevos se juzgan contra estos limites; no se recalculan solos.
              </p>
            )}
          </div>

          {!cSel && <div style={S.card}><p style={S.vacio}>Elige una caracteristica.</p></div>}

          {cSel && sinLimites && (
            <p style={S.aviso}>
              Todavia no hay limites de control congelados para esta caracteristica, asi que la carta
              solo dibuja los puntos y la especificacion: <b>no se pueden detectar puntos fuera de
              control</b> porque no hay contra que compararlos. Se necesitan al
              menos {param?.subgrupos_minimos ?? 25} subgrupos de un periodo estable para calcularlos.
              Con menos, los limites salen tan inestables que la carta marca falsas alarmas.
              Llevas <b>{puntos.length}</b>.
            </p>
          )}

          {cSel && cap && (
            <div style={S.kpis}>
              <div style={S.kpi}><span style={S.kpiTit}>Subgrupos</span><b style={S.kpiVal}>{cap.subgrupos}</b><span style={S.kpiPie}>{cap.mediciones} mediciones, n={cap.n}</span></div>
              <div style={S.kpi}><span style={S.kpiTit}>Media</span><b style={S.kpiVal}>{f4(cap.media)}</b><span style={S.kpiPie}>nominal {f4(cInfo?.nominal)}</span></div>
              <div style={S.kpi}>
                <span style={S.kpiTit}>Cpk (corto plazo)</span>
                <b style={{ ...S.kpiVal, color: cap.cumple_cpk === false ? '#b91c1c' : cap.cumple_cpk ? '#15803d' : '#1a1a2e' }}>{f3(cap.cpk)}</b>
                <span style={S.kpiPie}>meta {cap.meta_cpk}</span>
              </div>
              <div style={S.kpi}>
                <span style={S.kpiTit}>Ppk (largo plazo)</span>
                <b style={{ ...S.kpiVal, color: cap.cumple_ppk === false ? '#b91c1c' : cap.cumple_ppk ? '#15803d' : '#1a1a2e' }}>{f3(cap.ppk)}</b>
                <span style={S.kpiPie}>meta {cap.meta_ppk}</span>
              </div>
              <div style={S.kpi}><span style={S.kpiTit}>Cp / Pp</span><b style={S.kpiVal}>{f3(cap.cp)} / {f3(cap.pp)}</b><span style={S.kpiPie}>sin contar el centrado</span></div>
              <div style={S.kpi}><span style={S.kpiTit}>Puntos con problema</span><b style={{ ...S.kpiVal, color: (cap.fuera_especificacion + cap.fuera_control) > 0 ? '#b91c1c' : '#15803d' }}>{cap.fuera_especificacion + cap.fuera_control}</b><span style={S.kpiPie}>{cap.fuera_especificacion} fuera de esp · {cap.fuera_control} fuera de control</span></div>
            </div>
          )}

          {cSel && cap && cap.cpk != null && (
            <p style={S.nota}>
              <b>Como leer estos dos numeros.</b> Cpk usa la variacion de corto plazo, dentro de cada
              subgrupo: es de lo que el proceso <i>seria capaz</i> si se mantuviera centrado y estable.
              Ppk usa toda la variacion del periodo: es lo que el cliente <i>de verdad recibio</i>.
              Cuando Ppk sale bastante mas bajo que Cpk, el proceso se esta moviendo entre subgrupos
              {cap.cpk && cap.ppk && cap.cpk - cap.ppk > 0.3 ? ', que es justo lo que esta pasando aqui' : ''}.
            </p>
          )}

          {cSel && datos.length > 0 && (
            <>
              <div style={S.card}>
                <p style={S.cardTit}>Carta de medias {cInfo ? `· ${cInfo.nombre} (${cInfo.unidad || ''})` : ''}</p>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={datos} margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="i" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <Tooltip
                      formatter={(v) => f4(v)}
                      labelFormatter={(i) => datos[i - 1] ? `${datos[i - 1].etiqueta} · ${datos[i - 1].ot || ''}` : ''} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    {lim && <ReferenceLine y={lim.lcs_x} stroke="#ea580c" strokeDasharray="5 3" label={{ value: 'LCS', fontSize: 10, fill: '#ea580c', position: 'right' }} />}
                    {lim && <ReferenceLine y={lim.lc_x} stroke="#0f766e" label={{ value: 'LC', fontSize: 10, fill: '#0f766e', position: 'right' }} />}
                    {lim && <ReferenceLine y={lim.lci_x} stroke="#ea580c" strokeDasharray="5 3" label={{ value: 'LCI', fontSize: 10, fill: '#ea580c', position: 'right' }} />}
                    {cInfo?.lse != null && <ReferenceLine y={cInfo.lse} stroke="#b91c1c" strokeDasharray="2 2" label={{ value: 'LSE', fontSize: 10, fill: '#b91c1c', position: 'insideTopRight' }} />}
                    {cInfo?.lie != null && <ReferenceLine y={cInfo.lie} stroke="#b91c1c" strokeDasharray="2 2" label={{ value: 'LIE', fontSize: 10, fill: '#b91c1c', position: 'insideBottomRight' }} />}
                    <Line type="linear" dataKey="media" name="Media del subgrupo" stroke="#0f766e" strokeWidth={1.5} dot={punto} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={S.card}>
                <p style={S.cardTit}>Carta de rangos</p>
                <p style={S.ayuda}>
                  Mide la variacion <i>dentro</i> de cada subgrupo. Si esta carta se sale, la de medias
                  no se puede interpretar: primero se estabiliza la variacion y despues el centrado.
                </p>
                <ResponsiveContainer width="100%" height={180}>
                  <ComposedChart data={datos} margin={{ top: 10, right: 20, left: 0, bottom: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                    <XAxis dataKey="i" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} domain={['auto', 'auto']} />
                    <Tooltip formatter={(v) => f4(v)} />
                    {lim && <ReferenceLine y={lim.lcs_r} stroke="#ea580c" strokeDasharray="5 3" label={{ value: 'LCS', fontSize: 10, fill: '#ea580c', position: 'right' }} />}
                    {lim && <ReferenceLine y={lim.lc_r} stroke="#0f766e" label={{ value: 'R', fontSize: 10, fill: '#0f766e', position: 'right' }} />}
                    <Line type="linear" dataKey="rango" name="Rango" stroke="#7c3aed" strokeWidth={1.5} dot={{ r: 2.5 }} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div style={S.card}>
                <div style={S.cardHead}>
                  <p style={S.cardTit}>Subgrupos &middot; {puntos.length}</p>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button style={S.expBtn} onClick={() => exportarExcel(`spc_${cInfo?.nombre || cSel}`, COLS, puntos)}>Excel</button>
                    <button style={S.expBtn} onClick={() => imprimirTablaPDF(`Carta de control ${cInfo?.nombre || ''}`, COLS, puntos)}>PDF</button>
                  </div>
                </div>
                <div style={{ maxHeight: 340, overflowY: 'auto' }}>
                  <table style={S.tabla}>
                    <thead>
                      <tr>
                        <th style={S.th}>#</th><th style={S.th}>Fecha</th><th style={S.th}>Turno</th>
                        <th style={S.th}>OT</th><th style={S.th}>Maquina</th>
                        <th style={S.thR}>Media</th><th style={S.thR}>Rango</th>
                        <th style={S.thR}>Min</th><th style={S.thR}>Max</th>
                        <th style={S.th}>Estado</th><th style={S.th}>NC</th>
                      </tr>
                    </thead>
                    <tbody>
                      {datos.slice().reverse().map(p => (
                        <tr key={p.subgrupo_id}>
                          <td style={S.td}>{p.i}</td>
                          <td style={S.td}>{hora(p.fecha)}</td>
                          <td style={S.td}>{p.turno || '-'}</td>
                          <td style={S.td}>{p.ot || '-'}</td>
                          <td style={S.td}>{p.maquina || '-'}</td>
                          <td style={S.tdR}>{f4(p.media)}</td>
                          <td style={S.tdR}>{f4(p.rango)}</td>
                          <td style={S.tdR}>{f4(p.minimo)}</td>
                          <td style={S.tdR}>{f4(p.maximo)}</td>
                          <td style={{ ...S.td, maxWidth: 320 }}>
                            {p.fuera_especificacion && <span style={S.tagRojo}>fuera de esp</span>}
                            {p.fuera_control && <span style={S.tagNaranja}>fuera de control</span>}
                            {!p.fuera_especificacion && !p.fuera_control && p.reglas && <span style={S.tagAmbar}>tendencia</span>}
                            {!p.reglas && !p.fuera_especificacion && <span style={S.tagVerde}>ok</span>}
                            {p.reglas && <div style={S.mini}>{p.reglas}</div>}
                          </td>
                          <td style={S.td}>{p.nc_id ? `NC-SPC-${p.subgrupo_id}` : '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}

          {cSel && datos.length === 0 && (
            <div style={S.card}><p style={S.vacio}>No hay subgrupos capturados en el periodo.</p></div>
          )}
        </>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  top: { marginBottom: '12px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '860px', lineHeight: 1.5 },
  tabs: { display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' },
  tab: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  tabAct: { padding: '8px 15px', background: '#b91c1c', color: '#fff', border: '1px solid #b91c1c', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '15px 17px', marginBottom: '13px' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', marginBottom: '8px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 4px' },
  fila: { display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' },
  campo: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '130px', marginBottom: '8px' },
  label: { fontSize: '12px', color: '#444', fontWeight: 500 },
  labelMini: { fontSize: '10.5px', color: '#64748b' },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13.5px', outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box' },
  inputNum: { padding: '9px 8px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', width: '92px', textAlign: 'center' },
  inputMal: { borderColor: '#b91c1c', background: '#fef2f2', color: '#b91c1c', fontWeight: 600 },
  ayuda: { fontSize: '11.5px', color: '#64748b', lineHeight: 1.45, margin: '6px 0 0' },
  aviso: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#92400e', margin: '8px 0', lineHeight: 1.5 },
  avisoRojo: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#b91c1c', margin: '8px 0', lineHeight: 1.5 },
  nota: { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#075985', marginBottom: '13px', lineHeight: 1.55 },
  resVerde: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '11px 13px', fontSize: '13px', color: '#166534', marginBottom: '13px', lineHeight: 1.55 },
  resAmbar: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '11px 13px', fontSize: '13px', color: '#92400e', marginBottom: '13px', lineHeight: 1.55 },
  resNaranja: { background: '#fff7ed', border: '1px solid #fdba74', borderRadius: '8px', padding: '11px 13px', fontSize: '13px', color: '#c2410c', marginBottom: '13px', lineHeight: 1.55 },
  resRojo: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '11px 13px', fontSize: '13px', color: '#b91c1c', marginBottom: '13px', lineHeight: 1.55 },
  boton: { padding: '9px 18px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13.5px', cursor: 'pointer', fontWeight: 500 },
  expBtn: { padding: '7px 12px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '12.5px', cursor: 'pointer' },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '9px 12px', lineHeight: 1.5 },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  vacio: { color: '#64748b', fontSize: '13px', margin: 0 },
  kpis: { display: 'flex', gap: '11px', flexWrap: 'wrap', marginBottom: '13px' },
  kpi: { flex: 1, minWidth: '140px', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '13px 16px' },
  kpiTit: { fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
  kpiVal: { fontSize: '21px', color: '#1a1a2e', margin: '3px 0 1px' },
  kpiPie: { fontSize: '11px', color: '#64748b' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0 },
  thR: { textAlign: 'right', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap', background: '#fff', position: 'sticky', top: 0 },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right', whiteSpace: 'nowrap' },
  mini: { fontSize: '10.5px', color: '#64748b', marginTop: 2, lineHeight: 1.35 },
  tagEsp: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#fee2e2', color: '#b91c1c', marginLeft: '7px' },
  tagGris: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#e5e7eb', color: '#374151', marginLeft: '7px' },
  tagRojo: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#fee2e2', color: '#b91c1c', marginRight: 4 },
  tagNaranja: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#ffedd5', color: '#c2410c', marginRight: 4 },
  tagAmbar: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#fef3c7', color: '#92400e', marginRight: 4 },
  tagVerde: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', background: '#dcfce7', color: '#15803d' },
}
