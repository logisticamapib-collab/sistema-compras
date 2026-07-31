import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import EscanerCamara from '../../components/EscanerCamara'

// Inventario ciclico por clasificacion ABC.
// 1) El sistema propone que articulos tocan hoy (por clase ABC y ultima fecha de conteo),
//    filtrado por los ALMACENES que elija el usuario (asi Produccion o Calidad cuentan lo suyo).
// 2) El usuario selecciona con checkbox los que va a contar -> se genera un FOLIO con el
//    teorico congelado (lote + ubicacion + cantidad).
// 3) Toma fisica: se teclea/escanea el folio, se escanean cajas o lotes; los de la lista se
//    palomean, un lote del mismo articulo que no estaba se agrega en ROJO con su ultimo
//    movimiento, y un articulo que no pertenece al folio se rechaza con aviso.
// 4) Al cerrar: sin diferencias -> historial "100% OK". Con diferencias -> justificacion por
//    producto y va a aprobacion del Gerente de Logistica (con segunda firma opcional).
// 5) Al aprobar se aplican los ajustes (+/-) sobre las existencias.

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 3 })
const hoyISO = () => new Date().toISOString().slice(0, 10)
const diasEntre = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000)
const EST = {
  asignado: { l: 'Asignado', c: '#2563eb' }, en_conteo: { l: 'En conteo', c: '#d97706' },
  pendiente_aprobacion: { l: 'Por aprobar', c: '#b45309' }, aprobado: { l: 'Aprobado', c: '#16a34a' },
  rechazado: { l: 'Rechazado', c: '#dc2626' }, cerrado_ok: { l: '100% OK', c: '#16a34a' },
}

