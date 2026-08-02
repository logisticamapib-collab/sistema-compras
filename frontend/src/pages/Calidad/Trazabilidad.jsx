import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'
import EscanerCamara from '../../components/EscanerCamara'

// Trazabilidad de lote (IATF 16949). Dos direcciones:
//  - GENEALOGIA (hacia atras): de una caja embarcada hasta la resina y el
//    proveedor, pasando por OT, maquina, molde, turno y operador.
//  - IMPACTO (hacia adelante): de un lote de materia prima sospechoso hacia
//    todo lo que se produjo con el y a que cliente se embarco (contencion).
// La busqueda acepta folio de caja/tarima, codigo de lote, folio de embarque
// o folio de OT. El recorrido lo resuelven las funciones traza_* en Postgres.

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const fFechaH = (f) => f ? new Date(f).toLocaleString('es-MX') : '-'

const REL = {
  raiz: { txt: 'Punto de partida', bg: '#1e293b', fg: '#fff' },
  lote_padre: { txt: 'Lote padre', bg: '#ede9fe', fg: '#6d28d9' },
  consumo: { txt: 'Material consumido', bg: '#fef3c7', fg: '#b45309' },
  lote_hijo: { txt: 'Lote derivado', bg: '#ede9fe', fg: '#6d28d9' },
  produccion: { txt: 'Producido con el', bg: '#dcfce7', fg: '#15803d' },
}

