import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// CALIBRACION DE EQUIPOS DE MEDICION (IATF 16949, 7.1.5.2)
//
// Un dato medido con un equipo vencido no vale, y lo peor es que no se nota:
// la carta de control se ve normal, el Cpk sale bien y el producto se embarca.
// Por eso este padron no es un catalogo administrativo, es el cimiento del
// SPC. Si el equipo no esta vigente, lo que mide no es evidencia de nada.
//
// La norma pide ademas que cuando un equipo se encuentra fuera de calibracion
// se evalue la validez de lo que se midio con el desde la ultima calibracion
// buena. Por eso una calibracion rechazada guarda desde cuando queda en duda.

const hoyISO = () => new Date().toISOString().slice(0, 10)
const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 4 })

const ESTADO = {
  vigente:           { txt: 'Vigente',            bg: '#dcfce7', col: '#15803d' },
  por_vencer:        { txt: 'Por vencer',         bg: '#fef3c7', col: '#92400e' },
  vencido:           { txt: 'Vencido',            bg: '#fee2e2', col: '#b91c1c' },
  sin_calibrar:      { txt: 'Sin calibrar',       bg: '#fee2e2', col: '#b91c1c' },
  fuera_de_servicio: { txt: 'Fuera de servicio',  bg: '#e5e7eb', col: '#374151' },
  baja:              { txt: 'Baja',               bg: '#e5e7eb', col: '#374151' },
}
const RR = {
  aceptable:   { bg: '#dcfce7', col: '#15803d' },
  marginal:    { bg: '#fef3c7', col: '#92400e' },
  inaceptable: { bg: '#fee2e2', col: '#b91c1c' },
}
const TIPOS = ['vernier', 'micrometro', 'altimetro', 'indicador de caratula', 'bascula',
  'torquimetro', 'durometro', 'calibre pasa/no pasa', 'CMM', 'proyector de perfiles',
  'termometro', 'manometro', 'cronometro', 'otro']

const equipoVacio = {
  clave: '', nombre: '', tipo: '', marca: '', modelo: '', serie: '',
  resolucion: '', rango_min: '', rango_max: '', unidad: '', area_id: '',
  intervalo_meses: 12, requiere_rr: false, notas: '',
}
const calVacia = {
  equipo_id: '', fecha: hoyISO(), tipo: 'externa', resultado: 'aprobado',
  laboratorio: '', numero_certificado: '', patron: '', trazabilidad: '',
  error_encontrado: '', incertidumbre: '', proxima: '', documento_url: '', notas: '',
}
const rrVacio = {
  equipo_id: '', fecha: hoyISO(), pct_rr: '', ndc: '', caracteristica: '',
  operadores: 3, partes: 10, ensayos: 3, documento_url: '', notas: '',
}

