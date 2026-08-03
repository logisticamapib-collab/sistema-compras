import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'

// Catalogo de colores para variantes del mismo molde.
// El ORDEN DE SECUENCIA es lo que hace util al catalogo: menor = mas claro.
// La produccion se corre de claro a oscuro porque regresar a un color claro
// exige mucha mas purga. De ese orden sale la sugerencia de secuencia y el
// costo estimado de cada cambio de color.

const fmt = (n) => (Number(n) || 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const vacio = { clave: '', nombre: '', hex: '#cccccc', orden_secuencia: 50, es_dificil_purga: false, activo: true }

export default function Colores() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('ing_colores', 'editar') || tienePermiso('ing_colores', 'crear')

  const [colores, setColores] = useState([])
  const [param, setParam] = useState(null)
  const [cambios, setCambios] = useState([])
  const [form, setForm] = useState(null)
  const [editando, setEditando] = useState(null)
  const [tab, setTab] = useState('catalogo')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [simOrigen, setSimOrigen] = useState('')
  const [simDestino, setSimDestino] = useState('')
  const [sim, setSim] = useState(null)

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const [c, p, cc] = await Promise.all([
      supabase.from('colores').select('*').eq('empresa_id', emp).order('orden_secuencia'),
      supabase.from('color_parametros').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('color_cambios').select('*').eq('empresa_id', emp),
    ])
    setColores(c.data || []); setParam(p.data || null); setCambios(cc.data || [])
    setLoading(false)
  }

  const guardar = async () => {
    setError(''); setExito('')
    if (!form.clave || !form.nombre) { setError('Clave y nombre son obligatorios'); return }
    const payload = {
      empresa_id: emp, clave: form.clave.toUpperCase(), nombre: form.nombre,
      hex: form.hex || null, orden_secuencia: parseInt(form.orden_secuencia) || 50,
      es_dificil_purga: !!form.es_dificil_purga, activo: !!form.activo,
    }
    const r = editando
      ? await supabase.from('colores').update(payload).eq('id', editando.id)
      : await supabase.from('colores').insert(payload)
    if (r.error) {
      setError(r.error.message.includes('duplicate')
        ? `Ya existe un color con la clave ${payload.clave}` : 'No se pudo guardar: ' + r.error.message)
      return
    }
    setForm(null); setEditando(null); setExito('Color guardado'); cargar()
  }

  const guardarParam = async (campo, valor) => {
    const v = Number(valor)
    if (isNaN(v) || v < 0) { setError('Debe ser un numero positivo'); return }
    setError('')
    const { error: e } = await supabase.from('color_parametros')
      .upsert({ empresa_id: emp, [campo]: v, updated_at: new Date().toISOString(), updated_by: perfil.id })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setParam(p => ({ ...p, [campo]: v })); setExito('Parametro actualizado'); setSim(null)
  }

  const simular = async () => {
    if (!simOrigen || !simDestino) return
    const { data, error: e } = await supabase.rpc('color_cambio_costo', {
      p_empresa_id: emp, p_origen: Number(simOrigen), p_destino: Number(simDestino),
    })
    if (e) { setError(e.message); return }
    setSim(data && data[0] ? data[0] : { minutos: 0, kg: 0, fuente: 'sin cambio' })
  }

  const guardarOverride = async () => {
    if (!simOrigen || !simDestino || simOrigen === simDestino) { setError('Elige dos colores distintos'); return }
    const min = prompt('Minutos de purga reales para este cambio:', sim?.minutos ?? 0)
    if (min === null) return
    const kg = prompt('Kilos de purga reales para este cambio:', sim?.kg ?? 0)
    if (kg === null) return
    const { error: e } = await supabase.from('color_cambios').upsert({
      empresa_id: emp, color_origen_id: Number(simOrigen), color_destino_id: Number(simDestino),
      minutos_purga: Number(min) || 0, kg_purga: Number(kg) || 0,
    }, { onConflict: 'empresa_id,color_origen_id,color_destino_id' })
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    setExito('Cambio capturado: ya no se estima, se usa este valor'); cargar(); simular()
  }

  const borrarOverride = async (id) => {
    if (!confirm('Estas a punto de borrar este cambio capturado. El sistema volvera a estimarlo por la distancia de color. Confirma para continuar.')) return
    const { error: e } = await supabase.from('color_cambios').delete().eq('id', id)
    if (e) { setError(e.message); return }
    setExito('Override eliminado'); cargar()
  }

  const nombreColor = (id) => colores.find(c => c.id === id)?.clave || id

  const COLS = [
    { label: 'Clave', get: c => c.clave }, { label: 'Nombre', get: c => c.nombre },
    { label: 'Orden secuencia', get: c => c.orden_secuencia },
    { label: 'Dificil de purgar', get: c => c.es_dificil_purga ? 'Si' : 'No' },
    { label: 'Activo', get: c => c.activo ? 'Si' : 'No' },
  ]

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Colores</h2>
          <p style={S.sub}>Un mismo molde corre varios colores en corridas separadas. El <b>orden de secuencia</b> define cual va primero: menor = mas claro. Se produce de claro a oscuro porque regresar a un claro exige mucha mas purga.</p>
        </div>
        {puedeEditar && tab === 'catalogo' && !form && (
          <button style={S.boton} onClick={() => { setForm({ ...vacio }); setEditando(null); setError('') }}>+ Nuevo color</button>
        )}
      </div>

      <div style={S.tabs}>
        {[['catalogo', 'Catalogo'], ['purga', 'Costo de purga']].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => setTab(id)}>{n}</button>
        ))}
        <div style={{ flex: 1 }} />
        {tab === 'catalogo' && (
          <>
            <button style={S.expBtn} onClick={() => exportarExcel('colores', COLS, colores)}>Excel</button>
            <button style={S.expBtn} onClick={() => imprimirTablaPDF('Catalogo de colores', COLS, colores)}>PDF</button>
          </>
        )}
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      {/* ---------- Catalogo ---------- */}
      {tab === 'catalogo' && (
        <>
          {form && (
            <div style={S.card}>
              <h3 style={S.cardTit}>{editando ? 'Editar color' : 'Nuevo color'}</h3>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Clave *</label>
                  <input style={S.input} value={form.clave} maxLength={10}
                    onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="NEG" />
                </div>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Nombre *</label>
                  <input style={S.input} value={form.nombre}
                    onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Negro" />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Muestra</label>
                  <input style={{ ...S.input, padding: '3px', height: '38px' }} type="color" value={form.hex || '#cccccc'}
                    onChange={e => setForm({ ...form, hex: e.target.value })} />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Orden de secuencia *</label>
                  <input style={S.input} type="number" min="1" max="999" value={form.orden_secuencia}
                    onChange={e => setForm({ ...form, orden_secuencia: e.target.value })} />
                </div>
              </div>
              <p style={S.ayuda}>
                Sugerencia de escala: 10 natural, 20 blanco, 30-40 claros, 50-60 medios, 70-80 oscuros, 90 negro.
                Deja huecos para poder insertar colores despues sin renumerar todo.
              </p>
              <label style={S.check}>
                <input type="checkbox" checked={form.es_dificil_purga}
                  onChange={e => setForm({ ...form, es_dificil_purga: e.target.checked })} />
                <span>Dificil de purgar (rojos, fluorescentes: manchan el siguiente color aunque sea mas oscuro)</span>
              </label>
              <label style={S.check}>
                <input type="checkbox" checked={form.activo}
                  onChange={e => setForm({ ...form, activo: e.target.checked })} />
                <span>Activo</span>
              </label>
              <div style={S.acciones}>
                <button style={S.botonSec} onClick={() => { setForm(null); setEditando(null) }}>Cancelar</button>
                <button style={S.boton} onClick={guardar}>Guardar</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            {colores.length === 0 && !loading && (
              <p style={S.vacio}>
                Aun no hay colores. Mientras no captures ninguno, el sistema se comporta igual que antes:
                todos los articulos de un molde se consideran co-productos del mismo disparo.
              </p>
            )}
            {colores.length > 0 && (
              <table style={S.tabla}>
                <thead>
                  <tr>
                    <th style={S.th}>Orden</th><th style={S.th}></th><th style={S.th}>Clave</th>
                    <th style={S.th}>Nombre</th><th style={S.th}>Purga</th><th style={S.th}>Estatus</th>
                    <th style={S.th}></th>
                  </tr>
                </thead>
                <tbody>
                  {colores.map(c => (
                    <tr key={c.id}>
                      <td style={S.td}>{c.orden_secuencia}</td>
                      <td style={S.td}>
                        <span style={{ display: 'inline-block', width: '20px', height: '20px', borderRadius: '5px', border: '1px solid #cbd5e1', background: c.hex || '#fff' }} />
                      </td>
                      <td style={{ ...S.td, fontWeight: 600 }}>{c.clave}</td>
                      <td style={S.td}>{c.nombre}</td>
                      <td style={S.td}>{c.es_dificil_purga ? <span style={S.badgeAmbar}>dificil</span> : <span style={{ color: '#94a3b8' }}>normal</span>}</td>
                      <td style={S.td}>{c.activo ? <span style={S.badgeVerde}>activo</span> : <span style={S.badgeGris}>inactivo</span>}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>
                        {puedeEditar && (
                          <button style={S.botonAccion} onClick={() => { setEditando(c); setForm({ ...c }); setError('') }}>Editar</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {/* ---------- Costo de purga ---------- */}
      {tab === 'purga' && (
        <>
          <div style={S.card}>
            <p style={S.cardTit}>Como se estima la purga</p>
            <p style={S.ayuda}>
              El sistema estima el costo de cada cambio con la distancia entre los ordenes de los dos colores.
              Si el color destino es mas claro que el origen, aplica el factor de retroceso porque limpiar hacia
              un claro cuesta mucho mas. Si el color de origen es dificil de purgar, aplica su propio factor.
              Cualquier par que en la practica no siga esta regla se puede capturar a mano abajo.
            </p>
            <div style={S.paramGrid}>
              {[
                ['min_purga_base', 'Minutos fijos por cambio'],
                ['min_por_paso', 'Minutos por punto de distancia'],
                ['kg_purga_base', 'Kilos fijos por cambio'],
                ['kg_por_paso', 'Kilos por punto de distancia'],
                ['factor_retroceso', 'Factor al ir a un color mas claro'],
                ['factor_dificil', 'Factor si el origen es dificil'],
              ].map(([c, n]) => (
                <span key={c} style={S.campoMini}>
                  <label style={S.label}>{n}</label>
                  <input style={S.input} type="number" min="0" step="0.01" disabled={!puedeEditar}
                    defaultValue={param?.[c] ?? ''} onBlur={e => guardarParam(c, e.target.value)} />
                </span>
              ))}
            </div>
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>Probar un cambio de color</p>
            <div style={S.fila}>
              <div style={S.campo}>
                <label style={S.label}>De</label>
                <select style={S.input} value={simOrigen} onChange={e => { setSimOrigen(e.target.value); setSim(null) }}>
                  <option value="">Selecciona...</option>
                  {colores.map(c => <option key={c.id} value={c.id}>{c.clave} - {c.nombre}</option>)}
                </select>
              </div>
              <div style={S.campo}>
                <label style={S.label}>A</label>
                <select style={S.input} value={simDestino} onChange={e => { setSimDestino(e.target.value); setSim(null) }}>
                  <option value="">Selecciona...</option>
                  {colores.map(c => <option key={c.id} value={c.id}>{c.clave} - {c.nombre}</option>)}
                </select>
              </div>
              <div style={{ ...S.campo, justifyContent: 'flex-end' }}>
                <button style={S.boton} onClick={simular} disabled={!simOrigen || !simDestino}>Calcular</button>
              </div>
            </div>
            {sim && (
              <div style={{ ...S.simBox, borderColor: sim.es_retroceso ? '#fca5a5' : '#bbf7d0', background: sim.es_retroceso ? '#fef2f2' : '#f0fdf4' }}>
                <b style={{ fontSize: '17px', color: sim.es_retroceso ? '#b91c1c' : '#15803d' }}>
                  {fmt(sim.minutos)} min &middot; {fmt(sim.kg)} kg de purga
                </b>
                <span style={{ fontSize: '12.5px', color: '#475569' }}>
                  {sim.fuente === 'capturado' ? 'Valor capturado a mano' : sim.fuente === 'sin cambio' ? 'Mismo color, no hay purga' : 'Estimado por distancia de color'}
                  {sim.es_retroceso ? ' - va hacia un color mas claro, por eso cuesta mas' : ''}
                </span>
                {puedeEditar && simOrigen !== simDestino && (
                  <button style={{ ...S.botonSec, marginTop: '8px', alignSelf: 'flex-start' }} onClick={guardarOverride}>
                    Capturar el valor real de este cambio
                  </button>
                )}
              </div>
            )}
          </div>

          {cambios.length > 0 && (
            <div style={S.card}>
              <p style={S.cardTit}>Cambios capturados a mano &middot; {cambios.length}</p>
              <table style={S.tabla}>
                <thead>
                  <tr><th style={S.th}>De</th><th style={S.th}>A</th><th style={S.th}>Minutos</th><th style={S.th}>Kilos</th><th style={S.th}></th></tr>
                </thead>
                <tbody>
                  {cambios.map(c => (
                    <tr key={c.id}>
                      <td style={S.td}>{nombreColor(c.color_origen_id)}</td>
                      <td style={S.td}>{nombreColor(c.color_destino_id)}</td>
                      <td style={S.td}>{fmt(c.minutos_purga)}</td>
                      <td style={S.td}>{fmt(c.kg_purga)}</td>
                      <td style={{ ...S.td, textAlign: 'right' }}>
                        {puedeEditar && <button style={S.botonAccion} onClick={() => borrarOverride(c.id)}>Eliminar</button>}
                      </td>
                    </tr>
                  ))}
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
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '780px', lineHeight: 1.5 },
  tabs: { display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '14px' },
  tab: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  tabAct: { padding: '8px 15px', background: '#7c3aed', color: '#fff', border: '1px solid #7c3aed', borderRadius: '7px', fontSize: '13px', cursor: 'pointer', fontWeight: 500 },
  expBtn: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '16px 18px', marginBottom: '14px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 10px' },
  fila: { display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '10px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '150px' },
  campoMini: { display: 'flex', flexDirection: 'column', gap: '5px' },
  paramGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '13px' },
  label: { fontSize: '12px', color: '#444', fontWeight: 500 },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13.5px', outline: 'none', background: '#fff' },
  check: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: '#334155', margin: '8px 0' },
  acciones: { display: 'flex', gap: '9px', justifyContent: 'flex-end', marginTop: '12px' },
  boton: { padding: '9px 18px', background: '#7c3aed', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13.5px', cursor: 'pointer', fontWeight: 500 },
  botonSec: { padding: '9px 16px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13.5px', cursor: 'pointer' },
  botonAccion: { padding: '5px 11px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  ayuda: { fontSize: '12px', color: '#64748b', lineHeight: 1.55, margin: '4px 0 10px' },
  vacio: { color: '#64748b', fontSize: '13.5px', margin: 0, lineHeight: 1.55 },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px' },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  simBox: { display: 'flex', flexDirection: 'column', gap: '4px', border: '1px solid', borderRadius: '9px', padding: '13px 16px', marginTop: '6px' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em' },
  td: { padding: '8px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  badgeAmbar: { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: '#fef3c7', color: '#b45309' },
  badgeVerde: { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: '#dcfce7', color: '#15803d' },
  badgeGris: { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: '#f1f5f9', color: '#64748b' },
}
