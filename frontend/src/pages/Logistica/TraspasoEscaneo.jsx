import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import EscanerCamara from '../../components/EscanerCamara'
import { etiquetaRol } from '../../lib/roles'
import { folioContenedor } from '../../lib/contenedores'
import { datosEtiqueta } from '../../lib/etiquetas'
import EtiquetaProducto from '../../components/EtiquetaProducto'
import PortalImpresion from '../../components/PortalImpresion'
import { imprimirAislado } from '../../lib/impresion'

// Traspaso rapido por escaneo:
//   1) Almacen destino  2) Ubicacion (escanea/teclea)  3) Escanea caja/tarima/lote
//   -> muestra la info y pide CONFIRMAR CANTIDAD (editable para surtidos parciales)
//   -> al confirmar transfiere y guarda el movimiento.
// Reglas: no mueve a la misma ubicacion; no mueve retenido/rechazado; respeta el
// tipo de mercancia que acepta el almacen destino; valida el flujo de fabricados.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')

export default function TraspasoEscaneo() {
  const { perfil, tienePermiso } = useAuth()
  const puedeMover = tienePermiso('log_movimiento', 'crear')

  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [pasos, setPasos] = useState([])
  const [almacenTipos, setAlmacenTipos] = useState([])
  const [tiposAlmacen, setTiposAlmacen] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [procesando, setProcesando] = useState(false)

  const [destAlmacen, setDestAlmacen] = useState('')
  const [destUbicacion, setDestUbicacion] = useState('')
  const [escaneo, setEscaneo] = useState('')
  const [pendiente, setPendiente] = useState(null)  // item por confirmar
  const [historial, setHistorial] = useState([])
  const [empresa, setEmpresa] = useState(null)
  const [cfgEt, setCfgEt] = useState(null)
  const [artCliente, setArtCliente] = useState([])
  const [clientes, setClientes] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [artProv, setArtProv] = useState([])
  const [bom, setBom] = useState([])
  const [etiquetaNueva, setEtiquetaNueva] = useState(null)
  const escaneoRef = useRef(null)
  const cantRef = useRef(null)

  useEffect(() => { cargarCatalogos() }, [])

  const cargarCatalogos = async () => {
    setLoading(true)
    const [a, al, ub, ps, at, ta, emp, cfg, ac, cli, pv, ap, bm] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, flujo_id, origen, es_consigna').eq('empresa_id', perfil.empresa_id),
      supabase.from('almacenes').select('*').eq('activo', true).order('clave'),
      supabase.from('ubicaciones').select('*').eq('activo', true).order('clave'),
      supabase.from('flujo_pasos').select('*').order('secuencia'),
      supabase.from('almacen_tipos').select('*'),
      supabase.from('tipos_almacen').select('*'),
      supabase.from('empresas').select('*').eq('id', perfil.empresa_id).maybeSingle(),
      supabase.from('config_etiquetas').select('*').eq('empresa_id', perfil.empresa_id).maybeSingle(),
      supabase.from('articulo_cliente').select('*').eq('activo', true),
      supabase.from('clientes').select('id, nombre'),
      supabase.from('proveedores').select('id, nombre'),
      supabase.from('articulo_proveedor').select('articulo_id, proveedor_id').eq('activo', true),
      supabase.from('bom').select('componente_articulo_id'),
    ])
    setArticulos(a.data || []); setAlmacenes(al.data || []); setUbicaciones(ub.data || []); setPasos(ps.data || [])
    setAlmacenTipos(at.data || []); setTiposAlmacen(ta.data || [])
    setEmpresa(emp.data || null); setCfgEt(cfg.data || null); setArtCliente(ac.data || []); setClientes(cli.data || [])
    setProveedores(pv.data || []); setArtProv(ap.data || []); setBom(bm.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)
  const pasosDeArt = (artId) => { const a = artDe(artId); return a?.flujo_id ? pasos.filter(p => p.flujo_id === a.flujo_id) : [] }
  const ubisDest = () => ubicaciones.filter(u => u.almacen_id === Number(destAlmacen))

  const tiposDeAlmacen = (almId) => almacenTipos.filter(x => x.almacen_id === almId)
    .map(x => tiposAlmacen.find(t => t.id === x.tipo_id)?.nombre).filter(Boolean)

  // El almacen destino acepta el tipo de mercancia del articulo?
  const almacenAcepta = (art, almId) => {
    const nombres = tiposDeAlmacen(almId).map(n => n.toLowerCase())
    if (nombres.length === 0) return { ok: true }  // sin tipos configurados = acepta todo
    const esFab = art.origen === 'fabricado'
    const ok = esFab
      ? nombres.some(n => n.includes('terminado') || n === 'pt' || n.includes('wip'))
      : nombres.some(n => n.includes('materia') || n === 'mp' || n.includes('empaque') || n.includes('component') || n.includes('refacc') || n.includes('mro') || n.includes('consigna') || n.includes('herramental'))
    return { ok, tipos: tiposDeAlmacen(almId), familia: esFab ? 'producto fabricado (PT/WIP)' : (art.es_consigna ? 'consigna' : 'comprado (MP)') }
  }

  const resolverUbicacionDestino = () => {
    if (!destUbicacion) return { id: null }
    const porId = ubicaciones.find(u => String(u.id) === String(destUbicacion) && u.almacen_id === Number(destAlmacen))
    if (porId) return { id: porId.id }
    const porClave = ubicaciones.find(u => u.clave.toLowerCase() === String(destUbicacion).trim().toLowerCase() && u.almacen_id === Number(destAlmacen))
    if (porClave) return { id: porClave.id }
    return { id: null, invalida: true }
  }

  const validarFlujo = async (articuloId, loteId, almacenOrigen, destAlm) => {
    const art = artDe(articuloId)
    if (!art?.flujo_id) return { ok: true }
    const ps = pasosDeArt(articuloId)
    const idx = ps.findIndex(p => p.almacen_id === almacenOrigen)
    if (idx < 0) return { ok: false, motivo: `El material esta en un almacen fuera del flujo (${ps.map(p => almDe(p.almacen_id)?.clave).join(' -> ')}).` }
    const actual = ps[idx]; const siguiente = ps[idx + 1]
    if (actual.requiere_liberacion) {
      const { data: fir } = await supabase.from('lote_firmas').select('id').eq('lote_id', loteId).eq('paso_id', actual.id).maybeSingle()
      if (!fir) return { ok: false, motivo: `Requiere firma de ${etiquetaRol(actual.rol_libera || 'calidad')} antes de salir de ${almDe(actual.almacen_id)?.clave}.` }
    }
    if (!siguiente) return { ok: false, motivo: 'Es el ultimo paso del flujo (solo se embarca).' }
    if (destAlm !== siguiente.almacen_id) return { ok: false, motivo: `El siguiente paso es ${almDe(siguiente.almacen_id)?.clave}. Cambia el almacen destino a ese.` }
    return { ok: true }
  }

  // Paso 1: al escanear, resolver + validar y dejar el item pendiente de confirmar cantidad
  const escanear = async (valor) => {
    setError(''); setExito('')
    const v = (valor || '').trim()
    if (!v) return
    if (!destAlmacen) { setError('Primero elige el almacen destino'); return }
    const ud = resolverUbicacionDestino()
    if (destUbicacion && ud.invalida) { setError(`La ubicacion "${destUbicacion}" no existe en ese almacen`); return }
    const destAlm = Number(destAlmacen); const destUbi = ud.id

    setProcesando(true)
    try {
      // Resolver caja/tarima o lote
      let cont = null, lote = null, cajasIds = [], esCaja = false
      const { data: contData } = await supabase.from('contenedores').select('*').eq('empresa_id', perfil.empresa_id).eq('estatus', 'activo').ilike('folio', v).maybeSingle()
      if (contData && !contData.padre_id) {
        cont = contData; esCaja = true
        const { data: l } = await supabase.from('lotes').select('*').eq('id', cont.lote_id).maybeSingle(); lote = l
        if (cont.tipo === 'tarima') { const { data: h } = await supabase.from('contenedores').select('id').eq('padre_id', cont.id); cajasIds = (h || []).map(x => x.id) }
        cajasIds = [cont.id, ...cajasIds]
      } else {
        const { data: l } = await supabase.from('lotes').select('*').ilike('codigo_lote', v).maybeSingle(); if (l) lote = l
      }
      if (!lote) { setError(`No se encontro la caja, tarima o lote "${v}"`); setProcesando(false); return }
      const art = artDe(lote.articulo_id)

      // Retenido / rechazado
      if (lote.estatus_calidad !== 'liberado') { setError(`${art?.codigo_interno} lote ${lote.codigo_lote}: esta ${lote.estatus_calidad.toUpperCase()}. Debe liberarse por Calidad antes de traspasar.`); setProcesando(false); return }

      // Ubicacion origen y cantidad
      let almOrigen, ubiOrigen, maxCant
      if (cont) { almOrigen = cont.almacen_id; ubiOrigen = cont.ubicacion_id; maxCant = Number(cont.cantidad) }
      else {
        const { data: exs } = await supabase.from('existencias').select('*').eq('lote_id', lote.id).gt('cantidad', 0)
        if (!exs || exs.length === 0) { setError(`El lote ${lote.codigo_lote} no tiene existencia`); setProcesando(false); return }
        if (exs.length > 1) { setError(`El lote ${lote.codigo_lote} esta en varias ubicaciones; escanea la caja especifica`); setProcesando(false); return }
        almOrigen = exs[0].almacen_id; ubiOrigen = exs[0].ubicacion_id; maxCant = Number(exs[0].cantidad)
      }

      // Misma ubicacion
      if (almOrigen === destAlm && (ubiOrigen || null) === (destUbi || null)) { setError(`${art?.codigo_interno}: ya esta en ${almDe(destAlm)?.clave}${destUbi ? '/' + ubiDe(destUbi)?.clave : ''}. No se puede mover a la misma ubicacion.`); setProcesando(false); return }

      // Tipo de mercancia del almacen destino
      const acc = almacenAcepta(art, destAlm)
      if (!acc.ok) { setError(`${almDe(destAlm)?.clave} solo recibe: ${acc.tipos.join(', ')}. Este material es ${acc.familia} y no puede ir a ese almacen.`); setProcesando(false); return }

      // Flujo (fabricados)
      const val = await validarFlujo(lote.articulo_id, lote.id, almOrigen, destAlm)
      if (!val.ok) { setError(`${art?.codigo_interno} lote ${lote.codigo_lote}: ${val.motivo}`); setProcesando(false); return }

      // Todo OK -> pendiente de confirmar cantidad
      setPendiente({
        cont, esCaja, cajasIds, lote, art, almOrigen, ubiOrigen, destAlm, destUbi,
        maxCant, cantidad: String(maxCant),
      })
      setEscaneo('')
      setTimeout(() => cantRef.current?.select(), 50)
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  // Paso 2: confirmar y aplicar la transferencia (cantidad ya validada)
  const confirmar = async () => {
    const p = pendiente
    const cant = Number(p.cantidad)
    setError('')
    if (!(cant > 0)) { setError('La cantidad debe ser mayor a 0'); return }
    if (cant > p.maxCant + 0.000001) { setError(`Maximo disponible: ${fmtNum(p.maxCant)}`); return }
    setProcesando(true)
    try {
      // Existencia origen fresca
      const { data: exList } = await supabase.from('existencias').select('*').eq('lote_id', p.lote.id).eq('almacen_id', p.almOrigen)
      const exO = (exList || []).find(e => (e.ubicacion_id || null) === (p.ubiOrigen || null))
      if (!exO || Number(exO.cantidad) < cant - 0.000001) { setError(`La existencia en origen (${exO ? fmtNum(exO.cantidad) : 0}) no cubre ${fmtNum(cant)}.`); setProcesando(false); return }
      const nuevaO = Number(exO.cantidad) - cant
      if (nuevaO <= 0.000001) await supabase.from('existencias').delete().eq('id', exO.id)
      else await supabase.from('existencias').update({ cantidad: nuevaO }).eq('id', exO.id)

      const { data: dList } = await supabase.from('existencias').select('*').eq('lote_id', p.lote.id).eq('almacen_id', p.destAlm)
      const exD = (dList || []).find(e => (e.ubicacion_id || null) === (p.destUbi || null))
      if (exD) await supabase.from('existencias').update({ cantidad: Number(exD.cantidad) + cant }).eq('id', exD.id)
      else await supabase.from('existencias').insert({ lote_id: p.lote.id, almacen_id: p.destAlm, ubicacion_id: p.destUbi, cantidad: cant })

      // Contenedores y etiqueta
      const movioTodo = Math.abs(cant - p.maxCant) < 0.000001
      let cajaNueva = null
      if (movioTodo && p.cajasIds.length) {
        // Se movio completo: la(s) caja(s) viajan al destino con su etiqueta original
        await supabase.from('contenedores').update({ almacen_id: p.destAlm, ubicacion_id: p.destUbi }).in('id', p.cajasIds)
      } else if (!movioTodo) {
        // Parcial: se genera una CAJA NUEVA con la cantidad transferida (nueva etiqueta)
        if (p.esCaja && p.cont) {
          // La caja de origen se queda con el remanente
          await supabase.from('contenedores').update({ cantidad: Number(p.cont.cantidad) - cant }).eq('id', p.cont.id)
        }
        const folio = await folioContenedor(supabase, perfil.empresa_id, 'caja')
        const { data: nc } = await supabase.from('contenedores').insert({
          empresa_id: perfil.empresa_id, folio, tipo: 'caja', articulo_id: p.lote.articulo_id, lote_id: p.lote.id,
          cantidad: cant, almacen_id: p.destAlm, ubicacion_id: p.destUbi, origen: `Parcial de ${p.cont ? p.cont.folio : p.lote.codigo_lote}`, creado_por: perfil.id,
        }).select().single()
        cajaNueva = nc
      }

      await supabase.from('movimientos').insert({
        empresa_id: perfil.empresa_id, articulo_id: p.lote.articulo_id, lote_id: p.lote.id, tipo: 'traspaso',
        almacen_origen_id: p.almOrigen, ubicacion_origen_id: p.ubiOrigen, almacen_destino_id: p.destAlm, ubicacion_destino_id: p.destUbi,
        cantidad: cant, motivo: `Traspaso por escaneo (${p.cont ? p.cont.folio : p.lote.codigo_lote})`, usuario_id: perfil.id,
      })

      setExito(`${p.cont ? p.cont.folio : p.lote.codigo_lote} - ${p.art?.codigo_interno}: ${fmtNum(cant)} ${p.art?.unidad_medida || ''} -> ${almDe(p.destAlm)?.clave}${p.destUbi ? '/' + ubiDe(p.destUbi)?.clave : ''}${cajaNueva ? `. Nueva caja ${cajaNueva.folio}` : ''}`)
      setHistorial(h => [{ ref: cajaNueva ? cajaNueva.folio : (p.cont ? p.cont.folio : p.lote.codigo_lote), lote: p.lote.codigo_lote, art: p.art?.codigo_interno, cant, um: p.art?.unidad_medida, destino: `${almDe(p.destAlm)?.clave}${p.destUbi ? '/' + ubiDe(p.destUbi)?.clave : ''}` }, ...h].slice(0, 15))
      setPendiente(null)
      // Etiqueta de la caja nueva (parcial)
      if (cajaNueva) {
        const rel = artCliente.find(x => x.articulo_id === p.lote.articulo_id)
        const cli = rel ? clientes.find(c => c.id === rel.cliente_id) : null
        const relP = artProv.find(x => x.articulo_id === p.lote.articulo_id)
        const prov = relP ? proveedores.find(v => v.id === relP.proveedor_id) : null
        setEtiquetaNueva(datosEtiqueta({
          lote: p.lote, articulo: p.art, empresa, cliente: cli || (prov ? { nombre: prov.nombre } : null),
          codigoCliente: rel?.codigo_cliente || p.art?.codigo_interno, maquina: null, cantidad: cant, bom,
          contenedor: cajaNueva, qrContenido: cfgEt?.qr_contenido || 'contenedor',
        }))
      }
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
    escaneoRef.current?.focus()
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // Etiqueta de la caja nueva generada por un traspaso parcial
  if (etiquetaNueva) {
    return (
      <div style={styles.container} className="aparecer">
        <style>{`@media print { @page { size: ${cfgEt?.ancho_in || 4}in ${cfgEt?.alto_in || 2}in; margin: 0; } }`}</style>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }} className="no-imprimir">
          <button style={styles.botonSec} onClick={() => { setEtiquetaNueva(null); escaneoRef.current?.focus() }}>Continuar sin imprimir</button>
          <button style={styles.boton} onClick={imprimirAislado}>Imprimir etiqueta de la caja nueva</button>
        </div>
        <p style={{ ...styles.ayuda }} className="no-imprimir">Se genero una <b>caja nueva</b> ({etiquetaNueva.folio}) para la cantidad transferida. Imprime su etiqueta y pegala a ese material.</p>
        <EtiquetaProducto datos={etiquetaNueva} config={cfgEt} />
        <PortalImpresion><EtiquetaProducto datos={etiquetaNueva} config={cfgEt} /></PortalImpresion>
      </div>
    )
  }

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Traspaso por Escaneo</h2>
      <p style={styles.ayuda}>Elige almacen y ubicacion destino, escanea la caja/tarima (o teclea el lote) y <b>confirma la cantidad</b> (puedes surtir parcial). Bloquea material retenido, mismo lugar, y valida el tipo de mercancia del almacen y el flujo de fabricados.</p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.panel}>
        <div style={styles.fila}>
          <div style={{ ...styles.campo, flex: 1.2 }}>
            <label style={styles.label}>1. Almacen destino *</label>
            <select style={styles.input} value={destAlmacen} onChange={e => { setDestAlmacen(e.target.value); setDestUbicacion(''); setPendiente(null) }}>
              <option value="">Selecciona...</option>
              {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
            </select>
            {destAlmacen && <span style={{ fontSize: '11px', color: '#64748b', marginTop: '2px' }}>Acepta: {tiposDeAlmacen(Number(destAlmacen)).join(', ') || 'cualquier tipo'}</span>}
          </div>
          <div style={{ ...styles.campo, flex: 1 }}>
            <label style={styles.label}>2. Ubicacion (escanea o elige)</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              <input style={{ ...styles.input, flex: 1 }} value={destUbicacion} onChange={e => setDestUbicacion(e.target.value)} disabled={!destAlmacen} placeholder="Escanea/teclea la ubicacion" list="ubis-destino" />
              <EscanerCamara onScan={t => setDestUbicacion(t)} />
            </div>
            <datalist id="ubis-destino">{ubisDest().map(u => <option key={u.id} value={u.clave}>{u.clave}{u.es_cuarentena ? ' (cuarentena)' : ''}</option>)}</datalist>
          </div>
        </div>
        <div style={{ ...styles.campo, marginTop: '6px' }}>
          <label style={styles.label}>3. Escanea la caja / tarima / lote</label>
          <div style={{ display: 'flex', gap: '10px' }}>
            <input ref={escaneoRef} style={{ ...styles.input, fontSize: '16px', flex: 1 }} value={escaneo} disabled={!destAlmacen || !puedeMover || procesando || !!pendiente}
              placeholder={destAlmacen ? 'Escanea el QR' : 'Primero elige el destino'}
              onChange={e => setEscaneo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') escanear(escaneo) }} autoFocus />
            <EscanerCamara onScan={t => { setEscaneo(t); escanear(t) }} />
          </div>
        </div>
      </div>

      {/* Confirmar cantidad */}
      {pendiente && (
        <div style={styles.confirmar}>
          <div style={{ fontSize: '13px', color: '#0369a1', fontWeight: '600', marginBottom: '8px' }}>Favor de confirmar la cantidad a transferir</div>
          <div style={styles.gridInfo}>
            <div><b>Escaneado:</b> {pendiente.cont ? pendiente.cont.folio : pendiente.lote.codigo_lote}{pendiente.esCaja && <span style={{ color: '#64748b' }}> (caja)</span>}</div>
            <div><b>Lote:</b> {pendiente.lote.codigo_lote}</div>
            <div><b>Articulo:</b> {pendiente.art?.codigo_interno}</div>
            <div><b>Descripcion:</b> {pendiente.art?.descripcion}</div>
            <div><b>Origen:</b> {almDe(pendiente.almOrigen)?.clave}{pendiente.ubiOrigen ? '/' + ubiDe(pendiente.ubiOrigen)?.clave : ''}</div>
            <div><b>Destino:</b> {almDe(pendiente.destAlm)?.clave}{pendiente.destUbi ? '/' + ubiDe(pendiente.destUbi)?.clave : ''}</div>
          </div>
          <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginTop: '10px' }}>
            <div style={{ ...styles.campo, width: '160px' }}>
              <label style={styles.label}>Cantidad (max {fmtNum(pendiente.maxCant)})</label>
              <input ref={cantRef} type="number" min="0" max={pendiente.maxCant} step="0.001" style={{ ...styles.input, fontSize: '16px', fontWeight: '600' }}
                value={pendiente.cantidad} onChange={e => setPendiente({ ...pendiente, cantidad: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') confirmar() }} />
            </div>
            <button style={styles.botonSec} onClick={() => { setPendiente(null); escaneoRef.current?.focus() }} disabled={procesando}>Cancelar</button>
            <button style={styles.boton} onClick={confirmar} disabled={procesando}>{procesando ? 'Transfiriendo...' : 'Confirmar traspaso'}</button>
          </div>
        </div>
      )}

      {historial.length > 0 && (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 1 }}>Escaneado</span>
            <span style={{ flex: 1 }}>Lote</span>
            <span style={{ flex: 1.4 }}>Articulo</span>
            <span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span>
            <span style={{ flex: 1.3 }}>Destino</span>
          </div>
          {historial.map((h, i) => (
            <div key={i} style={{ ...styles.tablaFila, fontSize: '13px' }}>
              <span style={{ flex: 1, fontWeight: '600' }}>{h.ref}</span>
              <span style={{ flex: 1, color: '#64748b' }}>{h.lote}</span>
              <span style={{ flex: 1.4 }}>{h.art}</span>
              <span style={{ flex: 1, textAlign: 'right', fontWeight: '600' }}>{fmtNum(h.cant)} {h.um}</span>
              <span style={{ flex: 1.3, color: '#16a34a' }}>{h.destino}</span>
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
  confirmar: { backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '10px', padding: '16px 20px', marginBottom: '16px' },
  gridInfo: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px', fontSize: '13px', color: '#334155' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '10px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  error: { color: '#dc2626', fontSize: '14px', marginBottom: '12px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', borderRadius: '7px', padding: '10px 14px', fontWeight: '500' },
  exito: { color: '#16a34a', fontSize: '14px', marginBottom: '12px', backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '7px', padding: '10px 14px', fontWeight: '500' },
}