export default function InventarioCiclico() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeContar = tienePermiso('log_ciclico', 'crear')
  const puedeAprobar = tienePermiso('log_ciclico', 'aprobar')

  const [vista, setVista] = useState('programa')
  const [arts, setArts] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubis, setUbis] = useState([])
  const [lotes, setLotes] = useState([])
  const [exs, setExs] = useState([])
  const [conteos, setConteos] = useState([])
  const [param, setParam] = useState(null)
  const [usuarios, setUsuarios] = useState([])
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [almSel, setAlmSel] = useState([])
  const [sel, setSel] = useState(new Set())
  const [folioBusca, setFolioBusca] = useState('')
  const [conteo, setConteo] = useState(null)     // cabecera abierta en toma fisica
  const [lineas, setLineas] = useState([])
  const [master, setMaster] = useState(null)   // { tarima, cajas } confirmacion de master
  const [cfg, setCfg] = useState({ dias_a: 30, dias_b: 90, dias_c: 180, tolerancia_pct: 0, requiere_segunda_aut: false, segunda_aut_rol: '' })

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const [a, al, ub, lo, ex, cc, pa, us] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, clasificacion_abc, abc_criterio, ultima_fecha_conteo, costo').eq('empresa_id', emp).eq('activo', true),
      supabase.from('almacenes').select('*').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('ubicaciones').select('id, clave, almacen_id').eq('activo', true),
      supabase.from('lotes').select('id, codigo_lote, articulo_id').eq('empresa_id', emp),
      supabase.from('existencias').select('*'),
      supabase.from('conteos_ciclicos').select('*').eq('empresa_id', emp).order('id', { ascending: false }).limit(200),
      supabase.from('inventario_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('usuarios').select('id, nombre'),
    ])
    setArts(a.data || []); setAlmacenes(al.data || []); setUbis(ub.data || []); setLotes(lo.data || [])
    setExs(ex.data || []); setConteos(cc.data || []); setUsuarios(us.data || [])
    setParam(pa.data || null); if (pa.data) setCfg({ ...cfg, ...pa.data })
    setLoading(false)
  }

  const artDe = (id) => arts.find(x => x.id === id)
  const loteDe = (id) => lotes.find(x => x.id === id)
  const almDe = (id) => almacenes.find(x => x.id === id)
  const ubiDe = (id) => ubis.find(x => x.id === id)
  const usrDe = (id) => usuarios.find(u => u.id === id)?.nombre || '-'
  const dias = { A: cfg.dias_a, B: cfg.dias_b, C: cfg.dias_c }

  // Articulos que tocan hoy: por clase ABC + ultima fecha de conteo, con existencia en los almacenes elegidos
  const pendientesHoy = () => {
    const almOK = (aid) => almSel.length === 0 || almSel.includes(aid)
    const conEx = {}
    exs.filter(e => Number(e.cantidad) > 0 && almOK(e.almacen_id)).forEach(e => {
      const l = loteDe(e.lote_id); if (!l) return
      conEx[l.articulo_id] = (conEx[l.articulo_id] || 0) + Number(e.cantidad)
    })
    return Object.keys(conEx).map(Number).map(id => {
      const a = artDe(id); if (!a) return null
      const clase = a.clasificacion_abc || 'C'
      const freq = dias[clase] || 180
      const ult = a.ultima_fecha_conteo
      const vencido = !ult || diasEntre(ult, hoyISO()) >= freq
      return { articulo: a, clase, existencia: conEx[id], ultima: ult, vencido, diasSin: ult ? diasEntre(ult, hoyISO()) : null }
    }).filter(x => x && x.vencido).sort((a, b) => (a.clase).localeCompare(b.clase) || (b.diasSin || 9999) - (a.diasSin || 9999))
  }

  // ---------- 1) Generar folio con lo seleccionado ----------
  const generarFolio = async () => {
    setError('')
    if (sel.size === 0) { setError('Selecciona al menos un articulo.'); return }
    if (almSel.length === 0) { setError('Elige el o los almacenes del conteo.'); return }
    setProc(true)
    try {
      const folio = 'IC-' + String(Date.now()).slice(-8)
      const { data: cab, error: e1 } = await supabase.from('conteos_ciclicos').insert({
        empresa_id: emp, site_id: perfil.site_id || null, folio, almacenes: almSel,
        asignado_a: perfil.id, creado_por: perfil.id, estatus: 'asignado',
      }).select().single()
      if (e1) throw e1
      // congelar teorico: existencias de esos articulos en esos almacenes
      const filas = []
      exs.filter(e => Number(e.cantidad) > 0 && almSel.includes(e.almacen_id)).forEach(e => {
        const l = loteDe(e.lote_id); if (!l || !sel.has(l.articulo_id)) return
        filas.push({ conteo_id: cab.id, articulo_id: l.articulo_id, lote_id: l.id, almacen_id: e.almacen_id, ubicacion_id: e.ubicacion_id || null, cantidad_teorica: Number(e.cantidad) })
      })
      if (filas.length) await supabase.from('conteo_lineas').insert(filas)
      setExito(`Conteo ${folio} generado con ${sel.size} articulo(s) y ${filas.length} lote(s).`)
      setSel(new Set()); await cargar(); setVista('toma'); setFolioBusca(folio)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  // ---------- 2) Toma fisica ----------
  const abrirFolio = async (folio) => {
    setError(''); setExito('')
    const f = (folio || folioBusca).trim()
    if (!f) return
    const { data: cab } = await supabase.from('conteos_ciclicos').select('*').eq('empresa_id', emp).ilike('folio', f).maybeSingle()
    if (!cab) { setError(`No existe el conteo "${f}".`); return }
    const { data: ln } = await supabase.from('conteo_lineas').select('*').eq('conteo_id', cab.id).order('id')
    setConteo(cab); setLineas(ln || [])
    if (cab.estatus === 'asignado') await supabase.from('conteos_ciclicos').update({ estatus: 'en_conteo' }).eq('id', cab.id)
  }

  // Escaneo: caja (contenedor), lote o codigo de articulo
  const escanear = async (valor) => {
    setError('')
    const v = (valor || '').trim(); if (!v || !conteo) return
    let lote = null
    const { data: cont } = await supabase.from('contenedores').select('id, folio, tipo, lote_id, articulo_id, cantidad').eq('empresa_id', emp).ilike('folio', v).maybeSingle()
    // Master / tarima: pide validar fisicamente las cajas que la componen antes de palomear
    if (cont && cont.tipo === 'tarima') {
      const { data: hijas } = await supabase.from('contenedores').select('id, folio, lote_id, articulo_id, cantidad').eq('padre_id', cont.id).eq('estatus', 'activo').order('folio')
      if (!hijas || hijas.length === 0) { setError(`La master ${cont.folio} no tiene cajas activas.`); return }
      setMaster({ tarima: cont, cajas: hijas }); return
    }
    if (cont?.lote_id) lote = lotes.find(l => l.id === cont.lote_id)
    if (!lote) lote = lotes.find(l => (l.codigo_lote || '').toLowerCase() === v.toLowerCase())
    if (!lote) {
      const art = arts.find(a => (a.codigo_interno || '').toLowerCase() === v.toLowerCase())
      if (art) { setError(`El codigo ${art.codigo_interno} no corresponde a un lote. Escanea la caja o el lote.`); return }
      setError(`No se encontro la caja o lote "${v}".`); return
    }
    const enLista = lineas.find(x => x.lote_id === lote.id)
    if (enLista) {
      if (!enLista.contado) {
        await supabase.from('conteo_lineas').update({ contado: true, cantidad_contada: enLista.cantidad_teorica, contado_at: new Date().toISOString() }).eq('id', enLista.id)
        setLineas(ls => ls.map(x => x.id === enLista.id ? { ...x, contado: true, cantidad_contada: x.cantidad_teorica } : x))
      }
      setExito(`Lote ${lote.codigo_lote} palomeado.`); return
    }
    // El lote no estaba en la lista
    const articulosDelFolio = [...new Set(lineas.map(x => x.articulo_id))]
    if (!articulosDelFolio.includes(lote.articulo_id)) {
      setError(`El producto ${artDe(lote.articulo_id)?.codigo_interno || ''} (lote ${lote.codigo_lote}) NO corresponde al inventario ciclico seleccionado.`); return
    }
    // Mismo articulo pero lote ajeno: buscar su ultimo movimiento
    const { data: mov } = await supabase.from('movimientos').select('tipo, fecha, almacen_origen_id, almacen_destino_id, motivo')
      .eq('lote_id', lote.id).order('fecha', { ascending: false }).limit(1)
    const m = mov && mov[0]
    const detalle = m ? `${m.tipo}${m.almacen_destino_id ? ` -> ${almDe(m.almacen_destino_id)?.clave || ''}` : ''} (${new Date(m.fecha).toLocaleDateString('es-MX')})` : 'sin movimientos registrados'
    const { data: nueva } = await supabase.from('conteo_lineas').insert({
      conteo_id: conteo.id, articulo_id: lote.articulo_id, lote_id: lote.id,
      almacen_id: conteo.almacenes?.[0] || null, cantidad_teorica: 0, cantidad_contada: 0,
      contado: true, ajeno: true, ultimo_movimiento: detalle, contado_at: new Date().toISOString(),
    }).select().single()
    setLineas(ls => [...ls, nueva])
    setExito(`Lote ${lote.codigo_lote} agregado como AJENO. Ultimo movimiento: ${detalle}`)
  }

  // Confirmada fisicamente la master: palomea el lote de cada caja que la compone
  const confirmarMaster = async () => {
    const m = master; if (!m) return
    setProc(true); setError('')
    try {
      const loteIds = [...new Set(m.cajas.map(c => c.lote_id).filter(Boolean))]
      let palomeados = 0, ajenos = 0, fuera = 0
      const articulosDelFolio = [...new Set(lineas.map(x => x.articulo_id))]
      let nuevas = []
      for (const lid of loteIds) {
        const lote = lotes.find(l => l.id === lid); if (!lote) continue
        const enLista = lineas.find(x => x.lote_id === lid)
        if (enLista) {
          if (!enLista.contado) {
            await supabase.from('conteo_lineas').update({ contado: true, cantidad_contada: enLista.cantidad_teorica, contado_at: new Date().toISOString() }).eq('id', enLista.id)
            nuevas.push({ id: enLista.id, patch: { contado: true, cantidad_contada: enLista.cantidad_teorica } })
          }
          palomeados++
        } else if (!articulosDelFolio.includes(lote.articulo_id)) {
          fuera++
        } else {
          const { data: mv } = await supabase.from('movimientos').select('tipo, fecha, almacen_destino_id')
            .eq('lote_id', lid).order('fecha', { ascending: false }).limit(1)
          const mm = mv && mv[0]
          const detalle = mm ? `${mm.tipo}${mm.almacen_destino_id ? ` -> ${almDe(mm.almacen_destino_id)?.clave || ''}` : ''} (${new Date(mm.fecha).toLocaleDateString('es-MX')})` : 'sin movimientos registrados'
          const { data: nl } = await supabase.from('conteo_lineas').insert({
            conteo_id: conteo.id, articulo_id: lote.articulo_id, lote_id: lid,
            almacen_id: conteo.almacenes?.[0] || null, cantidad_teorica: 0, cantidad_contada: 0,
            contado: true, ajeno: true, ultimo_movimiento: detalle, contado_at: new Date().toISOString(),
          }).select().single()
          if (nl) nuevas.push({ nueva: nl })
          ajenos++
        }
      }
      setLineas(ls => {
        let out = ls.map(x => { const u = nuevas.find(n => n.id === x.id); return u ? { ...x, ...u.patch } : x })
        nuevas.filter(n => n.nueva).forEach(n => out.push(n.nueva))
        return out
      })
      const partes = [`${palomeados} lote(s) palomeado(s)`]
      if (ajenos) partes.push(`${ajenos} ajeno(s) en rojo`)
      if (fuera) partes.push(`${fuera} fuera del folio (ignorado(s))`)
      setExito(`Master ${m.tarima.folio}: ${partes.join(' · ')}.`)
      setMaster(null)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const setContada = async (l, valor) => {
    const v = valor === '' ? null : Number(valor)
    setLineas(ls => ls.map(x => x.id === l.id ? { ...x, cantidad_contada: v, contado: v != null } : x))
    await supabase.from('conteo_lineas').update({ cantidad_contada: v, contado: v != null, contado_at: new Date().toISOString() }).eq('id', l.id)
  }
  const setJustif = async (l, txt) => {
    setLineas(ls => ls.map(x => x.id === l.id ? { ...x, justificacion: txt } : x))
    await supabase.from('conteo_lineas').update({ justificacion: txt }).eq('id', l.id)
  }
  const dif = (l) => Number(l.cantidad_contada ?? 0) - Number(l.cantidad_teorica || 0)

  const cerrarConteo = async () => {
    setError('')
    const sinContar = lineas.filter(x => !x.contado)
    if (sinContar.length > 0) { setError(`Faltan ${sinContar.length} lote(s) por contar o marcar en 0.`); return }
    const conDif = lineas.filter(x => dif(x) !== 0)
    const sinJust = conDif.filter(x => !x.justificacion || !x.justificacion.trim())
    if (sinJust.length > 0) { setError(`Escribe la justificacion de los ${sinJust.length} producto(s) con diferencia.`); return }
    setProc(true)
    try {
      if (conDif.length === 0) {
        await supabase.from('conteos_ciclicos').update({ estatus: 'cerrado_ok', cerrado_at: new Date().toISOString() }).eq('id', conteo.id)
        await marcarContados()
        setExito('Inventario ciclico cerrado: 100% OK (sin diferencias).')
      } else {
        await supabase.from('conteos_ciclicos').update({ estatus: 'pendiente_aprobacion', cerrado_at: new Date().toISOString() }).eq('id', conteo.id)
        setExito(`Conteo enviado a aprobacion del Gerente de Logistica (${conDif.length} diferencia(s)).`)
      }
      setConteo(null); setLineas([]); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }
  const marcarContados = async () => {
    const ids = [...new Set(lineas.map(x => x.articulo_id))]
    for (const id of ids) await supabase.from('articulos').update({ ultima_fecha_conteo: hoyISO() }).eq('id', id)
  }

  // ---------- 3) Aprobacion y ajustes ----------
  const aprobar = async (cab, ok) => {
    setError(''); setProc(true)
    try {
      if (!ok) {
        await supabase.from('conteos_ciclicos').update({ estatus: 'rechazado', rechazo_motivo: 'Rechazado por el Gerente de Logistica' }).eq('id', cab.id)
        setExito('Conteo rechazado.'); await cargar(); setProc(false); return
      }
      const { data: ln } = await supabase.from('conteo_lineas').select('*').eq('conteo_id', cab.id)
      for (const l of (ln || [])) {
        const d = Number(l.cantidad_contada ?? 0) - Number(l.cantidad_teorica || 0)
        if (d === 0 || l.ajustado) continue
        // ajustar existencia del lote en ese almacen/ubicacion
        const { data: ex } = await supabase.from('existencias').select('*').eq('lote_id', l.lote_id).eq('almacen_id', l.almacen_id).maybeSingle()
        if (ex) {
          const nueva = Number(ex.cantidad) + d
          if (nueva > 0) await supabase.from('existencias').update({ cantidad: nueva }).eq('id', ex.id)
          else await supabase.from('existencias').delete().eq('id', ex.id)
        } else if (d > 0) {
          await supabase.from('existencias').insert({ lote_id: l.lote_id, almacen_id: l.almacen_id, ubicacion_id: l.ubicacion_id || null, cantidad: d })
        }
        await supabase.from('movimientos').insert({
          empresa_id: emp, articulo_id: l.articulo_id, lote_id: l.lote_id,
          tipo: d > 0 ? 'ajuste_positivo' : 'ajuste_negativo',
          almacen_origen_id: d < 0 ? l.almacen_id : null, almacen_destino_id: d > 0 ? l.almacen_id : null,
          cantidad: Math.abs(d), motivo: `Inv. ciclico ${cab.folio}: ${l.justificacion || 'ajuste'}`, usuario_id: perfil.id,
        })
        await supabase.from('conteo_lineas').update({ ajustado: true }).eq('id', l.id)
        await supabase.from('articulos').update({ ultima_fecha_conteo: hoyISO() }).eq('id', l.articulo_id)
      }
      await supabase.from('conteos_ciclicos').update({ estatus: 'aprobado', aprobado_por: perfil.id, aprobado_at: new Date().toISOString() }).eq('id', cab.id)
      setExito(`Conteo ${cab.folio} aprobado y ajustes aplicados.`); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const guardarCfg = async () => {
    setProc(true); setError('')
    try {
      await supabase.from('inventario_parametros').upsert({
        empresa_id: emp, dias_a: Number(cfg.dias_a), dias_b: Number(cfg.dias_b), dias_c: Number(cfg.dias_c),
        tolerancia_pct: Number(cfg.tolerancia_pct) || 0, requiere_segunda_aut: !!cfg.requiere_segunda_aut,
        segunda_aut_rol: cfg.segunda_aut_rol || null, updated_at: new Date().toISOString(), updated_by: perfil.id,
      }, { onConflict: 'empresa_id' })
      setExito('Parametros guardados.'); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  // Recalcular ABC (Pareto) segun el criterio de cada articulo
  const recalcularABC = async () => {
    setProc(true); setError('')
    try {
      const { data: movs } = await supabase.from('movimientos').select('articulo_id, cantidad, tipo').eq('empresa_id', emp).in('tipo', ['salida_embarque', 'consumo_produccion'])
      const val = {}
      ;(movs || []).forEach(m => { val[m.articulo_id] = (val[m.articulo_id] || 0) + Number(m.cantidad || 0) })
      const candidatos = arts.filter(a => (a.abc_criterio || 'manual') !== 'manual')
      const conValor = candidatos.map(a => ({ a, v: (a.abc_criterio === 'costo' ? (val[a.id] || 0) * Number(a.costo || 0) : (val[a.id] || 0)) }))
        .sort((x, y) => y.v - x.v)
      const total = conValor.reduce((s, x) => s + x.v, 0)
      let acum = 0; let n = 0
      for (const x of conValor) {
        acum += x.v
        const pct = total > 0 ? acum / total : 1
        const clase = pct <= 0.8 ? 'A' : pct <= 0.95 ? 'B' : 'C'
        await supabase.from('articulos').update({ clasificacion_abc: clase }).eq('id', x.a.id); n++
      }
      setExito(`ABC recalculado en ${n} articulo(s) (los marcados como manual no se tocan).`); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: 28, color: '#666' }}>Cargando...</p>
  const pend = pendientesHoy()
  const porAprobar = conteos.filter(c => c.estatus === 'pendiente_aprobacion')

  return (
    <div style={S.c} className="aparecer">
      <h2 style={S.t}>Inventario Ciclico</h2>
      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      <div style={S.tabs}>
        {[['programa', `Programa de hoy (${pend.length})`], ['toma', 'Toma fisica'], ['aprobar', `Por aprobar (${porAprobar.length})`], ['historial', 'Historial'], ['config', 'Configuracion']].map(([id, n]) => (
          <button key={id} style={vista === id ? S.tabOn : S.tab} onClick={() => { setVista(id); setError(''); setExito('') }}>{n}</button>
        ))}
      </div>

      {vista === 'programa' && (
        <>
          <div style={S.box}>
            <p style={S.lbl}>Almacenes a inventariar (puedes elegir varios):</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              {almacenes.map(a => (
                <label key={a.id} style={S.chk}>
                  <input type="checkbox" checked={almSel.includes(a.id)} onChange={e => setAlmSel(s => e.target.checked ? [...s, a.id] : s.filter(x => x !== a.id))} />
                  {a.clave} <span style={{ color: '#94a3b8' }}>{a.nombre}</span>
                </label>
              ))}
            </div>
          </div>
          {almSel.length === 0 ? <p style={S.hint}>Elige al menos un almacen para ver que toca contar hoy.</p> : (
            <>
              <p style={S.hint}>El sistema propone <b>{pend.length}</b> articulo(s) para hoy segun su clase ABC. Selecciona los que vas a contar (uno, varios o todos) y genera tu folio.</p>
              <div style={S.tabla}>
                <div style={S.th}><span style={{ width: 36 }}></span><span style={{ flex: 1.6 }}>Articulo</span><span style={{ width: 60, textAlign: 'center' }}>ABC</span><span style={{ flex: 1, textAlign: 'right' }}>Existencia</span><span style={{ flex: 1 }}>Ultimo conteo</span></div>
                {pend.map(p => (
                  <label key={p.articulo.id} style={S.tr}>
                    <span style={{ width: 36 }}><input type="checkbox" checked={sel.has(p.articulo.id)} onChange={e => { const s = new Set(sel); e.target.checked ? s.add(p.articulo.id) : s.delete(p.articulo.id); setSel(s) }} /></span>
                    <span style={{ flex: 1.6 }}><b>{p.articulo.codigo_interno}</b> <span style={{ color: '#94a3b8' }}>{p.articulo.descripcion}</span></span>
                    <span style={{ width: 60, textAlign: 'center' }}><span style={{ ...S.pill, backgroundColor: p.clase === 'A' ? '#fee2e2' : p.clase === 'B' ? '#fef3c7' : '#f1f5f9', color: p.clase === 'A' ? '#b91c1c' : p.clase === 'B' ? '#b45309' : '#475569' }}>{p.clase}</span></span>
                    <span style={{ flex: 1, textAlign: 'right' }}>{fmt(p.existencia)}</span>
                    <span style={{ flex: 1, fontSize: 12, color: '#64748b' }}>{p.ultima ? `${p.ultima} (${p.diasSin} dias)` : 'nunca'}</span>
                  </label>
                ))}
                {pend.length === 0 && <div style={S.vacio}>Nada pendiente de contar hoy en estos almacenes.</div>}
              </div>
              {puedeContar && sel.size > 0 && <div style={{ textAlign: 'right', marginTop: 12 }}><button style={S.btn} onClick={generarFolio} disabled={proc}>Generar folio con {sel.size} articulo(s)</button></div>}
            </>
          )}
        </>
      )}

      {vista === 'toma' && !conteo && (
        <div style={S.box}>
          <p style={S.lbl}>Folio del conteo</p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={S.input} placeholder="IC-XXXXXXXX" value={folioBusca} onChange={e => setFolioBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && abrirFolio()} />
            <EscanerCamara title="Escanear folio" onScan={(v) => { setFolioBusca(v); abrirFolio(v) }} />
            <button style={S.btn} onClick={() => abrirFolio()}>Abrir</button>
          </div>
          <div style={{ marginTop: 14 }}>
            {conteos.filter(c => ['asignado', 'en_conteo'].includes(c.estatus)).map(c => (
              <div key={c.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '6px 0', fontSize: 13 }}>
                <b>{c.folio}</b><span style={{ color: '#64748b' }}>{c.fecha} · {usrDe(c.asignado_a)}</span>
                <button style={S.btnMini} onClick={() => abrirFolio(c.folio)}>Abrir</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {vista === 'toma' && conteo && (
        <>
          <div style={S.selHead}>
            <div><b style={{ fontSize: 16 }}>{conteo.folio}</b> · {conteo.fecha} · almacenes: {(conteo.almacenes || []).map(id => almDe(id)?.clave).join(', ')}</div>
            <button style={S.btnSec} onClick={() => { setConteo(null); setLineas([]) }}>&larr; Volver</button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '10px 0 14px' }}>
            <input style={S.input} placeholder="Escanea o teclea caja / lote" onKeyDown={e => { if (e.key === 'Enter') { escanear(e.target.value); e.target.value = '' } }} />
            <EscanerCamara title="Escanear caja o lote" onScan={escanear} />
            <span style={{ fontSize: 12, color: '#64748b' }}>{lineas.filter(l => l.contado).length} / {lineas.length} contados</span>
          </div>
          <div style={S.tabla}>
            <div style={S.th}><span style={{ width: 30 }}></span><span style={{ flex: 1.3 }}>Articulo</span><span style={{ flex: 1 }}>Lote</span><span style={{ flex: 1 }}>Ubicacion</span><span style={{ flex: 0.8, textAlign: 'right' }}>Teorico</span><span style={{ flex: 0.9, textAlign: 'right' }}>Contado</span><span style={{ flex: 0.8, textAlign: 'right' }}>Dif.</span><span style={{ flex: 1.4 }}>Justificacion</span></div>
            {lineas.map(l => {
              const d = dif(l)
              return (
                <div key={l.id} style={{ ...S.tr, backgroundColor: l.ajeno ? '#fef2f2' : l.contado ? '#f0fdf4' : '#fff' }}>
                  <span style={{ width: 30 }}>{l.contado ? '✅' : '⬜'}</span>
                  <span style={{ flex: 1.3, fontSize: 12.5 }}>{artDe(l.articulo_id)?.codigo_interno}{l.ajeno && <span style={{ ...S.pill, backgroundColor: '#fee2e2', color: '#b91c1c', marginLeft: 4 }}>ajeno</span>}</span>
                  <span style={{ flex: 1, fontSize: 12.5 }}>{loteDe(l.lote_id)?.codigo_lote || '-'}{l.ultimo_movimiento && <div style={{ fontSize: 10.5, color: '#b91c1c' }}>{l.ultimo_movimiento}</div>}</span>
                  <span style={{ flex: 1, fontSize: 12, color: '#64748b' }}>{almDe(l.almacen_id)?.clave} {ubiDe(l.ubicacion_id)?.clave || ''}</span>
                  <span style={{ flex: 0.8, textAlign: 'right' }}>{fmt(l.cantidad_teorica)}</span>
                  <span style={{ flex: 0.9, textAlign: 'right' }}><input style={S.inputSm} type="number" value={l.cantidad_contada ?? ''} onChange={e => setContada(l, e.target.value)} /></span>
                  <span style={{ flex: 0.8, textAlign: 'right', fontWeight: 700, color: d === 0 ? '#16a34a' : '#dc2626' }}>{d === 0 ? '0' : fmt(d)}</span>
                  <span style={{ flex: 1.4 }}>{d !== 0 && <input style={{ ...S.inputSm, width: '100%' }} placeholder="Motivo *" value={l.justificacion || ''} onChange={e => setJustif(l, e.target.value)} />}</span>
                </div>
              )
            })}
            {lineas.length === 0 && <div style={S.vacio}>Este folio no tiene lotes.</div>}
          </div>
          {puedeContar && lineas.length > 0 && <div style={{ textAlign: 'right', marginTop: 12 }}><button style={S.btn} onClick={cerrarConteo} disabled={proc}>Terminar conteo</button></div>}
        </>
      )}

      {vista === 'aprobar' && (
        <div style={S.tabla}>
          <div style={S.th}><span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1 }}>Fecha</span><span style={{ flex: 1.2 }}>Conto</span><span style={{ flex: 1.2 }}>Almacenes</span><span style={{ width: 200 }}></span></div>
          {porAprobar.map(c => (
            <div key={c.id}>
              <div style={S.tr}>
                <span style={{ flex: 1, fontWeight: 600 }}>{c.folio}</span>
                <span style={{ flex: 1, color: '#64748b' }}>{c.fecha}</span>
                <span style={{ flex: 1.2, fontSize: 12 }}>{usrDe(c.asignado_a)}</span>
                <span style={{ flex: 1.2, fontSize: 12, color: '#64748b' }}>{(c.almacenes || []).map(id => almDe(id)?.clave).join(', ')}</span>
                <span style={{ width: 200, textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                  <button style={S.btnMini} onClick={() => abrirFolio(c.folio)}>Ver detalle</button>
                  {puedeAprobar && <><button style={S.btnMini} disabled={proc} onClick={() => aprobar(c, true)}>Aprobar</button>
                  <button style={S.btnMiniRed} disabled={proc} onClick={() => aprobar(c, false)}>Rechazar</button></>}
                </span>
              </div>
            </div>
          ))}
          {porAprobar.length === 0 && <div style={S.vacio}>No hay conteos por aprobar.</div>}
          {!puedeAprobar && porAprobar.length > 0 && <div style={S.vacio}>Solo el Gerente de Logistica puede aprobar los ajustes.</div>}
        </div>
      )}

      {vista === 'historial' && (
        <div style={S.tabla}>
          <div style={S.th}><span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1 }}>Fecha</span><span style={{ flex: 1.2 }}>Conto</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 1.2 }}>Aprobo</span></div>
          {conteos.map(c => (
            <div key={c.id} style={S.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{c.folio}</span>
              <span style={{ flex: 1, color: '#64748b' }}>{c.fecha}</span>
              <span style={{ flex: 1.2, fontSize: 12 }}>{usrDe(c.asignado_a)}</span>
              <span style={{ flex: 1 }}><span style={{ ...S.pill, backgroundColor: (EST[c.estatus]?.c || '#64748b') + '22', color: EST[c.estatus]?.c }}>{EST[c.estatus]?.l || c.estatus}</span></span>
              <span style={{ flex: 1.2, fontSize: 12, color: '#64748b' }}>{c.aprobado_por ? usrDe(c.aprobado_por) : '-'}</span>
            </div>
          ))}
          {conteos.length === 0 && <div style={S.vacio}>Sin conteos registrados.</div>}
        </div>
      )}

      {vista === 'config' && (
        <div style={{ ...S.box, maxWidth: 520 }}>
          <p style={S.hint}>Cada cuantos dias se debe contar cada clase, y quien autoriza los ajustes.</p>
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            {['A', 'B', 'C'].map(k => (
              <div key={k} style={{ flex: 1 }}>
                <label style={S.lbl}>Clase {k} (dias)</label>
                <input style={S.input} type="number" value={cfg['dias_' + k.toLowerCase()]} onChange={e => setCfg({ ...cfg, ['dias_' + k.toLowerCase()]: e.target.value })} />
              </div>
            ))}
          </div>
          <label style={S.lbl}>Tolerancia de diferencia (%)</label>
          <input style={S.input} type="number" value={cfg.tolerancia_pct} onChange={e => setCfg({ ...cfg, tolerancia_pct: e.target.value })} />
          <label style={{ ...S.chk, marginTop: 12 }}>
            <input type="checkbox" checked={!!cfg.requiere_segunda_aut} onChange={e => setCfg({ ...cfg, requiere_segunda_aut: e.target.checked })} />
            Requiere segunda autorizacion ademas del Gerente de Logistica
          </label>
          {cfg.requiere_segunda_aut && (
            <select style={S.input} value={cfg.segunda_aut_rol || ''} onChange={e => setCfg({ ...cfg, segunda_aut_rol: e.target.value })}>
              <option value="">Selecciona el rol...</option>
              <option value="gerente_planta">Gerente de Planta</option>
              <option value="direccion">Direccion</option>
              <option value="gerente_administrativo">Gerente Administrativo</option>
            </select>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button style={S.btnSec} onClick={recalcularABC} disabled={proc}>Recalcular ABC</button>
            <button style={S.btn} onClick={guardarCfg} disabled={proc}>Guardar</button>
          </div>
        </div>
      )}

      {master && (
        <div style={S.ov} onClick={() => setMaster(null)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <h3 style={{ fontSize: 15, fontWeight: 600, color: '#1a1a2e', margin: '0 0 6px' }}>Master {master.tarima.folio}</h3>
            <p style={{ fontSize: 13.5, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '9px 12px', margin: '0 0 10px' }}>
              Esta master contiene <b>{master.cajas.length} caja(s)</b>. Favor de validar que <b>fisicamente existan</b> antes de confirmar.
            </p>
            <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid #eef2f7', borderRadius: 8 }}>
              {master.cajas.map(c => (
                <div key={c.id} style={{ display: 'flex', gap: 8, padding: '6px 10px', borderBottom: '1px solid #f1f5f9', fontSize: 12.5 }}>
                  <span style={{ flex: 1, fontWeight: 600 }}>{c.folio}</span>
                  <span style={{ flex: 1.2, color: '#64748b' }}>{artDe(c.articulo_id)?.codigo_interno || ''}</span>
                  <span style={{ flex: 1.2, color: '#64748b' }}>{loteDe(c.lote_id)?.codigo_lote || '-'}</span>
                  <span style={{ width: 70, textAlign: 'right' }}>{fmt(c.cantidad)}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 14 }}>
              <button style={S.btnSec} onClick={() => setMaster(null)} disabled={proc}>Cancelar</button>
              <button style={S.btn} onClick={confirmarMaster} disabled={proc}>Confirmado fisicamente</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S = {
  c: { padding: 24, maxWidth: 1140 },
  t: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  tabs: { display: 'flex', gap: 4, marginBottom: 14, borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' },
  tab: { padding: '8px 15px', border: 'none', background: 'transparent', fontSize: 14, color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabOn: { padding: '8px 15px', border: 'none', background: 'transparent', fontSize: 14, color: '#0891b2', fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid #0891b2' },
  box: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 10, padding: 16, marginBottom: 14 },
  selHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  lbl: { fontSize: 12, fontWeight: 600, color: '#444', display: 'block', marginBottom: 6 },
  hint: { fontSize: 13, color: '#64748b', margin: '0 0 10px' },
  chk: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' },
  tabla: { background: '#fff', border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 14px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '9px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13, cursor: 'default' },
  vacio: { padding: '14px 16px', color: '#94a3b8', fontSize: 13 },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  inputSm: { padding: '5px 8px', borderRadius: 6, border: '1px solid #ddd', fontSize: 12.5, outline: 'none', width: 90, textAlign: 'right' },
  btn: { padding: '9px 18px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, cursor: 'pointer' },
  btnSec: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnMini: { padding: '5px 10px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  btnMiniRed: { padding: '5px 10px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  pill: { padding: '2px 8px', borderRadius: 20, fontSize: 10.5, fontWeight: 700 },
  ov: { position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { background: '#fff', borderRadius: 12, padding: 22, width: 520, maxWidth: '94vw' },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
