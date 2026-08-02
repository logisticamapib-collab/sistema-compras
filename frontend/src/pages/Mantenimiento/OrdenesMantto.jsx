import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// Ordenes de mantenimiento general / de maquinas. Cualquier usuario levanta la
// orden (problema/mejora/reparacion/creacion). Se asigna a un tecnico interno o a
// un proveedor externo, se registran insumos y costos, y al terminar el solicitante
// firma de conformidad para cerrarla.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const TIPOS = [['problema', 'Problema / falla'], ['mejora', 'Mejora'], ['reparacion', 'Reparacion'], ['creacion', 'Creacion / fabricacion'], ['preventivo', 'Preventivo'], ['otro', 'Otro']]
const PRIOS = ['baja', 'media', 'alta', 'urgente']

export default function OrdenesMantto() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('man_ordenes', 'crear')
  const puedeGestionar = tienePermiso('man_ordenes', 'editar') || ['admin'].includes(perfil?.rol)

  const [vista, setVista] = useState('lista')
  const [site, setSite] = useState('')
  const [ordenes, setOrdenes] = useState([])
  const [sel, setSel] = useState(null)
  const [insumos, setInsumos] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [lotes, setLotes] = useState([])
  const [form, setForm] = useState(null)
  const [asig, setAsig] = useState({ modo: 'interno', asignado_a: '', proveedor_id: '', costo_externo: '' })
  const [ins, setIns] = useState({ modo: 'articulo', articulo_id: '', almacen_id: '', descripcion: '', cantidad: '', costo_unitario: '' })
  const [conf, setConf] = useState({ comentario: '' })
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtro, setFiltro] = useState('abiertas')

  useEffect(() => { cargar() }, [site])
  const cargar = async () => {
    const sid = siteEfectivo(perfil, site)
    setLoading(true)
    const emp = perfil.empresa_id
    const [o, mq, us, pr, ar, al, ex, lo] = await Promise.all([
      supabase.from('mtto_gen_ordenes').select('*, maquina:maquinas(clave)').eq('empresa_id', emp).order('id', { ascending: false }),
      (sid ? supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', emp).eq('site_id', sid) : supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', emp)),
      supabase.from('usuarios').select('id, nombre, rol').eq('empresa_id', emp),
      supabase.from('proveedores').select('id, nombre').eq('empresa_id', emp).eq('activo', true),
      supabase.from('articulos').select('id, codigo_interno, descripcion, costo').eq('empresa_id', emp),
      supabase.from('almacenes').select('*').eq('empresa_id', emp).eq('activo', true),
      supabase.from('existencias').select('*'),
      supabase.from('lotes').select('id, articulo_id, estatus_calidad, fecha, empresa_id').eq('empresa_id', emp),
    ])
    setOrdenes((o.data || []).filter(x => { if (!sid) return true; const _ids = (mq.data || []).map(z => z.id); return !x.maquina_id || _ids.includes(x.maquina_id) })); setMaquinas(mq.data || []); setUsuarios(us.data || []); setProveedores(pr.data || [])
    setArticulos(ar.data || []); setAlmacenes(al.data || []); setExistencias(ex.data || []); setLotes(lo.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const usrDe = (id) => usuarios.find(u => u.id === id)?.nombre || '-'
  const provDe = (id) => proveedores.find(p => p.id === id)?.nombre || '-'

  const abrirNueva = () => { setError(''); setExito(''); setForm({ objeto: 'general', maquina_id: '', tipo_trabajo: 'reparacion', prioridad: 'media', titulo: '', descripcion: '', motivo: '' }); setVista('nueva') }

  const crear = async () => {
    setError('')
    if (!form.titulo.trim()) { setError('Captura el titulo de la orden.'); return }
    if (form.objeto === 'maquina' && !form.maquina_id) { setError('Selecciona la maquina.'); return }
    setProc(true)
    try {
      const folio = `OM-${Date.now().toString().slice(-8)}`
      const { data: o, error: e } = await supabase.from('mtto_gen_ordenes').insert({
        empresa_id: perfil.empresa_id, folio, objeto: form.objeto, maquina_id: form.objeto === 'maquina' ? Number(form.maquina_id) : null,
        tipo_trabajo: form.tipo_trabajo, prioridad: form.prioridad, titulo: form.titulo, descripcion: form.descripcion || null,
        motivo: form.motivo || null, solicitante_id: perfil.id, estatus: 'abierta', creado_por: perfil.id,
      }).select().single()
      if (e) throw e
      setExito(`Orden ${folio} levantada.`); await cargar(); abrirDetalle(o)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const abrirDetalle = async (o) => {
    setError(''); setExito('')
    const { data: od } = await supabase.from('mtto_gen_ordenes').select('*, maquina:maquinas(clave, nombre)').eq('id', o.id).single()
    const { data: insu } = await supabase.from('mtto_gen_insumos').select('*').eq('orden_id', o.id).order('id')
    setSel(od); setInsumos(insu || [])
    setAsig({ modo: od.es_externo ? 'externo' : 'interno', asignado_a: od.asignado_a || '', proveedor_id: od.proveedor_id || '', costo_externo: od.costo_externo ?? '' })
    setIns({ modo: 'articulo', articulo_id: '', almacen_id: '', descripcion: '', cantidad: '', costo_unitario: '' }); setConf({ comentario: '' })
    setVista('detalle')
  }

  const asignar = async () => {
    setError(''); setProc(true)
    try {
      const patch = asig.modo === 'externo'
        ? { es_externo: true, proveedor_id: asig.proveedor_id ? Number(asig.proveedor_id) : null, costo_externo: asig.costo_externo !== '' ? Number(asig.costo_externo) : null, asignado_a: null, estatus: 'asignada', fecha_asignacion: sel?.fecha_asignacion || new Date().toISOString() }
        : { es_externo: false, asignado_a: asig.asignado_a || null, proveedor_id: null, estatus: 'asignada', fecha_asignacion: sel?.fecha_asignacion || new Date().toISOString() }
      await supabase.from('mtto_gen_ordenes').update(patch).eq('id', sel.id)
      setExito('Orden asignada.'); await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }
  const cambiarEstatus = async (estatus, extra = {}) => {
    setProc(true); setError('')
    try {
      await supabase.from('mtto_gen_ordenes').update({ estatus, ...extra }).eq('id', sel.id)
      await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const deducir = (articuloId, cantidad, almacenId) => {
    let restante = Number(cantidad)
    const exs = existencias.filter(e => e.almacen_id === almacenId && Number(e.cantidad) > 0)
      .filter(e => loteDe(e.lote_id)?.articulo_id === articuloId && loteDe(e.lote_id)?.estatus_calidad === 'liberado')
      .sort((a, b) => (loteDe(a.lote_id)?.fecha || '').localeCompare(loteDe(b.lote_id)?.fecha || ''))
    const tomados = []
    for (const e of exs) { if (restante <= 0.000001) break; const t = Math.min(Number(e.cantidad), restante); tomados.push({ ex: e, toma: t }); restante -= t }
    return { tomados, faltante: Math.max(0, restante) }
  }
  const agregarInsumo = async () => {
    setError(''); const cant = Number(ins.cantidad); let cu = Number(ins.costo_unitario)
    if (!(cant > 0)) { setError('Captura la cantidad.'); return }
    setProc(true)
    try {
      let articulo_id = null, descripcion = ins.descripcion || null, lote_id = null, almacen_id = null
      if (ins.modo === 'articulo') {
        if (!ins.articulo_id || !ins.almacen_id) throw new Error('Selecciona articulo y almacen.')
        articulo_id = Number(ins.articulo_id); almacen_id = Number(ins.almacen_id)
        if (!cu) cu = Number(artDe(articulo_id)?.costo || 0)
        const { tomados, faltante } = deducir(articulo_id, cant, almacen_id)
        if (faltante > 0.001) throw new Error(`Faltan ${fmt(faltante)} de ${artDe(articulo_id)?.codigo_interno} (liberado).`)
        for (const t of tomados) {
          const nueva = Number(t.ex.cantidad) - t.toma
          if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', t.ex.id)
          else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.ex.id)
          await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id, lote_id: t.ex.lote_id, tipo: 'ajuste_negativo', almacen_origen_id: almacen_id, cantidad: t.toma, motivo: `Mantenimiento ${sel.folio}`, usuario_id: perfil.id })
          lote_id = t.ex.lote_id
        }
        descripcion = artDe(articulo_id)?.descripcion || null
      } else if (!descripcion) throw new Error('Describe el gasto.')
      await supabase.from('mtto_gen_insumos').insert({ orden_id: sel.id, articulo_id, descripcion, cantidad: cant, costo_unitario: cu, costo_total: cant * cu, lote_id, almacen_id })
      await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error al agregar insumo: ' + err.message) }
    setProc(false)
  }

  const firmarConformidad = async (ok) => {
    setProc(true); setError('')
    try {
      const patch = { conforme_ok: ok, conforme_por: perfil.id, conforme_at: new Date().toISOString(), conforme_comentario: conf.comentario || null }
      if (ok) { patch.estatus = 'cerrada'; patch.fecha_cierre = new Date().toISOString() }
      else { patch.estatus = 'en_proceso' }
      await supabase.from('mtto_gen_ordenes').update(patch).eq('id', sel.id)
      setExito(ok ? 'Conformidad firmada. Orden cerrada.' : 'No conforme: la orden regresa a proceso.')
      await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  if (vista === 'nueva') {
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => setVista('lista')}>&larr; Volver</button>
        <h2 style={styles.titulo}>Nueva orden de mantenimiento</h2>
      <div style={{ marginBottom: 10 }} className="no-imprimir"><FiltroSite value={site} onChange={setSite} /></div>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.tarjeta}>
          <div style={styles.fila}>
            <Campo label="Objeto"><select style={styles.input} value={form.objeto} onChange={e => setForm({ ...form, objeto: e.target.value })}><option value="general">General / instalaciones</option><option value="maquina">Maquina</option></select></Campo>
            {form.objeto === 'maquina' && <Campo label="Maquina *"><select style={styles.input} value={form.maquina_id} onChange={e => setForm({ ...form, maquina_id: e.target.value })}><option value="">Selecciona...</option>{maquinas.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}</select></Campo>}
            <Campo label="Tipo de trabajo"><select style={styles.input} value={form.tipo_trabajo} onChange={e => setForm({ ...form, tipo_trabajo: e.target.value })}>{TIPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
            <Campo label="Prioridad"><select style={styles.input} value={form.prioridad} onChange={e => setForm({ ...form, prioridad: e.target.value })}>{PRIOS.map(p => <option key={p} value={p}>{p}</option>)}</select></Campo>
          </div>
          <Campo label="Titulo *"><input style={styles.input} value={form.titulo} onChange={e => setForm({ ...form, titulo: e.target.value })} placeholder="Ej. Fuga de aceite en prensa 3" /></Campo>
          <Campo label="Descripcion del problema / solicitud"><input style={styles.input} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} /></Campo>
          <Campo label="Motivo / razon"><input style={styles.input} value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} /></Campo>
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setVista('lista')} disabled={proc}>Cancelar</button><button style={styles.boton} onClick={crear} disabled={proc}>{proc ? 'Guardando...' : 'Levantar orden'}</button></div>
        </div>
      </div>
    )
  }

  if (vista === 'detalle' && sel) {
    const costo = insumos.reduce((s, i) => s + Number(i.costo_total), 0) + Number(sel.costo_externo || 0)
    const puedeFirmar = perfil?.id === sel.solicitante_id || ['admin', 'gerente_produccion', 'gerente_planta'].includes(perfil?.rol)
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => { setVista('lista'); cargar() }}>&larr; Volver</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={styles.titulo}>{sel.folio} · {sel.titulo}</h2>
          <span style={badge(sel.estatus)}>{sel.estatus.replace(/_/g, ' ')}</span>
        </div>
        <p style={styles.sub}>{sel.objeto === 'maquina' ? `Maquina ${sel.maquina?.clave}` : 'General'} · {(TIPOS.find(t => t[0] === sel.tipo_trabajo) || [])[1]} · prioridad {sel.prioridad} · solicito {usrDe(sel.solicitante_id)}</p>
        {sel.descripcion && <p style={styles.desc}>{sel.descripcion}</p>}
        {error && <p style={styles.error}>{error}</p>}
        {exito && <p style={styles.exito}>{exito}</p>}

        {puedeGestionar && ['abierta', 'asignada'].includes(sel.estatus) && (
          <div style={styles.tarjeta}>
            <h3 style={styles.h3}>Asignacion</h3>
            <div style={styles.fila}>
              <Campo label="Realiza"><select style={styles.input} value={asig.modo} onChange={e => setAsig({ ...asig, modo: e.target.value })}><option value="interno">Tecnico interno</option><option value="externo">Proveedor externo</option></select></Campo>
              {asig.modo === 'interno'
                ? <Campo label="Tecnico"><select style={styles.input} value={asig.asignado_a} onChange={e => setAsig({ ...asig, asignado_a: e.target.value })}><option value="">Selecciona...</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
                : <>
                    <Campo label="Proveedor"><select style={styles.input} value={asig.proveedor_id} onChange={e => setAsig({ ...asig, proveedor_id: e.target.value })}><option value="">Selecciona...</option>{proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>
                    <Campo label="Costo externo"><input type="number" min="0" style={styles.input} value={asig.costo_externo} onChange={e => setAsig({ ...asig, costo_externo: e.target.value })} /></Campo>
                  </>}
              <button style={{ ...styles.boton, alignSelf: 'flex-end' }} onClick={asignar} disabled={proc}>Asignar</button>
            </div>
          </div>
        )}

        <div style={styles.tarjeta}>
          <h3 style={styles.h3}>Insumos y costos · Total: ${fmt(costo)}{sel.es_externo ? ` (incluye externo $${fmt(sel.costo_externo)})` : ''}</h3>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 2 }}>Concepto</span><span style={{ flex: 1, textAlign: 'right' }}>Cant.</span><span style={{ flex: 1, textAlign: 'right' }}>C. unit</span><span style={{ flex: 1, textAlign: 'right' }}>Total</span></div>
            {insumos.map(i => (<div key={i.id} style={styles.tr}><span style={{ flex: 2 }}>{i.articulo_id ? <b>{artDe(i.articulo_id)?.codigo_interno} </b> : <span style={{ color: '#7c3aed' }}>Gasto </span>}{i.descripcion}</span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(i.cantidad)}</span><span style={{ flex: 1, textAlign: 'right' }}>${fmt(i.costo_unitario)}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>${fmt(i.costo_total)}</span></div>))}
            {insumos.length === 0 && <div style={styles.vacio}>Sin insumos.</div>}
          </div>
          {['asignada', 'en_proceso'].includes(sel.estatus) && puedeGestionar && (
            <div style={{ ...styles.fila, marginTop: '12px', alignItems: 'flex-end' }}>
              <Campo label="Tipo"><select style={styles.input} value={ins.modo} onChange={e => setIns({ ...ins, modo: e.target.value })}><option value="articulo">Material (inventario)</option><option value="gasto">Gasto libre</option></select></Campo>
              {ins.modo === 'articulo'
                ? <><Campo label="Articulo"><select style={styles.input} value={ins.articulo_id} onChange={e => setIns({ ...ins, articulo_id: e.target.value })}><option value="">...</option>{articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno}</option>)}</select></Campo>
                    <Campo label="Almacen"><select style={styles.input} value={ins.almacen_id} onChange={e => setIns({ ...ins, almacen_id: e.target.value })}><option value="">...</option>{almacenes.filter(a => !a.es_virtual).map(a => <option key={a.id} value={a.id}>{a.clave}</option>)}</select></Campo></>
                : <Campo label="Descripcion"><input style={styles.input} value={ins.descripcion} onChange={e => setIns({ ...ins, descripcion: e.target.value })} /></Campo>}
              <Campo label="Cant."><input type="number" min="0" style={{ ...styles.input, width: '80px' }} value={ins.cantidad} onChange={e => setIns({ ...ins, cantidad: e.target.value })} /></Campo>
              <Campo label="C. unit"><input type="number" min="0" style={{ ...styles.input, width: '90px' }} value={ins.costo_unitario} onChange={e => setIns({ ...ins, costo_unitario: e.target.value })} placeholder="auto" /></Campo>
              <button style={styles.boton} onClick={agregarInsumo} disabled={proc}>Agregar</button>
            </div>
          )}
        </div>

        {puedeGestionar && (
          <div style={styles.botones}>
            {sel.estatus === 'asignada' && <button style={styles.boton} onClick={() => cambiarEstatus('en_proceso', { fecha_inicio: new Date().toISOString() })} disabled={proc}>Iniciar trabajo</button>}
            {sel.estatus === 'en_proceso' && <button style={styles.boton} onClick={() => cambiarEstatus('realizada', { fecha_fin: new Date().toISOString() })} disabled={proc}>Marcar realizada</button>}
          </div>
        )}

        {sel.estatus === 'realizada' && (
          <div style={styles.tarjeta}>
            <h3 style={styles.h3}>Firma de conformidad</h3>
            <p style={styles.sub}>El solicitante valida que el trabajo quedo conforme para cerrar la orden.</p>
            <input style={{ ...styles.input, width: '100%', marginBottom: '10px' }} placeholder="Comentario (opcional)" value={conf.comentario} onChange={e => setConf({ comentario: e.target.value })} />
            {puedeFirmar
              ? <div style={{ display: 'flex', gap: '10px' }}><button style={styles.botonOk} onClick={() => firmarConformidad(true)} disabled={proc}>Conforme (cerrar)</button><button style={styles.botonNo} onClick={() => firmarConformidad(false)} disabled={proc}>No conforme</button></div>
              : <p style={styles.vacio}>Solo el solicitante ({usrDe(sel.solicitante_id)}) o un gerente puede firmar.</p>}
          </div>
        )}
        {sel.estatus === 'cerrada' && sel.conforme_at && <p style={styles.exito}>Conforme por {usrDe(sel.conforme_por)} el {fFecha(sel.conforme_at)}. {sel.conforme_comentario || ''}</p>}
      </div>
    )
  }

  // ---- Tiempos de atencion ----
  const HORA = 3600000
  const dur = (desde, hasta) => {
    if (!desde) return null
    const fin = hasta ? new Date(hasta) : new Date()
    const ms = fin - new Date(desde)
    return ms >= 0 ? ms : null
  }
  const fmtDur = (ms) => {
    if (ms == null) return '-'
    const h = ms / HORA
    if (h < 1) return `${Math.round(ms / 60000)} min`
    if (h < 48) return `${h.toFixed(1)} h`
    return `${(h / 24).toFixed(1)} d`
  }
  const fmtFH = (t) => t ? new Date(t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '-'
  const cierreDe = (o) => o.fecha_cierre || o.fecha_fin || o.conforme_at || null
  const tRespuesta = (o) => dur(o.created_at, o.fecha_asignacion)      // apertura -> asignacion (o en curso)
  const tEjecucion = (o) => o.fecha_asignacion ? dur(o.fecha_asignacion, cierreDe(o)) : null
  const tTotal = (o) => dur(o.created_at, cierreDe(o))

  const colsExp = [
    { label: 'Folio', get: o => o.folio },
    { label: 'Titulo', get: o => o.titulo },
    { label: 'Objeto', get: o => o.objeto === 'maquina' ? (o.maquina?.clave || '') : 'general' },
    { label: 'Tipo', get: o => o.tipo_trabajo || '' },
    { label: 'Prioridad', get: o => o.prioridad || '' },
    { label: 'Realiza', get: o => o.es_externo ? `ext: ${provDe(o.proveedor_id)}` : (o.asignado_a ? usrDe(o.asignado_a) : '') },
    { label: 'Levantada', get: o => fmtFH(o.created_at) },
    { label: 'Asignada', get: o => fmtFH(o.fecha_asignacion) },
    { label: 'Cierre', get: o => fmtFH(cierreDe(o)) },
    { label: 'Apertura->Asignacion', get: o => fmtDur(tRespuesta(o)) + (o.fecha_asignacion ? '' : ' (sin asignar)') },
    { label: 'Asignacion->Cierre', get: o => fmtDur(tEjecucion(o)) + (o.fecha_asignacion && !cierreDe(o) ? ' (en curso)' : '') },
    { label: 'Tiempo total', get: o => fmtDur(tTotal(o)) + (cierreDe(o) ? '' : ' (abierta)') },
    { label: 'Estatus', get: o => (o.estatus || '').replace(/_/g, ' ') },
  ]

  const lista = ordenes.filter(o => filtro === 'todas' ? true : filtro === 'abiertas' ? !['cerrada', 'cancelada'].includes(o.estatus) : o.estatus === 'cerrada')
  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}><h2 style={styles.titulo}>Ordenes de mantenimiento</h2>{puedeCrear && <button style={styles.boton} onClick={abrirNueva}>Levantar orden</button>}</div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <div style={styles.tabs}>{[['abiertas', 'Abiertas'], ['cerradas', 'Cerradas'], ['todas', 'Todas']].map(([id, n]) => <button key={id} style={filtro === id ? styles.tabAct : styles.tab} onClick={() => setFiltro(id)}>{n}</button>)}</div>
        <span style={{ flex: 1 }} />
        {lista.length > 0 && <>
          <button style={styles.botonAccion} onClick={() => exportarExcel('ordenes_mantenimiento', colsExp, lista)}>Excel</button>
          <button style={styles.botonAccion} onClick={() => imprimirTablaPDF('Ordenes de Mantenimiento', colsExp, lista)}>PDF</button>
        </>}
      </div>
      <div style={styles.tabla}>
        <div style={styles.th}>
          <span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1.8 }}>Titulo</span>
          <span style={{ flex: 0.9 }}>Objeto</span><span style={{ flex: 0.8 }}>Prioridad</span>
          <span style={{ flex: 1 }}>Realiza</span>
          <span style={{ flex: 1.1 }}>Levantada</span><span style={{ flex: 1.1 }}>Asignada</span>
          <span style={{ flex: 0.9, textAlign: 'right' }}>Resp.</span>
          <span style={{ flex: 0.9, textAlign: 'right' }}>Ejec.</span>
          <span style={{ flex: 0.9, textAlign: 'right' }}>Total</span>
          <span style={{ flex: 0.9 }}>Estatus</span><span style={{ width: '70px' }}></span>
        </div>
        {lista.map(o => (
          <div key={o.id} style={styles.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{o.folio}</span>
            <span style={{ flex: 1.8 }}>{o.titulo}<div style={{ fontSize: '11px', color: '#94a3b8' }}>{o.tipo_trabajo}</div></span>
            <span style={{ flex: 0.9, color: '#64748b' }}>{o.objeto === 'maquina' ? o.maquina?.clave : 'general'}</span>
            <span style={{ flex: 0.8 }}><span style={prioBadge(o.prioridad)}>{o.prioridad}</span></span>
            <span style={{ flex: 1, fontSize: '12px', color: '#475569' }}>{o.es_externo ? `ext: ${provDe(o.proveedor_id)}` : (o.asignado_a ? usrDe(o.asignado_a) : '-')}</span>
            <span style={{ flex: 1.1, fontSize: '11.5px', color: '#64748b' }}>{fmtFH(o.created_at)}</span>
            <span style={{ flex: 1.1, fontSize: '11.5px', color: o.fecha_asignacion ? '#64748b' : '#dc2626' }}>{o.fecha_asignacion ? fmtFH(o.fecha_asignacion) : 'sin asignar'}</span>
            <span style={{ flex: 0.9, textAlign: 'right', fontSize: '12px', fontWeight: 600, color: o.fecha_asignacion ? '#334155' : '#dc2626' }} title={o.fecha_asignacion ? 'Apertura a asignacion' : 'Tiempo abierta sin asignar'}>{fmtDur(tRespuesta(o))}</span>
            <span style={{ flex: 0.9, textAlign: 'right', fontSize: '12px', color: '#334155' }} title="Asignacion a cierre">{fmtDur(tEjecucion(o))}{o.fecha_asignacion && !cierreDe(o) ? '*' : ''}</span>
            <span style={{ flex: 0.9, textAlign: 'right', fontSize: '12px', fontWeight: 700, color: cierreDe(o) ? '#15803d' : '#b45309' }} title="Tiempo total">{fmtDur(tTotal(o))}</span>
            <span style={{ flex: 0.9 }}><span style={badge(o.estatus)}>{o.estatus.replace(/_/g, ' ')}</span></span>
            <span style={{ width: '70px', textAlign: 'right' }}><button style={styles.botonAccion} onClick={() => abrirDetalle(o)}>Abrir</button></span>
          </div>
        ))}
        {lista.length === 0 && <div style={styles.vacio}>Sin ordenes.</div>}
      </div>
      <p style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '8px' }}>
        <b>Resp.</b> = tiempo de apertura a asignacion (en rojo si aun no se asigna, contando desde que se levanto) · <b>Ejec.</b> = de la asignacion al cierre (* = en curso) · <b>Total</b> = de la apertura al cierre (ambar si sigue abierta).
      </p>
    </div>
  )
}