export default function Trazabilidad() {
  const { perfil } = useAuth()
  const emp = perfil.empresa_id

  const [texto, setTexto] = useState('')
  const [candidatos, setCandidatos] = useState(null)
  const [sel, setSel] = useState(null)
  const [vista, setVista] = useState('atras')
  const [genealogia, setGenealogia] = useState([])
  const [impacto, setImpacto] = useState([])
  const [buscando, setBuscando] = useState(false)
  const [error, setError] = useState('')

  const limpiar = () => { setCandidatos(null); setSel(null); setGenealogia([]); setImpacto([]); setError('') }

  const buscar = async (valor) => {
    const t = (valor != null ? valor : texto).trim()
    if (!t) return
    if (valor != null) setTexto(t)
    limpiar(); setBuscando(true)
    const { data, error: e } = await supabase.rpc('traza_buscar', { p_empresa_id: emp, p_texto: t })
    setBuscando(false)
    if (e) { setError('No se pudo buscar: ' + e.message); return }
    if (!data || data.length === 0) {
      setError('No se encontro nada con "' + t + '". Puedes buscar por folio de caja o tarima, codigo de lote, folio de embarque o folio de OT.')
      setCandidatos([]); return
    }
    // dedupe por lote: un mismo lote puede llegar por varias vias
    const vistos = new Set()
    const unicos = data.filter(d => { if (vistos.has(d.lote_id)) return false; vistos.add(d.lote_id); return true })
    setCandidatos(unicos)
    if (unicos.length === 1) elegir(unicos[0])
  }

  const elegir = async (c) => {
    setSel(c); setError(''); setBuscando(true)
    const [g, i] = await Promise.all([
      supabase.rpc('traza_genealogia', { p_lote_id: c.lote_id }),
      supabase.rpc('traza_impacto', { p_lote_id: c.lote_id }),
    ])
    setBuscando(false)
    if (g.error) setError('Genealogia: ' + g.error.message)
    if (i.error) setError(e => (e ? e + ' | ' : '') + 'Impacto: ' + i.error.message)
    setGenealogia(g.data || [])
    setImpacto(i.data || [])
  }

  // ---- Embarques afectados: lo que se necesita para contener ----
  const embarques = []
  const vistosEmb = new Set()
  impacto.forEach(r => {
    if (!r.embarque_id) return
    const k = r.embarque_id + '|' + r.lote_id + '|' + (r.contenedor_folio || '')
    if (vistosEmb.has(k)) return
    vistosEmb.add(k)
    embarques.push(r)
  })
  const piezasEmbarcadas = embarques.reduce((s, r) => s + (Number(r.cantidad_embarcada) || 0), 0)
  const clientes = [...new Set(embarques.map(r => r.cliente).filter(Boolean))]

  // ---- Exportaciones ----
  const COLS_GEN = [
    { label: 'Nivel', get: r => r.nivel },
    { label: 'Relacion', get: r => REL[r.relacion]?.txt || r.relacion },
    { label: 'Lote', get: r => r.codigo_lote },
    { label: 'Articulo', get: r => r.articulo_codigo },
    { label: 'Descripcion', get: r => r.articulo_desc },
    { label: 'Cantidad usada', get: r => r.cantidad == null ? '' : r.cantidad },
    { label: 'Unidad', get: r => r.unidad || '' },
    { label: 'Estatus calidad', get: r => r.estatus_calidad || '' },
    { label: 'OT', get: r => r.ot_folio || '' },
    { label: 'Maquina', get: r => r.maquina || '' },
    { label: 'Molde', get: r => r.molde || '' },
    { label: 'Cavidades', get: r => r.cavidades || '' },
    { label: 'Turno', get: r => r.turno || '' },
    { label: 'Fecha produccion', get: r => fFechaH(r.fecha_produccion) },
    { label: 'Operador', get: r => r.operador || '' },
    { label: 'Proveedor', get: r => r.proveedor || '' },
    { label: 'Recibo', get: r => r.recibo_folio || '' },
    { label: 'Certificado', get: r => r.certificado_ref || '' },
    { label: 'PPAP', get: r => r.ppap_estado || '' },
    { label: 'Fecha recibo', get: r => fFecha(r.fecha_recibo) },
  ]
  const COLS_IMP = [
    { label: 'Nivel', get: r => r.nivel },
    { label: 'Relacion', get: r => REL[r.relacion]?.txt || r.relacion },
    { label: 'Lote', get: r => r.codigo_lote },
    { label: 'Articulo', get: r => r.articulo_codigo },
    { label: 'Descripcion', get: r => r.articulo_desc },
    { label: 'Estatus calidad', get: r => r.estatus_calidad || '' },
    { label: 'Cantidad usada', get: r => r.cantidad == null ? '' : r.cantidad },
    { label: 'OT', get: r => r.ot_folio || '' },
    { label: 'Maquina', get: r => r.maquina || '' },
    { label: 'Molde', get: r => r.molde || '' },
    { label: 'Turno', get: r => r.turno || '' },
    { label: 'Fecha produccion', get: r => fFechaH(r.fecha_produccion) },
    { label: 'Embarque', get: r => r.embarque_folio || '' },
    { label: 'Cliente', get: r => r.cliente || '' },
    { label: 'Fecha embarque', get: r => fFecha(r.fecha_embarque) },
    { label: 'Caja', get: r => r.contenedor_folio || '' },
    { label: 'Piezas embarcadas', get: r => r.cantidad_embarcada == null ? '' : r.cantidad_embarcada },
  ]
  const COLS_EMB = [
    { label: 'Embarque', get: r => r.embarque_folio },
    { label: 'Fecha', get: r => fFecha(r.fecha_embarque) },
    { label: 'Cliente', get: r => r.cliente || '' },
    { label: 'Articulo', get: r => r.articulo_codigo },
    { label: 'Descripcion', get: r => r.articulo_desc },
    { label: 'Lote', get: r => r.codigo_lote },
    { label: 'Caja', get: r => r.contenedor_folio || '' },
    { label: 'Piezas', get: r => r.cantidad_embarcada || 0 },
  ]

  const titulo = sel ? `Trazabilidad ${sel.codigo_lote} (${sel.articulo_codigo})` : 'Trazabilidad'
  const expExcel = () => {
    if (vista === 'atras') exportarExcel(`genealogia_${sel?.codigo_lote || ''}`, COLS_GEN, genealogia)
    else exportarExcel(`impacto_${sel?.codigo_lote || ''}`, COLS_IMP, impacto)
  }
  const expPDF = () => {
    if (vista === 'atras') imprimirTablaPDF(`Genealogia - ${titulo}`, COLS_GEN, genealogia)
    else imprimirTablaPDF(`Impacto / contencion - ${titulo}`, COLS_IMP, impacto)
  }

  const filas = vista === 'atras' ? genealogia : impacto

  return (
    <div style={S.wrap}>
      <div style={S.head} className="no-imprimir">
        <div>
          <h2 style={S.h2}>Trazabilidad de Lote</h2>
          <p style={S.sub}>Genealogia hacia atras (de la caja embarcada a la resina y su proveedor) e impacto hacia adelante (de un lote sospechoso a los clientes afectados).</p>
        </div>
      </div>

      {/* ---------- Buscador ---------- */}
      <div style={S.card} className="no-imprimir">
        <label style={S.lbl}>Escanea o escribe: folio de caja / tarima, codigo de lote, folio de embarque o folio de OT</label>
        <div style={S.busqRow}>
          <input
            style={S.input}
            placeholder="Ej. CJ-000123, LT-2026-0045, EMB-0087 u OT-1120"
            value={texto}
            onChange={e => setTexto(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && buscar()}
            autoFocus
          />
          <EscanerCamara onScan={v => buscar(v)} title="Escanear etiqueta de caja" />
          <button style={S.btn} onClick={() => buscar()} disabled={buscando}>
            {buscando ? 'Buscando...' : 'Rastrear'}
          </button>
          {(sel || candidatos) && <button style={S.btnSec} onClick={() => { setTexto(''); limpiar() }}>Limpiar</button>}
        </div>
        {error && <p style={S.err}>{error}</p>}
      </div>

      {/* ---------- Varios candidatos ---------- */}
      {candidatos && candidatos.length > 1 && (
        <div style={S.card} className="no-imprimir">
          <p style={S.cardTit}>Se encontro mas de un lote. Elige cual rastrear:</p>
          {candidatos.map(c => (
            <button key={c.lote_id} style={sel?.lote_id === c.lote_id ? S.candAct : S.cand} onClick={() => elegir(c)}>
              <b>{c.codigo_lote}</b> &middot; {c.articulo_codigo} &mdash; {c.articulo_desc}
              <span style={S.candDet}>{c.tipo}: {c.detalle}</span>
            </button>
          ))}
        </div>
      )}

      {/* ---------- Resultado ---------- */}
      {sel && (
        <>
          <div style={S.resumen}>
            <div style={S.resItem}><span style={S.resLbl}>Lote</span><b style={S.resVal}>{sel.codigo_lote}</b></div>
            <div style={S.resItem}><span style={S.resLbl}>Articulo</span><b style={S.resVal}>{sel.articulo_codigo}</b></div>
            <div style={S.resItem}><span style={S.resLbl}>Descripcion</span><b style={S.resVal}>{sel.articulo_desc}</b></div>
            <div style={S.resItem}><span style={S.resLbl}>Niveles hacia atras</span><b style={S.resVal}>{genealogia.length}</b></div>
            <div style={S.resItem}><span style={S.resLbl}>Clientes afectados</span><b style={{ ...S.resVal, color: clientes.length ? '#b91c1c' : '#15803d' }}>{clientes.length}</b></div>
            <div style={S.resItem}><span style={S.resLbl}>Piezas embarcadas</span><b style={S.resVal}>{fmt(piezasEmbarcadas)}</b></div>
          </div>

          <div style={S.tabs} className="no-imprimir">
            <button style={vista === 'atras' ? S.tabAct : S.tab} onClick={() => setVista('atras')}>
              Genealogia (hacia atras) &middot; {genealogia.length}
            </button>
            <button style={vista === 'adelante' ? S.tabAct : S.tab} onClick={() => setVista('adelante')}>
              Impacto / contencion (hacia adelante) &middot; {impacto.length}
            </button>
            <div style={{ flex: 1 }} />
            <button style={S.expBtn} onClick={expExcel}>Excel</button>
            <button style={S.expBtn} onClick={expPDF}>PDF</button>
          </div>

          {/* ---- Arbol ---- */}
          <div style={S.card}>
            {filas.length === 0 && !buscando && (
              <p style={S.vacio}>
                {vista === 'atras'
                  ? 'Este lote no tiene consumos registrados hacia atras. Si es materia prima comprada, es el inicio de la cadena.'
                  : 'Este lote no se ha consumido ni embarcado todavia. No hay material afectado.'}
              </p>
            )}
            {filas.map((r, i) => {
              const rel = REL[r.relacion] || { txt: r.relacion, bg: '#f1f5f9', fg: '#475569' }
              return (
                <div key={i} style={{ ...S.nodo, marginLeft: `${r.nivel * 26}px` }}>
                  {r.nivel > 0 && <span style={S.rama} />}
                  <div style={S.nodoBox}>
                    <div style={S.nodoTop}>
                      <span style={{ ...S.badge, background: rel.bg, color: rel.fg }}>{rel.txt}</span>
                      <b style={S.lote}>{r.codigo_lote}</b>
                      <span style={S.art}>{r.articulo_codigo} &mdash; {r.articulo_desc}</span>
                      {r.cantidad != null && (
                        <span style={S.cant}>{fmt(r.cantidad)} {r.unidad || ''}</span>
                      )}
                      {r.estatus_calidad && (
                        <span style={{ ...S.estatus, background: r.estatus_calidad === 'liberado' ? '#dcfce7' : '#fee2e2', color: r.estatus_calidad === 'liberado' ? '#15803d' : '#b91c1c' }}>
                          {r.estatus_calidad}
                        </span>
                      )}
                    </div>
                    <div style={S.nodoDet}>
                      {r.ot_folio && (
                        <span style={S.dato}>
                          <b>OT</b> {r.ot_folio} &middot; <b>Maq</b> {r.maquina || '-'} &middot; <b>Molde</b> {r.molde || '-'}
                          {r.cavidades ? ` (${r.cavidades} cav)` : ''} &middot; <b>Turno</b> {r.turno || '-'}
                          {r.operador ? ` · Reporto ${r.operador}` : ''} &middot; {fFechaH(r.fecha_produccion)}
                        </span>
                      )}
                      {r.proveedor && (
                        <span style={S.datoProv}>
                          <b>Proveedor</b> {r.proveedor} &middot; <b>Recibo</b> {r.recibo_folio || '-'} &middot; {fFecha(r.fecha_recibo)}
                          {r.certificado_ref ? <> &middot; <b>Certificado</b> {r.certificado_ref}</> : ''}
                          {r.certificado_url ? <> &middot; <a href={r.certificado_url} target="_blank" rel="noreferrer" style={S.link}>ver documento</a></> : ''}
                          {r.ppap_estado ? ` · PPAP ${r.ppap_estado}` : ''}
                        </span>
                      )}
                      {r.embarque_folio && (
                        <span style={S.datoEmb}>
                          <b>Embarcado</b> {r.embarque_folio} &middot; <b>Cliente</b> {r.cliente || '-'} &middot; {fFecha(r.fecha_embarque)}
                          {r.contenedor_folio ? ` · Caja ${r.contenedor_folio}` : ''}
                          {r.cantidad_embarcada ? ` · ${fmt(r.cantidad_embarcada)} pz` : ''}
                        </span>
                      )}
                      {!r.ot_folio && !r.proveedor && !r.embarque_folio && r.relacion !== 'raiz' && (
                        <span style={S.datoGris}>Sin movimiento de produccion, recepcion o embarque registrado.</span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ---- Embarques afectados (solo en vista de impacto) ---- */}
          {vista === 'adelante' && embarques.length > 0 && (
            <div style={S.card}>
              <div style={S.cardHead}>
                <p style={S.cardTit}>Embarques afectados &mdash; base para contencion</p>
                <div>
                  <button style={S.expBtn} onClick={() => exportarExcel(`embarques_afectados_${sel.codigo_lote}`, COLS_EMB, embarques)}>Excel</button>
                  <button style={{ ...S.expBtn, marginLeft: '8px' }} onClick={() => imprimirTablaPDF(`Embarques afectados - ${titulo}`, COLS_EMB, embarques)}>PDF</button>
                </div>
              </div>
              <table style={S.tabla}>
                <thead>
                  <tr>
                    {COLS_EMB.map(c => <th key={c.label} style={S.th}>{c.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {embarques.map((r, i) => (
                    <tr key={i}>
                      {COLS_EMB.map(c => <td key={c.label} style={S.td}>{c.get(r)}</td>)}
                    </tr>
                  ))}
                  <tr>
                    <td style={{ ...S.td, fontWeight: 600 }} colSpan={COLS_EMB.length - 1}>Total</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{fmt(piezasEmbarcadas)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  head: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '760px', lineHeight: 1.5 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', marginBottom: '14px' },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: 0 },
  lbl: { display: 'block', fontSize: '12px', color: '#64748b', marginBottom: '7px' },
  busqRow: { display: 'flex', gap: '9px', alignItems: 'center' },
  input: { flex: 1, padding: '11px 13px', border: '1px solid #ddd', borderRadius: '8px', fontSize: '15px', outline: 'none' },
  btn: { padding: '11px 22px', background: '#b91c1c', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '14px', cursor: 'pointer', fontWeight: 500 },
  btnSec: { padding: '11px 18px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '8px', fontSize: '14px', cursor: 'pointer' },
  expBtn: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  err: { color: '#b91c1c', fontSize: '13px', margin: '10px 0 0', lineHeight: 1.5 },
  cand: { display: 'block', width: '100%', textAlign: 'left', padding: '11px 13px', marginTop: '7px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', fontSize: '13.5px', cursor: 'pointer', color: '#1a1a2e' },
  candAct: { display: 'block', width: '100%', textAlign: 'left', padding: '11px 13px', marginTop: '7px', background: '#fef2f2', border: '1px solid #b91c1c', borderRadius: '8px', fontSize: '13.5px', cursor: 'pointer', color: '#1a1a2e' },
  candDet: { display: 'block', color: '#64748b', fontSize: '12px', marginTop: '3px' },
  resumen: { display: 'flex', gap: '26px', flexWrap: 'wrap', background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 18px', marginBottom: '14px' },
  resItem: { display: 'flex', flexDirection: 'column' },
  resLbl: { fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.03em' },
  resVal: { fontSize: '15px', color: '#1a1a2e', marginTop: '2px' },
  tabs: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' },
  tab: { padding: '9px 16px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '8px', fontSize: '13.5px', cursor: 'pointer' },
  tabAct: { padding: '9px 16px', background: '#b91c1c', color: '#fff', border: '1px solid #b91c1c', borderRadius: '8px', fontSize: '13.5px', cursor: 'pointer', fontWeight: 500 },
  vacio: { color: '#64748b', fontSize: '13.5px', margin: 0, lineHeight: 1.55 },
  nodo: { position: 'relative', marginBottom: '9px' },
  rama: { position: 'absolute', left: '-15px', top: '50%', width: '13px', height: '1px', background: '#cbd5e1' },
  nodoBox: { border: '1px solid #e2e8f0', borderRadius: '9px', padding: '10px 13px', background: '#fff' },
  nodoTop: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' },
  badge: { fontSize: '11px', fontWeight: 600, padding: '3px 9px', borderRadius: '20px', whiteSpace: 'nowrap' },
  lote: { fontSize: '14.5px', color: '#1a1a2e' },
  art: { fontSize: '13px', color: '#475569' },
  cant: { fontSize: '13px', color: '#b45309', fontWeight: 600 },
  estatus: { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px' },
  nodoDet: { display: 'flex', flexDirection: 'column', gap: '3px', marginTop: '6px' },
  dato: { fontSize: '12.5px', color: '#475569' },
  datoProv: { fontSize: '12.5px', color: '#b45309' },
  datoEmb: { fontSize: '12.5px', color: '#b91c1c' },
  datoGris: { fontSize: '12.5px', color: '#94a3b8' },
  link: { color: '#0891b2' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11.5px', textTransform: 'uppercase', letterSpacing: '0.03em' },
  td: { padding: '8px 10px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
}
