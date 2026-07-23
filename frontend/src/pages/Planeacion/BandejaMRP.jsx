import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

const ACCION_LABEL = { requisicion: 'Requisicion', consigna: 'Consigna', ot: 'Orden de Trabajo' }
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fLarga = (s) => { if (!s) return '-'; const p = String(s).split('-'); return `${p[2]}/${p[1]}/${p[0]}` }
const hoyISO = () => new Date().toISOString().slice(0, 10)

export default function BandejaMRP() {
  const { perfil, tienePermiso } = useAuth()
  const puedeGenerar = tienePermiso('plan_ordenes', 'aprobar')

  const [corridas, setCorridas] = useState([])
  const [corridaSel, setCorridaSel] = useState(null)
  const [ordenes, setOrdenes] = useState([])
  const [clientes, setClientes] = useState([])
  const [prefCliente, setPrefCliente] = useState({}) // articulo_id -> cliente_id
  const [sel, setSel] = useState(new Set())
  const [cliFila, setCliFila] = useState({}) // rowId -> cliente_id (consigna)
  const [cant, setCant] = useState({})       // rowId -> cantidad editable
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargarBase() }, [])

  const cargarBase = async () => {
    const emp = perfil.empresa_id
    const [{ data: cli }, { data: ac }] = await Promise.all([
      supabase.from('clientes').select('id, nombre').eq('empresa_id', emp).order('nombre'),
      supabase.from('articulo_cliente').select('articulo_id, cliente_id'),
    ])
    setClientes(cli || [])
    const pref = {}
    ;(ac || []).forEach(r => { if (!pref[r.articulo_id]) pref[r.articulo_id] = r.cliente_id })
    setPrefCliente(pref)
    await cargarCorridas()
  }

  const cargarCorridas = async (autoSel) => {
    const emp = perfil.empresa_id
    const { data } = await supabase.from('mrp_corridas').select('*').eq('empresa_id', emp).order('id', { ascending: false }).limit(15)
    setCorridas(data || [])
    const id = autoSel ?? (data && data[0]?.id)
    if (id) seleccionar(id, data || [])
    else { setCorridaSel(null); setOrdenes([]) }
  }

  const seleccionar = async (id, lista) => {
    setCorridaSel((lista || corridas).find(c => c.id === id) || null)
    setSel(new Set()); setError(''); setExito('')
    const { data } = await supabase.from('mrp_resultados')
      .select('*, articulo:articulos(codigo_interno, descripcion, unidad_medida, origen, es_consigna)')
      .eq('corrida_id', id).gt('orden_planeada', 0).is('convertida_a', null)
      .order('nivel_bom').order('fecha_requerida')
    const rows = data || []
    setOrdenes(rows)
    const c = {}, q = {}
    rows.forEach(r => { c[r.id] = prefCliente[r.articulo_id] || ''; q[r.id] = r.orden_planeada })
    setCliFila(c); setCant(q)
  }

  const toggle = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s) }
  const toggleAll = () => { setSel(sel.size === ordenes.length ? new Set() : new Set(ordenes.map(o => o.id))) }

  const generar = async () => {
    setError(''); setExito('')
    const filas = ordenes.filter(o => sel.has(o.id))
    if (filas.length === 0) { setError('Selecciona al menos una orden.'); return }
    const consignaSinCliente = filas.filter(o => o.accion === 'consigna' && !cliFila[o.id])
    if (consignaSinCliente.length > 0) { setError('Asigna cliente a las ordenes de consigna seleccionadas.'); return }

    setProc(true)
    try {
      const emp = perfil.empresa_id
      const comprados = filas.filter(o => o.accion === 'requisicion')
      const fabricados = filas.filter(o => o.accion === 'ot')
      const consignas = filas.filter(o => o.accion === 'consigna')
      let creados = { req: 0, ot: 0, con: 0 }

      // ---- Requisicion (agrupa todos los comprados en una) ----
      if (comprados.length > 0) {
        const anio = new Date().getFullYear()
        const codigo = perfil.sites?.codigo || 'GEN'
        const empNom = (perfil.empresas?.nombre || 'EMP').substring(0, 5).toUpperCase()
        const { count } = await supabase.from('requisiciones').select('*', { count: 'exact', head: true }).eq('site_id', perfil.site_id)
        const folio = `REQ-${empNom}-${codigo}-${anio}-${String((count || 0) + 1).padStart(4, '0')}`
        const fechaReq = comprados.reduce((min, o) => (o.fecha_requerida < min ? o.fecha_requerida : min), comprados[0].fecha_requerida)
        const critica = comprados.some(o => o.fecha_liberacion && o.fecha_liberacion < hoyISO())
        const { data: req, error: e1 } = await supabase.from('requisiciones').insert({
          folio, empresa_id: emp, site_id: perfil.site_id, solicitante_id: perfil.id,
          fecha_requerida: fechaReq, criticidad: critica ? 'alta' : 'media',
          justificacion: critica ? 'Generada por MRP (fecha de liberacion vencida)' : null,
          notas: `Generada por MRP corrida #${corridaSel.id}`, estatus: 'borrador',
          gerente_area_id: perfil.gerente_id || perfil.id, paso_aprobacion: 0,
        }).select().single()
        if (e1) throw e1
        const lineas = comprados.map(o => ({
          requisicion_id: req.id, articulo_id: o.articulo_id,
          cantidad: parseFloat(cant[o.id]) || o.orden_planeada,
          unidad_medida: o.articulo?.unidad_medida || 'PZA',
          notas: `MRP: requerido ${fLarga(o.fecha_requerida)}`,
        }))
        const { error: e2 } = await supabase.from('requisicion_lineas').insert(lineas)
        if (e2) throw e2
        await marcar(comprados, 'requisicion', req.id)
        creados.req = comprados.length
      }

      // ---- Consigna (una autorizacion por cliente) ----
      if (consignas.length > 0) {
        const porCliente = {}
        consignas.forEach(o => { const c = cliFila[o.id]; (porCliente[c] = porCliente[c] || []).push(o) })
        for (const cid of Object.keys(porCliente)) {
          const grupo = porCliente[cid]
          const folio = `AC-${Date.now().toString().slice(-8)}`
          const { data: aut, error: e1 } = await supabase.from('consigna_autorizaciones').insert({
            empresa_id: emp, folio, cliente_id: parseInt(cid), site_id: perfil.site_id,
            estatus: 'pendiente', referencia: `MRP corrida #${corridaSel.id}`,
            notas: 'Generada por MRP', creado_por: perfil.id,
          }).select().single()
          if (e1) throw e1
          const lineas = grupo.map(o => ({
            autorizacion_id: aut.id, articulo_id: o.articulo_id,
            cantidad: parseFloat(cant[o.id]) || o.orden_planeada,
            fecha_sugerida: o.fecha_requerida, tipo: 'firme',
          }))
          const { error: e2 } = await supabase.from('consigna_autorizacion_lineas').insert(lineas)
          if (e2) throw e2
          await marcar(grupo, 'consigna', aut.id)
          creados.con += grupo.length
        }
      }

      // ---- OT (una por fabricado) ----
      for (const o of fabricados) {
        const folio = `OT-${Date.now().toString().slice(-8)}-${o.articulo_id}`
        const { data: ot, error: e1 } = await supabase.from('ordenes_trabajo').insert({
          empresa_id: emp, folio, site_id: perfil.site_id, articulo_id: o.articulo_id,
          cantidad_programada: parseFloat(cant[o.id]) || o.orden_planeada,
          fecha_programada: o.fecha_liberacion || o.fecha_requerida,
          estatus: 'programada', notas: `Generada por MRP corrida #${corridaSel.id}`,
          creado_por: perfil.id,
        }).select().single()
        if (e1) throw e1
        const { error: e2 } = await supabase.from('ot_articulos').insert({
          ot_id: ot.id, articulo_id: o.articulo_id,
          cantidad_programada: parseFloat(cant[o.id]) || o.orden_planeada, principal: true,
        })
        if (e2) throw e2
        await marcar([o], 'ot', ot.id)
        creados.ot += 1
      }

      const partes = []
      if (creados.req) partes.push(`${creados.req} linea(s) de requisicion`)
      if (creados.con) partes.push(`${creados.con} de consigna`)
      if (creados.ot) partes.push(`${creados.ot} OT`)
      setExito(`Generado: ${partes.join(', ')}.`)
      await seleccionar(corridaSel.id)
      setTimeout(() => setExito(''), 5000)
    } catch (e) {
      setError('Error al generar: ' + (e.message || e))
    } finally {
      setProc(false)
    }
  }

  const marcar = async (filas, tipo, ref) => {
    const ids = filas.map(f => f.id)
    await supabase.from('mrp_resultados').update({
      convertida_a: tipo, convertida_ref: ref, convertida_at: new Date().toISOString(),
    }).in('id', ids)
  }

  return (
    <div>
      <div style={styles.encabezado}><h2 style={styles.titulo}>Bandeja de ordenes planeadas</h2></div>
      <p style={styles.ayuda}>Selecciona las ordenes sugeridas por el MRP y generalas como documentos reales.
        Los comprados crean una requisicion (borrador), la consigna una autorizacion por cliente, y los fabricados una OT programada.</p>

      <div style={styles.tarjeta}>
        <h3 style={styles.tarjetaTitulo}>Corrida</h3>
        {corridas.length === 0 ? <p style={{ color: '#666', fontSize: '13px' }}>No hay corridas. Corre el MRP primero.</p> : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
            {corridas.map(c => (
              <button key={c.id} onClick={() => seleccionar(c.id)} style={corridaSel?.id === c.id ? styles.chipActivo : styles.chip}>
                #{c.id} · {c.alcance_tipo} · {c.ordenes_sugeridas} ord
              </button>
            ))}
          </div>
        )}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {corridaSel && (
        <div style={styles.tarjeta}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
            <h3 style={styles.tarjetaTitulo}>Ordenes pendientes de generar</h3>
            {puedeGenerar && ordenes.length > 0 && (
              <button style={styles.boton} disabled={proc} onClick={generar}>{proc ? 'Generando...' : `Generar ${sel.size || ''} seleccionada(s)`}</button>
            )}
          </div>
          {ordenes.length === 0 ? <p style={{ color: '#666', fontSize: '13px' }}>No hay ordenes pendientes en esta corrida (o ya se generaron).</p> : (
            <div>
              <div style={styles.th}>
                <span style={{ width: '32px' }}><input type="checkbox" checked={sel.size === ordenes.length && ordenes.length > 0} onChange={toggleAll} /></span>
                <span style={{ flex: 2 }}>Articulo</span>
                <span style={{ flex: 1 }}>Accion</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span>
                <span style={{ flex: 1, textAlign: 'center' }}>Requerida</span>
                <span style={{ flex: 1, textAlign: 'center' }}>Liberar</span>
                <span style={{ flex: 1.4 }}>Cliente (consigna)</span>
              </div>
              {ordenes.map(o => (
                <div key={o.id} style={styles.tr}>
                  <span style={{ width: '32px' }}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></span>
                  <span style={{ flex: 2 }}><strong>{o.articulo?.codigo_interno}</strong><br /><span style={{ fontSize: '11px', color: '#94a3b8' }}>{o.articulo?.descripcion}</span></span>
                  <span style={{ flex: 1 }}><span style={badge(o.accion)}>{ACCION_LABEL[o.accion] || o.accion}</span></span>
                  <span style={{ flex: 1, textAlign: 'right' }}>
                    <input type="number" min="0" step="0.01" value={cant[o.id] ?? ''} onChange={e => setCant({ ...cant, [o.id]: e.target.value })}
                      style={{ ...styles.inputMini, textAlign: 'right' }} />
                  </span>
                  <span style={{ flex: 1, textAlign: 'center', fontSize: '12px' }}>{fLarga(o.fecha_requerida)}</span>
                  <span style={{ flex: 1, textAlign: 'center', fontSize: '12px', color: o.fecha_liberacion < hoyISO() ? '#dc2626' : '#334155' }}>{fLarga(o.fecha_liberacion)}</span>
                  <span style={{ flex: 1.4 }}>
                    {o.accion === 'consigna'
                      ? <select value={cliFila[o.id] || ''} onChange={e => setCliFila({ ...cliFila, [o.id]: e.target.value })} style={styles.inputMini}>
                          <option value="">Selecciona...</option>
                          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                        </select>
                      : <span style={{ color: '#cbd5e1' }}>-</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function badge(a) {
  const base = { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }
  if (a === 'requisicion') return { ...base, backgroundColor: '#eff6ff', color: '#2563eb' }
  if (a === 'consigna') return { ...base, backgroundColor: '#f0fdf4', color: '#16a34a' }
  if (a === 'ot') return { ...base, backgroundColor: '#fff7ed', color: '#c2410c' }
  return { ...base, backgroundColor: '#f1f5f9', color: '#64748b' }
}

const styles = {
  encabezado: { marginBottom: '8px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 20px 0', maxWidth: '820px', lineHeight: '1.5' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tarjetaTitulo: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  chip: { padding: '7px 12px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '12px', cursor: 'pointer' },
  chipActivo: { padding: '7px 12px', backgroundColor: '#faf5ff', color: '#7c3aed', border: '1px solid #d8b4fe', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  boton: { padding: '9px 18px', backgroundColor: '#9333ea', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13px', fontWeight: '500', cursor: 'pointer' },
  th: { display: 'flex', padding: '8px 6px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase', alignItems: 'center' },
  tr: { display: 'flex', padding: '10px 6px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  inputMini: { padding: '6px 8px', borderRadius: '6px', border: '1px solid #ddd', fontSize: '12px', outline: 'none', width: '100%', maxWidth: '150px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