export default function Calibracion() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('cal_calibracion', 'crear') || tienePermiso('cal_calibracion', 'editar')
  const puedeConfig = tienePermiso('cal_calibracion', 'aprobar')

  const [tab, setTab] = useState('padron')
  const [site, setSite] = useState('')
  const [equipos, setEquipos] = useState([])
  const [calibs, setCalibs] = useState([])
  const [rrs, setRrs] = useState([])
  const [param, setParam] = useState(null)
  const [articulos, setArticulos] = useState([])
  const [areas, setAreas] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [form, setForm] = useState(null)
  const [editando, setEditando] = useState(null)
  const [cal, setCal] = useState(calVacia)
  const [rr, setRr] = useState(rrVacio)
  const [detalle, setDetalle] = useState(null)   // equipo_id cuyo historial se ve
  const [filtro, setFiltro] = useState('')

  useEffect(() => { cargar() }, [site])

  const cargar = async () => {
    setLoading(true); setError('')
    const sid = siteEfectivo(perfil, site)
    const [eq, ca, rrq, pa, ar, ars] = await Promise.all([
      supabase.rpc('equipos_estado', { p_empresa_id: emp, p_site_id: sid || null }),
      supabase.from('calibraciones').select('*').eq('empresa_id', emp)
        .order('fecha', { ascending: false }).order('id', { ascending: false }).limit(400),
      supabase.from('equipo_rr').select('*').eq('empresa_id', emp)
        .order('fecha', { ascending: false }).limit(200),
      supabase.from('calibracion_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('articulos').select('id, codigo_interno, descripcion')
        .eq('empresa_id', emp).eq('activo', true).order('codigo_interno'),
      supabase.from('areas').select('id, clave, nombre').eq('empresa_id', emp)
        .eq('activo', true).order('clave'),
    ])
    if (eq.error) setError('No se pudo cargar el padron: ' + eq.error.message)
    setEquipos(eq.data || []); setCalibs(ca.data || []); setRrs(rrq.data || [])
    setParam(pa.data || null); setArticulos(ar.data || []); setAreas(ars.data || [])
    setLoading(false)
  }

  // ---------- Alta / edicion del equipo ----------
  const guardarEquipo = async () => {
    setError(''); setExito('')
    if (!form.clave || !form.nombre) { setError('La clave y el nombre son obligatorios'); return }
    if (Number(form.intervalo_meses) <= 0) { setError('El intervalo debe ser mayor a cero meses'); return }
    const num = (v) => v === '' || v === null ? null : Number(v)
    const payload = {
      empresa_id: emp, site_id: siteEfectivo(perfil, site) || perfil.site_id || null,
      clave: form.clave.toUpperCase(), nombre: form.nombre,
      tipo: form.tipo || null, marca: form.marca || null, modelo: form.modelo || null,
      serie: form.serie || null, resolucion: num(form.resolucion),
      rango_min: num(form.rango_min), rango_max: num(form.rango_max),
      unidad: form.unidad || null, area_id: form.area_id ? Number(form.area_id) : null,
      intervalo_meses: Number(form.intervalo_meses), requiere_rr: !!form.requiere_rr,
      notas: form.notas || null,
    }
    const r = editando
      ? await supabase.from('equipos_medicion').update(payload).eq('id', editando)
      : await supabase.from('equipos_medicion').insert(payload)
    if (r.error) {
      setError(r.error.message.includes('duplicate')
        ? `Ya existe un equipo con la clave ${payload.clave}`
        : 'No se pudo guardar: ' + r.error.message)
      return
    }
    setForm(null); setEditando(null); setExito('Equipo guardado'); cargar()
  }

  const editarEquipo = (e) => {
    setEditando(e.id); setError('')
    setForm({
      clave: e.clave, nombre: e.nombre, tipo: e.tipo || '', marca: e.marca || '',
      modelo: e.modelo || '', serie: e.serie || '', resolucion: e.resolucion ?? '',
      rango_min: '', rango_max: '', unidad: e.unidad || '', area_id: e.area_id || '',
      intervalo_meses: e.intervalo_meses, requiere_rr: !!e.requiere_rr, notas: '',
    })
    setTab('padron')
  }

  const darDeBaja = async (e) => {
    if (!confirm(`Vas a dar de baja ${e.clave}. Deja de aparecer en el padron y no se podra medir con el, pero su historial de calibraciones se conserva. Confirma para continuar.`)) return
    const { error: er } = await supabase.from('equipos_medicion').update({ estatus: 'baja' }).eq('id', e.id)
    if (er) { setError('No se pudo dar de baja: ' + er.message); return }
    setExito(`${e.clave} dado de baja`); cargar()
  }

  // ---------- Registrar calibracion ----------
  const guardarCal = async () => {
    setError(''); setExito('')
    if (!cal.equipo_id) { setError('Elige el equipo'); return }
    if (!cal.numero_certificado && cal.tipo === 'externa') {
      setError('Una calibracion externa sin numero de certificado no sirve como evidencia. Capturalo.')
      return
    }
    const eq = equipos.find(x => x.id === Number(cal.equipo_id))
    if (cal.resultado === 'rechazado') {
      if (!confirm(`Vas a registrar ${eq?.clave} como RECHAZADO. El equipo queda fuera de servicio y todo lo que se midio con el desde su ultima calibracion buena queda en duda y hay que evaluarlo. Confirma para continuar.`)) return
    }
    const num = (v) => v === '' ? null : Number(v)
    const { error: e } = await supabase.rpc('registrar_calibracion', {
      p_empresa_id: emp, p_equipo_id: Number(cal.equipo_id), p_fecha: cal.fecha,
      p_tipo: cal.tipo, p_resultado: cal.resultado,
      p_laboratorio: cal.laboratorio || null, p_certificado: cal.numero_certificado || null,
      p_patron: cal.patron || null, p_trazabilidad: cal.trazabilidad || null,
      p_error: num(cal.error_encontrado), p_incertidumbre: num(cal.incertidumbre),
      p_proxima: cal.proxima || null, p_documento: cal.documento_url || null,
      p_notas: cal.notas || null, p_usuario: perfil.id,
    })
    if (e) { setError('No se pudo registrar: ' + e.message); return }
    setExito(cal.resultado === 'rechazado'
      ? `${eq?.clave} quedo fuera de servicio. Revisa que se midio con el desde su ultima calibracion buena.`
      : `Calibracion registrada. ${eq?.clave} queda vigente.`)
    setCal({ ...calVacia, fecha: cal.fecha }); cargar()
  }

  // ---------- Registrar R&R ----------
  const guardarRR = async () => {
    setError(''); setExito('')
    if (!rr.equipo_id || rr.pct_rr === '') { setError('Elige el equipo y captura el %R&R'); return }
    const { error: e } = await supabase.rpc('registrar_rr', {
      p_empresa_id: emp, p_equipo_id: Number(rr.equipo_id), p_fecha: rr.fecha,
      p_pct: Number(rr.pct_rr), p_ndc: rr.ndc === '' ? null : Number(rr.ndc),
      p_articulo_id: rr.articulo_id ? Number(rr.articulo_id) : null,
      p_caracteristica: rr.caracteristica || null,
      p_operadores: rr.operadores === '' ? null : Number(rr.operadores),
      p_partes: rr.partes === '' ? null : Number(rr.partes),
      p_ensayos: rr.ensayos === '' ? null : Number(rr.ensayos),
      p_documento: rr.documento_url || null, p_notas: rr.notas || null, p_usuario: perfil.id,
    })
    if (e) { setError('No se pudo registrar: ' + e.message); return }
    setExito('Estudio R&R registrado'); setRr({ ...rrVacio, fecha: rr.fecha }); cargar()
  }

  const guardarParam = async (campo, valor) => {
    const v = Number(valor)
    if (isNaN(v) || v < 0) { setError('Captura un numero valido'); return }
    setError('')
    const { error: e } = await supabase.from('calibracion_parametros').upsert({
      empresa_id: emp, [campo]: v, updated_at: new Date().toISOString(), updated_by: perfil.id,
    }, { onConflict: 'empresa_id' })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setParam(p => ({ ...p, [campo]: v })); setExito('Configuracion actualizada'); cargar()
  }

  // ---------- Derivados ----------
  const cuenta = (est) => equipos.filter(e => e.estado === est).length
  const noUsables = equipos.filter(e => ['vencido', 'sin_calibrar', 'fuera_de_servicio'].includes(e.estado))
  const rechazadas = calibs.filter(c => c.resultado === 'rechazado' && c.impacto_desde)
  const equipoDe = (id) => equipos.find(e => e.id === id)
  const artDe = (id) => articulos.find(a => a.id === id)

  const lista = equipos.filter(e => {
    if (!filtro) return true
    const t = filtro.toLowerCase()
    return [e.clave, e.nombre, e.tipo, e.area, e.marca, e.modelo, e.serie]
      .some(v => (v || '').toLowerCase().includes(t))
  })

  const COLS_EQ = [
    { label: 'Clave', get: e => e.clave },
    { label: 'Equipo', get: e => e.nombre },
    { label: 'Tipo', get: e => e.tipo || '' },
    { label: 'Marca', get: e => e.marca || '' },
    { label: 'Modelo', get: e => e.modelo || '' },
    { label: 'Serie', get: e => e.serie || '' },
    { label: 'Area', get: e => e.area || '' },
    { label: 'Resolucion', get: e => e.resolucion ?? '' },
    { label: 'Unidad', get: e => e.unidad || '' },
    { label: 'Intervalo (meses)', get: e => e.intervalo_meses },
    { label: 'Ultima calibracion', get: e => e.ultima_calibracion || '' },
    { label: 'Proxima calibracion', get: e => e.proxima_calibracion || '' },
    { label: 'Estado', get: e => ESTADO[e.estado]?.txt || e.estado },
    { label: 'Certificado', get: e => e.ultimo_certificado || '' },
    { label: '%R&R', get: e => e.ultimo_rr_pct ?? '' },
    { label: 'Resultado R&R', get: e => e.ultimo_rr_resultado || '' },
  ]
  const COLS_CAL = [
    { label: 'Fecha', get: c => c.fecha },
    { label: 'Equipo', get: c => equipoDe(c.equipo_id)?.clave || c.equipo_id },
    { label: 'Tipo', get: c => c.tipo },
    { label: 'Resultado', get: c => c.resultado },
    { label: 'Laboratorio', get: c => c.laboratorio || '' },
    { label: 'Certificado', get: c => c.numero_certificado || '' },
    { label: 'Patron', get: c => c.patron || '' },
    { label: 'Trazabilidad', get: c => c.trazabilidad || '' },
    { label: 'Error', get: c => c.error_encontrado ?? '' },
    { label: 'Incertidumbre', get: c => c.incertidumbre ?? '' },
    { label: 'Proxima', get: c => c.proxima_fecha || '' },
  ]

  const badge = (est) => {
    const s = ESTADO[est] || { txt: est, bg: '#e5e7eb', col: '#374151' }
    return <span style={{ ...S.tag, background: s.bg, color: s.col }}>{s.txt}</span>
  }

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Calibracion de equipos de medicion</h2>
          <p style={S.sub}>
            Un dato medido con un equipo vencido no vale, y lo peor es que no se nota: la carta sale
            normal y el producto se embarca. Aqui vive el padron, su intervalo, sus certificados y su
            trazabilidad al patron. Cuando un equipo sale <b>rechazado</b>, el sistema guarda desde
            cuando queda en duda lo que se midio con el.
          </p>
        </div>
        <FiltroSite value={site} onChange={setSite} />
      </div>

      <div style={S.kpis}>
        <div style={S.kpi}><span style={S.kpiTit}>Equipos en el padron</span><b style={S.kpiVal}>{equipos.length}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Vigentes</span><b style={{ ...S.kpiVal, color: '#15803d' }}>{cuenta('vigente')}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Por vencer</span><b style={{ ...S.kpiVal, color: '#b45309' }}>{cuenta('por_vencer')}</b><span style={S.kpiPie}>dentro de {param?.dias_aviso ?? 30} dias</span></div>
        <div style={S.kpi}><span style={S.kpiTit}>Vencidos</span><b style={{ ...S.kpiVal, color: '#b91c1c' }}>{cuenta('vencido')}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Sin calibrar</span><b style={{ ...S.kpiVal, color: '#b91c1c' }}>{cuenta('sin_calibrar')}</b></div>
        <div style={S.kpi}><span style={S.kpiTit}>Fuera de servicio</span><b style={S.kpiVal}>{cuenta('fuera_de_servicio')}</b></div>
      </div>

      {noUsables.length > 0 && (
        <p style={S.aviso}>
          <b>{noUsables.length}</b> equipo(s) no se pueden usar para medir ahora mismo:{' '}
          {noUsables.slice(0, 6).map(e => e.clave).join(', ')}{noUsables.length > 6 ? '...' : ''}.
          Mientras esten asi, cualquier medicion que se tome con ellos no sirve como evidencia.
        </p>
      )}

      {rechazadas.length > 0 && (
        <p style={S.avisoRojo}>
          Hay <b>{rechazadas.length}</b> calibracion(es) rechazada(s). La norma pide evaluar la validez
          de lo que se midio con ese equipo desde su ultima calibracion buena:{' '}
          {rechazadas.slice(0, 4).map(c => `${equipoDe(c.equipo_id)?.clave || c.equipo_id} desde ${c.impacto_desde}`).join(' · ')}.
          El listado de que se midio en esa ventana llega con el modulo de SPC; por ahora hay que
          revisarlo a mano.
        </p>
      )}

      <div style={S.tabs}>
        {[['padron', 'Padron de equipos'], ['calibrar', 'Registrar calibracion'],
          ['historial', 'Historial de certificados'], ['rr', 'Estudios R&R'],
          ['config', 'Configuracion']].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => setTab(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      {/* ================= PADRON ================= */}
      {tab === 'padron' && (
        <>
          {puedeEditar && !form && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
              <button style={S.boton} onClick={() => { setForm({ ...equipoVacio }); setEditando(null); setError('') }}>
                + Nuevo equipo
              </button>
            </div>
          )}

          {form && (
            <div style={S.card}>
              <p style={S.cardTit}>{editando ? 'Editar equipo' : 'Nuevo equipo de medicion'}</p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Clave *</label>
                  <input style={S.input} maxLength={20} value={form.clave}
                    onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="VER-001" />
                </div>
                <div style={{ ...S.campo, flex: 2.5 }}>
                  <label style={S.label}>Nombre *</label>
                  <input style={S.input} value={form.nombre}
                    onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Vernier digital 0-150 mm" />
                </div>
                <div style={{ ...S.campo, flex: 1.4 }}>
                  <label style={S.label}>Tipo</label>
                  <select style={S.input} value={form.tipo} onChange={e => setForm({ ...form, tipo: e.target.value })}>
                    <option value="">Sin especificar</option>
                    {TIPOS.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Marca</label>
                  <input style={S.input} value={form.marca} onChange={e => setForm({ ...form, marca: e.target.value })} />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Modelo</label>
                  <input style={S.input} value={form.modelo} onChange={e => setForm({ ...form, modelo: e.target.value })} />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Numero de serie</label>
                  <input style={S.input} value={form.serie} onChange={e => setForm({ ...form, serie: e.target.value })} />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Area donde vive</label>
                  <select style={S.input} value={form.area_id}
                    onChange={e => setForm({ ...form, area_id: e.target.value })}>
                    <option value="">Sin asignar</option>
                    {areas.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Resolucion</label>
                  <input type="number" step="any" style={S.input} value={form.resolucion}
                    onChange={e => setForm({ ...form, resolucion: e.target.value })} placeholder="0.01" />
                  <span style={S.ayuda}>La division mas chica que alcanza a leer.</span>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Unidad</label>
                  <input style={S.input} maxLength={10} value={form.unidad}
                    onChange={e => setForm({ ...form, unidad: e.target.value })} placeholder="mm" />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Rango minimo</label>
                  <input type="number" step="any" style={S.input} value={form.rango_min}
                    onChange={e => setForm({ ...form, rango_min: e.target.value })} />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Rango maximo</label>
                  <input type="number" step="any" style={S.input} value={form.rango_max}
                    onChange={e => setForm({ ...form, rango_max: e.target.value })} />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Intervalo (meses) *</label>
                  <input type="number" min="1" style={S.input} value={form.intervalo_meses}
                    onChange={e => setForm({ ...form, intervalo_meses: e.target.value })} />
                  <span style={S.ayuda}>Cada cuanto se recalibra.</span>
                </div>
              </div>
              <label style={S.check}>
                <input type="checkbox" checked={!!form.requiere_rr}
                  onChange={e => setForm({ ...form, requiere_rr: e.target.checked })} />
                <span>Requiere estudio R&amp;R (se usa para medir caracteristicas especiales)</span>
              </label>
              <div style={S.acciones}>
                <button style={S.botonSec} onClick={() => { setForm(null); setEditando(null) }}>Cancelar</button>
                <button style={S.boton} onClick={guardarEquipo}>Guardar</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={S.cardHead}>
              <p style={S.cardTit}>Padron &middot; {lista.length} de {equipos.length}</p>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <input style={S.inputMini} value={filtro} onChange={e => setFiltro(e.target.value)}
                  placeholder="Buscar clave, tipo, area..." />
                <button style={S.expBtn} onClick={() => exportarExcel('equipos_medicion', COLS_EQ, lista)}>Excel</button>
                <button style={S.expBtn} onClick={() => imprimirTablaPDF('Padron de equipos de medicion', COLS_EQ, lista)}>PDF</button>
              </div>
            </div>
            {lista.length === 0 && <p style={S.vacio}>No hay equipos en el padron.</p>}
            {lista.length > 0 && (
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Clave</th><th style={S.th}>Equipo</th><th style={S.th}>Tipo</th>
                    <th style={S.th}>Area</th><th style={S.thR}>Resolucion</th><th style={S.thR}>Interv.</th>
                    <th style={S.th}>Ultima</th><th style={S.th}>Proxima</th><th style={S.th}>Estado</th>
                    <th style={S.th}>Certificado</th><th style={S.th}>R&amp;R</th><th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(e => (
                    <tr key={e.id}>
                      <td style={{ ...S.td, fontWeight: 600 }}>{e.clave}</td>
                      <td style={S.td}>{e.nombre}</td>
                      <td style={S.td}>{e.tipo || '-'}</td>
                      <td style={S.td}>{e.area || '-'}</td>
                      <td style={S.tdR}>{e.resolucion != null ? `${fmt(e.resolucion)} ${e.unidad || ''}` : '-'}</td>
                      <td style={S.tdR}>{e.intervalo_meses} m</td>
                      <td style={S.td}>{e.ultima_calibracion || '-'}</td>
                      <td style={S.td}>
                        {e.proxima_calibracion || '-'}
                        {e.dias != null && e.estado === 'por_vencer' && <span style={S.mini}> ({e.dias} d)</span>}
                        {e.dias != null && e.estado === 'vencido' && <span style={{ ...S.mini, color: '#b91c1c' }}> (+{e.dias} d)</span>}
                      </td>
                      <td style={S.td}>{badge(e.estado)}</td>
                      <td style={S.td}>{e.ultimo_certificado || '-'}</td>
                      <td style={S.td}>
                        {e.ultimo_rr_resultado
                          ? <span style={{ ...S.tag, ...(RR[e.ultimo_rr_resultado] || {}) }}>{fmt(e.ultimo_rr_pct)}%</span>
                          : (e.requiere_rr ? <span style={{ ...S.tag, background: '#fee2e2', color: '#b91c1c' }}>falta</span> : '-')}
                      </td>
                      <td style={S.td}>
                        <div style={{ display: 'flex', gap: '6px' }}>
                          <button style={S.btnMini} onClick={() => { setCal({ ...calVacia, equipo_id: String(e.id) }); setTab('calibrar') }}>Calibrar</button>
                          {puedeEditar && <button style={S.btnMiniSec} onClick={() => editarEquipo(e)}>Editar</button>}
                          {puedeConfig && <button style={S.btnMiniSec} onClick={() => darDeBaja(e)}>Baja</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ================= REGISTRAR CALIBRACION ================= */}
      {tab === 'calibrar' && (
        <div style={S.card}>
          <p style={S.cardTit}>Registrar una calibracion</p>
          <p style={S.ayuda}>
            La proxima fecha sale sola del intervalo del equipo, salvo que el laboratorio indique otra.
            Si el resultado es <b>rechazado</b>, el equipo queda fuera de servicio y se guarda desde
            cuando queda en duda lo que midio.
          </p>
          <div style={S.fila}>
            <div style={{ ...S.campo, flex: 2.5 }}>
              <label style={S.label}>Equipo *</label>
              <select style={S.input} value={cal.equipo_id} onChange={e => setCal({ ...cal, equipo_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {equipos.map(e => (
                  <option key={e.id} value={e.id}>
                    {e.clave} - {e.nombre} ({ESTADO[e.estado]?.txt || e.estado})
                  </option>
                ))}
              </select>
            </div>
            <div style={S.campo}>
              <label style={S.label}>Fecha *</label>
              <input type="date" max={hoyISO()} style={S.input} value={cal.fecha}
                onChange={e => setCal({ ...cal, fecha: e.target.value })} />
            </div>
            <div style={S.campo}>
              <label style={S.label}>Tipo</label>
              <select style={S.input} value={cal.tipo} onChange={e => setCal({ ...cal, tipo: e.target.value })}>
                <option value="externa">Externa (laboratorio acreditado)</option>
                <option value="interna">Interna</option>
                <option value="verificacion">Verificacion intermedia</option>
              </select>
            </div>
            <div style={S.campo}>
              <label style={S.label}>Resultado *</label>
              <select style={S.input} value={cal.resultado} onChange={e => setCal({ ...cal, resultado: e.target.value })}>
                <option value="aprobado">Aprobado</option>
                <option value="aprobado_con_ajuste">Aprobado con ajuste</option>
                <option value="rechazado">Rechazado</option>
              </select>
            </div>
          </div>

          <div style={S.fila}>
            <div style={{ ...S.campo, flex: 1.6 }}>
              <label style={S.label}>Laboratorio</label>
              <input style={S.input} value={cal.laboratorio} onChange={e => setCal({ ...cal, laboratorio: e.target.value })} />
            </div>
            <div style={S.campo}>
              <label style={S.label}>Numero de certificado{cal.tipo === 'externa' ? ' *' : ''}</label>
              <input style={S.input} value={cal.numero_certificado}
                onChange={e => setCal({ ...cal, numero_certificado: e.target.value })} />
            </div>
            <div style={S.campo}>
              <label style={S.label}>Patron utilizado</label>
              <input style={S.input} value={cal.patron} onChange={e => setCal({ ...cal, patron: e.target.value })}
                placeholder="Bloque patron 25 mm" />
            </div>
            <div style={S.campo}>
              <label style={S.label}>Trazabilidad</label>
              <input style={S.input} value={cal.trazabilidad} onChange={e => setCal({ ...cal, trazabilidad: e.target.value })}
                placeholder="CENAM / NIST" />
              <span style={S.ayuda}>A que patron nacional se remonta.</span>
            </div>
          </div>

          <div style={S.fila}>
            <div style={S.campo}>
              <label style={S.label}>Error encontrado</label>
              <input type="number" step="any" style={S.input} value={cal.error_encontrado}
                onChange={e => setCal({ ...cal, error_encontrado: e.target.value })} />
            </div>
            <div style={S.campo}>
              <label style={S.label}>Incertidumbre</label>
              <input type="number" step="any" style={S.input} value={cal.incertidumbre}
                onChange={e => setCal({ ...cal, incertidumbre: e.target.value })} />
            </div>
            <div style={S.campo}>
              <label style={S.label}>Proxima fecha</label>
              <input type="date" style={S.input} value={cal.proxima}
                onChange={e => setCal({ ...cal, proxima: e.target.value })} />
              <span style={S.ayuda}>Solo si el laboratorio indica una distinta al intervalo.</span>
            </div>
            <div style={{ ...S.campo, flex: 2 }}>
              <label style={S.label}>Liga al certificado</label>
              <input style={S.input} value={cal.documento_url}
                onChange={e => setCal({ ...cal, documento_url: e.target.value })} placeholder="https://..." />
            </div>
          </div>

          <div style={S.fila}>
            <div style={{ ...S.campo, flex: 4 }}>
              <label style={S.label}>Notas</label>
              <input style={S.input} value={cal.notas} onChange={e => setCal({ ...cal, notas: e.target.value })} />
            </div>
          </div>

          {(() => {
            const eq = equipos.find(x => x.id === Number(cal.equipo_id))
            if (!eq) return null
            if (cal.resultado === 'rechazado') {
              return (
                <div style={S.previoRojo}>
                  {eq.clave} va a quedar <b>fuera de servicio</b>. Todo lo medido con el
                  desde <b>{eq.ultima_calibracion || 'su alta'}</b> queda en duda y hay que evaluarlo.
                </div>
              )
            }
            return (
              <div style={S.previo}>
                Con el intervalo de <b>{eq.intervalo_meses} meses</b>, la proxima calibracion queda
                para <b>{cal.proxima || 'la fecha que resulte de sumar el intervalo'}</b>
                {!cal.proxima && cal.fecha ? ` (${cal.fecha} + ${eq.intervalo_meses} meses)` : ''}.
              </div>
            )
          })()}

          <div style={S.acciones}>
            <button style={S.boton} onClick={guardarCal}>Registrar calibracion</button>
          </div>
        </div>
      )}

      {/* ================= HISTORIAL ================= */}
      {tab === 'historial' && (
        <div style={S.card}>
          <div style={S.cardHead}>
            <p style={S.cardTit}>Certificados &middot; {calibs.length}</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
              <select style={S.inputMini} value={detalle || ''} onChange={e => setDetalle(e.target.value ? Number(e.target.value) : null)}>
                <option value="">Todos los equipos</option>
                {equipos.map(e => <option key={e.id} value={e.id}>{e.clave}</option>)}
              </select>
              <button style={S.expBtn} onClick={() => exportarExcel('calibraciones', COLS_CAL, calibs.filter(c => !detalle || c.equipo_id === detalle))}>Excel</button>
              <button style={S.expBtn} onClick={() => imprimirTablaPDF('Historial de calibraciones', COLS_CAL, calibs.filter(c => !detalle || c.equipo_id === detalle))}>PDF</button>
            </div>
          </div>
          {calibs.length === 0 && <p style={S.vacio}>Aun no se ha registrado ninguna calibracion.</p>}
          {calibs.length > 0 && (
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Fecha</th><th style={S.th}>Equipo</th><th style={S.th}>Tipo</th>
                  <th style={S.th}>Resultado</th><th style={S.th}>Laboratorio</th><th style={S.th}>Certificado</th>
                  <th style={S.th}>Patron</th><th style={S.th}>Trazabilidad</th>
                  <th style={S.thR}>Error</th><th style={S.th}>Proxima</th><th style={S.th}>Doc.</th>
                </tr>
              </thead>
              <tbody>
                {calibs.filter(c => !detalle || c.equipo_id === detalle).map(c => (
                  <tr key={c.id}>
                    <td style={S.td}>{c.fecha}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{equipoDe(c.equipo_id)?.clave || c.equipo_id}</td>
                    <td style={S.td}>{c.tipo}</td>
                    <td style={S.td}>
                      <span style={{ ...S.tag, ...(c.resultado === 'rechazado'
                        ? { background: '#fee2e2', color: '#b91c1c' }
                        : { background: '#dcfce7', color: '#15803d' }) }}>
                        {c.resultado.replace(/_/g, ' ')}
                      </span>
                      {c.impacto_desde && <span style={S.mini}> en duda desde {c.impacto_desde}</span>}
                    </td>
                    <td style={S.td}>{c.laboratorio || '-'}</td>
                    <td style={S.td}>{c.numero_certificado || '-'}</td>
                    <td style={S.td}>{c.patron || '-'}</td>
                    <td style={S.td}>{c.trazabilidad || '-'}</td>
                    <td style={S.tdR}>{c.error_encontrado != null ? fmt(c.error_encontrado) : '-'}</td>
                    <td style={S.td}>{c.proxima_fecha || '-'}</td>
                    <td style={S.td}>
                      {c.documento_url
                        ? <a href={c.documento_url} target="_blank" rel="noreferrer" style={S.link}>ver</a>
                        : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ================= R&R ================= */}
      {tab === 'rr' && (
        <>
          <div style={S.card}>
            <p style={S.cardTit}>Registrar un estudio R&amp;R</p>
            <p style={S.ayuda}>
              Aqui se guarda el <b>resultado</b> del estudio y su evidencia; el estudio se corre aparte.
              La calificacion la pone el sistema con los criterios AIAG y no se teclea, porque un numero
              capturado a mano termina diciendo lo que conviene. Menos de {param?.rr_aceptable_pct ?? 10}%
              es aceptable, hasta {param?.rr_marginal_pct ?? 30}% es marginal y se usa solo con
              justificacion, y arriba de ahi el equipo no sirve para decidir. El ndc va aparte: con
              menos de {param?.ndc_minimo ?? 5} categorias no distingue piezas buenas de malas aunque
              el porcentaje se vea bien.
            </p>
            <div style={S.fila}>
              <div style={{ ...S.campo, flex: 2 }}>
                <label style={S.label}>Equipo *</label>
                <select style={S.input} value={rr.equipo_id} onChange={e => setRr({ ...rr, equipo_id: e.target.value })}>
                  <option value="">Selecciona...</option>
                  {equipos.map(e => <option key={e.id} value={e.id}>{e.clave} - {e.nombre}</option>)}
                </select>
              </div>
              <div style={S.campo}>
                <label style={S.label}>Fecha</label>
                <input type="date" style={S.input} value={rr.fecha} onChange={e => setRr({ ...rr, fecha: e.target.value })} />
              </div>
              <div style={{ ...S.campo, flex: 2 }}>
                <label style={S.label}>Articulo</label>
                <select style={S.input} value={rr.articulo_id || ''} onChange={e => setRr({ ...rr, articulo_id: e.target.value })}>
                  <option value="">No aplica</option>
                  {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
                </select>
              </div>
              <div style={{ ...S.campo, flex: 1.5 }}>
                <label style={S.label}>Caracteristica</label>
                <input style={S.input} value={rr.caracteristica}
                  onChange={e => setRr({ ...rr, caracteristica: e.target.value })} placeholder="Diametro" />
              </div>
            </div>
            <div style={S.fila}>
              <div style={S.campo}>
                <label style={S.label}>%R&amp;R *</label>
                <input type="number" step="any" min="0" style={S.input} value={rr.pct_rr}
                  onChange={e => setRr({ ...rr, pct_rr: e.target.value })} />
              </div>
              <div style={S.campo}>
                <label style={S.label}>ndc</label>
                <input type="number" min="0" style={S.input} value={rr.ndc}
                  onChange={e => setRr({ ...rr, ndc: e.target.value })} />
                <span style={S.ayuda}>Categorias distintas.</span>
              </div>
              <div style={S.campo}>
                <label style={S.label}>Operadores</label>
                <input type="number" min="1" style={S.input} value={rr.operadores}
                  onChange={e => setRr({ ...rr, operadores: e.target.value })} />
              </div>
              <div style={S.campo}>
                <label style={S.label}>Partes</label>
                <input type="number" min="1" style={S.input} value={rr.partes}
                  onChange={e => setRr({ ...rr, partes: e.target.value })} />
              </div>
              <div style={S.campo}>
                <label style={S.label}>Ensayos</label>
                <input type="number" min="1" style={S.input} value={rr.ensayos}
                  onChange={e => setRr({ ...rr, ensayos: e.target.value })} />
              </div>
              <div style={{ ...S.campo, flex: 2 }}>
                <label style={S.label}>Liga al estudio</label>
                <input style={S.input} value={rr.documento_url}
                  onChange={e => setRr({ ...rr, documento_url: e.target.value })} placeholder="https://..." />
              </div>
            </div>
            <div style={S.acciones}>
              <button style={S.boton} onClick={guardarRR}>Registrar estudio</button>
            </div>
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>Estudios registrados &middot; {rrs.length}</p>
            {rrs.length === 0 && <p style={S.vacio}>Aun no hay estudios R&amp;R.</p>}
            {rrs.length > 0 && (
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Fecha</th><th style={S.th}>Equipo</th><th style={S.th}>Articulo</th>
                    <th style={S.th}>Caracteristica</th><th style={S.thR}>%R&amp;R</th><th style={S.thR}>ndc</th>
                    <th style={S.th}>Resultado</th><th style={S.th}>Estudio</th>
                  </tr>
                </thead>
                <tbody>
                  {rrs.map(x => (
                    <tr key={x.id}>
                      <td style={S.td}>{x.fecha}</td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{equipoDe(x.equipo_id)?.clave || x.equipo_id}</td>
                      <td style={S.td}>{artDe(x.articulo_id)?.codigo_interno || '-'}</td>
                      <td style={S.td}>{x.caracteristica || '-'}</td>
                      <td style={S.tdR}>{fmt(x.pct_rr)}%</td>
                      <td style={S.tdR}>{x.ndc ?? '-'}</td>
                      <td style={S.td}><span style={{ ...S.tag, ...(RR[x.resultado] || {}) }}>{x.resultado}</span></td>
                      <td style={S.td}>
                        {x.documento_url ? <a href={x.documento_url} target="_blank" rel="noreferrer" style={S.link}>ver</a> : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ================= CONFIGURACION ================= */}
      {tab === 'config' && (
        <div style={S.card}>
          <p style={S.cardTit}>Parametros de calibracion</p>
          <div style={S.fila}>
            <div style={S.campo}>
              <label style={S.label}>Aviso previo (dias)</label>
              <input type="number" min="0" style={S.input} disabled={!puedeConfig}
                defaultValue={param?.dias_aviso ?? 30}
                onBlur={e => guardarParam('dias_aviso', e.target.value)} />
              <span style={S.ayuda}>Con cuanta anticipacion un equipo se marca "por vencer".</span>
            </div>
            <div style={S.campo}>
              <label style={S.label}>%R&amp;R aceptable</label>
              <input type="number" min="0" step="0.1" style={S.input} disabled={!puedeConfig}
                defaultValue={param?.rr_aceptable_pct ?? 10}
                onBlur={e => guardarParam('rr_aceptable_pct', e.target.value)} />
              <span style={S.ayuda}>AIAG: 10%.</span>
            </div>
            <div style={S.campo}>
              <label style={S.label}>%R&amp;R marginal</label>
              <input type="number" min="0" step="0.1" style={S.input} disabled={!puedeConfig}
                defaultValue={param?.rr_marginal_pct ?? 30}
                onBlur={e => guardarParam('rr_marginal_pct', e.target.value)} />
              <span style={S.ayuda}>AIAG: 30%. Arriba de esto no sirve para decidir.</span>
            </div>
            <div style={S.campo}>
              <label style={S.label}>ndc minimo</label>
              <input type="number" min="1" style={S.input} disabled={!puedeConfig}
                defaultValue={param?.ndc_minimo ?? 5}
                onBlur={e => guardarParam('ndc_minimo', e.target.value)} />
              <span style={S.ayuda}>AIAG: 5 categorias.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '14px', marginBottom: '12px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '840px', lineHeight: 1.5 },
  aviso: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#92400e', marginBottom: '10px', lineHeight: 1.5 },
  avisoRojo: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '10px 12px', fontSize: '12.5px', color: '#b91c1c', marginBottom: '10px', lineHeight: 1.5 },
  tabs: { display: 'flex', gap: '8px', marginBottom: '14px', flexWrap: 'wrap' },
  tab: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  tabAct: { padding: '8px 15px', background: '#b91c1c', color: '#fff', border: '1px solid #b91c1c', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '15px 17px', marginBottom: '13px' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '10px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 6px' },
  fila: { display: 'flex', gap: '13px', flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '130px', marginBottom: '8px' },
  label: { fontSize: '12px', color: '#444', fontWeight: 500 },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13.5px', outline: 'none', background: '#fff' },
  inputMini: { padding: '7px 9px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '12.5px', outline: 'none' },
  ayuda: { fontSize: '11px', color: '#64748b', lineHeight: 1.45 },
  check: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#444', margin: '4px 0' },
  previo: { background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', padding: '9px 12px', fontSize: '12.5px', color: '#166534', marginTop: '6px', lineHeight: 1.5 },
  previoRojo: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '9px 12px', fontSize: '12.5px', color: '#b91c1c', marginTop: '6px', lineHeight: 1.5 },
  acciones: { display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '10px' },
  boton: { padding: '9px 20px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13.5px', cursor: 'pointer', fontWeight: 500 },
  botonSec: { padding: '9px 20px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13.5px', cursor: 'pointer' },
  btnMini: { padding: '5px 11px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' },
  btnMiniSec: { padding: '5px 11px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '6px', fontSize: '11.5px', cursor: 'pointer' },
  expBtn: { padding: '7px 13px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '12.5px', cursor: 'pointer' },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px' },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  vacio: { color: '#64748b', fontSize: '13px', margin: 0 },
  kpis: { display: 'flex', gap: '11px', flexWrap: 'wrap', marginBottom: '13px' },
  kpi: { flex: 1, minWidth: '130px', display: 'flex', flexDirection: 'column', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '13px 16px' },
  kpiTit: { fontSize: '10.5px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.04em', fontWeight: 600 },
  kpiVal: { fontSize: '21px', color: '#1a1a2e', margin: '3px 0 1px' },
  kpiPie: { fontSize: '11px', color: '#64748b' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right', whiteSpace: 'nowrap' },
  tag: { fontSize: '10px', fontWeight: 600, padding: '2px 7px', borderRadius: '20px', whiteSpace: 'nowrap' },
  mini: { fontSize: '10.5px', color: '#64748b' },
  link: { color: '#b91c1c', fontSize: '12px' },
}
