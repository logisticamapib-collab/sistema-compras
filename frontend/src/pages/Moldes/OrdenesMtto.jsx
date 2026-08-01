import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// Ordenes de mantenimiento de molde. Registra causa raiz (maquina/operador/turno/
// supervisor) para KPIs de danos, cobro al cliente para KPI de facturacion, e
// insumos (refaccion de inventario o gasto libre) para el costo. Al cerrar, si el
// tipo reinicia el contador, pone shots_acumulados=0. El molde vuelve a disponible.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const CAUSAS = [
  { v: 'desgaste_shots', l: 'Desgaste por shots' },
  { v: 'molde', l: 'Defecto del molde' },
  { v: 'parametros_maquina', l: 'Parametros de maquina (resina, botadores, presion, agua...)' },
  { v: 'reparacion_previa_inefectiva', l: 'Reparacion previa inefectiva (reincidencia)' },
  { v: 'otro', l: 'Otro' },
]

export default function OrdenesMtto() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('mol_ordenes', 'crear')
  const puedeEditar = tienePermiso('mol_ordenes', 'editar') || puedeCrear

  const [vista, setVista] = useState('lista')
  const [site, setSite] = useState('')
  const [ordenes, setOrdenes] = useState([])
  const [sel, setSel] = useState(null)
  const [insumos, setInsumos] = useState([])
  const [moldes, setMoldes] = useState([])
  const [tipos, setTipos] = useState([])
  const [clientes, setClientes] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [turnos, setTurnos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [articulos, setArticulos] = useState([])
  const [almacenes, setAlmacenes] = useState([])
  const [existencias, setExistencias] = useState([])
  const [lotes, setLotes] = useState([])
  const [form, setForm] = useState(null)
  const [ins, setIns] = useState({ modo: 'articulo', articulo_id: '', almacen_id: '', descripcion: '', cantidad: '', costo_unitario: '' })
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtro, setFiltro] = useState('abiertas')
  const [param, setParam] = useState(null)
  const [firmas, setFirmas] = useState([])

  useEffect(() => { cargar() }, [site])
  const cargar = async () => {
    const sid = siteEfectivo(perfil, site)
    setLoading(true)
    const emp = perfil.empresa_id
    const [o, mo, ti, cl, mq, tu, us, ar, al, ex, lo] = await Promise.all([
      supabase.from('molde_mtto').select('*, molde:moldes(clave), tipo:mtto_tipos(nombre, clase, reinicia_contador), cliente:clientes(nombre), maquina:maquinas(clave)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('moldes').select('*').eq('empresa_id', emp).order('clave'),
      supabase.from('mtto_tipos').select('*').eq('empresa_id', emp).eq('activo', true),
      supabase.from('clientes').select('id, nombre').eq('empresa_id', emp),
      (sid ? supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', emp).eq('site_id', sid) : supabase.from('maquinas').select('id, clave, nombre, site_id').eq('empresa_id', emp)),
      supabase.from('turnos').select('*').eq('empresa_id', emp),
      supabase.from('usuarios').select('id, nombre, rol').eq('empresa_id', emp),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, costo').eq('empresa_id', emp),
      supabase.from('almacenes').select('*').eq('empresa_id', emp).eq('activo', true),
      supabase.from('existencias').select('*'),
      supabase.from('lotes').select('id, articulo_id, estatus_calidad, fecha, empresa_id').eq('empresa_id', emp),
    ])
    setOrdenes((o.data || []).filter(x => { if (!sid) return true; const _ids = (mq.data || []).map(z => z.id); return !x.maquina_id || _ids.includes(x.maquina_id) })); setMoldes(mo.data || []); setTipos(ti.data || []); setClientes(cl.data || [])
    setMaquinas(mq.data || []); setTurnos(tu.data || []); setUsuarios(us.data || []); setArticulos(ar.data || [])
    setAlmacenes(al.data || []); setExistencias(ex.data || []); setLotes(lo.data || [])
    const { data: pa } = await supabase.from('mtto_parametros').select('*').eq('empresa_id', emp).maybeSingle()
    setParam(pa || { tryout_requiere_calidad: true, tryout_requiere_produccion: true, tryout_requiere_ingenieria: true })
    const { data: pv } = await supabase.from('proveedores').select('id, nombre').eq('empresa_id', emp).eq('activo', true)
    setProveedores(pv || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const loteDe = (id) => lotes.find(l => l.id === id)
  const moldeDe = (id) => moldes.find(m => m.id === id)
  const tipoDe = (id) => tipos.find(t => t.id === id)
  const provDe = (id) => proveedores.find(p => p.id === id)?.nombre || '-'

  const abrirNueva = () => { setError(''); setExito(''); setForm({ molde_id: '', tipo_id: '', motivo_origen: 'interno', cliente_id: '', es_cobrable: false, monto_cobrado: '', causa: '', maquina_id: '', operador_id: '', turno_id: '', supervisor_id: '', descripcion: '', es_externo: false, proveedor_id: '', costo_externo: '' }); setVista('nueva') }

  const crear = async () => {
    setError('')
    const f = form
    if (!f.molde_id || !f.tipo_id) { setError('Selecciona molde y tipo de mantenimiento.'); return }
    if (f.motivo_origen === 'cliente' && !f.cliente_id) { setError('Indica el cliente que solicita.'); return }
    setProc(true)
    try {
      const molde = moldeDe(Number(f.molde_id))
      const tipo = tipoDe(Number(f.tipo_id))
      const folio = `MM-${Date.now().toString().slice(-8)}`
      const { data: mm, error: e1 } = await supabase.from('molde_mtto').insert({
        empresa_id: perfil.empresa_id, folio, molde_id: Number(f.molde_id), tipo_id: Number(f.tipo_id),
        motivo_origen: f.motivo_origen, cliente_id: f.motivo_origen === 'cliente' && f.cliente_id ? Number(f.cliente_id) : null,
        es_cobrable: f.motivo_origen === 'cliente' && !!f.es_cobrable, monto_cobrado: f.es_cobrable && f.monto_cobrado !== '' ? Number(f.monto_cobrado) : null,
        causa: f.causa || null, maquina_id: f.maquina_id ? Number(f.maquina_id) : null,
        operador_id: f.operador_id || null, turno_id: f.turno_id ? Number(f.turno_id) : null, supervisor_id: f.supervisor_id || null,
        descripcion: f.descripcion || null, reinicia_contador: !!tipo?.reinicia_contador,
        es_externo: !!f.es_externo, proveedor_id: f.es_externo && f.proveedor_id ? Number(f.proveedor_id) : null,
        costo_externo: f.es_externo && f.costo_externo !== '' ? Number(f.costo_externo) : null, fecha_envio_ext: f.es_externo ? new Date().toISOString().split('T')[0] : null,
        shots_al_abrir: Number(molde?.shots_acumulados || 0), estatus: 'en_proceso', fecha_inicio: new Date().toISOString(), creado_por: perfil.id,
      }).select().single()
      if (e1) throw e1
      // El molde deja de estar disponible (no programable)
      const nuevoEstado = tipo?.clase === 'correctivo' ? 'en_reparacion' : 'en_mantenimiento'
      await supabase.from('moldes').update({ estado: nuevoEstado }).eq('id', Number(f.molde_id))
      setExito(`Orden ${folio} abierta. Molde ${molde?.clave} -> ${nuevoEstado.replace(/_/g, ' ')}.`)
      await cargar(); abrirDetalle({ id: mm.id })
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const abrirDetalle = async (o) => {
    setError(''); setExito('')
    const { data: mm } = await supabase.from('molde_mtto').select('*, molde:moldes(clave, shots_acumulados), tipo:mtto_tipos(nombre, clase, reinicia_contador), cliente:clientes(nombre), maquina:maquinas(clave)').eq('id', o.id).single()
    const { data: insu } = await supabase.from('molde_mtto_insumos').select('*').eq('mtto_id', o.id).order('id')
    const { data: fr } = await supabase.from('molde_mtto_firmas').select('*').eq('mtto_id', o.id)
    setFirmas(fr || [])
    setSel(mm); setInsumos(insu || []); setIns({ modo: 'articulo', articulo_id: '', almacen_id: '', descripcion: '', cantidad: '', costo_unitario: '' })
    setVista('detalle')
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
    setError('')
    const cant = Number(ins.cantidad), cu = Number(ins.costo_unitario)
    if (!(cant > 0)) { setError('Captura la cantidad del insumo.'); return }
    setProc(true)
    try {
      let articulo_id = null, descripcion = ins.descripcion || null, lote_id = null, almacen_id = null, cu2 = cu
      if (ins.modo === 'articulo') {
        if (!ins.articulo_id) throw new Error('Selecciona el articulo/refaccion.')
        if (!ins.almacen_id) throw new Error('Selecciona el almacen para descontar.')
        articulo_id = Number(ins.articulo_id); almacen_id = Number(ins.almacen_id)
        if (!cu2) cu2 = Number(artDe(articulo_id)?.costo || 0)
        const { tomados, faltante } = deducir(articulo_id, cant, almacen_id)
        if (faltante > 0.001) throw new Error(`Faltan ${fmt(faltante)} de ${artDe(articulo_id)?.codigo_interno} (liberado) en ese almacen.`)
        for (const t of tomados) {
          const nueva = Number(t.ex.cantidad) - t.toma
          if (nueva <= 0.000001) await supabase.from('existencias').delete().eq('id', t.ex.id)
          else await supabase.from('existencias').update({ cantidad: nueva }).eq('id', t.ex.id)
          await supabase.from('movimientos').insert({ empresa_id: perfil.empresa_id, articulo_id, lote_id: t.ex.lote_id, tipo: 'ajuste_negativo', almacen_origen_id: almacen_id, cantidad: t.toma, motivo: `Mantenimiento molde ${sel.folio}`, usuario_id: perfil.id })
          lote_id = t.ex.lote_id
        }
        descripcion = artDe(articulo_id)?.descripcion || null
      } else {
        if (!descripcion) throw new Error('Describe el gasto.')
      }
      await supabase.from('molde_mtto_insumos').insert({ mtto_id: sel.id, articulo_id, descripcion, cantidad: cant, costo_unitario: cu2, costo_total: cant * cu2, lote_id, almacen_id })
      await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error al agregar insumo: ' + err.message) }
    setProc(false)
  }

  const areasReq = () => { const r = []; if (param?.tryout_requiere_calidad) r.push('calidad'); if (param?.tryout_requiere_produccion) r.push('produccion'); if (param?.tryout_requiere_ingenieria) r.push('ingenieria'); return r }
  const rolArea = (rol) => ['calidad', 'gerente_calidad'].includes(rol) ? 'calidad' : ['produccion', 'gerente_produccion'].includes(rol) ? 'produccion' : ['gerente_ingenieria', 'ingeniero_nuevos_proyectos'].includes(rol) ? 'ingenieria' : null
  const puedeFirmar = (area) => perfil?.rol === 'admin' || rolArea(perfil?.rol) === area

  const liberar = async (efectiva) => {
    await supabase.from('molde_mtto').update({ estatus: 'cerrada', tryout_efectiva: efectiva, fecha_fin: new Date().toISOString() }).eq('id', sel.id)
    const patchMolde = { estado: 'disponible' }
    if (sel.reinicia_contador) { patchMolde.shots_acumulados = 0; patchMolde.fecha_ultimo_mtto = new Date().toISOString().split('T')[0] }
    await supabase.from('moldes').update(patchMolde).eq('id', sel.molde_id)
  }

  const cerrar = async () => {
    setError('')
    if (!window.confirm('Cerrar la orden y liberar el molde?')) return
    setProc(true)
    try {
      await liberar(true)
      setExito(`Orden ${sel.folio} cerrada. Molde disponible.${sel.reinicia_contador ? ' Contador de shots reiniciado.' : ''}`)
      await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error al cerrar: ' + err.message) }
    setProc(false)
  }

  const enviarTryout = async () => {
    setError(''); setProc(true)
    try {
      await supabase.from('molde_mtto').update({ estatus: 'tryout' }).eq('id', sel.id)
      setExito('Enviada a try-out. Debe validar: ' + areasReq().join(', ') + '.')
      await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const firmar = async (area, decision) => {
    setError(''); setProc(true)
    try {
      await supabase.from('molde_mtto_firmas').upsert({ mtto_id: sel.id, area, decision, firmado_por: perfil.id }, { onConflict: 'mtto_id,area' })
      const req = areasReq()
      const { data: fr } = await supabase.from('molde_mtto_firmas').select('*').eq('mtto_id', sel.id)
      const map = {}; (fr || []).forEach(f => { map[f.area] = f.decision })
      if (req.every(a => map[a])) {
        if (req.some(a => map[a] === 'rechazada')) {
          await supabase.from('molde_mtto').update({ estatus: 'en_proceso', tryout_efectiva: false, reintentos: Number(sel.reintentos || 0) + 1 }).eq('id', sel.id)
          await supabase.from('molde_mtto_firmas').delete().eq('mtto_id', sel.id)
          setExito('Try-out NO efectivo: la orden regresa a proceso (reincidencia). Repara y reenvia a try-out.')
        } else {
          await liberar(true)
          setExito(`Try-out aprobado. Orden ${sel.folio} cerrada y molde liberado.${sel.reinicia_contador ? ' Shots reiniciados.' : ''}`)
        }
      } else {
        setExito(`Firma registrada (${area}: ${decision}).`)
      }
      await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error al firmar: ' + err.message) }
    setProc(false)
  }

  const iniciar = async () => {
    setProc(true); setError('')
    try {
      await supabase.from('molde_mtto').update({ estatus: 'en_proceso', fecha_inicio: new Date().toISOString() }).eq('id', sel.id)
      const est = sel.tipo?.clase === 'correctivo' ? 'en_reparacion' : 'en_mantenimiento'
      await supabase.from('moldes').update({ estado: est }).eq('id', sel.molde_id)
      setExito('Mantenimiento iniciado. Molde -> ' + est.replace(/_/g, ' ') + '.')
      await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }
  const marcarFacturado = async () => {
    await supabase.from('molde_mtto').update({ facturado: true }).eq('id', sel.id)
    setExito('Marcada como facturada.'); await cargar(); await abrirDetalle(sel)
  }
  const registrarRetorno = async () => {
    await supabase.from('molde_mtto').update({ fecha_retorno_ext: new Date().toISOString().split('T')[0] }).eq('id', sel.id)
    setExito('Retorno del molde registrado.'); await cargar(); await abrirDetalle(sel)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // ---------- NUEVA ----------
  if (vista === 'nueva') {
    const esCliente = form.motivo_origen === 'cliente'
    const operadores = usuarios.filter(u => ['produccion', 'gerente_produccion'].includes(u.rol))
    const supervisores = usuarios.filter(u => ['gerente_produccion', 'produccion', 'gerente_calidad', 'gerente_ingenieria'].includes(u.rol))
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => setVista('lista')}>&larr; Volver</button>
        <h2 style={styles.titulo}>Nueva orden de mantenimiento</h2>
      <div style={{ marginBottom: 10 }} className="no-imprimir"><FiltroSite value={site} onChange={setSite} /></div>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.tarjeta}>
          <div style={styles.fila}>
            <Campo label="Molde *"><select style={styles.input} value={form.molde_id} onChange={e => setForm({ ...form, molde_id: e.target.value })}><option value="">Selecciona...</option>{moldes.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre} ({(m.estado || 'disponible').replace(/_/g, ' ')})</option>)}</select></Campo>
            <Campo label="Tipo *"><select style={styles.input} value={form.tipo_id} onChange={e => setForm({ ...form, tipo_id: e.target.value })}><option value="">Selecciona...</option>{tipos.map(t => <option key={t.id} value={t.id}>{t.nombre} {t.reinicia_contador ? '(reinicia shots)' : ''}</option>)}</select></Campo>
          </div>
          <div style={styles.fila}>
            <Campo label="Motivo"><select style={styles.input} value={form.motivo_origen} onChange={e => setForm({ ...form, motivo_origen: e.target.value })}><option value="interno">Interno</option><option value="cliente">Solicitado por cliente</option></select></Campo>
            {esCliente && <Campo label="Cliente *"><select style={styles.input} value={form.cliente_id} onChange={e => setForm({ ...form, cliente_id: e.target.value })}><option value="">Selecciona...</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>}
            {esCliente && <Campo label="Cobrable"><label style={styles.check}><input type="checkbox" checked={!!form.es_cobrable} onChange={e => setForm({ ...form, es_cobrable: e.target.checked })} /> Se cobra al cliente</label></Campo>}
            {esCliente && form.es_cobrable && <Campo label="Monto a cobrar"><input type="number" min="0" style={styles.input} value={form.monto_cobrado} onChange={e => setForm({ ...form, monto_cobrado: e.target.value })} /></Campo>}
          </div>
          <div style={styles.fila}>
            <Campo label="Causa raiz"><select style={styles.input} value={form.causa} onChange={e => setForm({ ...form, causa: e.target.value })}><option value="">Selecciona...</option>{CAUSAS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></Campo>
            <Campo label="Maquina (si aplica)"><select style={styles.input} value={form.maquina_id} onChange={e => setForm({ ...form, maquina_id: e.target.value })}><option value="">-</option>{maquinas.map(m => <option key={m.id} value={m.id}>{m.clave}</option>)}</select></Campo>
            <Campo label="Turno"><select style={styles.input} value={form.turno_id} onChange={e => setForm({ ...form, turno_id: e.target.value })}><option value="">-</option>{turnos.map(t => <option key={t.id} value={t.id}>{t.nombre || t.clave || t.id}</option>)}</select></Campo>
          </div>
          <div style={styles.fila}>
            <Campo label="Operador"><select style={styles.input} value={form.operador_id} onChange={e => setForm({ ...form, operador_id: e.target.value })}><option value="">-</option>{operadores.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
            <Campo label="Supervisor"><select style={styles.input} value={form.supervisor_id} onChange={e => setForm({ ...form, supervisor_id: e.target.value })}><option value="">-</option>{supervisores.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
          </div>
          <Campo label="Descripcion / trabajo a realizar"><input style={styles.input} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} /></Campo>
          <div style={styles.fila}>
            <Campo label="Trabajo externo"><label style={styles.check}><input type="checkbox" checked={!!form.es_externo} onChange={e => setForm({ ...form, es_externo: e.target.checked })} /> Se realiza fuera de la planta</label></Campo>
            {form.es_externo && <Campo label="Proveedor / taller"><select style={styles.input} value={form.proveedor_id} onChange={e => setForm({ ...form, proveedor_id: e.target.value })}><option value="">Selecciona...</option>{proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>}
            {form.es_externo && <Campo label="Costo externo"><input type="number" min="0" style={styles.input} value={form.costo_externo} onChange={e => setForm({ ...form, costo_externo: e.target.value })} /></Campo>}
          </div>
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setVista('lista')} disabled={proc}>Cancelar</button><button style={styles.boton} onClick={crear} disabled={proc}>{proc ? 'Guardando...' : 'Abrir orden'}</button></div>
        </div>
      </div>
    )
  }

  // ---------- DETALLE ----------
  if (vista === 'detalle' && sel) {
    const costoTotal = insumos.reduce((s, i) => s + Number(i.costo_total), 0) + Number(sel.costo_externo || 0)
    const abierta = ['programada', 'en_proceso', 'tryout'].includes(sel.estatus)
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => { setVista('lista'); cargar() }}>&larr; Volver</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={styles.titulo}>{sel.folio} · Molde {sel.molde?.clave}</h2>
          <span style={badgeEstatus(sel.estatus)}>{sel.estatus.replace(/_/g, ' ')}</span>
        </div>
        <p style={styles.sub}>{sel.tipo?.nombre} · motivo {sel.motivo_origen}{sel.cliente?.nombre ? ` (${sel.cliente.nombre})` : ''} · causa {sel.causa ? sel.causa.replace(/_/g, ' ') : '-'} {sel.maquina?.clave ? `· maquina ${sel.maquina.clave}` : ''}</p>
        {sel.es_cobrable && <p style={styles.cobro}>Cobrable al cliente: <b>${fmt(sel.monto_cobrado)}</b> {sel.facturado ? '(facturado)' : '(pendiente de facturar)'}</p>}
        {sel.es_externo && (<div style={styles.extBox}>Trabajo <b>externo</b> en <b>{provDe(sel.proveedor_id)}</b> · costo ${fmt(sel.costo_externo)} · enviado {sel.fecha_envio_ext || '-'} · retorno {sel.fecha_retorno_ext || 'pendiente'}{['programada', 'en_proceso', 'tryout'].includes(sel.estatus) && !sel.fecha_retorno_ext && puedeEditar && <button style={styles.botonMiniExt} onClick={registrarRetorno} disabled={proc}>Registrar retorno</button>}</div>)}
        {error && <p style={styles.error}>{error}</p>}
        {exito && <p style={styles.exito}>{exito}</p>}

        <div style={styles.tarjeta}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={styles.h3}>Insumos y gastos · Costo total: ${fmt(costoTotal)}</h3>
          </div>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 2 }}>Concepto</span><span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span><span style={{ flex: 1, textAlign: 'right' }}>Costo unit.</span><span style={{ flex: 1, textAlign: 'right' }}>Total</span></div>
            {insumos.map(i => (
              <div key={i.id} style={styles.tr}><span style={{ flex: 2 }}>{i.articulo_id ? <b>{artDe(i.articulo_id)?.codigo_interno} </b> : <span style={{ color: '#7c3aed' }}>Gasto </span>}<span style={{ color: '#64748b' }}>{i.descripcion}</span></span><span style={{ flex: 1, textAlign: 'right' }}>{fmt(i.cantidad)}</span><span style={{ flex: 1, textAlign: 'right' }}>${fmt(i.costo_unitario)}</span><span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>${fmt(i.costo_total)}</span></div>
            ))}
            {insumos.length === 0 && <div style={styles.vacio}>Sin insumos.</div>}
          </div>
          {abierta && puedeEditar && (
            <div style={{ ...styles.fila, marginTop: '12px', alignItems: 'flex-end' }}>
              <Campo label="Tipo"><select style={styles.input} value={ins.modo} onChange={e => setIns({ ...ins, modo: e.target.value })}><option value="articulo">Refaccion (inventario)</option><option value="gasto">Gasto libre</option></select></Campo>
              {ins.modo === 'articulo'
                ? <>
                    <Campo label="Articulo"><select style={styles.input} value={ins.articulo_id} onChange={e => setIns({ ...ins, articulo_id: e.target.value })}><option value="">Selecciona...</option>{articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno}</option>)}</select></Campo>
                    <Campo label="Almacen"><select style={styles.input} value={ins.almacen_id} onChange={e => setIns({ ...ins, almacen_id: e.target.value })}><option value="">Selecciona...</option>{almacenes.filter(a => !a.es_virtual).map(a => <option key={a.id} value={a.id}>{a.clave}</option>)}</select></Campo>
                  </>
                : <Campo label="Descripcion del gasto"><input style={styles.input} value={ins.descripcion} onChange={e => setIns({ ...ins, descripcion: e.target.value })} /></Campo>}
              <Campo label="Cantidad"><input type="number" min="0" style={{ ...styles.input, width: '90px' }} value={ins.cantidad} onChange={e => setIns({ ...ins, cantidad: e.target.value })} /></Campo>
              <Campo label="Costo unit."><input type="number" min="0" style={{ ...styles.input, width: '100px' }} value={ins.costo_unitario} onChange={e => setIns({ ...ins, costo_unitario: e.target.value })} placeholder="auto" /></Campo>
              <button style={styles.boton} onClick={agregarInsumo} disabled={proc}>Agregar</button>
            </div>
          )}
        </div>

        {sel.estatus === 'programada' && puedeEditar && (
          <div style={styles.botones}><button style={styles.boton} onClick={iniciar} disabled={proc}>Iniciar mantenimiento</button></div>
        )}
        {sel.estatus === 'en_proceso' && puedeEditar && (
          <div style={styles.botones}>
            {areasReq().length > 0
              ? <button style={styles.boton} onClick={enviarTryout} disabled={proc}>Enviar a try-out</button>
              : <button style={styles.botonCerrar} onClick={cerrar} disabled={proc}>Cerrar orden y liberar molde</button>}
          </div>
        )}
        {sel.estatus === 'tryout' && (
          <div style={styles.tarjeta}>
            <h3 style={styles.h3}>Try-out de liberacion</h3>
            <p style={styles.sub}>Validan que la reparacion fue efectiva. Con un rechazo la orden regresa a proceso (reincidencia). Reintentos: {fmt(sel.reintentos)}.</p>
            <div style={styles.tabla}>
              <div style={styles.th}><span style={{ flex: 1 }}>Area</span><span style={{ flex: 1 }}>Decision</span><span style={{ flex: 1.4 }}>Firmo</span><span style={{ width: '190px' }}></span></div>
              {areasReq().map(a => { const f = firmas.find(x => x.area === a); return (
                <div key={a} style={styles.tr}>
                  <span style={{ flex: 1, textTransform: 'capitalize' }}>{a}</span>
                  <span style={{ flex: 1 }}>{f ? <span style={f.decision === 'aprobada' ? styles.pillOk : styles.pillNo}>{f.decision}</span> : <span style={{ color: '#94a3b8' }}>pendiente</span>}</span>
                  <span style={{ flex: 1.4, color: '#64748b', fontSize: '12px' }}>{f ? (usuarios.find(u => u.id === f.firmado_por)?.nombre || '') : ''}</span>
                  <span style={{ width: '190px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                    {!f && puedeFirmar(a) && <><button style={styles.botonMiniOk} onClick={() => firmar(a, 'aprobada')} disabled={proc}>Aprobar</button><button style={styles.botonMiniNo} onClick={() => firmar(a, 'rechazada')} disabled={proc}>Rechazar</button></>}
                  </span>
                </div>) })}
            </div>
          </div>
        )}
        <p style={styles.hint}>Shots al abrir: {fmt(sel.shots_al_abrir)} · {sel.reinicia_contador ? 'Al cerrar (try-out aprobado) se reinicia el contador de shots.' : 'Este tipo NO reinicia el contador.'}</p>
        {sel.es_cobrable && !sel.facturado && puedeEditar && (<div style={styles.botones}><button style={styles.botonSec} onClick={marcarFacturado} disabled={proc}>Marcar como facturado</button></div>)}
      </div>
    )
  }

  // ---------- LISTA (historico) ----------
  const lista = ordenes.filter(o => filtro === 'todas' ? true : filtro === 'abiertas' ? ['programada', 'en_proceso', 'tryout'].includes(o.estatus) : o.estatus === 'cerrada')
  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Ordenes de mantenimiento de molde</h2>
        {puedeCrear && <button style={styles.boton} onClick={abrirNueva}>Nueva orden</button>}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      <div style={styles.tabs}>
        {[['abiertas', 'Abiertas'], ['cerradas', 'Cerradas (historico)'], ['todas', 'Todas']].map(([id, n]) => (
          <button key={id} style={filtro === id ? styles.tabAct : styles.tab} onClick={() => setFiltro(id)}>{n}</button>
        ))}
      </div>
      <div style={styles.tabla}>
        <div style={styles.th}><span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1 }}>Molde</span><span style={{ flex: 1.4 }}>Tipo</span><span style={{ flex: 1 }}>Motivo</span><span style={{ flex: 1.2 }}>Causa</span><span style={{ flex: 1 }}>Estatus</span><span style={{ flex: 1 }}>Inicio</span><span style={{ width: '80px' }}></span></div>
        {lista.map(o => (
          <div key={o.id} style={styles.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{o.folio}</span>
            <span style={{ flex: 1 }}>{o.molde?.clave}</span>
            <span style={{ flex: 1.4, color: '#475569' }}>{o.tipo?.nombre}</span>
            <span style={{ flex: 1 }}>{o.motivo_origen}{o.es_cobrable ? ' 💲' : ''}</span>
            <span style={{ flex: 1.2, color: '#64748b', fontSize: '12px' }}>{o.causa ? o.causa.replace(/_/g, ' ') : '-'}</span>
            <span style={{ flex: 1 }}><span style={badgeEstatus(o.estatus)}>{o.estatus.replace(/_/g, ' ')}</span></span>
            <span style={{ flex: 1, color: '#64748b', fontSize: '12px' }}>{fFecha(o.fecha_inicio)}</span>
            <span style={{ width: '80px', textAlign: 'right' }}><button style={styles.botonAccion} onClick={() => abrirDetalle(o)}>Abrir</button></span>
          </div>
        ))}
        {lista.length === 0 && <div style={styles.vacio}>Sin ordenes.</div>}
      </div>
    </div>
  )
}

function Campo({ label, children }) { return (<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '160px' }}><label style={{ fontSize: '12px', fontWeight: 500, color: '#444' }}>{label}</label>{children}</div>) }
function badgeEstatus(s) { const c = { programada: ['#f1f5f9', '#64748b'], en_proceso: ['#fef3c7', '#b45309'], tryout: ['#dbeafe', '#2563eb'], cerrada: ['#dcfce7', '#15803d'], cancelada: ['#fee2e2', '#b91c1c'] }[s] || ['#f1f5f9', '#64748b']; return { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, backgroundColor: c[0], color: c[1] } }

const styles = {
  container: { padding: '28px', maxWidth: '1040px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  sub: { fontSize: '13px', color: '#64748b', margin: '6px 0 10px' },
  cobro: { fontSize: '13px', color: '#7c3aed', margin: '0 0 10px' },
  h3: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  volver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '14px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' },
  check: { display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#334155' },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' },
  boton: { padding: '9px 18px', backgroundColor: '#a16207', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonCerrar: { padding: '9px 18px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonAccion: { padding: '5px 12px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#a16207', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #a16207' },
  tabla: { border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  hint: { fontSize: '12px', color: '#94a3b8', marginTop: '10px', lineHeight: 1.5 },
  extBox: { backgroundColor: '#f5f3ff', border: '1px solid #ddd6fe', borderRadius: '8px', padding: '9px 12px', margin: '0 0 12px', fontSize: '13px', color: '#5b21b6', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' },
  botonMiniExt: { padding: '4px 10px', backgroundColor: '#7c3aed', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  pillOk: { padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' },
  pillNo: { padding: '2px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 700, backgroundColor: '#fee2e2', color: '#b91c1c' },
  botonMiniOk: { padding: '5px 10px', backgroundColor: '#16a34a', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  botonMiniNo: { padding: '5px 10px', backgroundColor: '#dc2626', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
