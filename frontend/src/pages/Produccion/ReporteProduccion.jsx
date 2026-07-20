import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Reporte de produccion contra una OT (soporta molde familiar: varios articulos).
// Por cada articulo con piezas OK se genera su propio lote RETENIDO en el almacen
// del paso 1 de su flujo. El backflush descuenta la MP del BOM de cada articulo
// desde la UBICACION DE MAQUINA de la OT, solo lotes LIBERADOS y por FIFO.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const TURNOS = ['1o', '2o', '3o']

export default function ReporteProduccion() {
  const { perfil, tienePermiso } = useAuth()
  const puedeReportar = tienePermiso('prod_reportes', 'crear')

  const [ots, setOts] = useState([])
  const [otArts, setOtArts] = useState([])
  const [bom, setBom] = useState([])
  const [articulos, setArticulos] = useState([])
  const [existencias, setExistencias] = useState([])
  const [lotes, setLotes] = useState([])
  const [pasos, setPasos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [causasScrap, setCausasScrap] = useState([])
  const [causasParo, setCausasParo] = useState([])
  const [reportes, setReportes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [procesando, setProcesando] = useState(false)

  const [otId, setOtId] = useState('')
  const [turno, setTurno] = useState('1o')
  const [notas, setNotas] = useState('')
  const [porArt, setPorArt] = useState({}) // { [articuloId]: { ok, codigo_lote, ubicacion_pt_id, scrap: [{causa_id, cantidad}] } }
  const [paro, setParo] = useState({ causa_id: '', minutos: '', notas: '' })

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [o, oa, b, a, ex, lo, ps, al, ub, cs, cp, rep] = await Promise.all([
      supabase.from('ordenes_trabajo').select('*, maq:maquinas(clave, nombre)').eq('empresa_id', perfil.empresa_id).in('estatus', ['programada', 'en_proceso']).order('created_at', { ascending: false }),
      supabase.from('ot_articulos').select('*'),
      supabase.from('bom').select('*'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, flujo_id'),
      supabase.from('existencias').select('*'),
      supabase.from('lotes').select('*'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
      supabase.from('almacenes').select('*'),
      supabase.from('ubicaciones').select('*'),
      supabase.from('causas_scrap').select('*').eq('activo', true).order('nombre'),
      supabase.from('causas_paro').select('*').eq('activo', true).order('nombre'),
      supabase.from('ot_reportes').select('*, ot:ordenes_trabajo(folio), usuario:usuarios!ot_reportes_reportado_por_fkey(nombre)').order('fecha', { ascending: false }).limit(50),
    ])
    setOts(o.data || []); setOtArts(oa.data || []); setBom(b.data || []); setArticulos(a.data || [])
    setExistencias(ex.data || []); setLotes(lo.data || []); setPasos(ps.data || []); setAlmacenes(al.data || [])
    setUbicaciones(ub.data || []); setCausasScrap(cs.data || []); setCausasParo(cp.data || []); setReportes(rep.data || [])
    setLoading(false)
  }

  const ot = ots.find(o => o.id === Number(otId))
  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const lineasOt = ot ? otArts.filter(x => x.ot_id === ot.id) : []

  const almacenNacimientoDe = (articuloId) => {
    const art = artDe(articuloId)
    if (!art?.flujo_id) return null
    const ps = pasos.filter(p => p.flujo_id === art.flujo_id)
    return ps.length ? almDe(ps[0].almacen_id) : null
  }

  const datos = (artId) => porArt[artId] || { ok: '', codigo_lote: '', ubicacion_pt_id: '', scrap: [] }
  const setDato = (artId, campo, val) => setPorArt(p => ({ ...p, [artId]: { ...datos(artId), [campo]: val } }))
  const addScrap = (artId) => setPorArt(p => ({ ...p, [artId]: { ...datos(artId), scrap: [...datos(artId).scrap, { causa_id: '', cantidad: '' }] } }))
  const setScrap = (artId, i, campo, val) => setPorArt(p => ({ ...p, [artId]: { ...datos(artId), scrap: datos(artId).scrap.map((s, j) => j === i ? { ...s, [campo]: val } : s) } }))
  const delScrap = (artId, i) => setPorArt(p => ({ ...p, [artId]: { ...datos(artId), scrap: datos(artId).scrap.filter((_, j) => j !== i) } }))

  const scrapTotalDe = (artId) => datos(artId).scrap.reduce((s, l) => s + (Number(l.cantidad) || 0), 0)
  const piezasDe = (artId) => (Number(datos(artId).ok) || 0) + scrapTotalDe(artId)

  // Disponible de un componente en la ubicacion de MP de la maquina (solo liberados, FIFO)
  const disponiblesDe = (componenteId) => {
    if (!ot?.ubicacion_mp_id) return []
    return existencias
      .filter(e => e.ubicacion_id === ot.ubicacion_mp_id && Number(e.cantidad) > 0)
      .map(e => ({ ...e, _lote: lotes.find(l => l.id === e.lote_id) }))
      .filter(e => e._lote && e._lote.articulo_id === componenteId && e._lote.estatus_calidad === 'liberado')
      .sort((a, b) => (a._lote.fecha || '').localeCompare(b._lote.fecha || ''))
  }

  // Plan de consumo consolidado de todos los articulos de la OT
  const planConsumo = () => {
    const requeridos = {} // componenteId -> { requerido, porProducto: [{productoId, cantidad}] }
    lineasOt.forEach(l => {
      const piezas = piezasDe(l.articulo_id)
      if (piezas <= 0) return
      bom.filter(b => b.articulo_padre_id === l.articulo_id).forEach(c => {
        const req = Number(c.cantidad_por_unidad || 0) * piezas
        if (!requeridos[c.componente_articulo_id]) requeridos[c.componente_articulo_id] = { requerido: 0, porProducto: [] }
        requeridos[c.componente_articulo_id].requerido += req
        requeridos[c.componente_articulo_id].porProducto.push({ productoId: l.articulo_id, cantidad: req })
      })
    })
    return Object.keys(requeridos).map(compId => {
      const info = requeridos[compId]
      const disp = disponiblesDe(Number(compId))
      const total = disp.reduce((s, e) => s + Number(e.cantidad), 0)
      const tomas = []
      let falta = info.requerido
      for (const e of disp) {
        if (falta <= 0.000001) break
        const toma = Math.min(falta, Number(e.cantidad))
        tomas.push({ existencia: e, cantidad: toma })
        falta -= toma
      }
      return { componenteId: Number(compId), art: artDe(Number(compId)), requerido: info.requerido, porProducto: info.porProducto, disponible: total, tomas, faltante: Math.max(0, falta) }
    })
  }
  const plan = ot ? planConsumo() : []
  const hayFaltante = plan.some(p => p.faltante > 0.000001)
  const totalGeneral = lineasOt.reduce((s, l) => s + piezasDe(l.articulo_id), 0)

  const reportar = async () => {
    setError(''); setExito('')
    if (!ot) { setError('Selecciona la orden de trabajo'); return }
    const conDatos = lineasOt.filter(l => piezasDe(l.articulo_id) > 0)
    if (conDatos.length === 0) { setError('Captura piezas OK o scrap de al menos un articulo'); return }
    for (const l of conDatos) {
      const d = datos(l.articulo_id); const art = artDe(l.articulo_id)
      if (Number(d.ok) > 0 && !d.codigo_lote.trim()) { setError(`${art?.codigo_interno}: captura el codigo de lote`); return }
      if (Number(d.ok) > 0 && !almacenNacimientoDe(l.articulo_id)) { setError(`${art?.codigo_interno}: sin flujo de almacen asignado (Logistica > Flujos de Almacen)`); return }
      if (d.scrap.some(s => Number(s.cantidad) > 0 && !s.causa_id)) { setError(`${art?.codigo_interno}: cada renglon de scrap necesita causa`); return }
    }
    if (hayFaltante) { setError('No hay suficiente materia prima liberada en la ubicacion de la maquina. Revisa el plan de consumo.'); return }

    setProcesando(true)
    try {
      const okTotal = conDatos.reduce((s, l) => s + (Number(datos(l.articulo_id).ok) || 0), 0)
      const scrapTotal = conDatos.reduce((s, l) => s + scrapTotalDe(l.articulo_id), 0)
      const { data: reporte, error: e0 } = await supabase.from('ot_reportes').insert({
        ot_id: ot.id, cantidad_ok: okTotal, cantidad_scrap: scrapTotal, turno, tipo: 'manual',
        notas: notas || null, reportado_por: perfil.id,
      }).select().single()
      if (e0) throw e0

      const lotesCreados = []
      for (const l of conDatos) {
        const d = datos(l.articulo_id)
        const ok = Number(d.ok) || 0
        let lote = null
        if (ok > 0) {
          const alm = almacenNacimientoDe(l.articulo_id)
          const { data, error: e1 } = await supabase.from('lotes').insert({
            empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, codigo_lote: d.codigo_lote.trim(),
            origen: 'produccion', estatus_calidad: 'retenido', creado_por: perfil.id,
          }).select().single()
          if (e1) throw (e1.message.includes('duplicate') ? new Error(`El lote "${d.codigo_lote.trim()}" ya existe`) : e1)
          lote = data
          lotesCreados.push(`${artDe(l.articulo_id)?.codigo_interno}: ${lote.codigo_lote}`)
          await supabase.from('existencias').insert({
            lote_id: lote.id, almacen_id: alm.id,
            ubicacion_id: d.ubicacion_pt_id ? Number(d.ubicacion_pt_id) : null, cantidad: ok,
          })
          await supabase.from('movimientos').insert({
            empresa_id: perfil.empresa_id, articulo_id: l.articulo_id, lote_id: lote.id, tipo: 'entrada_produccion',
            almacen_destino_id: alm.id, ubicacion_destino_id: d.ubicacion_pt_id ? Number(d.ubicacion_pt_id) : null,
            cantidad: ok, motivo: `Produccion OT ${ot.folio}`, usuario_id: perfil.id,
          })
        }
        await supabase.from('ot_reporte_articulos').insert({
          reporte_id: reporte.id, articulo_id: l.articulo_id, cantidad_ok: ok,
          cantidad_scrap: scrapTotalDe(l.articulo_id), lote_id: lote?.id || null,
        })
        for (const s of d.scrap.filter(x => Number(x.cantidad) > 0)) {
          await supabase.from('ot_reporte_scrap').insert({ reporte_id: reporte.id, articulo_id: l.articulo_id, causa_id: Number(s.causa_id), cantidad: Number(s.cantidad) })
        }
        await supabase.from('ot_articulos').update({
          cantidad_producida: Number(l.cantidad_producida || 0) + ok,
          cantidad_scrap: Number(l.cantidad_scrap || 0) + scrapTotalDe(l.articulo_id),
        }).eq('id', l.id)
      }

      // Backflush con genealogia
      for (const p of plan) {
        const productoPrincipal = p.porProducto[0]?.productoId || null
        for (const t of p.tomas) {
          const nueva = Number(t.existencia.cantidad) - t.cantidad
          if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', t.existencia.id)
          else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.existencia.id)
          await supabase.from('ot_consumos').insert({
            reporte_id: reporte.id, articulo_id: p.componenteId, articulo_producto_id: productoPrincipal,
            lote_id: t.existencia.lote_id, cantidad: t.cantidad,
            ubicacion_id: t.existencia.ubicacion_id, almacen_id: t.existencia.almacen_id,
          })
          await supabase.from('movimientos').insert({
            empresa_id: perfil.empresa_id, articulo_id: p.componenteId, lote_id: t.existencia.lote_id,
            tipo: 'consumo_produccion', almacen_origen_id: t.existencia.almacen_id, ubicacion_origen_id: t.existencia.ubicacion_id,
            cantidad: t.cantidad, motivo: `Consumo OT ${ot.folio}`, usuario_id: perfil.id,
          })
        }
      }

      // Avance de la OT (por el articulo principal)
      const principal = lineasOt.find(l => l.principal) || lineasOt[0]
      const okPrin = Number(datos(principal.articulo_id).ok) || 0
      const prodTotal = Number(ot.cantidad_producida || 0) + okPrin
      const nuevoEstatus = prodTotal >= Number(ot.cantidad_programada) ? 'terminada' : 'en_proceso'
      await supabase.from('ordenes_trabajo').update({
        cantidad_producida: prodTotal, cantidad_scrap: Number(ot.cantidad_scrap || 0) + scrapTotalDe(principal.articulo_id), estatus: nuevoEstatus,
      }).eq('id', ot.id)

      setExito(`Reporte registrado: ${fmtNum(okTotal)} OK${scrapTotal ? `, ${fmtNum(scrapTotal)} scrap` : ''}. Lotes RETENIDOS: ${lotesCreados.join(' | ') || 'ninguno'}`)
      setPorArt({}); setNotas('')
      await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  const registrarParo = async () => {
    setError(''); setExito('')
    if (!ot) { setError('Selecciona la OT'); return }
    if (!paro.causa_id || !(Number(paro.minutos) > 0)) { setError('Captura causa y minutos del paro'); return }
    const { error: e1 } = await supabase.from('ot_paros').insert({
      ot_id: ot.id, causa_id: Number(paro.causa_id), minutos: Number(paro.minutos), turno, notas: paro.notas || null, reportado_por: perfil.id,
    })
    if (e1) { setError('Error: ' + e1.message); return }
    setExito('Paro registrado')
    setParo({ causa_id: '', minutos: '', notas: '' })
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Reporte de Produccion</h2>
      <p style={styles.ayuda}>Captura manual por turno. Si la OT es de molde familiar se reporta cada articulo por separado (cada uno genera su lote). La MP se descuenta por BOM desde la <b>ubicacion de la maquina</b>, usando solo lotes <b>liberados</b> (FIFO).</p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      {!puedeReportar && <p style={{ ...styles.error, color: '#b45309' }}>Tu rol puede consultar pero no reportar produccion.</p>}

      <div style={styles.form}>
        <div style={styles.fila}>
          <div style={{ ...styles.campo, flex: 2.5 }}>
            <label style={styles.label}>Orden de trabajo *</label>
            <select style={styles.input} value={otId} onChange={e => { setOtId(e.target.value); setPorArt({}); setError('') }}>
              <option value="">Selecciona...</option>
              {ots.map(o => {
                const arts = otArts.filter(x => x.ot_id === o.id).map(x => artDe(x.articulo_id)?.codigo_interno).join(' + ')
                return <option key={o.id} value={o.id}>{o.folio} - {arts} - {o.maq?.clave}</option>
              })}
            </select>
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Turno</label>
            <select style={styles.input} value={turno} onChange={e => setTurno(e.target.value)}>
              {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div style={{ ...styles.campo, flex: 1.6 }}>
            <label style={styles.label}>Notas del reporte</label>
            <input style={styles.input} value={notas} onChange={e => setNotas(e.target.value)} placeholder="Opcional" />
          </div>
        </div>

        {ot && (
          <>
            <div style={styles.info}>
              <span>Maquina: <b>{ot.maq?.clave}</b></span>
              <span>Consume de: <b>{ot.ubicacion_mp_id ? ubiDe(ot.ubicacion_mp_id)?.clave : 'sin ubicacion'}</b></span>
              {lineasOt.length > 1 && <span style={{ color: '#2563eb', fontWeight: '600' }}>Molde familiar: {lineasOt.length} articulos</span>}
            </div>

            {lineasOt.map(l => {
              const art = artDe(l.articulo_id)
              const d = datos(l.articulo_id)
              const alm = almacenNacimientoDe(l.articulo_id)
              const pend = Number(l.cantidad_programada) - Number(l.cantidad_producida || 0)
              return (
                <div key={l.id} style={styles.artBox}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                    <span><b>{art?.codigo_interno}</b> - {art?.descripcion} {l.principal && <span style={{ ...styles.badge, ...styles.badgeAzul }}>principal</span>}</span>
                    <span style={{ fontSize: '13px', color: '#64748b' }}>
                      Avance {fmtNum(l.cantidad_producida)}/{fmtNum(l.cantidad_programada)} - Pendiente <b>{fmtNum(pend > 0 ? pend : 0)}</b> - Nace en <b>{alm ? alm.clave : 'sin flujo'}</b>
                    </span>
                  </div>
                  <div style={styles.fila}>
                    <div style={{ ...styles.campo, flex: 0.7 }}>
                      <label style={styles.label}>Piezas OK</label>
                      <input type="number" min="0" style={styles.input} value={d.ok} onChange={e => setDato(l.articulo_id, 'ok', e.target.value)} />
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>Codigo de lote {Number(d.ok) > 0 ? '*' : ''}</label>
                      <input style={styles.input} value={d.codigo_lote} onChange={e => setDato(l.articulo_id, 'codigo_lote', e.target.value)} placeholder={`${ot.folio}-${art?.codigo_interno?.slice(-4) || ''}-T${turno}`} />
                    </div>
                    <div style={styles.campo}>
                      <label style={styles.label}>Ubicacion destino</label>
                      <select style={styles.input} value={d.ubicacion_pt_id} onChange={e => setDato(l.articulo_id, 'ubicacion_pt_id', e.target.value)} disabled={!alm}>
                        <option value="">Sin ubicacion</option>
                        {alm && ubicaciones.filter(u => u.almacen_id === alm.id).map(u => <option key={u.id} value={u.id}>{u.clave}</option>)}
                      </select>
                    </div>
                    <div style={{ ...styles.campo, flex: 0.5, justifyContent: 'flex-end' }}>
                      <button style={{ ...styles.botonAccion, marginBottom: '9px' }} onClick={() => addScrap(l.articulo_id)}>+ Scrap</button>
                    </div>
                  </div>
                  {d.scrap.map((s, i) => (
                    <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '6px' }}>
                      <select style={{ ...styles.input, flex: 2 }} value={s.causa_id} onChange={e => setScrap(l.articulo_id, i, 'causa_id', e.target.value)}>
                        <option value="">Causa de scrap...</option>
                        {causasScrap.map(c => <option key={c.id} value={c.id}>{c.clave ? c.clave + ' - ' : ''}{c.nombre}</option>)}
                      </select>
                      <input type="number" min="0" style={{ ...styles.input, flex: 0.7 }} value={s.cantidad} onChange={e => setScrap(l.articulo_id, i, 'cantidad', e.target.value)} placeholder="Piezas" />
                      <button style={styles.botonAccion} onClick={() => delScrap(l.articulo_id, i)}>Quitar</button>
                    </div>
                  ))}
                </div>
              )
            })}

            {totalGeneral > 0 && (
              <div style={styles.planBox}>
                <p style={{ margin: '0 0 8px', fontWeight: '600', fontSize: '13px' }}>Consumo de materia prima (backflush por {fmtNum(totalGeneral)} pzas totales: OK + scrap)</p>
                {plan.length === 0 && <p style={{ fontSize: '13px', color: '#92400e', margin: 0 }}>Los articulos no tienen BOM: no se descontara material.</p>}
                {plan.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: '12px', fontSize: '13px', padding: '3px 0', color: p.faltante > 0 ? '#dc2626' : '#334155' }}>
                    <span style={{ flex: 2 }}><b>{p.art?.codigo_interno}</b> {p.art?.descripcion}</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>Req: {fmtNum(p.requerido.toFixed(3))}</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>Disp: {fmtNum(p.disponible.toFixed(3))}</span>
                    <span style={{ flex: 1.6, textAlign: 'right' }}>{p.faltante > 0 ? `FALTAN ${fmtNum(p.faltante.toFixed(3))}` : `Lotes: ${p.tomas.map(t => lotes.find(l => l.id === t.existencia.lote_id)?.codigo_lote).join(', ')}`}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.botones}>
              <button style={{ ...styles.boton, opacity: (!puedeReportar || procesando || hayFaltante) ? 0.5 : 1 }} disabled={!puedeReportar || procesando || hayFaltante} onClick={reportar}>
                {procesando ? 'Registrando...' : 'Registrar produccion'}
              </button>
            </div>

            <div style={styles.paroBox}>
              <p style={{ margin: '0 0 8px', fontWeight: '600', fontSize: '13px' }}>Registrar paro de maquina</p>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-end' }}>
                <select style={{ ...styles.input, flex: 2 }} value={paro.causa_id} onChange={e => setParo({ ...paro, causa_id: e.target.value })}>
                  <option value="">Causa del paro...</option>
                  {causasParo.map(c => <option key={c.id} value={c.id}>{c.clave ? c.clave + ' - ' : ''}{c.nombre}</option>)}
                </select>
                <input type="number" min="0" style={{ ...styles.input, flex: 0.6 }} value={paro.minutos} onChange={e => setParo({ ...paro, minutos: e.target.value })} placeholder="Minutos" />
                <input style={{ ...styles.input, flex: 1.4 }} value={paro.notas} onChange={e => setParo({ ...paro, notas: e.target.value })} placeholder="Notas (opcional)" />
                <button style={styles.botonSec} onClick={registrarParo} disabled={!puedeReportar}>Registrar paro</button>
              </div>
            </div>
          </>
        )}
      </div>

      <h3 style={{ ...styles.titulo, fontSize: '15px', margin: '24px 0 12px' }}>Ultimos reportes</h3>
      {reportes.length === 0 ? (
        <p style={{ color: '#666', padding: '4px' }}>Aun no hay reportes de produccion.</p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1.3 }}>Fecha</span>
            <span style={{ flex: 1 }}>OT</span>
            <span style={{ flex: 0.7 }}>Turno</span>
            <span style={{ flex: 0.9, textAlign: 'right' }}>OK</span>
            <span style={{ flex: 0.9, textAlign: 'right' }}>Scrap</span>
            <span style={{ flex: 1.3 }}>Reporto</span>
            <span style={{ flex: 1.4 }}>Notas</span>
          </div>
          {reportes.map(r => (
            <div key={r.id} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
              <span style={{ flex: 1.3, color: '#64748b' }}>{new Date(r.fecha).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' })}</span>
              <span style={{ flex: 1, fontWeight: '600' }}>{r.ot?.folio}</span>
              <span style={{ flex: 0.7 }}>{r.turno}</span>
              <span style={{ flex: 0.9, textAlign: 'right', fontWeight: '600', color: '#16a34a' }}>{fmtNum(r.cantidad_ok)}</span>
              <span style={{ flex: 0.9, textAlign: 'right', color: Number(r.cantidad_scrap) > 0 ? '#dc2626' : '#94a3b8' }}>{fmtNum(r.cantidad_scrap)}</span>
              <span style={{ flex: 1.3, color: '#64748b' }}>{r.usuario?.nombre}</span>
              <span style={{ flex: 1.4, color: '#64748b' }}>{r.notas || '-'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 16px', lineHeight: '1.5' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '14px', marginBottom: '12px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  info: { display: 'flex', gap: '22px', backgroundColor: '#f8fafc', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: '#334155', marginBottom: '14px', flexWrap: 'wrap' },
  artBox: { border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px 16px', marginBottom: '12px' },
  planBox: { backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', marginBottom: '14px' },
  paroBox: { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '14px 16px', marginTop: '18px', borderTop: '1px solid #e2e8f0' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#c2410c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  badge: { padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' },
  badgeAzul: { backgroundColor: '#dbeafe', color: '#2563eb' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
