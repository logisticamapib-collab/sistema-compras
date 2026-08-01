import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

const TIPOS = [
  { value: 'producto_terminado', label: 'Producto Terminado' },
  { value: 'wip', label: 'WIP' },
  { value: 'materia_prima', label: 'Materia Prima' },
  { value: 'empaque', label: 'Empaque' },
  { value: 'ensamble', label: 'Ensamble' },
]

const ACCION_LABEL = { requisicion: 'Requisicion', consigna: 'Consigna', ot: 'Orden de Trabajo', ninguna: '-' }
const EXC_LABEL = { nuevo: 'Nuevo pedido', adelantar: 'Adelantar', diferir: 'Diferir', cancelar: 'Cancelar' }

const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fechaCorta = (s) => { if (!s) return '-'; const p = String(s).split('-'); return `${p[2]}/${p[1]}` }
const fechaLarga = (s) => { if (!s) return '-'; const p = String(s).split('-'); return `${p[2]}/${p[1]}/${p[0]}` }
const fechaHora = (ts) => { if (!ts) return '-'; const d = new Date(ts); const z = n => String(n).padStart(2,'0'); return `${z(d.getDate())}/${z(d.getMonth()+1)} ${z(d.getHours())}:${z(d.getMinutes())}` }

export default function CorrerMRP() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCorrer = tienePermiso('plan_correr', 'crear')

  const [articulos, setArticulos] = useState([])
  const [clientes, setClientes] = useState([])
  const [corridas, setCorridas] = useState([])
  const [corridaSel, setCorridaSel] = useState(null)
  const [resultados, setResultados] = useState([])
  const [expandido, setExpandido] = useState(null)
  const [corriendo, setCorriendo] = useState(false)
  const [error, setError] = useState('')

  const [alcanceTipo, setAlcanceTipo] = useState('todos')
  const [alcanceRef, setAlcanceRef] = useState('')
  const [site, setSite] = useState('')

  useEffect(() => { cargarBase() }, [])

  const cargarBase = async () => {
    const emp = perfil.empresa_id
    const [{ data: arts }, { data: cli }] = await Promise.all([
      supabase.from('articulos').select('id, codigo_interno, descripcion, origen, es_consigna').eq('empresa_id', emp).eq('activo', true).order('codigo_interno'),
      supabase.from('clientes').select('id, nombre').eq('empresa_id', emp).order('nombre'),
    ])
    setArticulos(arts || [])
    setClientes(cli || [])
    await cargarCorridas()
  }

  const cargarCorridas = async (autoSel) => {
    const emp = perfil.empresa_id
    const { data } = await supabase.from('mrp_corridas').select('*').eq('empresa_id', emp).order('id', { ascending: false }).limit(25)
    setCorridas(data || [])
    const sel = autoSel ?? (data && data[0]?.id)
    if (sel) seleccionarCorrida(sel)
  }

  const seleccionarCorrida = async (id) => {
    setCorridaSel(corridas.find(c => c.id === id) || null)
    const { data } = await supabase.from('mrp_resultados').select('*, articulo:articulos(codigo_interno, descripcion)')
      .eq('corrida_id', id).order('nivel_bom').order('articulo_id').order('cubo_inicio')
    setResultados(data || [])
    // refrescar cabecera seleccionada por si venia de correr
    const { data: cab } = await supabase.from('mrp_corridas').select('*').eq('id', id).maybeSingle()
    if (cab) setCorridaSel(cab)
    const arts = [...new Set((data || []).map(r => r.articulo_id))]
    setExpandido(arts[0] ?? null)
  }

  const puedeBorrar = tienePermiso('plan_correr', 'crear')

  const borrarCorrida = async (id) => {
    if (!window.confirm(`Borrar la corrida #${id}?`)) return
    await supabase.from('mrp_corridas').delete().eq('id', id)
    if (corridaSel?.id === id) { setCorridaSel(null); setResultados([]) }
    await cargarCorridas()
  }

  const limpiarAntiguas = async () => {
    const d = new Date(); const day = (d.getDay() + 6) % 7
    const lunes = new Date(d); lunes.setDate(d.getDate() - day); lunes.setHours(0, 0, 0, 0)
    if (!window.confirm('Borrar todas las corridas anteriores a esta semana?')) return
    await supabase.from('mrp_corridas').delete().eq('empresa_id', perfil.empresa_id).lt('fecha_corrida', lunes.toISOString())
    await cargarCorridas()
  }

  const correr = async () => {
    setError(''); setCorriendo(true)
    const ref = alcanceTipo === 'todos' ? null : (alcanceRef || null)
    if (alcanceTipo !== 'todos' && !ref) { setError('Selecciona la referencia del alcance.'); setCorriendo(false); return }
    const { data, error } = await supabase.rpc('mrp_correr', {
      p_site_id: siteEfectivo(perfil, site),
      p_empresa_id: perfil.empresa_id,
      p_alcance_tipo: alcanceTipo,
      p_alcance_ref: ref,
      p_usuario_id: null,
      p_usuario_nombre: perfil.nombre || null,
    })
    setCorriendo(false)
    if (error) { setError(error.message); return }
    await cargarCorridas(data)
  }

  // agrupar resultados por articulo
  const porArticulo = {}
  resultados.forEach(r => {
    if (!porArticulo[r.articulo_id]) porArticulo[r.articulo_id] = { art: r.articulo, nivel: r.nivel_bom, filas: [] }
    porArticulo[r.articulo_id].filas.push(r)
  })
  const articulosOrden = Object.keys(porArticulo).map(Number)
  const ordenesSugeridas = resultados.filter(r => Number(r.orden_planeada) > 0)

  return (
    <div>
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Correr MRP</h2>
      </div>

      {/* Panel de corrida */}
      <div style={styles.tarjeta}>
        <div style={styles.fila}>
          <div style={styles.campo}>
            <label style={styles.label}>Alcance</label>
            <span style={{ marginRight: 12 }}><FiltroSite value={site} onChange={setSite} label="Site:" todos="Todos los sites" /></span>
            <select style={styles.input} value={alcanceTipo}
              onChange={e => { setAlcanceTipo(e.target.value); setAlcanceRef('') }}>
              <option value="todos">Todos</option>
              <option value="producto">Por producto</option>
              <option value="tipo">Por tipo</option>
              <option value="cliente">Por cliente</option>
            </select>
          </div>
          {alcanceTipo === 'producto' && (
            <div style={styles.campo}>
              <label style={styles.label}>Producto</label>
              <select style={styles.input} value={alcanceRef} onChange={e => setAlcanceRef(e.target.value)}>
                <option value="">Selecciona...</option>
                {articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
              </select>
            </div>
          )}
          {alcanceTipo === 'tipo' && (
            <div style={styles.campo}>
              <label style={styles.label}>Tipo</label>
              <select style={styles.input} value={alcanceRef} onChange={e => setAlcanceRef(e.target.value)}>
                <option value="">Selecciona...</option>
                {TIPOS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          )}
          {alcanceTipo === 'cliente' && (
            <div style={styles.campo}>
              <label style={styles.label}>Cliente</label>
              <select style={styles.input} value={alcanceRef} onChange={e => setAlcanceRef(e.target.value)}>
                <option value="">Selecciona...</option>
                {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
            </div>
          )}
          <div style={{ ...styles.campo, justifyContent: 'flex-end', flex: '0 0 auto' }}>
            {puedeCorrer
              ? <button style={styles.boton} disabled={corriendo} onClick={correr}>{corriendo ? 'Corriendo...' : 'Correr MRP'}</button>
              : <span style={{ fontSize: '12px', color: '#94a3b8' }}>Tu rol no puede ejecutar corridas.</span>}
          </div>
        </div>
        {error && <p style={styles.error}>{error}</p>}
      </div>

      {/* Corridas recientes */}
      <div style={styles.tarjeta}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ ...styles.tarjetaTitulo, margin: 0 }}>Corridas recientes</h3>
          {puedeBorrar && corridas.length > 0 && (
            <button style={styles.botonLimpiar} onClick={limpiarAntiguas}>Borrar semanas anteriores</button>
          )}
        </div>
        {corridas.length === 0 ? <p style={{ color: '#666', fontSize: '13px' }}>Aun no hay corridas. Ejecuta una arriba.</p> : (
          <div>
            {corridas.map(c => (
              <div key={c.id} style={corridaSel?.id === c.id ? styles.corridaFilaActiva : styles.corridaFila}>
                <button onClick={() => seleccionarCorrida(c.id)} style={styles.corridaBtn}>
                  <span style={{ fontWeight: '700', color: '#7c3aed', minWidth: '36px' }}>#{c.id}</span>
                  <span style={{ color: '#334155', minWidth: '96px' }}>{fechaHora(c.fecha_corrida)}</span>
                  <span style={{ color: '#64748b', flex: 1 }}>{c.usuario_nombre || 'sistema'}</span>
                  <span style={{ color: '#64748b', minWidth: '120px' }}>{c.alcance_tipo}{c.alcance_ref ? `(${c.alcance_ref})` : ''}</span>
                  <span style={{ color: '#334155', minWidth: '60px', textAlign: 'right' }}>{c.ordenes_sugeridas} ord</span>
                </button>
                {puedeBorrar && <button title="Borrar corrida" style={styles.borrarBtn} onClick={() => borrarCorrida(c.id)}>✕</button>}
              </div>
            ))}
          </div>
        )}
      </div>

      {corridaSel && (
        <>
          <div style={styles.resumen}>
            <span>Corrida <strong>#{corridaSel.id}</strong></span>
            <span>Inicio: <strong>{fechaLarga(corridaSel.fecha_inicio)}</strong></span>
            <span>Firme: <strong>{corridaSel.horizonte_firme_dias}d</strong> · Total: <strong>{corridaSel.horizonte_total_dias}d</strong></span>
            <span>Articulos planeados: <strong>{corridaSel.articulos_planeados}</strong></span>
            <span>Ordenes sugeridas: <strong>{corridaSel.ordenes_sugeridas}</strong></span>
          </div>

          {/* Ordenes sugeridas */}
          <div style={styles.tarjeta}>
            <h3 style={styles.tarjetaTitulo}>Ordenes sugeridas</h3>
            {ordenesSugeridas.length === 0 ? <p style={{ color: '#666', fontSize: '13px' }}>Esta corrida no genero ordenes (el inventario y lo programado cubren la demanda).</p> : (
              <div>
                <div style={styles.thOrden}>
                  <span style={{ flex: 2 }}>Articulo</span>
                  <span style={{ flex: 1 }}>Accion</span>
                  <span style={{ flex: 1, textAlign: 'right' }}>Cantidad</span>
                  <span style={{ flex: 1, textAlign: 'center' }}>Requerida</span>
                  <span style={{ flex: 1, textAlign: 'center' }}>Liberar</span>
                  <span style={{ flex: 1, textAlign: 'center' }}>Mensaje</span>
                </div>
                {ordenesSugeridas.map(r => (
                  <div key={r.id} style={styles.trOrden}>
                    <span style={{ flex: 2, fontWeight: '500' }}>{r.articulo?.codigo_interno}</span>
                    <span style={{ flex: 1 }}><span style={badgeAccion(r.accion)}>{ACCION_LABEL[r.accion] || r.accion}</span></span>
                    <span style={{ flex: 1, textAlign: 'right', fontWeight: '600' }}>{fmt(r.orden_planeada)}</span>
                    <span style={{ flex: 1, textAlign: 'center' }}>{fechaLarga(r.fecha_requerida)}</span>
                    <span style={{ flex: 1, textAlign: 'center', color: r.fecha_liberacion < corridaSel.fecha_inicio ? '#dc2626' : '#334155' }}>{fechaLarga(r.fecha_liberacion)}</span>
                    <span style={{ flex: 1, textAlign: 'center', fontSize: '12px', color: '#64748b' }}>{EXC_LABEL[r.mensaje_excepcion] || '-'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Matriz por articulo */}
          <div style={styles.tarjeta}>
            <h3 style={styles.tarjetaTitulo}>Plan por articulo (demanda x cubo)</h3>
            {articulosOrden.map(aid => {
              const grupo = porArticulo[aid]
              const abierto = expandido === aid
              return (
                <div key={aid} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <button style={styles.filaArt} onClick={() => setExpandido(abierto ? null : aid)}>
                    <span style={{ fontWeight: '600' }}>{abierto ? '▾' : '▸'} {grupo.art?.codigo_interno}</span>
                    <span style={{ color: '#64748b', fontSize: '12px' }}>Nivel {grupo.nivel} · {grupo.art?.descripcion}</span>
                  </button>
                  {abierto && (
                    <div style={{ overflowX: 'auto', paddingBottom: '12px' }}>
                      <table style={styles.matriz}>
                        <thead>
                          <tr>
                            <th style={styles.mHeadLeft}>Cubo</th>
                            {grupo.filas.map(f => (
                              <th key={f.id} style={{ ...styles.mHead, color: f.firme ? '#7c3aed' : '#94a3b8' }}>
                                {fechaCorta(f.cubo_inicio)}<br /><span style={{ fontSize: '9px', fontWeight: '400' }}>{f.cubo_tipo}</span>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {renderFila('Demanda', grupo.filas, 'demanda_bruta')}
                          {renderFila('Recep. prog.', grupo.filas, 'recepciones_programadas')}
                          {renderFila('Disponible', grupo.filas, 'disponible_proyectado')}
                          {renderFila('Seguridad', grupo.filas, 'stock_seguridad', '#64748b')}
                          {renderFila('Orden planeada', grupo.filas, 'orden_planeada', '#7c3aed', true)}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
            {articulosOrden.length === 0 && <p style={{ color: '#666', fontSize: '13px' }}>Sin resultados en esta corrida.</p>}
          </div>
        </>
      )}
    </div>
  )
}

function renderFila(label, filas, campo, color, bold) {
  return (
    <tr>
      <td style={styles.mLabel}>{label}</td>
      {filas.map(f => {
        const v = Number(f[campo] ?? 0)
        const resalta = bold && v > 0
        return (
          <td key={f.id} style={{ ...styles.mCell, color: color || '#334155', fontWeight: (bold ? '700' : '400'), backgroundColor: resalta ? '#faf5ff' : 'transparent' }}>
            {v === 0 ? '·' : fmt(v)}
          </td>
        )
      })}
    </tr>
  )
}

function badgeAccion(accion) {
  const base = { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' }
  if (accion === 'requisicion') return { ...base, backgroundColor: '#eff6ff', color: '#2563eb' }
  if (accion === 'consigna') return { ...base, backgroundColor: '#f0fdf4', color: '#16a34a' }
  if (accion === 'ot') return { ...base, backgroundColor: '#fff7ed', color: '#c2410c' }
  return { ...base, backgroundColor: '#f1f5f9', color: '#64748b' }
}

const styles = {
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px', marginBottom: '16px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tarjetaTitulo: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 14px 0' },
  fila: { display: 'flex', gap: '16px', alignItems: 'flex-end', flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '180px' },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none' },
  boton: { padding: '9px 22px', backgroundColor: '#9333ea', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  chip: { padding: '7px 12px', backgroundColor: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '12px', cursor: 'pointer' },
  chipActivo: { padding: '7px 12px', backgroundColor: '#faf5ff', color: '#7c3aed', border: '1px solid #d8b4fe', borderRadius: '7px', fontSize: '12px', fontWeight: '600', cursor: 'pointer' },
  botonLimpiar: { padding: '6px 12px', backgroundColor: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: '7px', fontSize: '12px', cursor: 'pointer' },
  corridaFila: { display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f5f9' },
  corridaFilaActiva: { display: 'flex', alignItems: 'center', borderBottom: '1px solid #f1f5f9', backgroundColor: '#faf5ff' },
  corridaBtn: { display: 'flex', alignItems: 'center', gap: '14px', flex: 1, padding: '10px 8px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '12px' },
  borrarBtn: { padding: '6px 10px', background: 'transparent', border: 'none', color: '#cbd5e1', cursor: 'pointer', fontSize: '14px' },
  resumen: { display: 'flex', gap: '20px', flexWrap: 'wrap', padding: '12px 20px', backgroundColor: '#faf5ff', border: '1px solid #e9d5ff', borderRadius: '8px', marginBottom: '16px', fontSize: '13px', color: '#475569' },
  thOrden: { display: 'flex', padding: '8px 12px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  trOrden: { display: 'flex', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  filaArt: { display: 'flex', gap: '12px', alignItems: 'center', width: '100%', padding: '12px 4px', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', fontSize: '14px' },
  matriz: { borderCollapse: 'collapse', fontSize: '12px', minWidth: '100%' },
  mHeadLeft: { position: 'sticky', left: 0, background: '#fff', textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #e2e8f0', fontSize: '11px', color: '#64748b', minWidth: '110px' },
  mHead: { padding: '6px 8px', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', textAlign: 'center', minWidth: '52px' },
  mLabel: { position: 'sticky', left: 0, background: '#fff', padding: '6px 10px', fontSize: '12px', color: '#475569', borderBottom: '1px solid #f8fafc', whiteSpace: 'nowrap' },
  mCell: { padding: '6px 8px', textAlign: 'center', borderBottom: '1px solid #f8fafc' },
  error: { color: '#dc2626', fontSize: '13px', marginTop: '10px' },
}
