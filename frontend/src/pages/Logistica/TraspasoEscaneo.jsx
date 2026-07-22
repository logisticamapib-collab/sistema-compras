import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { etiquetaRol } from '../../lib/roles'

// Traspaso rapido por escaneo (scan-and-go, una transferencia por escaneo):
//   1) Se elige el ALMACEN DESTINO (una vez).
//   2) Se escanea o teclea la UBICACION destino.
//   3) Se escanea el QR de la caja/tarima (o el lote): se transfiere de INMEDIATO
//      y se guarda el movimiento. Sin lista ni boton de confirmar.
// Reglas:
//   - No mueve a la misma ubicacion.
//   - No mueve material RETENIDO o RECHAZADO (debe liberarse antes).
//   - Fabricado con flujo: el destino debe ser el ALMACEN DEL SIGUIENTE PASO; si
//     no, cancela y avisa a que almacen debe ir; si el paso actual pide firma y
//     falta, avisa quien debe firmar.
//   - Comprado/consigna (sin flujo): movimiento libre.
// Cada transferencia lee la existencia fresca y la ajusta de forma atomica.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')

export default function TraspasoEscaneo() {
  const { perfil, tienePermiso } = useAuth()
  const puedeMover = tienePermiso('log_movimiento', 'crear')

  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [pasos, setPasos] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [procesando, setProcesando] = useState(false)

  const [destAlmacen, setDestAlmacen] = useState('')
  const [destUbicacion, setDestUbicacion] = useState('')  // clave o id de la ubicacion destino
  const [escaneo, setEscaneo] = useState('')
  const [historial, setHistorial] = useState([])   // ultimos traspasos de la sesion
  const escaneoRef = useRef(null)

  useEffect(() => { cargarCatalogos() }, [])

  const cargarCatalogos = async () => {
    setLoading(true)
    const [a, al, ub, ps] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, flujo_id, origen, es_consigna').eq('empresa_id', perfil.empresa_id),
      supabase.from('almacenes').select('*').eq('activo', true).order('clave'),
      supabase.from('ubicaciones').select('*').eq('activo', true).order('clave'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
    ])
    setArticulos(a.data || []); setAlmacenes(al.data || []); setUbicaciones(ub.data || []); setPasos(ps.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const pasosDeArt = (artId) => { const a = artDe(artId); return a?.flujo_id ? pasos.filter(p => p.flujo_id === a.flujo_id) : [] }
  const ubisDest = () => ubicaciones.filter(u => u.almacen_id === Number(destAlmacen))

  // Resuelve la ubicacion destino (por id de <select> o por clave escaneada)
  const resolverUbicacionDestino = () => {
    if (!destUbicacion) return { id: null }
    const porId = ubicaciones.find(u => String(u.id) === String(destUbicacion) && u.almacen_id === Number(destAlmacen))
    if (porId) return { id: porId.id }
    const porClave = ubicaciones.find(u => u.clave.toLowerCase() === String(destUbicacion).trim().toLowerCase() && u.almacen_id === Number(destAlmacen))
    if (porClave) return { id: porClave.id }
    return { id: null, invalida: true }
  }

  // Valida flujo/firma para material fabricado. Regresa { ok, motivo }
  const validarFlujo = async (articuloId, loteId, almacenOrigen, destAlm) => {
    const art = artDe(articuloId)
    if (!art?.flujo_id) return { ok: true }  // comprado/consigna: libre
    const ps = pasosDeArt(articuloId)
    const idx = ps.findIndex(p => p.almacen_id === almacenOrigen)
    if (idx < 0) return { ok: false, motivo: `El material esta en un almacen fuera del flujo (${ps.map(p => almDe(p.almacen_id)?.clave).join(' -> ')}).` }
    const actual = ps[idx]
    const siguiente = ps[idx + 1]
    if (actual.requiere_liberacion) {
      const { data: fir } = await supabase.from('lote_firmas').select('id').eq('lote_id', loteId).eq('paso_id', actual.id).maybeSingle()
      if (!fir) return { ok: false, motivo: `Requiere firma de ${etiquetaRol(actual.rol_libera || 'calidad')} antes de salir de ${almDe(actual.almacen_id)?.clave}.` }
    }
    if (!siguiente) return { ok: false, motivo: 'Es el ultimo paso del flujo (solo se embarca).' }
    if (destAlm !== siguiente.almacen_id) return { ok: false, motivo: `El siguiente paso es ${almDe(siguiente.almacen_id)?.clave}. Cambia el almacen destino a ese.` }
    return { ok: true }
  }

  // Transfiere una caja/tarima/lote al destino elegido (una sola pieza, atomico)
  const transferir = async (valor) => {
    setError(''); setExito('')
    const v = (valor || '').trim()
    if (!v) return
    if (!destAlmacen) { setError('Primero elige el almacen destino'); escaneoRef.current?.focus(); return }
    const ud = resolverUbicacionDestino()
    if (destUbicacion && ud.invalida) { setError(`La ubicacion "${destUbicacion}" no existe en ese almacen`); return }
    const destAlm = Number(destAlmacen)
    const destUbi = ud.id

    setProcesando(true)
    try {
      // 1) Resolver que se escaneo: caja/tarima (folio) o lote (codigo)
      let cont = null, lote = null, cajasIds = []
      const { data: contData } = await supabase.from('contenedores').select('*').eq('empresa_id', perfil.empresa_id).eq('estatus', 'activo').ilike('folio', v).maybeSingle()
      if (contData && !contData.padre_id) {
        cont = contData
        const { data: l } = await supabase.from('lotes').select('*').eq('id', cont.lote_id).maybeSingle()
        lote = l
        if (cont.tipo === 'tarima') {
          const { data: hijas } = await supabase.from('contenedores').select('id').eq('padre_id', cont.id)
          cajasIds = (hijas || []).map(h => h.id)
        }
        cajasIds = [cont.id, ...cajasIds]
      } else {
        const { data: l } = await supabase.from('lotes').select('*').ilike('codigo_lote', v).maybeSingle()
        if (l) lote = l
      }
      if (!lote) { setError(`No se encontro la caja, tarima o lote "${v}"`); setProcesando(false); return }

      const art = artDe(lote.articulo_id)

      // 2) Candado de calidad: no mover retenido/rechazado
      if (lote.estatus_calidad !== 'liberado') {
        setError(`${art?.codigo_interno} lote ${lote.codigo_lote}: esta ${lote.estatus_calidad.toUpperCase()}. Debe liberarse por Calidad antes de traspasar.`)
        setProcesando(false); return
      }

      // 3) Ubicacion origen: la de la caja, o la existencia del lote
      let almOrigen, ubiOrigen, cantidad
      if (cont) {
        almOrigen = cont.almacen_id; ubiOrigen = cont.ubicacion_id; cantidad = Number(cont.cantidad)
      } else {
        const { data: exs } = await supabase.from('existencias').select('*').eq('lote_id', lote.id).gt('cantidad', 0)
        if (!exs || exs.length === 0) { setError(`El lote ${lote.codigo_lote} no tiene existencia`); setProcesando(false); return }
        if (exs.length > 1) { setError(`El lote ${lote.codigo_lote} esta en varias ubicaciones; escanea la caja especifica`); setProcesando(false); return }
        almOrigen = exs[0].almacen_id; ubiOrigen = exs[0].ubicacion_id; cantidad = Number(exs[0].cantidad)
      }

      // 4) No mover a la misma ubicacion
      if (almOrigen === destAlm && (ubiOrigen || null) === (destUbi || null)) {
        setError(`${art?.codigo_interno}: ya esta en ${almDe(destAlm)?.clave}${destUbi ? '/' + ubiDe(destUbi)?.clave : ''}. No se puede mover a la misma ubicacion.`)
        setProcesando(false); return
      }

      // 5) Validacion de flujo (fabricados)
      const val = await validarFlujo(lote.articulo_id, lote.id, almOrigen, destAlm)
      if (!val.ok) { setError(`${art?.codigo_interno} lote ${lote.codigo_lote}: ${val.motivo}`); setProcesando(false); return }

      // 6) Aplicar transferencia atomica (lectura fresca del origen)
      const { data: exOrigen } = await supabase.from('existencias').select('*').eq('lote_id', lote.id).eq('almacen_id', almOrigen).is('ubicacion_id', ubiOrigen ?? null).maybeSingle()
      // Fallback si la ubicacion_id no es null (is() no aplica): buscar exacto
      let exO = exOrigen
      if (!exO) {
        const { data: exList } = await supabase.from('existencias').select('*').eq('lote_id', lote.id).eq('almacen_id', almOrigen)
        exO = (exList || []).find(e => (e.ubicacion_id || null) === (ubiOrigen || null))
      }
      if (!exO || Number(exO.cantidad) < cantidad - 0.000001) {
        setError(`${art?.codigo_interno}: la existencia en origen (${exO ? fmtNum(exO.cantidad) : 0}) no cubre ${fmtNum(cantidad)}. Revisa el inventario.`)
        setProcesando(false); return
      }
      const nuevaOrigen = Number(exO.cantidad) - cantidad
      if (nuevaOrigen <= 0.000001) await supabase.from('existencias').delete().eq('id', exO.id)
      else await supabase.from('existencias').update({ cantidad: nuevaOrigen }).eq('id', exO.id)

      const { data: destList } = await supabase.from('existencias').select('*').eq('lote_id', lote.id).eq('almacen_id', destAlm)
      const exD = (destList || []).find(e => (e.ubicacion_id || null) === (destUbi || null))
      if (exD) await supabase.from('existencias').update({ cantidad: Number(exD.cantidad) + cantidad }).eq('id', exD.id)
      else await supabase.from('existencias').insert({ lote_id: lote.id, almacen_id: destAlm, ubicacion_id: destUbi, cantidad })

      if (cajasIds.length) await supabase.from('contenedores').update({ almacen_id: destAlm, ubicacion_id: destUbi }).in('id', cajasIds)

      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: lote.articulo_id, lote_id: lote.id, tipo: 'traspaso',
        almacen_origen_id: almOrigen, ubicacion_origen_id: ubiOrigen, almacen_destino_id: destAlm, ubicacion_destino_id: destUbi,
        cantidad, motivo: `Traspaso por escaneo (${cont ? cont.folio : lote.codigo_lote})`, usuario_id: perfil.id,
      })

      setExito(`${cont ? cont.folio : lote.codigo_lote} - ${art?.codigo_interno}: ${fmtNum(cantidad)} ${art?.unidad_medida || ''} -> ${almDe(destAlm)?.clave}${destUbi ? '/' + ubiDe(destUbi)?.clave : ''}`)
      setHistorial(h => [{ ref: cont ? cont.folio : lote.codigo_lote, art: art?.codigo_interno, cant: cantidad, um: art?.unidad_medida, destino: `${almDe(destAlm)?.clave}${destUbi ? '/' + ubiDe(destUbi)?.clave : ''}` }, ...h].slice(0, 15))
      setEscaneo('')
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
    escaneoRef.current?.focus()
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Traspaso por Escaneo</h2>
      <p style={styles.ayuda}>Elige el <b>almacen destino</b>, escanea o teclea la <b>ubicacion</b>, y luego escanea la caja/tarima (o teclea el lote): se <b>transfiere de inmediato</b>. No mueve material retenido ni a la misma ubicacion; valida el flujo de los fabricados.</p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.panel}>
        <div style={styles.fila}>
          <div style={{ ...styles.campo, flex: 1.2 }}>
            <label style={styles.label}>1. Almacen destino *</label>
            <select style={styles.input} value={destAlmacen} onChange={e => { setDestAlmacen(e.target.value); setDestUbicacion('') }}>
              <option value="">Selecciona...</option>
              {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
            </select>
          </div>
          <div style={{ ...styles.campo, flex: 1 }}>
            <label style={styles.label}>2. Ubicacion (escanea o elige)</label>
            <input style={styles.input} value={destUbicacion} onChange={e => setDestUbicacion(e.target.value)}
              disabled={!destAlmacen} placeholder="Escanea/teclea la ubicacion" list="ubis-destino" />
            <datalist id="ubis-destino">
              {ubisDest().map(u => <option key={u.id} value={u.clave}>{u.clave}{u.es_cuarentena ? ' (cuarentena)' : ''}</option>)}
            </datalist>
          </div>
        </div>
        <div style={{ ...styles.campo, marginTop: '6px' }}>
          <label style={styles.label}>3. Escanea la caja / tarima / lote</label>
          <input ref={escaneoRef} style={{ ...styles.input, fontSize: '16px' }} value={escaneo} disabled={!destAlmacen || !puedeMover || procesando}
            placeholder={destAlmacen ? 'Escanea el QR y se transfiere solo' : 'Primero elige el destino'}
            onChange={e => setEscaneo(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') transferir(escaneo) }} autoFocus />
        </div>
      </div>

      {historial.length > 0 && (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Escaneado</span>
            <span style={{ flex: 1.6 }}>Articulo</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span>
            <span style={{ flex: 1.4 }}>Destino</span>
          </div>
          {historial.map((h, i) => (
            <div key={i} style={{ ...styles.tablaFila, fontSize: '13px' }}>
              <span style={{ flex: 1, fontWeight: '600' }}>{h.ref}</span>
              <span style={{ flex: 1.6 }}>{h.art}</span>
              <span style={{ flex: 1, textAlign: 'right', fontWeight: '600' }}>{fmtNum(h.cant)} {h.um}</span>
              <span style={{ flex: 1.4, color: '#16a34a' }}>{h.destino}</span>
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
  panel: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', marginBottom: '16px' },
  fila: { display: 'flex', gap: '16px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff', boxSizing: 'border-box' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '10px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  error: { color: '#dc2626', fontSize: '14px', marginBottom: '12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '7px', padding: '10px 14px', fontWeight: '500' },
  exito: { color: '#16a34a', fontSize: '14px', marginBottom: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '7px', padding: '10px 14px', fontWeight: '500' },
}