function Campo({ label, children }) { return (<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '150px' }}><label style={{ fontSize: '12px', fontWeight: 500, color: '#444' }}>{label}</label>{children}</div>) }
function badge(s) { const c = { abierta: ['#fef3c7', '#b45309'], asignada: ['#dbeafe', '#2563eb'], en_proceso: ['#e0e7ff', '#4338ca'], realizada: ['#cffafe', '#0e7490'], cerrada: ['#dcfce7', '#15803d'], cancelada: ['#fee2e2', '#b91c1c'] }[s] || ['#f1f5f9', '#64748b']; return { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, backgroundColor: c[0], color: c[1] } }
function prioBadge(p) { const c = { baja: ['#f1f5f9', '#64748b'], media: ['#dbeafe', '#2563eb'], alta: ['#fef3c7', '#b45309'], urgente: ['#fee2e2', '#b91c1c'] }[p] || ['#f1f5f9', '#64748b']; return { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: c[0], color: c[1] } }

const styles = {
  container: { padding: '28px', maxWidth: '1060px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  sub: { fontSize: '13px', color: '#64748b', margin: '6px 0 8px' },
  desc: { fontSize: '13px', color: '#334155', margin: '0 0 10px' },
  h3: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  volver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '14px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '14px' },
  boton: { padding: '9px 18px', backgroundColor: '#57534e', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonOk: { padding: '9px 18px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonNo: { padding: '9px 18px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '5px 12px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#57534e', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #57534e' },
  tabla: { border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
