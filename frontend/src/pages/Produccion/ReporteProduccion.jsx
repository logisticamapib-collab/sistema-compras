import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Reporte de produccion contra una OT.
// - Genera el lote de PT (retenido) en el almacen del PASO 1 del flujo del articulo.
// - Backflush: descuenta la MP del BOM desde la UBICACION DE MAQUINA de la OT,
//   consumiendo por FIFO y SOLO lotes LIBERADOS por Calidad.
// - Registra scrap por causa y deja la genealogia lote MP -> lote PT en ot_consumos.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const TURNOS = ['1o', '2o', '3o']

export default function ReporteProduccion() {
  const { perfil, tienePermiso } = useAuth()
  const puedeReportar = tienePermiso('prod_reportes', 'crear')

  const [ots, setOts] = useState([])
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
  const [form, setForm] = useState({ cantidad_ok: '', turno: '1o', codigo_lote: '', ubicacion_pt_id: '', notas: '' })
  const [scrapLineas, setScrapLineas] = useState([])
  const [paro, setParo] = useState({ causa_id: '', minutos: '', notas: '' })

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [o, b, a, ex, lo, ps, al, ub, cs, cp, rep] = await Promise.all([
      supabase.from('ordenes_trabajo').select('*, art:articulos(id, codigo_interno, descripcion, unidad_medida, flujo_id), maq:maquinas(clave, nombre)').eq('empresa_id', perfil.empresa_id).in('estatus', ['programada', 'en_proceso']).order('created_at', { ascending: false }),
      supabase.from('bom').select('*'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida'),
      supabase.from('existencias').select('*'),
      supabase.from('lotes').select('*'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
      supabase.from('almacenes').select('*'),
      supabase.from('ubicaciones').select('*'),
      supabase.from('causas_scrap').select('*').eq('activo', true).order('nombre'),
      supabase.from('causas_paro').select('*').eq('activo', true).order('nombre'),
      supabase.from('ot_reportes').select('*, ot:ordenes_trabajo(folio), usuario:usuarios!ot_reportes_reportado_por_fkey(nombre)').order('fecha', { ascending: false }).limit(50),
    ])
    setOts(o.data || []); setBom(b.data || []); setArticulos(a.data || []); setExistencias(ex.data || [])
    setLotes(lo.data || []); setPasos(ps.data || []); setAlmacenes(al.data || []); setUbicaciones(ub.data || [])
    setCausasScrap(cs.data || []); setCausasParo(cp.data || []); setReportes(rep.data || [])
    setLoading(false)
  }

  const ot = ots.find(o => o.id === Number(otId))
  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)

  // Almacen donde NACE el producto = paso 1 del flujo del articulo
  const almacenNacimiento = () => {
    if (!ot?.art?.flujo_id) return null
    const ps = pasos.filter(p => p.flujo_id === ot.art.flujo_id)
    return ps.length ? almDe(ps[0].almacen_id) : null
  }
  const almNac = ot ? almacenNacimiento() : null

  // Componentes del BOM del articulo de la OT
  const componentes = ot ? bom.filter(b => b.articulo_padre_id === ot.articulo_id) : []
  const totalPiezas = (Number(form.cantidad_ok) || 0) + scrapLineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0)

  // Existencia disponible de un componente en la ubicacion de MP de la maquina (solo lotes liberados)
  const disponiblesDe = (componenteId) => {
    if (!ot?.ubicacion_mp_id) return []
    return existencias
      .filter(e => e.ubicacion_id === ot.ubicacion_mp_id && Number(e.cantidad) > 0)
      .map(e => ({ ...e, _lote: lotes.find(l => l.id === e.lote_id) }))
      .filter(e => e._lote && e._lote.articulo_id === componenteId && e._lote.estatus_calidad === 'liberado')
      .sort((a, b) => (a._lote.fecha || '').localeCompare(b._lote.fecha || '')) // FIFO
  }

  // Plan de consumo (backflush) para la cantidad reportada
  const planConsumo = () => componentes.map(c => {
    const requerido = Number(c.cantidad_por_unidad || 0) * totalPiezas
    const disp = disponiblesDe(c.componente_articulo_id)
    const total = disp.reduce((s, e) => s + Number(e.cantidad), 0)
    const tomas = []
    let falta = requerido
    for (const e of disp) {
      if (falta <= 0) break
      const toma = Math.min(falta, Number(e.cantidad))
      tomas.push({ existencia: e, cantidad: toma })
      falta -= toma
    }
    return { comp: c, art: artDe(c.componente_articulo_id), requerido, disponible: total, tomas, faltante: Math.max(0, falta) }
  })
  const plan = ot && totalPiezas > 0 ? planConsumo() : []
  const hayFaltante = plan.some(p => p.faltante > 0.000001)

  const agregarScrap = () => setScrapLineas([...scrapLineas, { causa_id: '', cantidad: '' }])
  const setScrap = (i, campo, val) => setScrapLineas(scrapLineas.map((l, j) => j === i ? { ...l, [campo]: val } : l))
  const quitarScrap = (i) => setScrapLineas(scrapLineas.filter((_, j) => j !== i))

  const reportar = async () => {
    setError(''); setExito('')
    if (!ot) { setError('Selecciona la orden de trabajo'); return }
    const ok = Number(form.cantidad_ok) || 0
    const scrapTotal = scrapLineas.reduce((s, l) => s + (Number(l.cantidad) || 0), 0)
    if (ok <= 0 && scrapTotal <= 0) { setError('Captura piezas OK o scrap'); return }
    if (scrapLineas.some(l => Number(l.cantidad) > 0 && !l.causa_id)) { setError('Cada renglon de scrap necesita su causa'); return }
    if (ok > 0 && !almNac) { setError('El articulo no tiene flujo de almacen asignado: no se sabe donde nace el producto. Asignalo en Logistica > Flujos de Almacen.'); return }
    if (ok > 0 && !form.codigo_lote.trim()) { setError('Captura el codigo de lote del producto'); return }
    if (hayFaltante) { setError('No hay suficiente materia prima liberada en la ubicacion de la maquina. Revisa el plan de consumo.'); return }

    setProcesando(true)
    try {
      // 1) Lote de PT (retenido) + existencia en el almacen de nacimiento
      let lotePt = null
      if (ok > 0) {
        const { data, error: e1 } = await supabase.from('lotes').insert({
          empresa_id: perfil.empresa_id, articulo_id: ot.articulo_id, codigo_lote: form.codigo_lote.trim(),
          origen: 'produccion', estatus_calidad: 'retenido', creado_por: perfil.id,
        }).select().single()
        if (e1) throw (e1.message.includes('duplicate') ? new Error(`El lote "${form.codigo_lote.trim()}" ya existe`) : e1)
        lotePt = data
        await supabase.from('existencias').insert({
          lote_id: lotePt.id, almacen_id: almNac.id,
          ubicacion_id: form.ubicacion_pt_id ? Number(form.ubicacion_pt_id) : null, cantidad: ok,
        })
        await supabase.from('movimientos').insert({
          empresa_id: perfil.empresa_id, articulo_id: ot.articulo_id, lote_id: lotePt.id, tipo: 'entrada_produccion',
          almacen_destino_id: almNac.id, ubicacion_destino_id: form.ubicacion_pt_id ? Number(form.ubicacion_pt_id) : null,
          cantidad: ok, motivo: `Produccion OT ${ot.folio}`, usuario_id: perfil.id,
        })
      }

      // 2) Encabezado del reporte
      const { data: reporte, error: e2 } = await supabase.from('ot_reportes').insert({
        ot_id: ot.id, cantidad_ok: ok, cantidad_scrap: scrapTotal, lote_id: lotePt?.id || null,
        turno: form.turno, tipo: 'manual', notas: form.notas || null, reportado_por: perfil.id,
      }).select().single()
      if (e2) throw e2

      // 3) Scrap por causa
      for (const l of scrapLineas.filter(x => Number(x.cantidad) > 0)) {
        await supabase.from('ot_reporte_scrap').insert({ reporte_id: reporte.id, causa_id: Number(l.causa_id), cantidad: Number(l.cantidad) })
      }

      // 4) Backflush: descuenta MP y deja genealogia
      for (const p of plan) {
        for (const t of p.tomas) {
          const nueva = Number(t.existencia.cantidad) - t.cantidad
          if (nueva <= 0) await supabase.from('existencias').delete().eq('id', t.existencia.id)
          else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.existencia.id)
          await supabase.from('ot_consumos').insert({
            reporte_id: reporte.id, articulo_id: p.comp.componente_articulo_id, lote_id: t.existencia.lote_id,
            cantidad: t.cantidad, ubicacion_id: t.existencia.ubicacion_id, almacen_id: t.existencia.almacen_id,
          })
          await supabase.from('movimientos').insert({
            empresa_id: perfil.empresa_id, articulo_id: p.comp.componente_articulo_id, lote_id: t.existencia.lote_id,
            tipo: 'consumo_produccion', almacen_origen_id: t.existencia.almacen_id, ubicacion_origen_id: t.existencia.ubicacion_id,
            cantidad: t.cantidad, motivo: `Consumo OT ${ot.folio}${lotePt ? ` -> lote ${lotePt.codigo_lote}` : ''}`, usuario_id: perfil.id,
          })
        }
      }

      // 5) Avance de la OT
      const prodTotal = Number(ot.cantidad_producida || 0) + ok
      const scrapAcum = Number(ot.cantidad_scrap || 0) + scrapTotal
      const nuevoEstatus = prodTotal >= Number(ot.cantidad_programada) ? 'terminada' : 'en_proceso'
      await supabase.from('ordenes_trabajo').update({ cantidad_producida: prodTotal, cantidad_scrap: scrapAcum, estatus: nuevoEstatus }).eq('id', ot.id)

      setExito(`Reporte registrado: ${fmtNum(ok)} OK${scrapTotal ? `, ${fmtNum(scrapTotal)} scrap` : ''}. ${lotePt ? `Lote ${lotePt.codigo_lote} creado como RETENIDO en ${almNac.clave}.` : ''}`)
      setForm({ cantidad_ok: '', turno: form.turno, codigo_lote: '', ubicacion_pt_id: '', notas: '' })
      setScrapLineas([])
      await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  const registrarParo = async () => {
    setError(''); setExito('')
    if (!ot) { setError('Selecciona la OT'); return }
    if (!paro.causa_id || !(Number(paro.minutos) > 0)) { setError('Captura causa y minutos del paro'); return }
    const { error: e1 } = await supabase.from('ot_paros').insert({
      ot_id: ot.id, causa_id: Number(paro.causa_id), minutos: Number(paro.minutos),
      turno: form.turno, notas: paro.notas || null, reportado_por: perfil.id,
    })
    if (e1) { setError('Error: ' + e1.message); return }
    setExito('Paro registrado')
    setParo({ causa_id: '', minutos: '', notas: '' })
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Reporte de Produccion</h2>
      <p style={styles.ayuda}>Captura manual por turno. El material se descuenta por BOM desde la <b>ubicacion de MP de la maquina</b> de la OT, usando solo lotes <b>liberados</b> por Calidad (FIFO). El producto nace como lote <b>retenido</b>.</p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      {!puedeReportar && <p style={{ ...styles.error, color: '#b45309' }}>Tu rol puede consultar pero no reportar produccion.</p>}

      <div style={styles.form}>
        <div style={styles.fila}>
          <div style={{ ...styles.campo, flex: 2 }}>
            <label style={styles.label}>Orden de trabajo *</label>
            <select style={styles.input} value={otId} onChange={e => { setOtId(e.target.value); setScrapLineas([]); setError('') }}>
              <option value="">Selecciona...</option>
              {ots.map(o => <option key={o.id} value={o.id}>{o.folio} - {o.art?.codigo_interno} ({fmtNum(o.cantidad_producida)}/{fmtNum(o.cantidad_programada)}) - {o.maq?.clave}</option>)}
            </select>
          </div>
          <div style={styles.campo}>
            <label style={styles.label}>Turno</label>
            <select style={styles.input} value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })}>
              {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
        </div>

        {ot && (
          <>
            <div style={styles.info}>
              <span>Maquina: <b>{ot.maq?.clave}</b></span>
              <span>Consume de: <b>{ot.ubicacion_mp_id ? ubiDe(ot.ubicacion_mp_id)?.clave : 'sin ubicacion'}</b></span>
              <span>Producto nace en: <b>{almNac ? almNac.clave : 'sin flujo asignado'}</b></span>
              <span>SNP: <b>{ot.piezas_por_caja ? fmtNum(ot.piezas_por_caja) + ' pzas/caja' : '-'}</b></span>
            </div>

            <div style={styles.fila}>
              <div style={styles.campo}>
                <label style={styles.label}>Piezas OK *</label>
                <input type="number" min="0" style={styles.input} value={form.cantidad_ok} onChange={e => setForm({ ...form, cantidad_ok: e.target.value })} />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Codigo de lote del producto *</label>
                <input style={styles.input} value={form.codigo_lote} onChange={e => setForm({ ...form, codigo_lote: e.target.value })} placeholder={`Ej. ${ot.folio}-T${form.turno}`} />
              </div>
              <div style={styles.campo}>
                <label style={styles.label}>Ubicacion destino (opcional)</label>
                <select style={styles.input} value={form.ubicacion_pt_id} onChange={e => setForm({ ...form, ubicacion_pt_id: e.target.value })} disabled={!almNac}>
                  <option value="">Sin ubicacion</option>
                  {almNac && ubicaciones.filter(u => u.almacen_id === almNac.id).map(u => <option key={u.id} value={u.id}>{u.clave}</option>)}
                </select>
              </div>
              <div style={{ ...styles.campo, flex: 1.4 }}>
                <label style={styles.label}>Notas</label>
                <input style={styles.input} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Opcional" />
              </div>
            </div>

            {/* Scrap */}
            <div style={{ marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                <label style={styles.label}>Scrap por causa</label>
                <button style={styles.botonAccion} onClick={agregarScrap}>+ Agregar scrap</button>
              </div>
              {scrapLineas.map((l, i) => (
                <div key={i} style={{ display: 'flex', gap: '10px', marginBottom: '6px' }}>
                  <select style={{ ...styles.input, flex: 2 }} value={l.causa_id} onChange={e => setScrap(i, 'causa_id', e.target.value)}>
                    <option value="">Causa...</option>
                    {causasScrap.map(c => <option key={c.id} value={c.id}>{c.clave ? c.clave + ' - ' : ''}{c.nombre}</option>)}
                  </select>
                  <input type="number" min="0" style={{ ...styles.input, flex: 0.7 }} value={l.cantidad} onChange={e => setScrap(i, 'cantidad', e.target.value)} placeholder="Piezas" />
                  <button style={styles.botonAccion} onClick={() => quitarScrap(i)}>Quitar</button>
                </div>
              ))}
            </div>

            {/* Plan de consumo */}
            {totalPiezas > 0 && (
              <div style={styles.planBox}>
                <p style={{ margin: '0 0 8px', fontWeight: '600', fontSize: '13px' }}>Consumo de materia prima (backflush por {fmtNum(totalPiezas)} pzas: OK + scrap)</p>
                {plan.length === 0 && <p style={{ fontSize: '13px', color: '#92400e', margin: 0 }}>El articulo no tiene BOM: no se descontara material.</p>}
                {plan.map((p, i) => (
                  <div key={i} style={{ display: 'flex', gap: '12px', fontSize: '13px', padding: '3px 0', color: p.faltante > 0 ? '#dc2626' : '#334155' }}>
                    <span style={{ flex: 2 }}><b>{p.art?.codigo_interno}</b> {p.art?.descripcion}</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>Req: {fmtNum(p.requerido.toFixed(3))}</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>Disp: {fmtNum(p.disponible.toFixed(3))}</span>
                    <span style={{ flex: 1.4, textAlign: 'right' }}>{p.faltante > 0 ? `FALTAN ${fmtNum(p.faltante.toFixed(3))}` : `Lotes: ${p.tomas.map(t => lotes.find(l => l.id === t.existencia.lote_id)?.codigo_lote).join(', ')}`}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.botones}>
              <button style={{ ...styles.boton, opacity: (!puedeReportar || procesando || hayFaltante) ? 0.5 : 1 }} disabled={!puedeReportar || procesando || hayFaltante} onClick={reportar}>
                {procesando ? 'Registrando...' : 'Registrar produccion'}
              </button>
            </div>

            {/* Paros */}
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
  fila: { display: 'flex', gap: '14px', marginBottom: '14px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  info: { display: 'flex', gap: '22px', backgroundColor: '#f8fafc', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: '#334155', marginBottom: '14px', flexWrap: 'wrap' },
  planBox: { backgroundColor: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', marginBottom: '14px' },
  paroBox: { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '14px 16px', marginTop: '18px', borderTop: '1px solid #e2e8f0' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#c2410c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
