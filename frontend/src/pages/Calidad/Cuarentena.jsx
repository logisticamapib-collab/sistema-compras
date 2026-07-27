import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Cuarentena por CAJA (cada caja = su lote). Al ENVIAR se exige CAUSA y el material
// se mueve a la UBICACION VIRTUAL de cuarentena (configurable por empresa). La SALIDA
// se registra como DISPOSICION firmada (liberar / retrabajo / scrap) que requiere
// autorizacion: Gerente de Calidad (todas) y ademas Gerente de Planta (solo scrap).
// La liberacion puede ser PARCIAL: se captura la cantidad y, para PT/WIP (fabricado),
// debe respetar la SNP (multiplos de piezas por caja) para no dejar cajas incompletas;
// si es parcial se divide en un LOTE HIJO de cajas completas.

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const esRolCalidad = (r) => ['gerente_calidad', 'admin'].includes(r)
const esRolPlanta = (r) => ['gerente_planta', 'admin'].includes(r)

export default function Cuarentena() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEnviar = tienePermiso('cal_cuarentena', 'crear')
  const puedeSalir = tienePermiso('cal_cuarentena', 'editar')
  const puedeConfig = tienePermiso('cal_cuarentena', 'editar')

  const [lotes, setLotes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [eventos, setEventos] = useState([])
  const [salidas, setSalidas] = useState([])
  const [causas, setCausas] = useState([])
  const [articulos, setArticulos] = useState([])
  const [normas, setNormas] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [param, setParam] = useState(null)
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [vista, setVista] = useState('cuarentena')
  const [envForm, setEnvForm] = useState(null)
  const [dispForm, setDispForm] = useState(null)
  const [cfgForm, setCfgForm] = useState({ almacen_id: '', ubicacion_id: '' })

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const [lo, ex, ev, sa, ca, ar, no, al, ub, us, pa] = await Promise.all([
      supabase.from('lotes').select('*, articulo:articulos(codigo_interno, descripcion, origen)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('existencias').select('*'),
      supabase.from('cuarentena_eventos').select('*, envio:usuarios!cuarentena_eventos_enviado_por_fkey(nombre)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('cuarentena_salidas').select('*').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('causas_scrap').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true),
      supabase.from('articulos').select('id, codigo_interno, descripcion, origen').eq('empresa_id', emp),
      supabase.from('normas_empaque').select('articulo_id, piezas_por_empaque, activa').eq('activa', true),
      supabase.from('almacenes').select('*').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('ubicaciones').select('*').eq('activo', true).order('clave'),
      supabase.from('usuarios').select('id, nombre'),
      supabase.from('cuarentena_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
    ])
    setLotes(lo.data || []); setExistencias(ex.data || []); setEventos(ev.data || []); setSalidas(sa.data || [])
    setCausas(ca.data || []); setArticulos(ar.data || []); setNormas(no.data || [])
    setAlmacenes(al.data || []); setUbicaciones(ub.data || []); setUsuarios(us.data || [])
    setParam(pa.data || null)
    if (pa.data) setCfgForm({ almacen_id: pa.data.almacen_id || '', ubicacion_id: pa.data.ubicacion_id || '' })
    setLoading(false)
  }

  const totalDe = (loteId) => existencias.filter(e => e.lote_id === loteId).reduce((s, e) => s + Number(e.cantidad), 0)
  const eventoActivo = (loteId) => eventos.find(e => e.lote_id === loteId && ['en_cuarentena', 'parcial'].includes(e.estatus))
  const snpDe = (artId) => { const n = normas.find(x => x.articulo_id === artId); return n ? Number(n.piezas_por_empaque) || 0 : 0 }
  const nombreUsr = (id) => usuarios.find(u => u.id === id)?.nombre || '-'
  const almDe = (id) => almacenes.find(a => a.id === id)
  const ubiDe = (id) => ubicaciones.find(u => u.id === id)

  // ---------- ENVIAR A CUARENTENA ----------
  const enviar = async () => {
    setError('')
    const f = envForm
    if (!param || !param.almacen_id || !param.ubicacion_id) { setError('Primero configura la ubicacion virtual de cuarentena (pestana Configuracion).'); return }
    if (!f.causa || !f.causa.trim()) { setError('La causa es obligatoria para enviar a cuarentena.'); return }
    setProc(true)
    try {
      const exs = existencias.filter(x => x.lote_id === f.lote.id && Number(x.cantidad) > 0)
      if (exs.length === 0) { setError('La caja no tiene existencia.'); setProc(false); return }
      const total = exs.reduce((s, e) => s + Number(e.cantidad), 0)
      const origen = { alm: exs[0].almacen_id, ubi: exs[0].ubicacion_id || null }
      // mover a la ubicacion virtual: consolidar en una sola existencia
      for (const e of exs) await supabase.from('existencias').delete().eq('id', e.id)
      await supabase.from('existencias').insert({ lote_id: f.lote.id, almacen_id: param.almacen_id, ubicacion_id: param.ubicacion_id, cantidad: total })
      await supabase.from('contenedores').update({ almacen_id: param.almacen_id, ubicacion_id: param.ubicacion_id }).eq('lote_id', f.lote.id)
      await supabase.from('movimientos').insert({ empresa_id: emp, articulo_id: f.lote.articulo_id, lote_id: f.lote.id, tipo: 'cuarentena', almacen_origen_id: origen.alm, ubicacion_origen_id: origen.ubi, almacen_destino_id: param.almacen_id, ubicacion_destino_id: param.ubicacion_id, cantidad: total, motivo: `Cuarentena: ${f.causa.trim()}`, usuario_id: perfil.id })
      await supabase.from('lotes').update({ estatus_calidad: 'cuarentena' }).eq('id', f.lote.id)
      await supabase.from('cuarentena_eventos').insert({ empresa_id: emp, lote_id: f.lote.id, articulo_id: f.lote.articulo_id, cantidad: total, causa: f.causa.trim(), causa_id: f.causa_id ? Number(f.causa_id) : null, snp: snpDe(f.lote.articulo_id), origen_almacen_id: origen.alm, origen_ubicacion_id: origen.ubi, enviado_por: perfil.id })
      setExito(`Caja ${f.lote.codigo_lote} enviada a cuarentena (ubicacion ${ubiDe(param.ubicacion_id)?.clave || ''}).`); setEnvForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  // ---------- CREAR DISPOSICION (SALIDA) ----------
  const crearDisposicion = async () => {
    setError('')
    const f = dispForm
    const ev = f.evento
    const cant = Number(f.cantidad)
    const rem = Number(ev.cantidad)
    if (!f.disposicion) { setError('Elige la disposicion.'); return }
    if (!(cant > 0) || cant > rem) { setError(`Cantidad invalida. Disponible en cuarentena: ${fmt(rem)}.`); return }
    if (!f.nota || !f.nota.trim()) { setError('Escribe la nota / dictamen.'); return }
    // Regla SNP para fabricados (PT/WIP): no dejar cajas incompletas
    const esFab = f.art?.origen === 'fabricado'
    const snp = Number(ev.snp) || 0
    if (esFab && snp > 0 && cant !== rem) {
      if (cant % snp !== 0 || (rem - cant) % snp !== 0) {
        setError(`Articulo PT/WIP: para no dejar cajas incompletas, la cantidad debe completar cajas de ${fmt(snp)} pzas (o disponer la caja completa: ${fmt(rem)}).`); return
      }
    }
    setProc(true)
    try {
      const requierePlanta = f.disposicion === 'scrap'
      const row = {
        empresa_id: emp, evento_id: ev.id, lote_id: ev.lote_id, articulo_id: ev.articulo_id,
        disposicion: f.disposicion, cantidad: cant, nota: f.nota.trim(), requiere_planta: requierePlanta,
        solicitado_por: perfil.id, estatus: 'pendiente',
      }
      // autofirma segun rol del usuario actual
      const now = new Date().toISOString()
      if (esRolCalidad(perfil.rol)) { row.auth_calidad_por = perfil.id; row.auth_calidad_at = now }
      if (requierePlanta && esRolPlanta(perfil.rol)) { row.auth_planta_por = perfil.id; row.auth_planta_at = now }
      const { data: ins, error: e1 } = await supabase.from('cuarentena_salidas').insert(row).select().single()
      if (e1) throw e1
      const completa = ins.auth_calidad_at && (!requierePlanta || ins.auth_planta_at)
      if (completa) { await aplicarSalida(ins) }
      setExito(completa ? 'Disposicion autorizada y aplicada.' : 'Disposicion registrada. Queda pendiente de autorizacion.')
      setDispForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  // ---------- AUTORIZAR ----------
  const autorizar = async (salida, area) => {
    setError(''); setProc(true)
    try {
      const now = new Date().toISOString()
      const patch = area === 'calidad' ? { auth_calidad_por: perfil.id, auth_calidad_at: now } : { auth_planta_por: perfil.id, auth_planta_at: now }
      const { data: upd } = await supabase.from('cuarentena_salidas').update(patch).eq('id', salida.id).select().single()
      const completa = upd.auth_calidad_at && (!upd.requiere_planta || upd.auth_planta_at)
      if (completa) await aplicarSalida(upd)
      setExito(completa ? 'Autorizada y aplicada.' : 'Autorizacion registrada. Falta otra firma.')
      await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  // ---------- APLICAR (mueve inventario) ----------
  const aplicarSalida = async (salida) => {
    const { data: ev } = await supabase.from('cuarentena_eventos').select('*').eq('id', salida.evento_id).single()
    const { data: parent } = await supabase.from('lotes').select('*').eq('id', ev.lote_id).single()
    // existencia en la ubicacion virtual
    const { data: exs } = await supabase.from('existencias').select('*').eq('lote_id', ev.lote_id)
    const virtualRow = (exs || []).find(x => x.almacen_id === param.almacen_id) || (exs || [])[0]
    const cant = Number(salida.cantidad)
    const rem = Number(ev.cantidad)
    const esTodo = cant >= rem
    const origAlm = ev.origen_almacen_id || null
    const origUbi = ev.origen_ubicacion_id || null
    let loteHijo = null

    const estatusDestino = salida.disposicion === 'liberar' ? 'liberado' : salida.disposicion === 'retrabajo' ? 'retenido' : 'scrap'
    const tipoMov = salida.disposicion === 'liberar' ? 'liberacion_calidad' : salida.disposicion === 'retrabajo' ? 'retrabajo' : 'scrap'

    if (esTodo) {
      // Se dispone TODO lo que queda en cuarentena: el lote actual conserva su codigo y solo cambia de estatus
      if (salida.disposicion === 'scrap') {
        if (virtualRow) await supabase.from('existencias').delete().eq('id', virtualRow.id)
        await supabase.from('movimientos').insert({ empresa_id: emp, articulo_id: ev.articulo_id, lote_id: ev.lote_id, tipo: 'scrap', almacen_origen_id: param.almacen_id, ubicacion_origen_id: param.ubicacion_id, cantidad: cant, motivo: `Scrap desde cuarentena: ${salida.nota}`, usuario_id: perfil.id })
      } else {
        if (virtualRow) await supabase.from('existencias').update({ almacen_id: origAlm, ubicacion_id: origUbi }).eq('id', virtualRow.id)
        await supabase.from('contenedores').update({ almacen_id: origAlm, ubicacion_id: origUbi }).eq('lote_id', ev.lote_id)
        await supabase.from('movimientos').insert({ empresa_id: emp, articulo_id: ev.articulo_id, lote_id: ev.lote_id, tipo: tipoMov, almacen_origen_id: param.almacen_id, ubicacion_origen_id: param.ubicacion_id, almacen_destino_id: origAlm, ubicacion_destino_id: origUbi, cantidad: cant, motivo: `${salida.disposicion} desde cuarentena: ${salida.nota}`, usuario_id: perfil.id })
      }
      await supabase.from('lotes').update({ estatus_calidad: estatusDestino, ...(salida.disposicion === 'liberar' ? { liberado_por: perfil.id, liberado_en: new Date().toISOString() } : {}) }).eq('id', ev.lote_id)
    } else {
      // PARCIAL: lo dispuesto (cant) CONSERVA el lote original; el REMANENTE que sigue en
      // cuarentena se separa en un lote hijo con sufijo, en la misma ubicacion virtual.
      const remnant = rem - cant
      const childCode = `${parent.codigo_lote}-R${String(Date.now()).slice(-4)}`
      const { data: hijo } = await supabase.from('lotes').insert({ empresa_id: emp, articulo_id: ev.articulo_id, codigo_lote: childCode, origen: parent.origen, estatus_calidad: 'cuarentena', lote_padre_id: parent.id, fecha: new Date().toISOString().slice(0, 10), creado_por: perfil.id }).select().single()
      loteHijo = hijo?.id || null
      // el lote original se queda con 'cant'; el remanente pasa al lote hijo (ubicacion virtual)
      if (virtualRow) await supabase.from('existencias').update({ cantidad: cant }).eq('id', virtualRow.id)
      if (loteHijo) await supabase.from('existencias').insert({ lote_id: loteHijo, almacen_id: param.almacen_id, ubicacion_id: param.ubicacion_id, cantidad: remnant })
      // disponer del lote original (conserva su codigo)
      if (salida.disposicion === 'scrap') {
        if (virtualRow) await supabase.from('existencias').delete().eq('id', virtualRow.id)
        await supabase.from('movimientos').insert({ empresa_id: emp, articulo_id: ev.articulo_id, lote_id: ev.lote_id, tipo: 'scrap', almacen_origen_id: param.almacen_id, ubicacion_origen_id: param.ubicacion_id, cantidad: cant, motivo: `Scrap desde cuarentena: ${salida.nota}`, usuario_id: perfil.id })
      } else {
        if (virtualRow) await supabase.from('existencias').update({ almacen_id: origAlm, ubicacion_id: origUbi }).eq('id', virtualRow.id)
        await supabase.from('contenedores').update({ almacen_id: origAlm, ubicacion_id: origUbi }).eq('lote_id', ev.lote_id)
        await supabase.from('movimientos').insert({ empresa_id: emp, articulo_id: ev.articulo_id, lote_id: ev.lote_id, tipo: tipoMov, almacen_origen_id: param.almacen_id, ubicacion_origen_id: param.ubicacion_id, almacen_destino_id: origAlm, ubicacion_destino_id: origUbi, cantidad: cant, motivo: `${salida.disposicion} desde cuarentena: ${salida.nota}`, usuario_id: perfil.id })
      }
    }

    // actualizar contadores del evento
    const nuevaRem = rem - cant
    const patchEv = {
      cantidad: nuevaRem,
      cantidad_liberada: Number(ev.cantidad_liberada || 0) + (salida.disposicion === 'liberar' ? cant : 0),
      cantidad_scrap: Number(ev.cantidad_scrap || 0) + (salida.disposicion === 'scrap' ? cant : 0),
      cantidad_retrabajo: Number(ev.cantidad_retrabajo || 0) + (salida.disposicion === 'retrabajo' ? cant : 0),
      estatus: nuevaRem <= 0 ? 'cerrada' : 'parcial',
    }
    if (nuevaRem > 0 && loteHijo) patchEv.lote_id = loteHijo
    if (nuevaRem <= 0) { patchEv.salida_at = new Date().toISOString(); patchEv.salida_por = perfil.id }
    await supabase.from('cuarentena_eventos').update(patchEv).eq('id', ev.id)
    await supabase.from('cuarentena_salidas').update({ estatus: 'aplicada', lote_hijo_id: loteHijo, aplicado_por: perfil.id, aplicado_at: new Date().toISOString() }).eq('id', salida.id)
  }

  const guardarConfig = async () => {
    setError(''); setProc(true)
    try {
      await supabase.from('cuarentena_parametros').upsert({ empresa_id: emp, almacen_id: cfgForm.almacen_id ? Number(cfgForm.almacen_id) : null, ubicacion_id: cfgForm.ubicacion_id ? Number(cfgForm.ubicacion_id) : null, updated_at: new Date().toISOString(), updated_by: perfil.id }, { onConflict: 'empresa_id' })
      setExito('Ubicacion virtual de cuarentena guardada.'); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  const enCuarentena = eventos.filter(e => ['en_cuarentena', 'parcial'].includes(e.estatus))
  const disponibles = lotes.filter(l => ['liberado', 'retenido'].includes(l.estatus_calidad) && totalDe(l.id) > 0)
  const pendientes = salidas.filter(s => s.estatus === 'pendiente')
  const ubisDelAlm = ubicaciones.filter(u => u.almacen_id === Number(cfgForm.almacen_id))

  return (
    <div style={styles.container} className="aparecer">
      <h2 style={styles.titulo}>Cuarentena</h2>
      {!param?.ubicacion_id && <p style={styles.warn}>Aun no se configura la ubicacion virtual de cuarentena. Ve a la pestana <b>Configuracion</b>.</p>}
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      <div style={styles.tabs}>
        {[['cuarentena', `En cuarentena (${enCuarentena.length})`], ['enviar', 'Enviar a cuarentena'], ['autorizar', `Por autorizar (${pendientes.length})`], ['historial', 'Historial'], ...(puedeConfig ? [['config', 'Configuracion']] : [])].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabAct : styles.tab} onClick={() => { setError(''); setExito(''); setVista(id) }}>{n}</button>
        ))}
      </div>

      {vista === 'cuarentena' && (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Caja / Lote</span><span style={{ flex: 1.4 }}>Articulo</span><span style={{ flex: 1, textAlign: 'right' }}>En cuarentena</span><span style={{ flex: 1, textAlign: 'right' }}>SNP</span><span style={{ flex: 2 }}>Causa</span><span style={{ width: '110px' }}></span></div>
          {enCuarentena.map(ev => { const l = lotes.find(x => x.id === ev.lote_id); const art = articulos.find(a => a.id === ev.articulo_id); return (
            <div key={ev.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l?.codigo_lote || ev.lote_id}{ev.estatus === 'parcial' && <span style={styles.pillAmber}> parcial</span>}</span>
              <span style={{ flex: 1.4 }}>{art?.codigo_interno} {art?.origen === 'fabricado' && <span style={styles.tagFab}>PT/WIP</span>}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmt(ev.cantidad)}</span>
              <span style={{ flex: 1, textAlign: 'right', color: '#64748b' }}>{ev.snp ? fmt(ev.snp) : '-'}</span>
              <span style={{ flex: 2, color: '#64748b', fontSize: '12px' }}>{ev.causa || '-'}</span>
              <span style={{ width: '110px', textAlign: 'right' }}>{puedeSalir && <button style={styles.boton} onClick={() => { setError(''); setDispForm({ evento: ev, art, lote: l, disposicion: '', cantidad: ev.cantidad, nota: '' }) }}>Disponer</button>}</span>
            </div>
          ) })}
          {enCuarentena.length === 0 && <div style={styles.vacio}>No hay material en cuarentena.</div>}
        </div>
      )}

      {vista === 'enviar' && (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Caja / Lote</span><span style={{ flex: 1.6 }}>Articulo</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 1, textAlign: 'right' }}>Existencia</span><span style={{ width: '160px' }}></span></div>
          {disponibles.map(l => (
            <div key={l.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l.codigo_lote}</span>
              <span style={{ flex: 1.6 }}>{l.articulo?.codigo_interno} <span style={{ color: '#94a3b8' }}>- {l.articulo?.descripcion}</span></span>
              <span style={{ flex: 1 }}>{l.estatus_calidad}</span>
              <span style={{ flex: 1, textAlign: 'right' }}>{fmt(totalDe(l.id))}</span>
              <span style={{ width: '160px', textAlign: 'right' }}>{puedeEnviar && <button style={styles.botonAmber} onClick={() => { setError(''); setEnvForm({ lote: l, causa: '', causa_id: '' }) }}>Enviar a cuarentena</button>}</span>
            </div>
          ))}
          {disponibles.length === 0 && <div style={styles.vacio}>Sin cajas con existencia.</div>}
        </div>
      )}

      {vista === 'autorizar' && (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Caja</span><span style={{ flex: 1 }}>Disposicion</span><span style={{ flex: 0.8, textAlign: 'right' }}>Cant.</span><span style={{ flex: 1.4 }}>Nota</span><span style={{ flex: 1.4 }}>Firmas</span><span style={{ width: '180px' }}></span></div>
          {pendientes.map(s => { const l = lotes.find(x => x.id === s.lote_id); const okCal = !!s.auth_calidad_at; const okPla = !!s.auth_planta_at; return (
            <div key={s.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l?.codigo_lote || s.lote_id}</span>
              <span style={{ flex: 1 }}>{s.disposicion === 'liberar' ? <span style={styles.pillGreen}>liberar</span> : s.disposicion === 'retrabajo' ? <span style={styles.pillBlue}>retrabajo</span> : <span style={styles.pillRed}>scrap</span>}</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>{fmt(s.cantidad)}</span>
              <span style={{ flex: 1.4, color: '#64748b', fontSize: '12px' }}>{s.nota}</span>
              <span style={{ flex: 1.4, fontSize: '11px', color: '#64748b' }}>
                Calidad: {okCal ? <b style={{ color: '#15803d' }}>OK</b> : 'pendiente'}{s.requiere_planta && <> · Planta: {okPla ? <b style={{ color: '#15803d' }}>OK</b> : 'pendiente'}</>}
              </span>
              <span style={{ width: '180px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                {!okCal && esRolCalidad(perfil.rol) && <button style={styles.botonMini} disabled={proc} onClick={() => autorizar(s, 'calidad')}>Firmar Calidad</button>}
                {s.requiere_planta && !okPla && esRolPlanta(perfil.rol) && <button style={styles.botonMiniRed} disabled={proc} onClick={() => autorizar(s, 'planta')}>Firmar Planta</button>}
                {((okCal || !esRolCalidad(perfil.rol)) && (!s.requiere_planta || okPla || !esRolPlanta(perfil.rol))) && !(esRolCalidad(perfil.rol) && !okCal) && !(s.requiere_planta && esRolPlanta(perfil.rol) && !okPla) && <span style={{ fontSize: '11px', color: '#94a3b8' }}>esperando firma</span>}
              </span>
            </div>
          ) })}
          {pendientes.length === 0 && <div style={styles.vacio}>No hay disposiciones por autorizar.</div>}
        </div>
      )}

      {vista === 'historial' && (
        <div style={styles.tabla}>
          <div style={styles.th}><span style={{ flex: 1 }}>Caja</span><span style={{ flex: 1 }}>Disposicion</span><span style={{ flex: 0.8, textAlign: 'right' }}>Cant.</span><span style={{ flex: 1 }}>Remanente</span><span style={{ flex: 1.4 }}>Autorizo</span><span style={{ flex: 1 }}>Fecha</span></div>
          {salidas.filter(s => s.estatus === 'aplicada').map(s => { const l = lotes.find(x => x.id === s.lote_id); const h = lotes.find(x => x.id === s.lote_hijo_id); return (
            <div key={s.id} style={styles.tr}>
              <span style={{ flex: 1, fontWeight: 600 }}>{l?.codigo_lote || s.lote_id}</span>
              <span style={{ flex: 1 }}>{s.disposicion === 'liberar' ? <span style={styles.pillGreen}>liberar</span> : s.disposicion === 'retrabajo' ? <span style={styles.pillBlue}>retrabajo</span> : <span style={styles.pillRed}>scrap</span>}</span>
              <span style={{ flex: 0.8, textAlign: 'right' }}>{fmt(s.cantidad)}</span>
              <span style={{ flex: 1, fontSize: '12px', color: '#64748b' }}>{h?.codigo_lote || '-'}</span>
              <span style={{ flex: 1.4, fontSize: '11px', color: '#64748b' }}>Cal: {nombreUsr(s.auth_calidad_por)}{s.requiere_planta && ` · Pla: ${nombreUsr(s.auth_planta_por)}`}</span>
              <span style={{ flex: 1, fontSize: '12px', color: '#64748b' }}>{fFecha(s.aplicado_at)}</span>
            </div>
          ) })}
          {salidas.filter(s => s.estatus === 'aplicada').length === 0 && <div style={styles.vacio}>Sin disposiciones aplicadas.</div>}
        </div>
      )}

      {vista === 'config' && puedeConfig && (
        <div style={styles.cfg}>
          <p style={styles.sub}>Define el <b>almacen y ubicacion virtual</b> a donde se moveran las cajas al enviarse a cuarentena. Usa una ubicacion marcada como cuarentena o virtual.</p>
          <label style={styles.lbl}>Almacen</label>
          <select style={styles.input} value={cfgForm.almacen_id} onChange={e => setCfgForm({ almacen_id: e.target.value, ubicacion_id: '' })}>
            <option value="">Selecciona...</option>
            {almacenes.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}{a.es_virtual ? ' (virtual)' : ''}</option>)}
          </select>
          <label style={{ ...styles.lbl, marginTop: '10px' }}>Ubicacion</label>
          <select style={styles.input} value={cfgForm.ubicacion_id} onChange={e => setCfgForm({ ...cfgForm, ubicacion_id: e.target.value })} disabled={!cfgForm.almacen_id}>
            <option value="">Selecciona...</option>
            {ubisDelAlm.map(u => <option key={u.id} value={u.id}>{u.clave}{u.es_cuarentena ? ' (cuarentena)' : ''}{u.descripcion ? ` - ${u.descripcion}` : ''}</option>)}
          </select>
          <div style={styles.botones}><button style={styles.boton} onClick={guardarConfig} disabled={proc || !cfgForm.almacen_id || !cfgForm.ubicacion_id}>Guardar</button></div>
          {param?.ubicacion_id && <p style={styles.ok}>Actual: {almDe(param.almacen_id)?.clave} / {ubiDe(param.ubicacion_id)?.clave}</p>}
        </div>
      )}

      {/* Modal enviar */}
      {envForm && (
        <div style={styles.overlay}><div style={styles.modal}>
          <h3 style={styles.h3}>Enviar caja {envForm.lote.codigo_lote} a cuarentena</h3>
          <p style={styles.sub}>La <b>causa es obligatoria</b>. El material se movera a la ubicacion virtual de cuarentena.</p>
          <label style={styles.lbl}>Causa (catalogo)</label>
          <select style={styles.input} value={envForm.causa_id} onChange={e => { const c = causas.find(x => x.id === Number(e.target.value)); setEnvForm({ ...envForm, causa_id: e.target.value, causa: c ? c.nombre : envForm.causa }) }}>
            <option value="">Otra / escribir</option>
            {causas.map(c => <option key={c.id} value={c.id}>{c.clave} - {c.nombre}</option>)}
          </select>
          <label style={{ ...styles.lbl, marginTop: '8px' }}>Causa (detalle) *</label>
          <input style={styles.input} value={envForm.causa} onChange={e => setEnvForm({ ...envForm, causa: e.target.value })} autoFocus placeholder="Describe la causa" />
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setEnvForm(null)} disabled={proc}>Cancelar</button><button style={styles.botonAmber} onClick={enviar} disabled={proc || !envForm.causa.trim()}>Enviar a cuarentena</button></div>
        </div></div>
      )}

      {/* Modal disposicion */}
      {dispForm && (
        <div style={styles.overlay}><div style={styles.modal}>
          <h3 style={styles.h3}>Disposicion · caja {dispForm.lote?.codigo_lote}</h3>
          <p style={styles.sub}>En cuarentena: <b>{fmt(dispForm.evento.cantidad)}</b>{dispForm.art?.origen === 'fabricado' && dispForm.evento.snp ? ` · SNP ${fmt(dispForm.evento.snp)} pzas/caja` : ''}</p>
          <label style={styles.lbl}>Disposicion *</label>
          <div style={{ display: 'flex', gap: '8px', margin: '6px 0 10px' }}>
            <button style={dispForm.disposicion === 'liberar' ? styles.optOn : styles.opt} onClick={() => setDispForm({ ...dispForm, disposicion: 'liberar' })}>Liberar</button>
            <button style={dispForm.disposicion === 'retrabajo' ? styles.optBlueOn : styles.opt} onClick={() => setDispForm({ ...dispForm, disposicion: 'retrabajo' })}>Retrabajo</button>
            <button style={dispForm.disposicion === 'scrap' ? styles.optRedOn : styles.opt} onClick={() => setDispForm({ ...dispForm, disposicion: 'scrap' })}>Scrap</button>
          </div>
          <label style={styles.lbl}>Cantidad *</label>
          <input style={styles.input} type="number" value={dispForm.cantidad} onChange={e => setDispForm({ ...dispForm, cantidad: e.target.value })} />
          <label style={{ ...styles.lbl, marginTop: '8px' }}>Nota / dictamen *</label>
          <input style={styles.input} value={dispForm.nota} onChange={e => setDispForm({ ...dispForm, nota: e.target.value })} placeholder={dispForm.disposicion === 'scrap' ? 'Motivo del scrap' : 'Dictamen'} />
          <p style={styles.aviso}>{dispForm.disposicion === 'scrap' ? 'Scrap requiere firma de Gerente de Calidad y Gerente de Planta.' : 'Requiere firma de Gerente de Calidad.'}</p>
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setDispForm(null)} disabled={proc}>Cancelar</button><button style={dispForm.disposicion === 'scrap' ? styles.botonRed : styles.boton} onClick={crearDisposicion} disabled={proc || !dispForm.disposicion || !dispForm.nota.trim()}>Registrar disposicion</button></div>
        </div></div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px', maxWidth: '1100px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 12px' },
  h3: { fontSize: '15px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 6px' },
  sub: { fontSize: '13px', color: '#64748b', margin: '0 0 10px' },
  aviso: { fontSize: '12px', color: '#b45309', margin: '10px 0 0' },
  lbl: { fontSize: '12px', fontWeight: 500, color: '#444' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#b45309', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #b45309' },
  tabla: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 16px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '11px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '14px 16px', color: '#94a3b8', fontSize: '13px' },
  cfg: { backgroundColor: '#fff', border: '1px solid #eef2f7', borderRadius: '8px', padding: '20px', maxWidth: '480px' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '14px' },
  boton: { padding: '8px 16px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  botonRed: { padding: '8px 16px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  botonAmber: { padding: '7px 14px', backgroundColor: '#d97706', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: 500, cursor: 'pointer' },
  botonSec: { padding: '8px 16px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  botonMini: { padding: '6px 10px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  botonMiniRed: { padding: '6px 10px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  opt: { flex: 1, padding: '10px', backgroundColor: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', cursor: 'pointer' },
  optOn: { flex: 1, padding: '10px', backgroundColor: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  optBlueOn: { flex: 1, padding: '10px', backgroundColor: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  optRedOn: { flex: 1, padding: '10px', backgroundColor: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: '8px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 },
  modal: { backgroundColor: '#fff', borderRadius: '12px', padding: '22px', width: '460px', maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  pillAmber: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#b45309' },
  pillRed: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c' },
  pillGreen: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' },
  pillBlue: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#dbeafe', color: '#1d4ed8' },
  tagFab: { padding: '1px 6px', borderRadius: '4px', fontSize: '9px', fontWeight: 700, backgroundColor: '#ede9fe', color: '#6d28d9', marginLeft: '4px' },
  warn: { backgroundColor: '#fffbeb', border: '1px solid #fde68a', color: '#b45309', padding: '10px 14px', borderRadius: '8px', fontSize: '13px', marginBottom: '12px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
  ok: { color: '#15803d', fontSize: '12px', marginTop: '10px' },
}
