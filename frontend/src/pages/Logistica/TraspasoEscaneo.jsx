import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { etiquetaRol } from '../../lib/roles'

// Traspaso rapido por escaneo. Flujo de uso:
//   1) Se elige la UBICACION DESTINO.
//   2) Se escanea/teclea el folio de CAJA, TARIMA o el LOTE.
//   3) El sistema valida contra el flujo y las firmas:
//        - Fabricado con flujo: el destino debe ser el ALMACEN DEL SIGUIENTE PASO.
//          Si el paso actual requiere firma y el lote no esta firmado -> bloquea
//          y avisa quien debe firmar; si el destino no es el siguiente paso ->
//          avisa a que almacen debe ir.
//        - Comprado/consigna (sin flujo): movimiento libre, sin candados.
//   4) Se van listando los items validos; al final un boton transfiere todo.
// Mueve la caja/tarima y su existencia juntas para no descuadrar.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')

export default function TraspasoEscaneo() {
  const { perfil, tienePermiso } = useAuth()
  const puedeMover = tienePermiso('log_movimiento', 'crear')

  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [pasos, setPasos] = useState([])
  const [lotes, setLotes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [contenedores, setContenedores] = useState([])
  const [firmas, setFirmas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [procesando, setProcesando] = useState(false)

  const [destAlmacen, setDestAlmacen] = useState('')
  const [destUbicacion, setDestUbicacion] = useState('')
  const [escaneo, setEscaneo] = useState('')
  const [items, setItems] = useState([])   // [{ tipo:'caja'|'tarima'|'lote', ref, lote, articulo, cantidad, almacen_id, ubicacion_id, contenedorIds:[] }]
  const escaneoRef = useRef(null)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [a, al, ub, ps, lo, ex, ct, fi] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, flujo_id, origen, es_consigna').eq('empresa_id', perfil.empresa_id),
      supabase.from('almacenes').select('*').eq('activo', true).order('clave'),
      supabase.from('ubicaciones').select('*').eq('activo', true).order('clave'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
      supabase.from('lotes').select('*'),
      supabase.from('existencias').select('*'),
      supabase.from('contenedores').select('*').eq('estatus', 'activo'),
      supabase.from('lote_firmas').select('*'),
    ])
    setArticulos(a.data || []); setAlmacenes(al.data || []); setUbicaciones(ub.data || []); setPasos(ps.data || [])
    setLotes(lo.data || []); setExistencias(ex.data || []); setContenedores(ct.data || []); setFirmas(fi.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const pasosDeArt = (artId) => { const a = artDe(artId); return a?.flujo_id ? pasos.filter(p => p.flujo_id === a.flujo_id) : [] }
  const firmaDe = (loteId, pasoId) => firmas.find(f => f.lote_id === loteId && f.paso_id === pasoId)
  const ubisDe = (almId) => ubicaciones.filter(u => u.almacen_id === Number(almId))

  // Valida si un material en (almacen origen) puede ir al almacen destino elegido.
  // Devuelve { ok, motivo }
  const validar = (articuloId, loteId, almacenOrigen) => {
    const art = artDe(articuloId)
    const lote = loteDe(loteId)
    if (lote?.estatus_calidad === 'rechazado') return { ok: false, motivo: 'El lote esta RECHAZADO por Calidad: no se puede traspasar.' }
    // Sin flujo (comprado/consigna): movimiento libre
    if (!art?.flujo_id) return { ok: true }
    const ps = pasosDeArt(articuloId)
    const idx = ps.findIndex(p => p.almacen_id === almacenOrigen)
    if (idx < 0) return { ok: false, motivo: `El material esta en un almacen fuera del flujo del articulo. Debe estar en: ${ps.map(p => almDe(p.almacen_id)?.clave).join(' -> ')}` }
    const actual = ps[idx]
    const siguiente = ps[idx + 1]
    if (actual.requiere_liberacion && !firmaDe(loteId, actual.id)) {
      return { ok: false, motivo: `Requiere la firma de ${etiquetaRol(actual.rol_libera || 'calidad')} antes de salir de ${almDe(actual.almacen_id)?.clave}. Firmala en Movimiento de Material o en la bandeja de Calidad.` }
    }
    if (!siguiente) return { ok: false, motivo: 'Es el ultimo paso del flujo (ya solo se embarca).' }
    if (Number(destAlmacen) !== siguiente.almacen_id) {
      return { ok: false, motivo: `El siguiente paso es ${almDe(siguiente.almacen_id)?.clave}. Cambia el destino a ese almacen.` }
    }
    return { ok: true }
  }

  const procesarEscaneo = (valor) => {
    setError('')
    const v = (valor || '').trim()
    if (!v) return
    if (!destAlmacen) { setError('Primero elige la ubicacion destino'); return }

    // Caja o tarima por folio
    const cont = contenedores.find(c => c.folio.toLowerCase() === v.toLowerCase() && !c.padre_id)
    if (cont) {
      if (items.some(it => it.contenedorIds.includes(cont.id))) { setError(`${cont.folio} ya esta en la lista`); return }
      const cajas = cont.tipo === 'tarima' ? contenedores.filter(c => c.padre_id === cont.id) : [cont]
      const val = validar(cont.articulo_id, cont.lote_id, cont.almacen_id)
      if (!val.ok) { setError(`${cont.folio}: ${val.motivo}`); return }
      setItems([...items, {
        tipo: cont.tipo, ref: cont.folio, lote: loteDe(cont.lote_id), articulo: artDe(cont.articulo_id),
        cantidad: Number(cont.cantidad), almacen_id: cont.almacen_id, ubicacion_id: cont.ubicacion_id,
        contenedorId: cont.id, contenedorIds: [cont.id, ...cajas.map(c => c.id)],
      }])
      setExito(`${cont.tipo === 'tarima' ? 'Tarima' : 'Caja'} ${cont.folio} agregada`)
      setEscaneo('')
      return
    }

    // Lote directo (material sin caja, ej. MP a granel)
    const lote = lotes.find(l => l.codigo_lote.toLowerCase() === v.toLowerCase())
    if (lote) {
      const exs = existencias.filter(e => e.lote_id === lote.id && Number(e.cantidad) > 0)
      if (exs.length === 0) { setError(`El lote ${v} no tiene existencia disponible`); return }
      if (exs.length > 1) { setError(`El lote ${v} esta en varias ubicaciones; escanea la caja especifica o muevelo en Inventario`); return }
      const ex = exs[0]
      if (items.some(it => it.tipo === 'lote' && it.existenciaId === ex.id)) { setError('Ese lote ya esta en la lista'); return }
      const val = validar(lote.articulo_id, lote.id, ex.almacen_id)
      if (!val.ok) { setError(`${lote.codigo_lote}: ${val.motivo}`); return }
      setItems([...items, {
        tipo: 'lote', ref: lote.codigo_lote, lote, articulo: artDe(lote.articulo_id),
        cantidad: Number(ex.cantidad), almacen_id: ex.almacen_id, ubicacion_id: ex.ubicacion_id,
        existenciaId: ex.id, contenedorIds: [],
      }])
      setExito(`Lote ${lote.codigo_lote} agregado`)
      setEscaneo('')
      return
    }

    setError(`No se encontro la caja, tarima o lote "${v}"`)
  }

  const quitar = (i) => setItems(items.filter((_, j) => j !== i))

  const transferir = async () => {
    setError('')
    if (items.length === 0) { setError('Escanea al menos una caja o lote'); return }
    const destAlm = Number(destAlmacen)
    const destUbi = destUbicacion ? Number(destUbicacion) : null
    setProcesando(true)
    try {
      for (const it of items) {
        // Existencia: descuenta del origen y suma al destino
        const origen = existencias.find(e => e.lote_id === it.lote.id && e.almacen_id === it.almacen_id && (e.ubicacion_id || null) === (it.ubicacion_id || null))
        if (origen) {
          const nueva = Number(origen.cantidad) - it.cantidad
          if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', origen.id)
          else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', origen.id)
        }
        const dest = existencias.find(e => e.lote_id === it.lote.id && e.almacen_id === destAlm && (e.ubicacion_id || null) === destUbi)
        if (dest) await supabase.from('existencias').update({ cantidad: Number(dest.cantidad) + it.cantidad }).eq('id', dest.id)
        else await supabase.from('existencias').insert({ lote_id: it.lote.id, almacen_id: destAlm, ubicacion_id: destUbi, cantidad: it.cantidad })

        // Contenedores: mueve caja/tarima (y sus cajas hijas)
        if (it.contenedorIds.length) {
          await supabase.from('contenedores').update({ almacen_id: destAlm, ubicacion_id: destUbi }).in('id', it.contenedorIds)
        }

        await supabase.from('movimientos').insert({
          empresa_id: perfil.empresa_id, articulo_id: it.articulo.id, lote_id: it.lote.id, tipo: 'traspaso',
          almacen_origen_id: it.almacen_id, ubicacion_origen_id: it.ubicacion_id,
          almacen_destino_id: destAlm, ubicacion_destino_id: destUbi, cantidad: it.cantidad,
          motivo: `Traspaso por escaneo (${it.ref})`, usuario_id: perfil.id,
        })
      }
      setExito(`Traspaso realizado: ${items.length} item(s) a ${almDe(destAlm)?.clave}${destUbi ? ' / ' + ubiDe(destUbi)?.clave : ''}`)
      setItems([]); setEscaneo('')
      await cargar()
      escaneoRef.current?.focus()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  const totalItems = items.reduce((s, it) => s + Number(it.cantidad), 0)

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Traspaso por Escaneo</h2>
      <p style={styles.ayuda}>Elige el <b>destino</b>, luego escanea las cajas/tarimas o teclea el lote. El sistema valida el flujo y las firmas: si no procede, te dice a que almacen debe ir o que firma falta. Comprados y consigna se mueven libres.</p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.panelDestino}>
        <span style={{ fontWeight: '600', fontSize: '13px', color: '#0891b2' }}>1. Destino</span>
        <div style={{ ...styles.campo }}>
          <label style={styles.label}>Almacen destino *</label>
          <select style={styles.input} value={destAlmacen} onChange={e => { setDestAlmacen(e.target.value); setDestUbicacion('') }}>
            <option value="">Selecciona...</option>
            {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
          </select>
        </div>
        <div style={{ ...styles.campo }}>
          <label style={styles.label}>Ubicacion destino</label>
          <select style={styles.input} value={destUbicacion} onChange={e => setDestUbicacion(e.target.value)} disabled={!destAlmacen}>
            <option value="">Sin ubicacion</option>
            {ubisDe(destAlmacen).map(u => <option key={u.id} value={u.id}>{u.clave}{u.es_cuarentena ? ' (cuarentena)' : ''}</option>)}
          </select>
        </div>
      </div>

      <div style={styles.panelEscaneo}>
        <span style={{ fontWeight: '600', fontSize: '13px', color: '#0891b2', display: 'block', marginBottom: '8px' }}>2. Escanea caja / tarima / lote</span>
        <input ref={escaneoRef} style={{ ...styles.input, width: '100%' }} value={escaneo}
          disabled={!destAlmacen || !puedeMover}
          placeholder={destAlmacen ? 'Escanea el QR de la caja o tarima (o teclea el lote) y Enter' : 'Primero elige el destino'}
          onChange={e => setEscaneo(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') procesarEscaneo(escaneo) }} autoFocus />
      </div>

      {items.length > 0 && (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 0.9 }}>Ref</span>
            <span style={{ flex: 2 }}>Articulo</span>
            <span style={{ flex: 1.2 }}>Lote</span>
            <span style={{ flex: 1.2 }}>Origen</span>
            <span style={{ flex: 0.9, textAlign: 'right' }}>Cantidad</span>
            <span style={{ width: '80px' }}></span>
          </div>
          {items.map((it, i) => (
            <div key={i} style={styles.tablaFila}>
              <span style={{ flex: 0.9, fontWeight: '600', fontSize: '13px' }}>{it.ref}<span style={{ display: 'block', fontSize: '10px', color: '#94a3b8' }}>{it.tipo}</span></span>
              <span style={{ flex: 2, fontSize: '13px' }}><b>{it.articulo?.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {it.articulo?.descripcion}</span></span>
              <span style={{ flex: 1.2, fontSize: '13px' }}>{it.lote?.codigo_lote}</span>
              <span style={{ flex: 1.2, fontSize: '13px', color: '#64748b' }}>{almDe(it.almacen_id)?.clave}{it.ubicacion_id ? ` / ${ubiDe(it.ubicacion_id)?.clave}` : ''}</span>
              <span style={{ flex: 0.9, textAlign: 'right', fontWeight: '600' }}>{fmtNum(it.cantidad)} {it.articulo?.unidad_medida}</span>
              <span style={{ width: '80px', textAlign: 'right' }}><button style={styles.botonAccion} onClick={() => quitar(i)}>Quitar</button></span>
            </div>
          ))}
          <div style={{ ...styles.tablaFila, backgroundColor: '#f8fafc', fontWeight: '600' }}>
            <span style={{ flex: 5.3 }}>{items.length} item(s) a {almDe(Number(destAlmacen))?.clave}{destUbicacion ? ' / ' + ubiDe(Number(destUbicacion))?.clave : ''}</span>
            <span style={{ flex: 0.9, textAlign: 'right' }}>{fmtNum(totalItems)}</span>
            <span style={{ width: '80px' }}></span>
          </div>
        </div>
      )}

      <div style={{ ...styles.botones, marginTop: '16px' }}>
        {items.length > 0 && <button style={styles.botonSec} onClick={() => setItems([])} disabled={procesando}>Vaciar</button>}
        <button style={{ ...styles.boton, opacity: (!puedeMover || procesando || items.length === 0) ? 0.5 : 1 }}
          disabled={!puedeMover || procesando || items.length === 0} onClick={transferir}>
          {procesando ? 'Transfiriendo...' : `Transferir ${items.length || ''}`}
        </button>
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 16px', lineHeight: '1.5' },
  panelDestino: { display: 'flex', gap: '16px', alignItems: 'flex-end', backgroundColor: '#fff', borderRadius: '10px', padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '14px' },
  panelEscaneo: { backgroundColor: '#fff', borderRadius: '10px', padding: '16px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff', boxSizing: 'border-box' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 22px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '10px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '7px', padding: '8px 12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
