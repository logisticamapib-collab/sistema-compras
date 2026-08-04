import React, { useState, useEffect } from 'react'
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
  const [cavidades, setCavidades] = useState([])     // molde_cavidades (activa)
  const [artColor, setArtColor] = useState({})       // articulo_id -> color_id
  const [colores, setColores] = useState([])
  const [artParte, setArtParte] = useState({})     // articulo_id -> parte
  const [repartos, setRepartos] = useState({})     // resultado_id -> reparto entre moldes
  const [normas, setNormas] = useState([])           // normas_empaque oficiales
  const [moldes, setMoldes] = useState([])
  const [bom, setBom] = useState([])
  const [sel, setSel] = useState(new Set())
  const [cliFila, setCliFila] = useState({}) // rowId -> cliente_id (consigna)
  const [cant, setCant] = useState({})       // rowId -> cantidad editable
  const [qtyGrupo, setQtyGrupo] = useState({}) // `${moldeId}:${articuloId}` -> cantidad override
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargarBase() }, [])

  const cargarBase = async () => {
    const emp = perfil.empresa_id
    const [{ data: cli }, { data: ac }, { data: mc }, { data: ne }, { data: mo }, { data: bm }, { data: arc }, { data: cols }, { data: prts }] = await Promise.all([
      supabase.from('clientes').select('id, nombre').eq('empresa_id', emp).order('nombre'),
      supabase.from('articulo_cliente').select('articulo_id, cliente_id'),
      supabase.from('molde_cavidades').select('molde_id, articulo_id, activa').eq('activa', true),
      supabase.from('normas_empaque').select('id, articulo_id, piezas_por_empaque, activa, tipo').eq('activa', true).eq('tipo', 'oficial'),
      supabase.from('moldes').select('id, clave, nombre').eq('empresa_id', emp),
      supabase.from('bom').select('*'),
      supabase.from('articulos').select('id, color_id, parte_id, codigo_interno').eq('empresa_id', emp),
      supabase.from('colores').select('*').eq('empresa_id', emp).eq('activo', true),
      supabase.from('partes').select('*').eq('empresa_id', emp).eq('activo', true),
    ])
    const mapCol = {}
    ;(arc || []).forEach(r => { mapCol[r.id] = r.color_id ?? null })
    setArtColor(mapCol); setColores(cols || [])
    // articulo -> su parte, para avisar que un renglon cubre la demanda de
    // otro codigo y para poder repartir entre moldes gemelos
    const mapParte = {}
    ;(arc || []).forEach(x => {
      const pt = (prts || []).find(p => p.id === x.parte_id)
      if (pt) mapParte[x.id] = pt
    })
    setArtParte(mapParte)
    setClientes(cli || [])
    const pref = {}
    ;(ac || []).forEach(r => { if (!pref[r.articulo_id]) pref[r.articulo_id] = r.cliente_id })
    setPrefCliente(pref)
    setCavidades(mc || []); setNormas(ne || []); setMoldes(mo || []); setBom(bm || [])
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
    setSel(new Set()); setError(''); setExito(''); setQtyGrupo({})
    const { data } = await supabase.from('mrp_resultados')
      .select('*, articulo:articulos(codigo_interno, descripcion, unidad_medida, origen, es_consigna, se_maquila, maquilador_id)')
      .eq('corrida_id', id).gt('orden_planeada', 0).is('convertida_a', null)
      .order('nivel_bom').order('fecha_requerida')
    const rows = data || []
    setOrdenes(rows)
    const c = {}, q = {}
    rows.forEach(r => { c[r.id] = prefCliente[r.articulo_id] || ''; q[r.id] = r.orden_planeada })
    setCliFila(c); setCant(q)

    // Para los articulos que pertenecen a una parte con mas de un molde, se
    // pregunta si el molde principal alcanza a producir la cantidad antes de
    // la fecha requerida. Si no, se sugiere abrir tambien el gemelo.
    const rep = {}
    for (const r of rows) {
      const pt = artParte[r.articulo_id]
      if (!pt || !r.fecha_requerida) continue
      const { data: sug } = await supabase.rpc('sugerir_moldes_parte', {
        p_empresa_id: perfil.empresa_id, p_articulo_id: r.articulo_id,
        p_cantidad: Number(r.orden_planeada) || 0,
        p_fecha_requerida: r.fecha_requerida, p_site_id: perfil.site_id || null,
      })
      if (sug && sug.length > 1) rep[r.id] = sug
    }
    setRepartos(rep)
  }

  const toggle = (id) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s) }
  const toggleAll = () => { setSel(sel.size === ordenes.length ? new Set() : new Set(ordenes.map(o => o.id))) }

  // ---- Helpers de molde / cavidades / empaque ----
  const moldeDeArticulo = (artId) => cavidades.find(c => c.articulo_id === artId)?.molde_id || null
  const cavDe = (artId) => cavidades.filter(c => c.articulo_id === artId).length
  // Color del articulo. Los co-productos de un disparo comparten molde Y color;
  // las variantes de color del mismo molde son corridas separadas.
  const colorArt = (artId) => artColor[artId] ?? null
  const colorClave = (cid) => colores.find(c => c.id === cid)?.clave || null
  const familiaDeMolde = (moldeId, colorRef) => {
    const porArt = {}
    cavidades
      .filter(c => c.molde_id === moldeId && colorArt(c.articulo_id) === (colorRef ?? null))
      .forEach(c => { porArt[c.articulo_id] = (porArt[c.articulo_id] || 0) + 1 })
    return Object.keys(porArt).map(id => ({ articulo_id: Number(id), cavidades: porArt[id] }))
  }
  const normaDe = (artId) => normas.find(n => n.articulo_id === artId)
  const moldeClave = (mid) => { const m = moldes.find(x => x.id === mid); return m?.clave || m?.nombre || `Molde ${mid}` }
  const bomDe = (artId) => bom.filter(b => b.articulo_padre_id === artId)
  const artDe = (id) => ordenes.find(o => o.articulo_id === id)?.articulo

  // Analiza la seleccion de fabricados: agrupa por molde compartido (2+ articulos
  // seleccionados del mismo molde) y balancea por cavidades. Politica: cubrir todo
  // (S = max de shots), cantidad por articulo redondeada a empaque (norma oficial).
  const analizar = () => {
    const fabAll = ordenes.filter(o => sel.has(o.id) && o.accion === 'ot')
    const fab = fabAll.filter(o => !o.articulo?.se_maquila)
    const maqMap = new Map(); const advMaquila = []
    for (const o of fabAll.filter(x => x.articulo?.se_maquila)) {
      if (!o.articulo?.maquilador_id) { advMaquila.push(o.articulo_id); continue }
      const k = `${o.articulo.maquilador_id}:${o.articulo_id}`
      const cur = maqMap.get(k) || { maquilador_id: o.articulo.maquilador_id, articulo_id: o.articulo_id, net: 0, rows: [] }
      cur.net += parseFloat(cant[o.id]) || Number(o.orden_planeada) || 0; cur.rows.push(o)
      maqMap.set(k, cur)
    }
    const gruposMaquila = [...maqMap.values()]
    const porMolde = new Map()
    const sinMolde = []
    for (const o of fab) {
      const mid = moldeDeArticulo(o.articulo_id)
      if (!mid) { sinMolde.push(o); continue }
      // La llave incluye el color: dos colores del mismo molde NO son
      // co-productos, se corren en OT separadas con purga entre ellas.
      const k = `${mid}::${colorArt(o.articulo_id) ?? 'sin'}`
      if (!porMolde.has(k)) porMolde.set(k, new Map())
      const m = porMolde.get(k)
      const cur = m.get(o.articulo_id) || { articulo_id: o.articulo_id, rows: [], net: 0 }
      cur.rows.push(o); cur.net += parseFloat(cant[o.id]) || Number(o.orden_planeada) || 0
      m.set(o.articulo_id, cur)
    }
    const gruposCompartidos = []
    const individuales = [...sinMolde]
    const advertencias = []
    for (const [k, m] of porMolde) {
      const mid = Number(String(k).split('::')[0])
      const arts = [...m.values()]
      if (arts.length >= 2) {
        const items = arts.map(a => {
          const cav = cavDe(a.articulo_id) || 1
          return { ...a, cav, shots: Math.ceil(a.net / cav) }
        })
        const S = Math.max(...items.map(i => i.shots))
        const conQty = items.map(i => {
          const pxc = Number(normaDe(i.articulo_id)?.piezas_por_empaque || 0)
          const base = S * i.cav
          const qtyDefault = pxc > 0 ? Math.ceil(base / pxc) * pxc : base
          return { ...i, pxc, base, qtyDefault }
        })
        const principal = conQty.reduce((p, c) => (c.shots > p.shots ? c : p), conQty[0]).articulo_id
        gruposCompartidos.push({ moldeId: mid, S, items: conQty, principal, rows: arts.flatMap(a => a.rows) })
      } else {
        individuales.push(...arts.flatMap(a => a.rows))
        if (familiaDeMolde(mid, colorArt(arts[0].articulo_id)).length >= 2) advertencias.push({ articulo_id: arts[0].articulo_id, moldeId: mid })
      }
    }
    return { gruposCompartidos, individuales, advertencias, gruposMaquila, advMaquila }
  }

  const qtyDe = (g, artId) => {
    const k = `${g.moldeId}:${artId}`
    if (qtyGrupo[k] !== undefined && qtyGrupo[k] !== '') return Number(qtyGrupo[k])
    return g.items.find(i => i.articulo_id === artId)?.qtyDefault || 0
  }

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
      const consignas = filas.filter(o => o.accion === 'consigna')
      const { gruposCompartidos, individuales, gruposMaquila, advMaquila } = analizar()
      let creados = { req: 0, ot: 0, con: 0, om: 0 }

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

      // ---- OT compartida: una OT multi-articulo por molde (balanceo por cavidades) ----
      for (const g of gruposCompartidos) {
        const fechaProg = g.rows.reduce((min, o) => { const f = o.fecha_liberacion || o.fecha_requerida; return (!min || (f && f < min)) ? f : min }, null)
        const folio = `OT-${Date.now().toString().slice(-8)}-M${g.moldeId}`
        const { data: ot, error: e1 } = await supabase.from('ordenes_trabajo').insert({
          empresa_id: emp, folio, site_id: perfil.site_id, articulo_id: g.principal, molde_id: g.moldeId,
          cantidad_programada: qtyDe(g, g.principal), fecha_programada: fechaProg,
          estatus: 'programada', notas: `Generada por MRP corrida #${corridaSel.id} (molde ${moldeClave(g.moldeId)}, ${g.S} shots)`,
          creado_por: perfil.id,
        }).select().single()
        if (e1) throw e1
        const filasOt = g.items.map(i => {
          const qty = qtyDe(g, i.articulo_id)
          return {
            ot_id: ot.id, articulo_id: i.articulo_id, principal: i.articulo_id === g.principal, cavidades: i.cav,
            cantidad_programada: qty, norma_empaque_id: normaDe(i.articulo_id)?.id || null,
            piezas_por_caja: i.pxc || null, cajas_estimadas: i.pxc > 0 ? Math.ceil(qty / i.pxc) : null,
          }
        })
        const { error: e2 } = await supabase.from('ot_articulos').insert(filasOt)
        if (e2) throw e2
        await marcar(g.rows, 'ot', ot.id)
        creados.ot += 1
      }

      // ---- OT individual (fabricado sin molde compartido en la seleccion) ----
      for (const o of individuales) {
        const mid = moldeDeArticulo(o.articulo_id)
        const cav = cavDe(o.articulo_id) || null
        const qty = parseFloat(cant[o.id]) || o.orden_planeada
        const norma = normaDe(o.articulo_id); const pxc = Number(norma?.piezas_por_empaque || 0)
        const folio = `OT-${Date.now().toString().slice(-8)}-${o.articulo_id}`
        const { data: ot, error: e1 } = await supabase.from('ordenes_trabajo').insert({
          empresa_id: emp, folio, site_id: perfil.site_id, articulo_id: o.articulo_id, molde_id: mid,
          cantidad_programada: qty, fecha_programada: o.fecha_liberacion || o.fecha_requerida,
          estatus: 'programada', notas: `Generada por MRP corrida #${corridaSel.id}`, creado_por: perfil.id,
        }).select().single()
        if (e1) throw e1
        const { error: e2 } = await supabase.from('ot_articulos').insert({
          ot_id: ot.id, articulo_id: o.articulo_id, principal: true, cavidades: cav,
          cantidad_programada: qty, norma_empaque_id: norma?.id || null,
          piezas_por_caja: pxc || null, cajas_estimadas: pxc > 0 ? Math.ceil(qty / pxc) : null,
        })
        if (e2) throw e2
        await marcar([o], 'ot', ot.id)
        creados.ot += 1
      }

      // ---- Maquila: programa firme/forecast por (maquilador, articulo) ----
      for (const g of gruposMaquila) {
        let omId
        const { data: existente } = await supabase.from('ordenes_maquila').select('id')
          .eq('empresa_id', emp).eq('maquilador_id', g.maquilador_id).eq('articulo_id', g.articulo_id)
          .eq('estatus', 'abierta').limit(1).maybeSingle()
        if (existente) {
          omId = existente.id
        } else {
          const folio = `OM-${Date.now().toString().slice(-8)}-${g.articulo_id}`
          const molde = moldeDeArticulo(g.articulo_id)
          const { data: om, error: e1 } = await supabase.from('ordenes_maquila').insert({
            empresa_id: emp, folio, maquilador_id: g.maquilador_id, site_id: perfil.site_id,
            articulo_id: g.articulo_id, cantidad_esperada: 0, molde_id: molde,
            estatus: 'abierta', notas: `Programa de maquila (MRP #${corridaSel.id})`, creado_por: perfil.id,
          }).select().single()
          if (e1) throw e1
          omId = om.id
          const mats = bomDe(g.articulo_id).map(b => ({
            om_id: omId, articulo_id: b.componente_articulo_id,
            cantidad_por_unidad: Number(b.cantidad_por_unidad), cantidad_plan: 0, cantidad_enviada: 0,
            unidad_medida: b.unidad_medida || null, enviar: true,
          }))
          if (mats.length > 0) { const { error: e2 } = await supabase.from('om_materiales').insert(mats); if (e2) throw e2 }
        }
        const lineas = g.rows.map(o => ({
          om_id: omId, fecha_requerida: o.fecha_requerida, tipo: o.firme ? 'firme' : 'forecast',
          cantidad: parseFloat(cant[o.id]) || Number(o.orden_planeada) || 0, corrida_id: corridaSel.id,
        }))
        if (lineas.length > 0) { const { error: e3 } = await supabase.from('om_lineas').insert(lineas); if (e3) throw e3 }
        await marcar(g.rows, 'maquila', omId)
        creados.om += 1
      }
      const partes = []
      if (creados.req) partes.push(`${creados.req} linea(s) de requisicion`)
      if (creados.con) partes.push(`${creados.con} de consigna`)
      if (creados.ot) partes.push(`${creados.ot} OT`)
      if (creados.om) partes.push(`${creados.om} programa(s) de maquila`)
      setExito(`Generado: ${partes.join(', ')}.${advMaquila && advMaquila.length ? ` Aviso: ${advMaquila.length} articulo(s) 'se maquila' sin maquilador, sin OM.` : ''}`)
      await seleccionar(corridaSel.id)
      setTimeout(() => setExito(''), 6000)
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

  const analisis = corridaSel ? analizar() : { gruposCompartidos: [], individuales: [], advertencias: [], gruposMaquila: [], advMaquila: [] }

  return (
    <div>
      <div style={styles.encabezado}><h2 style={styles.titulo}>Bandeja de ordenes planeadas</h2></div>
      <p style={styles.ayuda}>Selecciona las ordenes sugeridas por el MRP y generalas como documentos reales.
        Los comprados crean una requisicion (borrador), la consigna una autorizacion por cliente, y los fabricados una OT programada.
        Si seleccionas 2+ articulos que comparten molde, se crea <b>una sola OT</b> balanceada por cavidades.</p>

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
                <React.Fragment key={o.id}>
                <div style={styles.tr}>
                  <span style={{ width: '32px' }}><input type="checkbox" checked={sel.has(o.id)} onChange={() => toggle(o.id)} /></span>
                  <span style={{ flex: 2 }}><strong>{o.articulo?.codigo_interno}</strong><br /><span style={{ fontSize: '11px', color: '#94a3b8' }}>{o.articulo?.descripcion}</span></span>
                  <span style={{ flex: 1 }}><span style={badge(o.articulo?.se_maquila && o.accion === 'ot' ? 'maquila' : o.accion)}>{o.articulo?.se_maquila && o.accion === 'ot' ? 'Maquila' : (ACCION_LABEL[o.accion] || o.accion)}</span></span>
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
                {/* Parte equivalente: de que codigos cubre la demanda y, si el
                    molde principal no alcanza para la fecha del cliente, como
                    repartir con el gemelo. */}
                {(() => {
                  const pt = artParte[o.articulo_id]
                  if (!pt) return null
                  const rep = repartos[o.id] || []
                  const conCarga = rep.filter(x => Number(x.sugerido_pz) > 0)
                  const cubierto = rep.reduce((a2, x) => a2 + (Number(x.sugerido_pz) || 0), 0)
                  const pedido = Number(o.orden_planeada) || 0
                  const falta = Math.max(pedido - cubierto, 0)
                  const necesitaGemelo = conCarga.length > 1
                  return (
                    <div style={{ ...styles.notaParte, ...(falta > 0 ? styles.notaRoja : necesitaGemelo ? styles.notaAmbar : {}) }}>
                      <div>
                        <b>Parte {pt.clave}</b>: este renglon planea el codigo principal y cubre la demanda
                        de todos los codigos equivalentes del grupo. El inventario y el FIFO ya se ven juntos.
                      </div>
                      {rep.length > 1 && (
                        <div style={{ marginTop: '4px' }}>
                          {necesitaGemelo
                            ? <b>El molde principal no alcanza para el {fLarga(o.fecha_requerida)}. Reparto sugerido:</b>
                            : <span>El molde principal alcanza solo para esta fecha.</span>}
                          <div style={{ marginTop: '3px' }}>
                            {rep.map(x => (
                              <div key={x.articulo_id} style={{ paddingLeft: '10px' }}>
                                {x.es_principal ? 'Principal' : 'Gemelo'} &middot; {x.codigo_interno}
                                {x.molde_clave ? ` (molde ${x.molde_clave}` : ''}{x.maquina_clave ? `, ${x.maquina_clave})` : x.molde_clave ? ')' : ''}
                                {' '}&rarr; capacidad {fmt(x.capacidad_pz)} pz
                                {Number(x.sugerido_pz) > 0 && <b> · producir {fmt(x.sugerido_pz)} pz</b>}
                                {!x.maquina_clave && <span style={{ color: '#b91c1c' }}> · sin ruta ni maquina capturada</span>}
                              </div>
                            ))}
                          </div>
                          {falta > 0 && (
                            <div style={{ marginTop: '4px' }}>
                              <b>Aun con los dos moldes faltan {fmt(falta)} pz</b> para llegar al {fLarga(o.fecha_requerida)}.
                              Habria que meter tiempo extra, adelantar el arranque o renegociar la fecha.
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })()}
                </React.Fragment>
              ))}
            </div>
          )}

          {/* Preview de balanceo por molde compartido */}
          {analisis.gruposCompartidos.map(g => (
            <div key={g.moldeId} style={styles.grupo}>
              <div style={styles.grupoTitulo}>
                Molde compartido <b>{moldeClave(g.moldeId)}</b> · una OT · <b>{fmt(g.S)}</b> shots (cubrir todo)
              </div>
              <div style={styles.grupoTh}>
                <span style={{ flex: 2 }}>Articulo</span>
                <span style={{ flex: 0.7, textAlign: 'center' }}>Cav</span>
                <span style={{ flex: 1, textAlign: 'right' }}>Neto MRP</span>
                <span style={{ flex: 0.8, textAlign: 'right' }}>Shots</span>
                <span style={{ flex: 1.2, textAlign: 'right' }}>Cant. programada</span>
                <span style={{ flex: 0.8, textAlign: 'right' }}>Cajas</span>
              </div>
              {g.items.map(i => {
                const qty = qtyDe(g, i.articulo_id)
                const cajas = i.pxc > 0 ? Math.ceil(qty / i.pxc) : null
                return (
                  <div key={i.articulo_id} style={styles.grupoTr}>
                    <span style={{ flex: 2 }}>
                      <strong>{artDe(i.articulo_id)?.codigo_interno || i.articulo_id}</strong>
                      {i.articulo_id === g.principal && <span style={styles.pill}>principal</span>}
                    </span>
                    <span style={{ flex: 0.7, textAlign: 'center' }}>{i.cav}</span>
                    <span style={{ flex: 1, textAlign: 'right' }}>{fmt(i.net)}</span>
                    <span style={{ flex: 0.8, textAlign: 'right' }}>{fmt(i.shots)}</span>
                    <span style={{ flex: 1.2, textAlign: 'right' }}>
                      <input type="number" min="0" value={qtyGrupo[`${g.moldeId}:${i.articulo_id}`] ?? i.qtyDefault}
                        onChange={e => setQtyGrupo({ ...qtyGrupo, [`${g.moldeId}:${i.articulo_id}`]: e.target.value })}
                        style={{ ...styles.inputMini, textAlign: 'right', maxWidth: '110px' }} />
                    </span>
                    <span style={{ flex: 0.8, textAlign: 'right' }}>{cajas != null ? fmt(cajas) : '-'}</span>
                  </div>
                )
              })}
              <div style={styles.grupoNota}>Cantidad = shots × cavidades, redondeada a empaque (norma oficial). Editable si tapan una cavidad o hay desbalance por rechazos.</div>
            </div>
          ))}

          {analisis.gruposMaquila.map(g => (
            <div key={`m${g.maquilador_id}-${g.articulo_id}`} style={styles.grupo}>
              <div style={{ ...styles.grupoTitulo, backgroundColor: '#f5f3ff', color: '#6d28d9', borderColor: '#ddd6fe' }}>
                Maquila · <b>{artDe(g.articulo_id)?.codigo_interno || g.articulo_id}</b> · {fmt(g.net)} pzas · se agregara al programa de maquila (firme/forecast); el firme se convierte en OC.
              </div>
            </div>
          ))}
          {(analisis.advMaquila || []).map((aid, i) => (
            <p key={`am${i}`} style={styles.aviso}>
              <b>{artDe(aid)?.codigo_interno || aid}</b> esta marcado "se maquila" pero no tiene maquilador asignado. Asignalo en Articulos para generar la OM.
            </p>
          ))}
          {analisis.advertencias.map((a, idx) => (
            <p key={idx} style={styles.aviso}>
              <b>{artDe(a.articulo_id)?.codigo_interno || a.articulo_id}</b> usa el molde compartido <b>{moldeClave(a.moldeId)}</b>, pero su(s) articulo(s) hermano(s) no estan en la seleccion.
              Se creara una OT individual; al correr el molde, las cavidades hermanas tambien produciran salvo que se tapen.
            </p>
          ))}
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
  if (a === 'maquila') return { ...base, backgroundColor: '#f5f3ff', color: '#7c3aed' }
  return { ...base, backgroundColor: '#f1f5f9', color: '#64748b' }
}

