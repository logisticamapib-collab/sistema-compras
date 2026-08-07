import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// TOOLCRIB
//
// El almacen de herramental y refacciones no necesita entradas ni traspasos
// propios: eso ya funciona en Inventario. Lo que le faltaba era saber CONTRA
// QUE se consume, que es lo unico que permite responder que molde, que
// maquina o que area gasta mas y por que.
//
// El vale es ese documento. Y sustituye la captura de insumos en las ordenes
// de mantenimiento en lugar de sumarse a ella: si quedaran los dos caminos
// abiertos, la gente usaria el facil y los numeros nunca cuadrarian. Al
// surtir, el insumo se escribe solo en la orden.
//
// Una cosa es donde se COMPRA y otra donde se CONSUME. El mismo buje se
// compra bajo Logistica / Toolcrib y se consume bajo Produccion / Maquina 1;
// son dos asientos distintos. Por eso la imputacion de la SALIDA baja del
// destino: centro de costo y cuenta de gasto salen del molde, de su maquina o
// de su area, en cascada. La categoria del articulo, que es la clasificacion
// de compra, solo se usa como ultimo recurso si el destino no tiene cuenta.
// Un eje que se captura a mano se captura mal.

const hoyISO = () => new Date().toISOString().slice(0, 10)
const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const din = (n) => '$' + (Number(n) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const fecha = (t) => t ? new Date(t).toLocaleDateString('es-MX') : '-'

const DESTINOS = {
  molde: 'Molde', maquina: 'Maquina', area: 'Area',
  ot: 'Orden de produccion', general: 'General',
}
const MOTIVOS = {
  mantenimiento: 'Mantenimiento', rutina: 'Consumo de rutina',
  proyecto: 'Proyecto', emergencia: 'Emergencia', otro: 'Otro',
}
const EJES = {
  molde: 'Molde', maquina: 'Maquina', area: 'Area',
  articulo: 'Articulo', centro_costo: 'Centro de costo', cuenta: 'Cuenta de gasto',
}
const EST = {
  borrador: { txt: 'Por surtir', bg: '#fef3c7', col: '#92400e' },
  surtido: { txt: 'Surtido', bg: '#dcfce7', col: '#15803d' },
  cancelado: { txt: 'Cancelado', bg: '#e5e7eb', col: '#374151' },
}

const valeVacio = {
  almacen_id: '', destino_tipo: 'area', molde_id: '', maquina_id: '', area_id: '', ot_id: '',
  mtto_molde_id: '', mtto_gen_id: '', motivo: 'rutina', turno: '1o', notas: '',
}

export default function Toolcrib() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeCrear = tienePermiso('log_toolcrib', 'crear')
  const puedeAutorizar = tienePermiso('log_toolcrib', 'aprobar')

  const [tab, setTab] = useState('vales')
  const [site, setSite] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [param, setParam] = useState(null)
  const [almacenes, setAlmacenes] = useState([])
  const [moldes, setMoldes] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [areas, setAreas] = useState([])
  const [ots, setOts] = useState([])
  const [mttoMolde, setMttoMolde] = useState([])
  const [mttoGen, setMttoGen] = useState([])
  const [articulos, setArticulos] = useState([])
  const [centros, setCentros] = useState([])
  const [cuentas, setCuentas] = useState([])
  const [vales, setVales] = useState([])
  const [existencias, setExistencias] = useState([])

  const [desde, setDesde] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10) })
  const [hasta, setHasta] = useState(hoyISO())
  const [eje, setEje] = useState('molde')
  const [consumo, setConsumo] = useState([])
  const [reinc, setReinc] = useState([])
  const [costoMolde, setCostoMolde] = useState([])

  const [form, setForm] = useState(null)
  const [valeSel, setValeSel] = useState(null)
  const [lineas, setLineas] = useState([])
  const [nuevaLinea, setNuevaLinea] = useState({ articulo_id: '', cantidad: '', notas: '' })
  const [imput, setImput] = useState(null)

  useEffect(() => { cargar() }, [site])
  useEffect(() => { cargarAnalisis() }, [desde, hasta, eje, site])
  useEffect(() => { if (valeSel) cargarLineas(valeSel) }, [valeSel])

  const cargar = async () => {
    setLoading(true); setError('')
    const sid = siteEfectivo(perfil, site)
    const [pa, al, mo, mq, ar, ot, mm, mg, art, va, cc, cg] = await Promise.all([
      supabase.from('toolcrib_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('almacenes').select('id, clave, nombre, site_id, es_toolcrib')
        .eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('moldes').select('id, clave, nombre, maquina_asignada_id, centro_costo_id, cuenta_gasto_id')
        .eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('maquinas').select('id, clave, nombre, area_id, centro_costo_id, cuenta_gasto_id')
        .eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('areas').select('id, clave, nombre, centro_costo_id, cuenta_gasto_id')
        .eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('ordenes_trabajo').select('id, folio, articulo_id')
        .eq('empresa_id', emp).in('estatus', ['programada', 'en_proceso'])
        .order('fecha_programada', { ascending: false }).limit(80),
      supabase.from('molde_mtto').select('id, folio, molde_id, estatus')
        .eq('empresa_id', emp).in('estatus', ['programada', 'en_proceso', 'tryout']).order('id', { ascending: false }).limit(80),
      supabase.from('mtto_gen_ordenes').select('id, folio, maquina_id, objeto, estatus, titulo')
        .eq('empresa_id', emp).in('estatus', ['abierta', 'asignada', 'en_proceso']).order('id', { ascending: false }).limit(80),
      supabase.from('articulos').select('id, codigo_interno, descripcion, unidad_medida, costo, categoria_id, categorias(nombre, tipo)')
        .eq('empresa_id', emp).eq('activo', true).order('codigo_interno'),
      supabase.from('toolcrib_vales')
        .select('*, moldes(clave), maquinas(clave), areas(clave), centros_costos(codigo), cuentas_gastos(codigo)')
        .eq('empresa_id', emp).order('fecha', { ascending: false }).limit(200),
      supabase.from('centros_costos').select('id, codigo, nombre').eq('activo', true).order('codigo'),
      supabase.from('cuentas_gastos').select('id, codigo, nombre').eq('activo', true).order('codigo'),
    ])
    setParam(pa.data || null)
    setAlmacenes(al.data || []); setMoldes(mo.data || []); setMaquinas(mq.data || [])
    setAreas(ar.data || []); setOts(ot.data || []); setMttoMolde(mm.data || [])
    setMttoGen(mg.data || []); setArticulos(art.data || []); setVales(va.data || [])
    setCentros(cc.data || []); setCuentas(cg.data || [])

    const tc = (al.data || []).find(a => a.es_toolcrib)
    if (tc) {
      const { data: ex } = await supabase.rpc('toolcrib_existencias', { p_empresa_id: emp, p_almacen_id: tc.id })
      setExistencias(ex || [])
    }
    setLoading(false)
  }

  const cargarAnalisis = async () => {
    const sid = siteEfectivo(perfil, site)
    const [c, r, cm] = await Promise.all([
      supabase.rpc('toolcrib_consumo', { p_empresa_id: emp, p_desde: desde, p_hasta: hasta, p_agrupar: eje, p_site_id: sid || null }),
      supabase.rpc('toolcrib_reincidencia', { p_empresa_id: emp, p_desde: desde, p_hasta: hasta, p_min_veces: 3, p_site_id: sid || null }),
      supabase.rpc('toolcrib_costo_molde', { p_empresa_id: emp, p_desde: desde, p_hasta: hasta }),
    ])
    setConsumo(c.data || []); setReinc(r.data || []); setCostoMolde(cm.data || [])
  }

  const cargarLineas = async (id) => {
    const { data } = await supabase.from('toolcrib_vale_lineas')
      .select('*, articulos(codigo_interno, descripcion, unidad_medida), cuentas_gastos(codigo)')
      .eq('vale_id', id).order('id')
    setLineas(data || [])
  }

  // ---------- Imputacion previa ----------
  const verImputacion = async (f) => {
    if (!f.destino_tipo) { setImput(null); return }
    const { data } = await supabase.rpc('toolcrib_imputacion', {
      p_empresa_id: emp, p_destino_tipo: f.destino_tipo,
      p_molde_id: f.molde_id ? Number(f.molde_id) : null,
      p_maquina_id: f.maquina_id ? Number(f.maquina_id) : null,
      p_area_id: f.area_id ? Number(f.area_id) : null,
      p_ot_id: f.ot_id ? Number(f.ot_id) : null,
    })
    setImput((data && data[0]) || null)
  }

  const cambiarForm = (campo, valor) => {
    const f = { ...form, [campo]: valor }
    if (campo === 'destino_tipo') {
      f.molde_id = ''; f.maquina_id = ''; f.area_id = ''; f.ot_id = ''
      f.mtto_molde_id = ''; f.mtto_gen_id = ''
    }
    // Al elegir la orden de mantenimiento, el destino se deduce solo.
    if (campo === 'mtto_molde_id' && valor) {
      const m = mttoMolde.find(x => String(x.id) === String(valor))
      if (m) { f.destino_tipo = 'molde'; f.molde_id = String(m.molde_id); f.motivo = 'mantenimiento' }
    }
    if (campo === 'mtto_gen_id' && valor) {
      const m = mttoGen.find(x => String(x.id) === String(valor))
      if (m && m.maquina_id) { f.destino_tipo = 'maquina'; f.maquina_id = String(m.maquina_id) }
      if (m) f.motivo = 'mantenimiento'
    }
    setForm(f); verImputacion(f)
  }

  // ---------- Vale ----------
  const crearVale = async () => {
    setError(''); setExito('')
    if (!form.almacen_id) { setError('Elige el almacen de donde sale el material'); return }
    const req = { molde: 'molde_id', maquina: 'maquina_id', area: 'area_id', ot: 'ot_id' }[form.destino_tipo]
    if (req && !form[req]) { setError(`Elige el ${DESTINOS[form.destino_tipo].toLowerCase()} contra el que se consume`); return }
    const { data, error: e } = await supabase.rpc('crear_vale_toolcrib', {
      p_empresa_id: emp, p_site_id: siteEfectivo(perfil, site) || perfil.site_id || null,
      p_almacen_id: Number(form.almacen_id), p_destino_tipo: form.destino_tipo,
      p_molde_id: form.molde_id ? Number(form.molde_id) : null,
      p_maquina_id: form.maquina_id ? Number(form.maquina_id) : null,
      p_area_id: form.area_id ? Number(form.area_id) : null,
      p_ot_id: form.ot_id ? Number(form.ot_id) : null,
      p_mtto_molde_id: form.mtto_molde_id ? Number(form.mtto_molde_id) : null,
      p_mtto_gen_id: form.mtto_gen_id ? Number(form.mtto_gen_id) : null,
      p_motivo: form.motivo, p_turno: form.turno,
      p_usuario: perfil.id, p_notas: form.notas || null,
    })
    if (e) { setError(e.message); return }
    setForm(null); setImput(null); setExito('Vale creado. Agrega los renglones y surtelo.')
    await cargar(); setValeSel(data); setTab('vales')
  }

  const agregarLinea = async () => {
    setError('')
    if (!nuevaLinea.articulo_id || !nuevaLinea.cantidad) { setError('Elige el articulo y la cantidad'); return }
    if (Number(nuevaLinea.cantidad) <= 0) { setError('La cantidad debe ser mayor a cero'); return }
    const { error: e } = await supabase.from('toolcrib_vale_lineas').insert({
      vale_id: valeSel, articulo_id: Number(nuevaLinea.articulo_id),
      cantidad: Number(nuevaLinea.cantidad), notas: nuevaLinea.notas || null,
    })
    if (e) { setError('No se pudo agregar: ' + e.message); return }
    setNuevaLinea({ articulo_id: '', cantidad: '', notas: '' }); cargarLineas(valeSel)
  }

  const quitarLinea = async (l) => {
    const { error: e } = await supabase.from('toolcrib_vale_lineas').delete().eq('id', l.id)
    if (e) { setError('No se pudo quitar: ' + e.message); return }
    cargarLineas(valeSel)
  }

  const autorizar = async (v) => {
    setError(''); setExito('')
    const { error: e } = await supabase.rpc('autorizar_vale_toolcrib', {
      p_empresa_id: emp, p_vale_id: v.id, p_usuario: perfil.id,
    })
    if (e) { setError(e.message); return }
    setExito(`Vale ${v.folio} autorizado`); cargar()
  }

  const surtir = async (v) => {
    setError(''); setExito('')
    const quien = prompt('Nombre de quien recibe el material:')
    if (!quien) return
    const { data, error: e } = await supabase.rpc('surtir_vale_toolcrib', {
      p_empresa_id: emp, p_vale_id: v.id, p_usuario: perfil.id, p_recibido_por: quien,
    })
    if (e) { setError(e.message); return }
    setExito(`Vale ${v.folio} surtido por ${din(data)}${v.mtto_molde_id || v.mtto_gen_id ? '. El insumo ya quedo en la orden de mantenimiento.' : ''}`)
    cargar(); cargarLineas(v.id); cargarAnalisis()
  }

  const cancelar = async (v) => {
    if (!confirm(`Se va a cancelar el vale ${v.folio}. Confirma para continuar.`)) return
    setError(''); setExito('')
    const { error: e } = await supabase.rpc('cancelar_vale_toolcrib', { p_empresa_id: emp, p_vale_id: v.id })
    if (e) { setError(e.message); return }
    setExito('Vale cancelado'); cargar()
  }

  // La imputacion llega resuelta del destino, pero siempre hay excepciones.
  // Solo se puede corregir en borrador: la base rechaza el cambio despues de
  // surtir, porque ya habria un asiento hecho.
  const guardarImputacion = async (v, campo, valor) => {
    setError(''); setExito('')
    const { error: e } = await supabase.from('toolcrib_vales')
      .update({ [campo]: valor ? Number(valor) : null }).eq('id', v.id)
    if (e) { setError(e.message); return }
    setExito('Imputacion actualizada'); cargar()
  }

  const guardarParam = async (campo, valor) => {
    const v = ['monto_autorizacion', 'avisar_monto'].includes(campo) ? Number(valor) || 0 : valor
    const { error: e } = await supabase.from('toolcrib_parametros').upsert({
      empresa_id: emp, [campo]: v, updated_at: new Date().toISOString(), updated_by: perfil.id,
    }, { onConflict: 'empresa_id' })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setParam(p => ({ ...p, [campo]: v })); setExito('Configuracion actualizada')
  }

  const marcarToolcrib = async (alm, valor) => {
    const { error: e } = await supabase.from('almacenes').update({ es_toolcrib: valor }).eq('id', alm.id)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setExito(`${alm.clave} ${valor ? 'marcado como' : 'ya no es'} toolcrib`); cargar()
  }

  // ---------- Derivados ----------
  const almToolcrib = almacenes.filter(a => a.es_toolcrib)
  const vale = vales.find(v => v.id === valeSel)
  const totalLineas = lineas.reduce((s, l) => s + Number(l.costo_total || (l.cantidad * (articulos.find(a => a.id === l.articulo_id)?.costo || 0))), 0)
  const porSurtir = vales.filter(v => v.estatus === 'borrador')
  const surtidos = vales.filter(v => v.estatus === 'surtido')
  const montoMes = surtidos
    .filter(v => v.fecha >= desde && v.fecha <= hasta + 'T23:59:59')
    .reduce((s, v) => s + Number(v.monto_total || 0), 0)
  const bajoMinimo = existencias.filter(e => e.bajo_minimo)
  const requiereAut = param?.requiere_autorizacion &&
    totalLineas >= Number(param?.monto_autorizacion || 0)

  const artDe = (id) => articulos.find(a => a.id === id)
  const destinoDe = (v) =>
    v.moldes?.clave || v.maquinas?.clave || v.areas?.clave ||
    (v.ot_id ? 'OT ' + v.ot_id : 'general')

  const COLS_V = [
    { label: 'Folio', get: v => v.folio },
    { label: 'Fecha', get: v => fecha(v.fecha) },
    { label: 'Destino', get: v => DESTINOS[v.destino_tipo] },
    { label: 'Contra', get: v => destinoDe(v) },
    { label: 'Motivo', get: v => MOTIVOS[v.motivo] },
    { label: 'Centro de costo', get: v => v.centros_costos?.codigo || '' },
    { label: 'Monto', get: v => v.monto_total },
    { label: 'Estatus', get: v => v.estatus },
    { label: 'Recibio', get: v => v.recibido_por || '' },
  ]
  const COLS_C = [
    { label: 'Clave', get: c => c.clave },
    { label: 'Nombre', get: c => c.nombre },
    { label: 'Vales', get: c => c.vales },
    { label: 'Renglones', get: c => c.renglones },
    { label: 'Piezas', get: c => c.piezas },
    { label: 'Monto', get: c => c.monto },
    { label: '% del total', get: c => c.pct },
  ]
  const COLS_E = [
    { label: 'Codigo', get: e => e.codigo_interno },
    { label: 'Descripcion', get: e => e.descripcion },
    { label: 'Categoria', get: e => e.categoria || '' },
    { label: 'Existencia', get: e => e.existencia },
    { label: 'Costo', get: e => e.costo },
    { label: 'Valor', get: e => e.valor },
    { label: 'Minimo', get: e => e.stock_minimo },
    { label: 'Consumo 90 dias', get: e => e.consumo_90d },
    { label: 'Ultima salida', get: e => e.ultima_salida || '' },
  ]

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Toolcrib</h2>
          <p style={S.sub}>
            Las entradas y traspasos siguen en Inventario; aqui vive lo que faltaba, que es saber
            <b> contra que se consume</b>. El vale sustituye la captura de insumos en las ordenes de
            mantenimiento: al surtirlo, el insumo se escribe solo en la orden, para que el dato se
            capture una vez y llegue igual a los dos lados. El centro de costo no se teclea, baja del
            molde, de su maquina o de su area.
          </p>
        </div>
        <FiltroSite value={site} onChange={setSite} />
      </div>

      {almToolcrib.length === 0 && (
        <p style={S.aviso}>
          Ningun almacen esta marcado como <b>toolcrib</b>. Marcalo en Configuracion para que sus
          salidas se hagan por vale y se puedan imputar.
        </p>
      )}

      <div style={S.kpis}>
        <div style={S.kpi}><span style={S.kpiTit}>Vales por surtir</span><b style={{ ...S.kpiVal, color: porSurtir.length ? '#b45309' : '#1a1a2e' }}>{porSurtir.length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Consumo del periodo</span><b style={S.kpiVal}>{din(montoMes)}</b><span style={S.kpiPie}>{desde} a {hasta}</span></div>
        <div style={S.kpi}><span style={S.kpiTit}>Articulos en piso</span><b style={S.kpiVal}>{existencias.filter(e => Number(e.existencia) > 0).length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Bajo minimo</span><b style={{ ...S.kpiVal, color: bajoMinimo.length ? '#b91c1c' : '#1a1a2e' }}>{bajoMinimo.length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Reincidencias</span><b style={{ ...S.kpiVal, color: reinc.length ? '#b45309' : '#1a1a2e' }}>{reinc.length}</b><span style={S.kpiPie}>misma refaccion, mismo objeto</span></div>
      </div>

      <div style={S.tabs}>
        {[['vales', `Vales${porSurtir.length ? ` (${porSurtir.length})` : ''}`],
          ['consumo', 'Consumo'], ['moldes', 'Costo por molde'],
          ['reincidencia', 'Reincidencia'], ['existencias', 'Existencias'],
          ['config', 'Configuracion']].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => setTab(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      {/* ================= VALES ================= */}
      {tab === 'vales' && (
        <>
          {form && (
            <div style={S.card}>
              <p style={S.cardTit}>Nuevo vale</p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Sale del almacen *</label>
                  <select style={S.input} value={form.almacen_id} onChange={e => cambiarForm('almacen_id', e.target.value)}>
                    <option value="">Selecciona...</option>
                    {(almToolcrib.length ? almToolcrib : almacenes).map(a => (
                      <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>
                    ))}
                  </select>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Motivo</label>
                  <select style={S.input} value={form.motivo} onChange={e => cambiarForm('motivo', e.target.value)}>
                    {Object.entries(MOTIVOS).map(([k, v]) => <option key={k} value={v === '' ? k : k}>{v}</option>)}
                  </select>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Turno</label>
                  <select style={S.input} value={form.turno} onChange={e => cambiarForm('turno', e.target.value)}>
                    <option value="1o">1o</option><option value="2o">2o</option><option value="3o">3o</option>
                  </select>
                </div>
              </div>

              <p style={S.subTit}>Si sale de una orden de mantenimiento, elige la orden y el destino se llena solo</p>
              <div style={S.fila}>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Orden de mantenimiento de molde</label>
                  <select style={S.input} value={form.mtto_molde_id} onChange={e => cambiarForm('mtto_molde_id', e.target.value)}>
                    <option value="">No aplica</option>
                    {mttoMolde.map(m => (
                      <option key={m.id} value={m.id}>
                        {m.folio} · {moldes.find(x => x.id === m.molde_id)?.clave || ''} · {m.estatus}
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Orden de mantenimiento general</label>
                  <select style={S.input} value={form.mtto_gen_id} onChange={e => cambiarForm('mtto_gen_id', e.target.value)}>
                    <option value="">No aplica</option>
                    {mttoGen.map(m => (
                      <option key={m.id} value={m.id}>{m.folio} · {m.titulo || m.objeto} · {m.estatus}</option>
                    ))}
                  </select>
                </div>
              </div>

              <p style={S.subTit}>Contra que se consume</p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Destino *</label>
                  <select style={S.input} value={form.destino_tipo} onChange={e => cambiarForm('destino_tipo', e.target.value)}>
                    {Object.entries(DESTINOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                {form.destino_tipo === 'molde' && (
                  <div style={{ ...S.campo, flex: 2.5 }}>
                    <label style={S.label}>Molde *</label>
                    <select style={S.input} value={form.molde_id} onChange={e => cambiarForm('molde_id', e.target.value)}>
                      <option value="">Selecciona...</option>
                      {moldes.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
                    </select>
                  </div>
                )}
                {form.destino_tipo === 'maquina' && (
                  <div style={{ ...S.campo, flex: 2.5 }}>
                    <label style={S.label}>Maquina *</label>
                    <select style={S.input} value={form.maquina_id} onChange={e => cambiarForm('maquina_id', e.target.value)}>
                      <option value="">Selecciona...</option>
                      {maquinas.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
                    </select>
                  </div>
                )}
                {form.destino_tipo === 'area' && (
                  <div style={{ ...S.campo, flex: 2.5 }}>
                    <label style={S.label}>Area *</label>
                    <select style={S.input} value={form.area_id} onChange={e => cambiarForm('area_id', e.target.value)}>
                      <option value="">Selecciona...</option>
                      {areas.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                    </select>
                  </div>
                )}
                {form.destino_tipo === 'ot' && (
                  <div style={{ ...S.campo, flex: 2.5 }}>
                    <label style={S.label}>Orden de produccion *</label>
                    <select style={S.input} value={form.ot_id} onChange={e => cambiarForm('ot_id', e.target.value)}>
                      <option value="">Selecciona...</option>
                      {ots.map(o => <option key={o.id} value={o.id}>{o.folio}</option>)}
                    </select>
                  </div>
                )}
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Notas</label>
                  <input style={S.input} value={form.notas} onChange={e => cambiarForm('notas', e.target.value)} />
                </div>
              </div>

              {imput && (
                <div style={imput.centro_costo_id && imput.cuenta_gasto_id ? S.previo : S.previoAmbar}>
                  <b>Asi se va a imputar la salida.</b> Ojo: esto no es como se compro el
                  articulo, es contra que se consume.
                  <div style={{ marginTop: 4 }}>
                    Centro de costo:{' '}
                    {imput.centro_costo_id
                      ? <b>{centros.find(c => c.id === imput.centro_costo_id)?.codigo}</b>
                      : <b>sin resolver</b>} <span style={S.mini}>({imput.origen_cc})</span>
                  </div>
                  <div>
                    Cuenta de gasto:{' '}
                    {imput.cuenta_gasto_id
                      ? <b>{cuentas.find(c => c.id === imput.cuenta_gasto_id)?.codigo}</b>
                      : <b>sin resolver</b>} <span style={S.mini}>({imput.origen_cg})</span>
                  </div>
                  {(!imput.centro_costo_id || !imput.cuenta_gasto_id) && (
                    <div style={{ marginTop: 4 }}>
                      Lo que quede sin resolver se puede capturar en el vale antes de surtirlo, pero
                      conviene asignarselo al molde, a la maquina o al area para que salga solo la
                      proxima vez.
                    </div>
                  )}
                </div>
              )}

              <div style={S.acciones}>
                <button style={S.botonSec} onClick={() => { setForm(null); setImput(null) }}>Cancelar</button>
                <button style={S.boton} onClick={crearVale}>Crear vale</button>
              </div>
            </div>
          )}

          <div style={S.cols}>
            <div style={S.izq}>
              <div style={S.card}>
                <div style={S.cardHead}>
                  <p style={S.cardTit}>Vales &middot; {vales.length}</p>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button style={S.expBtn} onClick={() => exportarExcel('vales_toolcrib', COLS_V, vales)}>Excel</button>
                    {puedeCrear && !form && (
                      <button style={S.boton} onClick={() => { setForm({ ...valeVacio, almacen_id: almToolcrib[0]?.id || '' }); setImput(null); setError('') }}>
                        + Nuevo vale
                      </button>
                    )}
                  </div>
                </div>
                {vales.length === 0 && <p style={S.vacio}>Aun no hay vales.</p>}
                <div style={{ maxHeight: 460, overflowY: 'auto' }}>
                  {vales.map(v => (
                    <button key={v.id} onClick={() => setValeSel(v.id)}
                      style={{ ...S.item, ...(valeSel === v.id ? S.itemAct : {}) }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                        <b>{v.folio}</b>
                        <span style={{ ...S.tag, ...(EST[v.estatus] || {}) }}>{EST[v.estatus]?.txt}</span>
                      </div>
                      <span style={S.itemPie}>
                        {fecha(v.fecha)} · {DESTINOS[v.destino_tipo]} {destinoDe(v)}
                        {Number(v.monto_total) > 0 && ` · ${din(v.monto_total)}`}
                        {v.centros_costos?.codigo && ` · ${v.centros_costos.codigo}`}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div style={S.der}>
              {!vale && <div style={S.card}><p style={S.vacio}>Elige un vale de la lista.</p></div>}
              {vale && (
                <div style={S.card}>
                  <div style={S.cardHead}>
                    <div>
                      <p style={S.cardTit}>
                        {vale.folio}
                        <span style={{ ...S.tag, ...(EST[vale.estatus] || {}), marginLeft: 8 }}>{EST[vale.estatus]?.txt}</span>
                      </p>
                      <p style={S.ayuda}>
                        {DESTINOS[vale.destino_tipo]} <b>{destinoDe(vale)}</b> · {MOTIVOS[vale.motivo]}
                        {vale.centros_costos?.codigo && ` · centro de costo ${vale.centros_costos.codigo}`}
                        {(vale.mtto_molde_id || vale.mtto_gen_id) && ' · ligado a una orden de mantenimiento'}
                        {vale.recibido_por && ` · recibio ${vale.recibido_por}`}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {vale.estatus === 'borrador' && puedeAutorizar && !vale.autorizado_at && requiereAut && (
                        <button style={S.botonSec} onClick={() => autorizar(vale)}>Autorizar</button>
                      )}
                      {vale.estatus === 'borrador' && puedeCrear && (
                        <button style={S.boton} onClick={() => surtir(vale)}>Surtir</button>
                      )}
                      {vale.estatus === 'borrador' && puedeCrear && (
                        <button style={S.botonSec} onClick={() => cancelar(vale)}>Cancelar</button>
                      )}
                    </div>
                  </div>

                  {vale.estatus === 'borrador' && requiereAut && !vale.autorizado_at && (
                    <p style={S.aviso}>
                      Suma {din(totalLineas)} y la autorizacion esta activada a partir
                      de {din(param?.monto_autorizacion)}. Falta que lo autorice {param?.rol_autoriza || 'un gerente'}.
                    </p>
                  )}
                  {vale.autorizado_at && vale.estatus === 'borrador' && (
                    <p style={S.previo}>Autorizado el {fecha(vale.autorizado_at)}. Ya se puede surtir.</p>
                  )}

                  {vale.estatus === 'borrador' && puedeCrear && (
                    <div style={S.fila}>
                      <div style={S.campo}>
                        <label style={S.label}>Centro de costo</label>
                        <select style={S.input} value={vale.centro_costo_id || ''}
                          onChange={e => guardarImputacion(vale, 'centro_costo_id', e.target.value)}>
                          <option value="">Sin asignar</option>
                          {centros.map(c => <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>)}
                        </select>
                      </div>
                      <div style={S.campo}>
                        <label style={S.label}>Cuenta de gasto</label>
                        <select style={S.input} value={vale.cuenta_gasto_id || ''}
                          onChange={e => guardarImputacion(vale, 'cuenta_gasto_id', e.target.value)}>
                          <option value="">Sin asignar</option>
                          {cuentas.map(c => <option key={c.id} value={c.id}>{c.codigo} - {c.nombre}</option>)}
                        </select>
                      </div>
                      <div style={{ ...S.campo, flex: 2, justifyContent: 'flex-end' }}>
                        <span style={S.ayuda}>
                          Llegan resueltos del destino. Se pueden corregir aqui, pero una vez surtido
                          el vale ya no se cambian: habria un asiento hecho.
                        </span>
                      </div>
                    </div>
                  )}

                  {lineas.length > 0 && (
                    <table style={S.tabla}>
                      <thead>
                        <tr>
                          <th style={S.th}>Articulo</th><th style={S.thR}>Cantidad</th>
                          <th style={S.thR}>Costo</th><th style={S.thR}>Total</th>
                          <th style={S.th}>Cuenta</th><th style={S.th}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lineas.map(l => (
                          <tr key={l.id}>
                            <td style={S.td}>
                              <b>{l.articulos?.codigo_interno}</b>
                              <div style={S.mini}>{l.articulos?.descripcion}</div>
                            </td>
                            <td style={S.tdR}>{fmt(l.cantidad)} {l.articulos?.unidad_medida}</td>
                            <td style={S.tdR}>{din(l.costo_unitario ?? artDe(l.articulo_id)?.costo)}</td>
                            <td style={S.tdR}>{din(l.costo_total ?? (l.cantidad * (artDe(l.articulo_id)?.costo || 0)))}</td>
                            <td style={S.td}>{l.cuentas_gastos?.codigo || <span style={S.mini}>al surtir</span>}</td>
                            <td style={S.td}>
                              {vale.estatus === 'borrador' && puedeCrear && (
                                <button style={S.btnMiniSec} onClick={() => quitarLinea(l)}>Quitar</button>
                              )}
                            </td>
                          </tr>
                        ))}
                        <tr>
                          <td style={{ ...S.td, fontWeight: 600 }} colSpan={3}>Total</td>
                          <td style={{ ...S.tdR, fontWeight: 600 }}>{din(vale.monto_total || totalLineas)}</td>
                          <td style={S.td} colSpan={2}></td>
                        </tr>
                      </tbody>
                    </table>
                  )}
                  {lineas.length === 0 && <p style={S.vacio}>Este vale no tiene renglones.</p>}

                  {vale.estatus === 'borrador' && puedeCrear && (
                    <div style={{ ...S.fila, marginTop: 12, alignItems: 'flex-end' }}>
                      <div style={{ ...S.campo, flex: 3 }}>
                        <label style={S.label}>Articulo</label>
                        <select style={S.input} value={nuevaLinea.articulo_id}
                          onChange={e => setNuevaLinea({ ...nuevaLinea, articulo_id: e.target.value })}>
                          <option value="">Selecciona...</option>
                          {articulos.map(a => (
                            <option key={a.id} value={a.id}>
                              {a.codigo_interno} - {a.descripcion} ({din(a.costo)})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div style={S.campo}>
                        <label style={S.label}>Cantidad</label>
                        <input type="number" step="any" min="0" style={S.input} value={nuevaLinea.cantidad}
                          onChange={e => setNuevaLinea({ ...nuevaLinea, cantidad: e.target.value })} />
                      </div>
                      <div style={{ ...S.campo, flex: 2 }}>
                        <label style={S.label}>Notas</label>
                        <input style={S.input} value={nuevaLinea.notas}
                          onChange={e => setNuevaLinea({ ...nuevaLinea, notas: e.target.value })} />
                      </div>
                      <div style={{ ...S.campo, justifyContent: 'flex-end', maxWidth: 120 }}>
                        <button style={S.boton} onClick={agregarLinea}>Agregar</button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* ================= CONSUMO ================= */}
      {tab === 'consumo' && (
        <div style={S.card}>
          <div style={S.cardHead}>
            <div>
              <p style={S.cardTit}>Consumo por {EJES[eje].toLowerCase()}</p>
              <p style={S.ayuda}>
                Los vales que fueron a otro destino se siguen contando para que el total cuadre con
                el gasto real, pero aparecen como "otro destino": no es un dato faltante.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <select style={S.inputMini} value={eje} onChange={e => setEje(e.target.value)}>
                {Object.entries(EJES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
              <input type="date" style={S.inputMini} value={desde} onChange={e => setDesde(e.target.value)} />
              <input type="date" style={S.inputMini} value={hasta} onChange={e => setHasta(e.target.value)} />
              <button style={S.expBtn} onClick={() => exportarExcel(`consumo_${eje}`, COLS_C, consumo)}>Excel</button>
              <button style={S.expBtn} onClick={() => imprimirTablaPDF(`Consumo de toolcrib por ${EJES[eje]}`, COLS_C, consumo)}>PDF</button>
            </div>
          </div>
          {consumo.length === 0 && <p style={S.vacio}>Sin consumo en el periodo.</p>}
          {consumo.length > 0 && (
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>{EJES[eje]}</th><th style={S.th}>Nombre</th>
                  <th style={S.thR}>Vales</th><th style={S.thR}>Renglones</th>
                  <th style={S.thR}>Piezas</th><th style={S.thR}>Monto</th><th style={S.th}>Peso</th>
                </tr>
              </thead>
              <tbody>
                {consumo.map((c, i) => (
                  <tr key={i}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{c.clave}</td>
                    <td style={S.td}>{c.nombre}</td>
                    <td style={S.tdR}>{c.vales}</td>
                    <td style={S.tdR}>{c.renglones}</td>
                    <td style={S.tdR}>{fmt(c.piezas)}</td>
                    <td style={S.tdR}>{din(c.monto)}</td>
                    <td style={S.td}>
                      <div style={S.barraBg}>
                        <div style={{ ...S.barra, width: `${Math.min(100, Number(c.pct) || 0)}%` }} />
                      </div>
                      <span style={S.mini}>{c.pct}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================= COSTO POR MOLDE ================= */}
      {tab === 'moldes' && (
        <div style={S.card}>
          <div style={S.cardHead}>
            <div>
              <p style={S.cardTit}>Costo de refacciones contra shots</p>
              <p style={S.ayuda}>
                Lo que de verdad decide si un molde conviene repararlo o reemplazarlo. El gasto
                absoluto engana: un molde que produce el triple gasta mas y esta bien. Lo comparable
                es el costo por cada mil shots.
              </p>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <input type="date" style={S.inputMini} value={desde} onChange={e => setDesde(e.target.value)} />
              <input type="date" style={S.inputMini} value={hasta} onChange={e => setHasta(e.target.value)} />
            </div>
          </div>
          {costoMolde.length === 0 && <p style={S.vacio}>No hay moldes activos.</p>}
          {costoMolde.length > 0 && (
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Molde</th><th style={S.th}>Nombre</th><th style={S.thR}>Cav.</th>
                  <th style={S.thR}>Shots</th><th style={S.thR}>Vales</th>
                  <th style={S.thR}>Refacciones</th><th style={S.thR}>Por mil shots</th>
                  <th style={S.thR}>Mttos</th><th style={S.th}>Ultimo mtto</th><th style={S.th}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {costoMolde.map(m => (
                  <tr key={m.molde_id}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{m.clave}</td>
                    <td style={S.td}>{m.nombre}</td>
                    <td style={S.tdR}>{m.cavidades}</td>
                    <td style={S.tdR}>{fmt(m.shots_acumulados)}</td>
                    <td style={S.tdR}>{m.vales}</td>
                    <td style={S.tdR}>{din(m.monto_refacciones)}</td>
                    <td style={{ ...S.tdR, fontWeight: 600 }}>
                      {m.costo_por_mil_shots != null ? din(m.costo_por_mil_shots) : <span style={S.mini}>sin shots</span>}
                    </td>
                    <td style={S.tdR}>{m.mttos}</td>
                    <td style={S.td}>{m.ultimo_mtto || '-'}</td>
                    <td style={S.td}>{m.estado || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================= REINCIDENCIA ================= */}
      {tab === 'reincidencia' && (
        <div style={S.card}>
          <p style={S.cardTit}>Reincidencia &middot; {reinc.length}</p>
          <p style={S.ayuda}>
            La misma refaccion consumida una y otra vez en el mismo molde o la misma maquina. Eso no
            es gasto, es un sintoma, y mirando el gasto por mes no se ve: cada consumo es chico y se
            pierde entre los demas. Si los dias entre consumos se van acortando, algo se esta
            degradando.
          </p>
          {reinc.length === 0 && <p style={S.vacio}>Ninguna refaccion se repitio tres veces o mas en el periodo.</p>}
          {reinc.length > 0 && (
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Destino</th><th style={S.th}>Contra</th>
                  <th style={S.th}>Refaccion</th><th style={S.thR}>Veces</th>
                  <th style={S.thR}>Piezas</th><th style={S.thR}>Monto</th>
                  <th style={S.th}>Primera</th><th style={S.th}>Ultima</th>
                  <th style={S.thR}>Dias entre</th>
                </tr>
              </thead>
              <tbody>
                {reinc.map((r, i) => (
                  <tr key={i}>
                    <td style={S.td}>{DESTINOS[r.destino_tipo]}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{r.destino}</td>
                    <td style={S.td}>{r.articulo}<div style={S.mini}>{r.descripcion}</div></td>
                    <td style={{ ...S.tdR, fontWeight: 600, color: '#b45309' }}>{r.veces}</td>
                    <td style={S.tdR}>{fmt(r.piezas)}</td>
                    <td style={S.tdR}>{din(r.monto)}</td>
                    <td style={S.td}>{r.primera}</td>
                    <td style={S.td}>{r.ultima}</td>
                    <td style={S.tdR}>{r.dias_entre != null ? fmt(r.dias_entre) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================= EXISTENCIAS ================= */}
      {tab === 'existencias' && (
        <div style={S.card}>
          <div style={S.cardHead}>
            <p style={S.cardTit}>Existencias del toolcrib &middot; {existencias.length}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button style={S.expBtn} onClick={() => exportarExcel('existencias_toolcrib', COLS_E, existencias)}>Excel</button>
              <button style={S.expBtn} onClick={() => imprimirTablaPDF('Existencias de toolcrib', COLS_E, existencias)}>PDF</button>
            </div>
          </div>
          {existencias.length === 0 && (
            <p style={S.vacio}>
              No hay existencia en el almacen de toolcrib, o todavia no hay un almacen marcado como tal.
            </p>
          )}
          {existencias.length > 0 && (
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Codigo</th><th style={S.th}>Descripcion</th><th style={S.th}>Categoria</th>
                  <th style={S.thR}>Existencia</th><th style={S.thR}>Minimo</th>
                  <th style={S.thR}>Costo</th><th style={S.thR}>Valor</th>
                  <th style={S.thR}>Consumo 90d</th><th style={S.th}>Ultima salida</th>
                </tr>
              </thead>
              <tbody>
                {existencias.map(e => (
                  <tr key={e.articulo_id}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{e.codigo_interno}</td>
                    <td style={S.td}>{e.descripcion}</td>
                    <td style={S.td}>{e.categoria || '-'}</td>
                    <td style={{ ...S.tdR, color: e.bajo_minimo ? '#b91c1c' : '#1a1a2e', fontWeight: e.bajo_minimo ? 600 : 400 }}>
                      {fmt(e.existencia)} {e.unidad}
                      {e.bajo_minimo && <span style={S.tagRojo}>bajo minimo</span>}
                    </td>
                    <td style={S.tdR}>{e.stock_minimo ? fmt(e.stock_minimo) : '-'}</td>
                    <td style={S.tdR}>{din(e.costo)}</td>
                    <td style={S.tdR}>{din(e.valor)}</td>
                    <td style={S.tdR}>{fmt(e.consumo_90d)}</td>
                    <td style={S.td}>{e.ultima_salida || <span style={S.mini}>sin salidas</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================= CONFIGURACION ================= */}
      {tab === 'config' && (
        <>
          <div style={S.card}>
            <p style={S.cardTit}>Autorizacion de vales</p>
            <p style={S.ayuda}>
              Por default el sistema <b>registra y avisa</b>, no frena. Un tope de firma puede dejar
              una maquina parada a las 2 de la manana esperando a un gerente. Si tu empresa lo
              requiere, aqui se activa.
            </p>
            <label style={S.check}>
              <input type="checkbox" disabled={!puedeAutorizar} checked={!!param?.requiere_autorizacion}
                onChange={e => guardarParam('requiere_autorizacion', e.target.checked)} />
              <span>Pedir autorizacion de un gerente para surtir arriba del monto</span>
            </label>
            <div style={S.fila}>
              <div style={S.campo}>
                <label style={S.label}>Monto a partir del cual se autoriza</label>
                <input type="number" min="0" step="0.01" style={S.input}
                  disabled={!puedeAutorizar || !param?.requiere_autorizacion}
                  defaultValue={param?.monto_autorizacion ?? 0}
                  onBlur={e => guardarParam('monto_autorizacion', e.target.value)} />
              </div>
              <div style={{ ...S.campo, flex: 2 }}>
                <label style={S.label}>Quien autoriza</label>
                <input style={S.input} disabled={!puedeAutorizar || !param?.requiere_autorizacion}
                  defaultValue={param?.rol_autoriza || ''}
                  onBlur={e => guardarParam('rol_autoriza', e.target.value)}
                  placeholder="Gerente de planta" />
                <span style={S.ayuda}>Solo se usa en el mensaje, para que quede claro a quien buscar.</span>
              </div>
              <div style={S.campo}>
                <label style={S.label}>Avisar arriba de</label>
                <input type="number" min="0" step="0.01" style={S.input} disabled={!puedeAutorizar}
                  defaultValue={param?.avisar_monto ?? 0}
                  onBlur={e => guardarParam('avisar_monto', e.target.value)} />
                <span style={S.ayuda}>Registra y avisa sin frenar.</span>
              </div>
            </div>
            <label style={S.check}>
              <input type="checkbox" disabled={!puedeAutorizar} checked={!!param?.requiere_orden_mtto}
                onChange={e => guardarParam('requiere_orden_mtto', e.target.checked)} />
              <span>Exigir orden de mantenimiento en los vales de mantenimiento</span>
            </label>
            <p style={S.ayuda}>
              Se deja apagado a proposito: hay consumo de rutina que no amerita orden, y si lo
              obligas la gente inventa ordenes falsas, que es peor que no tenerlas.
            </p>
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>Que almacen es el toolcrib</p>
            <p style={S.ayuda}>
              No es una tabla nueva: es un almacen marcado. Sus entradas y traspasos siguen en
              Inventario; lo que cambia es que sus salidas se hacen por vale para poder imputarlas.
            </p>
            <table style={S.tabla}>
              <thead>
                <tr><th style={S.th}>Clave</th><th style={S.th}>Nombre</th><th style={S.th}>Es toolcrib</th></tr>
              </thead>
              <tbody>
                {almacenes.map(a => (
                  <tr key={a.id}>
                    <td style={{ ...S.td, fontWeight: 600 }}>{a.clave}</td>
                    <td style={S.td}>{a.nombre}</td>
                    <td style={S.td}>
                      <input type="checkbox" disabled={!puedeAutorizar} checked={!!a.es_toolcrib}
                        onChange={e => marcarToolcrib(a, e.target.checked)} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>De donde sale la imputacion de la salida</p>
            <p style={S.ayuda}>
              En cascada, para que nadie la teclee: primero la del molde, si no la de su maquina
              asignada, si no la del area de esa maquina. Aplica igual al centro de costo y a la
              cuenta de gasto. Lo que este vacio aqui es lo que va a caer sin imputar.
              <b> Esto no tiene que ver con como se compro el articulo</b>: esa clasificacion vive
              en la requisicion y es otro asiento.
            </p>
            <div style={S.fila}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={S.subTit}>Moldes sin centro de costo</p>
                {moldes.filter(m => !m.centro_costo_id).length === 0
                  ? <p style={S.mini}>Todos tienen, o lo heredan de su maquina.</p>
                  : <p style={S.mini}>{moldes.filter(m => !m.centro_costo_id).map(m => m.clave).join(', ')}</p>}
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={S.subTit}>Maquinas sin centro de costo</p>
                {maquinas.filter(m => !m.centro_costo_id).length === 0
                  ? <p style={S.mini}>Todas tienen.</p>
                  : <p style={S.mini}>{maquinas.filter(m => !m.centro_costo_id).map(m => m.clave).join(', ')}</p>}
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={S.subTit}>Areas sin centro de costo</p>
                {areas.filter(a => !a.centro_costo_id).length === 0
                  ? <p style={S.mini}>Todas tienen.</p>
                  : <p style={S.mini}>{areas.filter(a => !a.centro_costo_id).map(a => a.clave).join(', ')}</p>}
              </div>
            </div>
            <div style={S.fila}>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={S.subTit}>Moldes sin cuenta de gasto</p>
                {moldes.filter(m => !m.cuenta_gasto_id).length === 0
                  ? <p style={S.mini}>Todos tienen, o la heredan de su maquina.</p>
                  : <p style={S.mini}>{moldes.filter(m => !m.cuenta_gasto_id).map(m => m.clave).join(', ')}</p>}
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={S.subTit}>Maquinas sin cuenta de gasto</p>
                {maquinas.filter(m => !m.cuenta_gasto_id).length === 0
                  ? <p style={S.mini}>Todas tienen.</p>
                  : <p style={S.mini}>{maquinas.filter(m => !m.cuenta_gasto_id).map(m => m.clave).join(', ')}</p>}
              </div>
              <div style={{ flex: 1, minWidth: 240 }}>
                <p style={S.subTit}>Areas sin cuenta de gasto</p>
                {areas.filter(a => !a.cuenta_gasto_id).length === 0
                  ? <p style={S.mini}>Todas tienen.</p>
                  : <p style={S.mini}>{areas.filter(a => !a.cuenta_gasto_id).map(a => a.clave).join(', ')}</p>}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, marginBottom: 12 },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '860px', lineHeight: 1.5 },
  aviso: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#92400e', marginBottom: 10, lineHeight: 1.5 },
  cols: { display: 'flex', gap: 13, alignItems: 'flex-start', flexWrap: 'wrap' },
  izq: { width: 300, flexShrink: 0 },
  der: { flex: 1, minWidth: 520 },
  tabs: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  tab: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  tabAct: { padding: '8px 15px', background: '#0f766e', color: '#fff', border: '1px solid #0f766e', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '15px 17px', marginBottom: 13 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  cardTit: { fontSize: 14, fontWeight: 600, color: '#1a1a2e', margin: '0 0 4px' },
  subTit: { fontSize: 12, fontWeight: 600, color: '#64748b', margin: '10px 0 6px' },
  fila: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 140, marginBottom: 8 },
  label: { fontSize: 12, color: '#444', fontWeight: 500 },
  input: { padding: '9px 11px', borderRadius: 7, border: '1px solid #ddd', fontSize: 13.5, outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box' },
  inputMini: { padding: '7px 9px', borderRadius: 7, border: '1px solid #ddd', fontSize: 12.5, outline: 'none' },
  ayuda: { fontSize: 11.5, color: '#64748b', lineHeight: 1.45, margin: '4px 0 0' },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#444', margin: '8px 0' },
  previo: { background: '#f0fdfa', border: '1px solid #99f6e4', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#115e59', marginTop: 6, lineHeight: 1.5 },
  previoAmbar: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '9px 12px', fontSize: 12.5, color: '#92400e', marginTop: 6, lineHeight: 1.5 },
  acciones: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  boton: { padding: '9px 18px', background: '#0f766e', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13.5, cursor: 'pointer', fontWeight: 500 },
  botonSec: { padding: '9px 18px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13.5, cursor: 'pointer' },
  btnMiniSec: { padding: '4px 10px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 6, fontSize: 11.5, cursor: 'pointer' },
  expBtn: { padding: '7px 12px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 12.5, cursor: 'pointer' },
  err: { color: '#b91c1c', fontSize: 13, margin: '0 0 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', lineHeight: 1.5 },
  ok: { color: '#15803d', fontSize: 13, margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: 13 },
  vacio: { color: '#64748b', fontSize: 13, margin: 0 },
  kpis: { display: 'flex', gap: 11, flexWrap: 'wrap', marginBottom: 13 },
  kpi: { flex: 1, minWidth: 140, display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '13px 16px' },
  kpiTit: { fontSize: 10.5, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
  kpiVal: { fontSize: 21, color: '#1a1a2e', margin: '3px 0 1px' },
  kpiPie: { fontSize: 11, color: '#64748b' },
  item: { display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', border: '1px solid transparent', borderRadius: 8, background: 'transparent', cursor: 'pointer', fontSize: 13, color: '#1a1a2e', marginBottom: 3 },
  itemAct: { background: '#f0fdfa', border: '1px solid #99f6e4' },
  itemPie: { display: 'block', fontSize: 11, color: '#64748b', marginTop: 3 },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right', whiteSpace: 'nowrap' },
  mini: { fontSize: 10.5, color: '#64748b', marginTop: 2 },
  tag: { fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, whiteSpace: 'nowrap' },
  tagRojo: { fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: '#fee2e2', color: '#b91c1c', marginLeft: 5 },
  barraBg: { width: 90, height: 6, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' },
  barra: { height: '100%', background: '#0f766e' },
}