const styles = {
  notaParte: { background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '7px', padding: '7px 10px', margin: '0 0 8px 32px', fontSize: '11.5px', color: '#1e40af', lineHeight: 1.5 },
  notaAmbar: { background: '#fffbeb', borderColor: '#fcd34d', color: '#92400e' },
  notaRoja: { background: '#fef2f2', borderColor: '#fca5a5', color: '#b91c1c' },
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
  grupo: { marginTop: '16px', border: '1px solid #d8b4fe', borderRadius: '9px', overflow: 'hidden' },
  grupoTitulo: { padding: '10px 14px', backgroundColor: '#faf5ff', color: '#6b21a8', fontSize: '13px', borderBottom: '1px solid #e9d5ff' },
  grupoTh: { display: 'flex', padding: '8px 14px', backgroundColor: '#fbfaff', borderBottom: '1px solid #f1f5f9', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  grupoTr: { display: 'flex', padding: '9px 14px', borderBottom: '1px solid #f6f4fb', alignItems: 'center', fontSize: '13px' },
  grupoNota: { padding: '8px 14px', fontSize: '11.5px', color: '#94a3b8' },
  pill: { marginLeft: '8px', padding: '1px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: '700', backgroundColor: '#ede9fe', color: '#7c3aed' },
  aviso: { marginTop: '12px', backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '7px', padding: '9px 12px', color: '#92400e', fontSize: '12.5px', lineHeight: 1.5 },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
