import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'

// Monedas, moneda principal y tipo de cambio.
//
// Hasta hoy las monedas vivian en un CHECK escrito a mano y agregar otra
// exigia tocar la base. Ahora se dan de alta aqui y quedan habilitadas en todo
// el sistema.
//
// La tasa se define SIEMPRE en el mismo sentido: cuantas unidades de la moneda
// principal vale UNA unidad de la moneda extranjera. Con principal MXN y el
// dolar a 17.20, la tasa del USD es 17.20. Definirla al reves es el error
// clasico, por eso la pantalla lo dice y ademas muestra la equivalencia
// calculada mientras se captura.
//
// El tipo de cambio vencido AVISA, no bloquea: nadie deja de comprar porque
// falte actualizar una tasa. Pero se ve en rojo, porque un costeo con un tipo
// de cambio de la semana pasada es un numero que parece bueno y no lo es.

const vacio = { clave: '', nombre: '', simbolo: '', decimales: 2, activo: true }

export default function Monedas() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('config_monedas', 'editar') || tienePermiso('config_monedas', 'crear')

  const [monedas, setMonedas] = useState([])
  const [empresa, setEmpresa] = useState(null)
  const [cambios, setCambios] = useState([])
  const [usos, setUsos] = useState({})
  const [form, setForm] = useState(null)
  const [editando, setEditando] = useState(null)
  const [nuevaTasa, setNuevaTasa] = useState({ moneda: '', tasa: '', fecha: new Date().toISOString().split('T')[0], notas: '' })
  const [tab, setTab] = useState('cambio')
  const [politica, setPolitica] = useState(null)
  const [tasasPeriodo, setTasasPeriodo] = useState([])
  const [nuevaPeriodo, setNuevaPeriodo] = useState({
    moneda: '', anio: new Date().getFullYear(), mes: new Date().getMonth() + 1, tasa: '', notas: '',
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    // El orden de las variables sigue el orden de las consultas.
    const [rMon, rEmp, rTc, rArt, rAp, rPol, rTp] = await Promise.all([
      supabase.from('monedas').select('*').eq('empresa_id', emp).order('clave'),
      supabase.from('empresas').select('id, moneda_principal, dias_vigencia_tipo_cambio').eq('id', emp).maybeSingle(),
      supabase.from('tipos_cambio').select('*').eq('empresa_id', emp).order('fecha', { ascending: false }).limit(200),
      supabase.from('articulos').select('tipo_moneda').eq('empresa_id', emp),
      supabase.from('articulo_proveedor').select('moneda'),
      supabase.from('politica_moneda').select('*').eq('empresa_id', emp).maybeSingle(),
      supabase.from('tipos_cambio_periodo').select('*').eq('empresa_id', emp).order('anio', { ascending: false }).order('mes', { ascending: false }).limit(120),
    ])
    setMonedas(rMon.data || [])
    setEmpresa(rEmp.data || null)
    setCambios(rTc.data || [])
    setPolitica(rPol.data || { empresa_id: emp, congela_en: 'recibo', sin_tasa: 'ultima', revalua_inventario: false })
    setTasasPeriodo(rTp.data || [])

    // Cuantos registros usan cada moneda: se necesita para no dejar borrar una
    // que ya se esta usando.
    const u = {}
    for (const a of rArt.data || []) if (a.tipo_moneda) u[a.tipo_moneda] = (u[a.tipo_moneda] || 0) + 1
    for (const p of rAp.data || []) if (p.moneda) u[p.moneda] = (u[p.moneda] || 0) + 1
    setUsos(u)
    setLoading(false)
  }

  const principal = empresa?.moneda_principal || 'MXN'
  const diasVig = Math.max(Number(empresa?.dias_vigencia_tipo_cambio) || 1, 1)

  // Ultimo tipo de cambio de cada moneda y si ya vencio. Misma regla que la
  // funcion tipo_cambio_vigente de la base; si cambia alla, cambia aqui.
  const vigenteDe = (clave) => {
    if (clave === principal) return { tasa: 1, fecha: null, dias: 0, vencido: false, esPrincipal: true }
    const hoy = new Date().toISOString().split('T')[0]
    const tc = cambios.filter(c => c.moneda === clave && c.fecha <= hoy)
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))[0]
    if (!tc) return { tasa: null, fecha: null, dias: null, vencido: true, esPrincipal: false }
    const dias = Math.round((new Date(hoy) - new Date(tc.fecha)) / 86400000)
    return { tasa: Number(tc.tasa), fecha: tc.fecha, dias, vencido: dias > diasVig, esPrincipal: false }
  }

  const guardarMoneda = async () => {
    setError(''); setExito('')
    if (!form.clave || !form.nombre) { setError('La clave y el nombre son obligatorios.'); return }
    const payload = {
      empresa_id: emp, clave: form.clave.toUpperCase().trim(), nombre: form.nombre.trim(),
      simbolo: form.simbolo || null, decimales: parseInt(form.decimales) || 2, activo: !!form.activo,
    }
    const r = editando
      ? await supabase.from('monedas').update(payload).eq('id', editando.id)
      : await supabase.from('monedas').insert(payload)
    if (r.error) {
      setError(r.error.message.includes('duplicate') ? `Ya existe la moneda ${payload.clave}` : r.error.message)
      return
    }
    setForm(null); setEditando(null); setExito('Moneda guardada.'); cargar()
    setTimeout(() => setExito(''), 3000)
  }

  const eliminarMoneda = async (m) => {
    setError(''); setExito('')
    const n = usos[m.clave] || 0
    if (m.clave === principal) { setError('No se puede eliminar la moneda principal de la compania.'); return }
    if (n > 0) { setError(`No se puede eliminar ${m.clave}: la usan ${n} registro(s). Desactivala para que deje de ofrecerse sin perder lo capturado.`); return }
    if (!window.confirm(`Eliminar la moneda ${m.clave}?\n\nNo la usa ningun articulo ni ningun precio de proveedor.`)) return
    const { error: e } = await supabase.from('monedas').delete().eq('id', m.id)
    if (e) { setError(e.message); return }
    setExito('Moneda eliminada.'); cargar()
  }

  const cambiarPrincipal = async (clave) => {
    setError(''); setExito('')
    if (!window.confirm(
      `Cambiar la moneda principal a ${clave}?\n\n`
      + `Todos los tipos de cambio se expresan CONTRA la principal, asi que los que ya capturaste `
      + `quedan referidos a otra base y hay que volver a capturarlos.\n\nConfirma que desea proceder.`)) return
    const { error: e } = await supabase.from('empresas').update({ moneda_principal: clave }).eq('id', emp)
    if (e) { setError(e.message); return }
    setExito(`Moneda principal: ${clave}. Revisa los tipos de cambio: ahora se expresan contra ${clave}.`)
    cargar()
    setTimeout(() => setExito(''), 8000)
  }

  const guardarVigencia = async (dias) => {
    const d = parseInt(dias)
    if (isNaN(d) || d < 1) { setError('Los dias deben ser un entero de 1 en adelante.'); return }
    setError('')
    const { error: e } = await supabase.from('empresas').update({ dias_vigencia_tipo_cambio: d }).eq('id', emp)
    if (e) { setError(e.message); return }
    setEmpresa(x => ({ ...x, dias_vigencia_tipo_cambio: d }))
    setExito('Listo. A partir de ahora se avisa cuando un tipo de cambio pase de esos dias.')
    setTimeout(() => setExito(''), 4000)
  }

  const guardarPolitica = async (patch) => {
    setError(''); setExito('')
    const np = { ...politica, ...patch, empresa_id: emp, updated_at: new Date().toISOString(), updated_by: perfil.id }
    const { error: e } = await supabase.from('politica_moneda').upsert(np, { onConflict: 'empresa_id' })
    if (e) { setError(e.message); return }
    setPolitica(np)
    setExito('Politica guardada. Lo ya congelado no se re-expresa: aplica de aqui en adelante.')
    setTimeout(() => setExito(''), 6000)
  }

  const guardarTasaPeriodo = async () => {
    setError(''); setExito('')
    if (!nuevaPeriodo.moneda) { setError('Elige la moneda.'); return }
    const t = Number(nuevaPeriodo.tasa)
    if (!t || t <= 0) { setError('La tasa debe ser mayor que cero.'); return }
    const { error: e } = await supabase.from('tipos_cambio_periodo').upsert({
      empresa_id: emp, moneda: nuevaPeriodo.moneda,
      anio: parseInt(nuevaPeriodo.anio), mes: parseInt(nuevaPeriodo.mes),
      tasa: t, notas: nuevaPeriodo.notas || null, capturado_por: perfil.id,
    }, { onConflict: 'empresa_id,moneda,anio,mes' })
    if (e) { setError(e.message); return }
    setNuevaPeriodo({ ...nuevaPeriodo, tasa: '', notas: '' })
    setExito('Tasa del periodo guardada.')
    cargar()
    setTimeout(() => setExito(''), 3000)
  }

  const guardarTasa = async () => {
    setError(''); setExito('')
    if (!nuevaTasa.moneda) { setError('Elige la moneda.'); return }
    const t = Number(nuevaTasa.tasa)
    if (!t || t <= 0) { setError('La tasa debe ser un numero mayor que cero.'); return }
    const { error: e } = await supabase.from('tipos_cambio').upsert({
      empresa_id: emp, moneda: nuevaTasa.moneda, fecha: nuevaTasa.fecha,
      tasa: t, notas: nuevaTasa.notas || null, capturado_por: perfil.id,
    }, { onConflict: 'empresa_id,moneda,fecha' })
    if (e) { setError(e.message); return }
    setNuevaTasa({ moneda: '', tasa: '', fecha: new Date().toISOString().split('T')[0], notas: '' })
    setExito('Tipo de cambio guardado.')
    cargar()
    setTimeout(() => setExito(''), 3000)
  }

  const activas = monedas.filter(m => m.activo && m.clave !== principal)
  const vencidas = activas.filter(m => vigenteDe(m.clave).vencido)

  const COLS_TC = [
    { label: 'Moneda', get: c => c.moneda },
    { label: 'Fecha', get: c => c.fecha },
    { label: `Tasa a ${principal}`, get: c => c.tasa },
    { label: 'Notas', get: c => c.notas },
  ]

  if (loading) return <p style={{ padding: 28, color: '#666' }}>Cargando...</p>

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Monedas y tipo de cambio</h2>
          <p style={S.sub}>
            La compania lleva sus numeros en <b>{principal}</b>. Todo tipo de cambio se expresa contra esa moneda:
            la tasa es <b>cuantos {principal} vale UNA unidad</b> de la moneda extranjera.
          </p>
        </div>
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}

      {vencidas.length > 0 && (
        <div style={S.avisoVencido}>
          <b>{vencidas.length} tipo(s) de cambio vencido(s) o sin capturar:</b>{' '}
          {vencidas.map(m => {
            const v = vigenteDe(m.clave)
            return `${m.clave} (${v.fecha ? `hace ${v.dias} dia(s)` : 'nunca'})`
          }).join(', ')}.
          {' '}Un costeo o una orden con una tasa vieja da un numero que parece bueno y no lo es.
          Se avisa, no se bloquea: nadie deja de comprar por esto.
        </div>
      )}

      <div style={S.tabs}>
        {[['cambio', 'Tipo de cambio'], ['catalogo', 'Monedas'], ['politica', 'Politica de costeo']].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => { setTab(id); setError('') }}>{n}</button>
        ))}
      </div>

      {/* ---------- Tipo de cambio ---------- */}
      {tab === 'cambio' && (
        <>
          <div style={S.card}>
            <p style={S.cardTit}>Vigente hoy</p>
            <div style={S.tabla}>
              <div style={S.th}>
                <span style={{ width: 90 }}>Moneda</span>
                <span style={{ flex: 1 }}>Nombre</span>
                <span style={{ width: 150 }}>Tasa a {principal}</span>
                <span style={{ width: 130 }}>Capturado</span>
                <span style={{ width: 200 }}>Equivale a</span>
              </div>
              {monedas.filter(m => m.activo).map(m => {
                const v = vigenteDe(m.clave)
                return (
                  <div key={m.id} style={S.tr}>
                    <span style={{ width: 90, fontWeight: 700, color: '#2563eb' }}>{m.clave}</span>
                    <span style={{ flex: 1, color: '#475569' }}>{m.nombre}{v.esPrincipal ? ' · principal' : ''}</span>
                    <span style={{ width: 150, fontWeight: 600 }}>
                      {v.esPrincipal ? '1.00'
                        : v.tasa == null ? <span style={S.pillMal}>sin capturar</span>
                          : v.tasa.toLocaleString('es-MX', { minimumFractionDigits: 4 })}
                    </span>
                    <span style={{ width: 130, fontSize: 12 }}>
                      {v.esPrincipal ? '—'
                        : v.fecha
                          ? <span style={v.vencido ? S.pillMal : S.pillOk}>{v.fecha}{v.vencido ? ` · ${v.dias}d` : ''}</span>
                          : '—'}
                    </span>
                    <span style={{ width: 200, fontSize: 12, color: '#64748b' }}>
                      {!v.esPrincipal && v.tasa != null
                        ? `1 ${m.clave} = ${v.tasa.toLocaleString('es-MX', { minimumFractionDigits: 2 })} ${principal}`
                        : ''}
                    </span>
                  </div>
                )
              })}
            </div>

            <div style={{ ...S.fila, marginTop: 16, alignItems: 'flex-end' }}>
              <div style={S.campo}>
                <label style={S.label}>Se debe actualizar cada</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input style={{ ...S.input, width: 90 }} type="number" min="1" defaultValue={diasVig}
                    disabled={!puedeEditar}
                    onBlur={e => guardarVigencia(e.target.value)} />
                  <span style={{ fontSize: 13, color: '#64748b' }}>dia(s)</span>
                </div>
                <span style={S.ayuda}>Pasado ese plazo, la tasa se marca vencida y se avisa arriba.</span>
              </div>
            </div>
          </div>

          {puedeEditar && (
            <div style={S.card}>
              <p style={S.cardTit}>Capturar tipo de cambio</p>
              <p style={S.ayuda}>
                Cuantos <b>{principal}</b> vale UNA unidad de la moneda que elijas. Si capturas dos veces la misma
                moneda en la misma fecha, se reemplaza.
              </p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Moneda</label>
                  <select style={S.input} value={nuevaTasa.moneda} onChange={e => setNuevaTasa({ ...nuevaTasa, moneda: e.target.value })}>
                    <option value="">Selecciona...</option>
                    {activas.map(m => <option key={m.id} value={m.clave}>{m.clave} — {m.nombre}</option>)}
                  </select>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Fecha</label>
                  <input style={S.input} type="date" value={nuevaTasa.fecha} onChange={e => setNuevaTasa({ ...nuevaTasa, fecha: e.target.value })} />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Tasa</label>
                  <input style={S.input} type="number" step="0.0001" min="0" value={nuevaTasa.tasa}
                    onChange={e => setNuevaTasa({ ...nuevaTasa, tasa: e.target.value })} placeholder="Ej: 17.2000" />
                </div>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Notas</label>
                  <input style={S.input} value={nuevaTasa.notas} onChange={e => setNuevaTasa({ ...nuevaTasa, notas: e.target.value })}
                    placeholder="Fuente: DOF, banco, contrato..." />
                </div>
              </div>
              {nuevaTasa.moneda && Number(nuevaTasa.tasa) > 0 && (
                <p style={S.equivale}>
                  Estas capturando que <b>1 {nuevaTasa.moneda} = {Number(nuevaTasa.tasa).toLocaleString('es-MX', { minimumFractionDigits: 2 })} {principal}</b>.
                  {' '}Si querias lo contrario, la tasa va al reves.
                </p>
              )}
              <div style={S.acciones}>
                <button style={S.boton} onClick={guardarTasa}>Guardar tipo de cambio</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <p style={{ ...S.cardTit, margin: 0 }}>Historial</p>
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={S.expBtn} onClick={() => exportarExcel('tipos_cambio', COLS_TC, cambios)}>Excel</button>
                <button style={S.expBtn} onClick={() => imprimirTablaPDF('Tipos de cambio', COLS_TC, cambios)}>PDF</button>
              </div>
            </div>
            <div style={{ ...S.tabla, marginTop: 10 }}>
              <div style={S.th}>
                <span style={{ width: 90 }}>Moneda</span>
                <span style={{ width: 120 }}>Fecha</span>
                <span style={{ width: 150 }}>Tasa a {principal}</span>
                <span style={{ flex: 1 }}>Notas</span>
              </div>
              {cambios.length === 0 && <p style={S.info}>Todavia no se ha capturado ningun tipo de cambio.</p>}
              {cambios.slice(0, 60).map(c => (
                <div key={c.id} style={S.tr}>
                  <span style={{ width: 90, fontWeight: 600 }}>{c.moneda}</span>
                  <span style={{ width: 120, color: '#64748b' }}>{c.fecha}</span>
                  <span style={{ width: 150 }}>{Number(c.tasa).toLocaleString('es-MX', { minimumFractionDigits: 4 })}</span>
                  <span style={{ flex: 1, color: '#64748b', fontSize: 12 }}>{c.notas}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ---------- Politica de costeo ---------- */}
      {tab === 'politica' && politica && (
        <>
          <div style={S.card}>
            <p style={S.cardTit}>Cuando se congela el tipo de cambio de una compra</p>
            <p style={S.ayuda}>
              Una compra en moneda extranjera tiene que quedar valuada en <b>{principal}</b> en algun momento, y
              a partir de ahi ese numero ya no cambia. Elegir el momento es una decision contable: aqui se define
              una vez y todos los movimientos la siguen.
            </p>
            {[
              ['recibo', 'Al recibir el material',
               'La tasa del dia en que el material entra al inventario. Es lo mas comun: el costo se vuelve real cuando la pieza esta en el anden, y el lote se queda con esa tasa.'],
              ['factura', 'Al registrar la factura del proveedor',
               'La tasa de la factura, que es lo que contabilidad realmente paga. Mas exacto contra el estado de resultados; a cambio, el lote entra al inventario sin costo firme hasta que llega la factura.'],
              ['periodo', 'Tasa fija del periodo',
               'Una tasa presupuestal por mes, igual para todos los movimientos de ese mes. Se captura abajo. La diferencia contra la real se reconoce como variacion cambiaria en vez de ensuciar el costo de cada lote.'],
            ].map(([v, titulo, expl]) => (
              <label key={v} style={politica.congela_en === v ? S.opcionSel : S.opcion}>
                <input type="radio" name="congela" checked={politica.congela_en === v} disabled={!puedeEditar}
                  onChange={() => guardarPolitica({ congela_en: v })} />
                <span>
                  <b>{titulo}</b>
                  <span style={S.opcionExpl}>{expl}</span>
                </span>
              </label>
            ))}
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>Cuando no hay tipo de cambio del dia del movimiento</p>
            {[
              ['ultima', 'Usar la ultima disponible y marcarlo',
               'El movimiento no se detiene: se toma la tasa mas reciente, se guarda cual se uso y de que fecha era, y el lote queda marcado como valuado con tasa vieja. Queda el rastro para corregirlo despues.'],
              ['sin_convertir', 'Dejarlo sin convertir',
               'El lote entra en su moneda original, sin valor en {principal}, y los reportes de inventario lo excluyen avisando. Mas honesto, pero deja huecos en el valor del inventario.'],
            ].map(([v, titulo, expl]) => (
              <label key={v} style={politica.sin_tasa === v ? S.opcionSel : S.opcion}>
                <input type="radio" name="sintasa" checked={politica.sin_tasa === v} disabled={!puedeEditar}
                  onChange={() => guardarPolitica({ sin_tasa: v })} />
                <span>
                  <b>{titulo}</b>
                  <span style={S.opcionExpl}>{expl.replace('{principal}', principal)}</span>
                </span>
              </label>
            ))}
          </div>

          <div style={S.card}>
            <p style={S.cardTit}>Valor del inventario</p>
            <p style={S.ayuda}>
              Cada lote conserva el costo con el que entro: <b>el inventario no se revalua</b>. Es lo que pide el
              costo historico y hace que el valor cuadre con lo que se pago. La diferencia por tipo de cambio se
              reconoce cuando el material se consume o se vende, no antes.
              {' '}Si un lote no trae costo congelado -- porque entro antes de esto o nunca se costeo -- el reporte
              cae al costo estandar del articulo convertido y lo <b>reporta aparte</b>, para que se vea cuanto del
              inventario esta valuado con cada criterio.
            </p>
          </div>

          {politica.congela_en === 'periodo' && (
            <div style={S.card}>
              <p style={S.cardTit}>Tasa del periodo</p>
              <p style={S.ayuda}>
                Cuantos <b>{principal}</b> vale UNA unidad de la moneda, para todo ese mes. Si el mes no tiene tasa
                capturada, el sistema se cae a la diaria y lo marca.
              </p>
              {puedeEditar && (
                <>
                  <div style={S.fila}>
                    <div style={S.campo}>
                      <label style={S.label}>Moneda</label>
                      <select style={S.input} value={nuevaPeriodo.moneda} onChange={e => setNuevaPeriodo({ ...nuevaPeriodo, moneda: e.target.value })}>
                        <option value="">Selecciona...</option>
                        {activas.map(m => <option key={m.id} value={m.clave}>{m.clave}</option>)}
                      </select>
                    </div>
                    <div style={S.campo}>
                      <label style={S.label}>Anio</label>
                      <input style={S.input} type="number" value={nuevaPeriodo.anio} onChange={e => setNuevaPeriodo({ ...nuevaPeriodo, anio: e.target.value })} />
                    </div>
                    <div style={S.campo}>
                      <label style={S.label}>Mes</label>
                      <input style={S.input} type="number" min="1" max="12" value={nuevaPeriodo.mes} onChange={e => setNuevaPeriodo({ ...nuevaPeriodo, mes: e.target.value })} />
                    </div>
                    <div style={S.campo}>
                      <label style={S.label}>Tasa</label>
                      <input style={S.input} type="number" step="0.0001" value={nuevaPeriodo.tasa} onChange={e => setNuevaPeriodo({ ...nuevaPeriodo, tasa: e.target.value })} placeholder="17.2000" />
                    </div>
                    <div style={{ ...S.campo, flex: 2 }}>
                      <label style={S.label}>Notas</label>
                      <input style={S.input} value={nuevaPeriodo.notas} onChange={e => setNuevaPeriodo({ ...nuevaPeriodo, notas: e.target.value })} placeholder="Presupuesto, contrato..." />
                    </div>
                  </div>
                  <div style={S.acciones}>
                    <button style={S.boton} onClick={guardarTasaPeriodo}>Guardar tasa del periodo</button>
                  </div>
                </>
              )}
              <div style={{ ...S.tabla, marginTop: 12 }}>
                <div style={S.th}>
                  <span style={{ width: 90 }}>Moneda</span>
                  <span style={{ width: 120 }}>Periodo</span>
                  <span style={{ width: 150 }}>Tasa a {principal}</span>
                  <span style={{ flex: 1 }}>Notas</span>
                </div>
                {tasasPeriodo.length === 0 && <p style={S.info}>Sin tasas de periodo capturadas.</p>}
                {tasasPeriodo.map(t => (
                  <div key={t.id} style={S.tr}>
                    <span style={{ width: 90, fontWeight: 600 }}>{t.moneda}</span>
                    <span style={{ width: 120, color: '#64748b' }}>{t.anio}-{String(t.mes).padStart(2, '0')}</span>
                    <span style={{ width: 150 }}>{Number(t.tasa).toLocaleString('es-MX', { minimumFractionDigits: 4 })}</span>
                    <span style={{ flex: 1, color: '#64748b', fontSize: 12 }}>{t.notas}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={S.avisoPol}>
            <b>Cambiar la politica no re-expresa lo que ya se congelo.</b> Los lotes que ya entraron conservan su
            costo y su tasa: eso es lo correcto, porque re-expresar el pasado cada vez que cambia una politica
            hace que un mismo mes valga distinto segun cuando se consulte. La politica nueva aplica de aqui en
            adelante.
          </div>
        </>
      )}

      {/* ---------- Catalogo ---------- */}
      {tab === 'catalogo' && (
        <>
          {puedeEditar && !form && (
            <button style={{ ...S.boton, marginBottom: 14 }} onClick={() => { setForm({ ...vacio }); setEditando(null); setError('') }}>
              + Nueva moneda
            </button>
          )}

          {form && (
            <div style={S.card}>
              <p style={S.cardTit}>{editando ? `Editar ${editando.clave}` : 'Nueva moneda'}</p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Clave *</label>
                  <input style={S.input} maxLength={5} value={form.clave}
                    onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="USD" />
                  <span style={S.ayuda}>Codigo ISO de tres letras: MXN, USD, EUR, JPY...</span>
                </div>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Nombre *</label>
                  <input style={S.input} value={form.nombre}
                    onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Dolar americano" />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Simbolo</label>
                  <input style={S.input} maxLength={5} value={form.simbolo || ''}
                    onChange={e => setForm({ ...form, simbolo: e.target.value })} placeholder="US$" />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Decimales</label>
                  <input style={S.input} type="number" min="0" max="6" value={form.decimales}
                    onChange={e => setForm({ ...form, decimales: e.target.value })} />
                </div>
              </div>
              <label style={S.check}>
                <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />
                <span>Activa (se ofrece al capturar precios)</span>
              </label>
              <div style={S.acciones}>
                <button style={S.botonGris} onClick={() => { setForm(null); setEditando(null); setError('') }}>Cancelar</button>
                <button style={S.boton} onClick={guardarMoneda}>Guardar</button>
              </div>
            </div>
          )}

          <div style={S.tabla}>
            <div style={S.th}>
              <span style={{ width: 90 }}>Clave</span>
              <span style={{ flex: 1 }}>Nombre</span>
              <span style={{ width: 80 }}>Simbolo</span>
              <span style={{ width: 90 }}>Decimales</span>
              <span style={{ width: 110 }}>En uso</span>
              <span style={{ width: 100 }}>Estatus</span>
              <span style={{ width: 260 }}>Acciones</span>
            </div>
            {monedas.map(m => {
              const enUso = usos[m.clave] || 0
              const esPrin = m.clave === principal
              return (
                <div key={m.id} style={S.tr}>
                  <span style={{ width: 90, fontWeight: 700, color: '#2563eb' }}>{m.clave}</span>
                  <span style={{ flex: 1 }}>{m.nombre}</span>
                  <span style={{ width: 80, color: '#64748b' }}>{m.simbolo}</span>
                  <span style={{ width: 90, color: '#64748b' }}>{m.decimales}</span>
                  <span style={{ width: 110, fontSize: 12, color: '#64748b' }}>{enUso} registro(s)</span>
                  <span style={{ width: 100 }}>
                    {esPrin
                      ? <span style={S.pillPrin}>principal</span>
                      : <span style={{ ...S.pill, background: m.activo ? '#f0fdf4' : '#fef2f2', color: m.activo ? '#16a34a' : '#dc2626' }}>
                          {m.activo ? 'Activa' : 'Inactiva'}
                        </span>}
                  </span>
                  <span style={{ width: 260, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {puedeEditar && (
                      <button style={S.btnMini} onClick={() => {
                        setEditando(m)
                        setForm({ clave: m.clave, nombre: m.nombre, simbolo: m.simbolo || '', decimales: m.decimales, activo: !!m.activo })
                        setError('')
                      }}>Editar</button>
                    )}
                    {puedeEditar && !esPrin && (
                      <button style={S.btnMini} title={`Hacer de ${m.clave} la moneda en la que la compania lleva sus numeros`}
                        onClick={() => cambiarPrincipal(m.clave)}>Hacer principal</button>
                    )}
                    {puedeEditar && !esPrin && (
                      <button
                        style={enUso > 0
                          ? { ...S.btnMini, color: '#cbd5e1', cursor: 'not-allowed' }
                          : { ...S.btnMini, color: '#dc2626', borderColor: '#fecaca' }}
                        title={enUso > 0 ? `La usan ${enUso} registro(s). Desactivala en su lugar.` : 'No la usa nadie'}
                        onClick={() => eliminarMoneda(m)}>Eliminar</button>
                    )}
                  </span>
                </div>
              )
            })}
          </div>
          <p style={S.pie}>
            Dar de alta una moneda aqui la habilita en todo el sistema: en el costo del articulo, en el precio de
            cada proveedor y en las ordenes de compra. Eliminar solo se puede cuando no la usa ningun registro;
            si ya se uso, desactivala para que deje de ofrecerse sin perder lo capturado.
          </p>
        </>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: 24 },
  top: { marginBottom: 16 },
  h2: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  sub: { fontSize: 13, color: '#64748b', margin: '6px 0 0', maxWidth: 880, lineHeight: 1.6 },
  tabs: { display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 18px', border: 'none', background: 'transparent', fontSize: 14, color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 18px', border: 'none', background: 'transparent', fontSize: 14, color: '#2563eb', fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid #2563eb' },
  card: { background: '#fff', borderRadius: 10, padding: 18, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTit: { fontSize: 14, fontWeight: 600, color: '#1a1a2e', margin: '0 0 10px' },
  fila: { display: 'flex', gap: 14, marginBottom: 12, flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 150 },
  label: { fontSize: 12, fontWeight: 500, color: '#444' },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  ayuda: { fontSize: 11.5, color: '#94a3b8', lineHeight: 1.5, marginTop: 3, display: 'block' },
  equivale: { fontSize: 13, color: '#1d4ed8', background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 7, padding: '9px 12px', margin: '4px 0 12px' },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#334155', cursor: 'pointer', marginBottom: 12 },
  acciones: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  botonGris: { padding: '9px 20px', background: '#e2e8f0', color: '#444', border: 'none', borderRadius: 7, fontSize: 14, cursor: 'pointer' },
  btnMini: { padding: '4px 10px', background: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, cursor: 'pointer' },
  expBtn: { padding: '6px 12px', background: '#fff', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, cursor: 'pointer' },
  tabla: { background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  th: { display: 'flex', gap: 12, padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', gap: 12, padding: '11px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13.5 },
  pill: { padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 500 },
  pillPrin: { padding: '3px 10px', borderRadius: 20, fontSize: 11.5, fontWeight: 700, background: '#eff6ff', color: '#1d4ed8', border: '1px solid #bfdbfe' },
  pillOk: { padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: '#f0fdf4', color: '#16a34a', border: '1px solid #bbf7d0' },
  pillMal: { padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' },
  opcion: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', border: '1px solid #e2e8f0', borderRadius: 8, marginBottom: 8, cursor: 'pointer', fontSize: 13.5, color: '#334155' },
  opcionSel: { display: 'flex', gap: 10, alignItems: 'flex-start', padding: '12px 14px', border: '1px solid #2563eb', background: '#eff6ff', borderRadius: 8, marginBottom: 8, cursor: 'pointer', fontSize: 13.5, color: '#1e3a8a' },
  opcionExpl: { display: 'block', fontSize: 12, color: '#64748b', marginTop: 4, lineHeight: 1.6, maxWidth: 820 },
  avisoPol: { background: '#fffbeb', border: '1px solid #fcd34d', borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: '#92400e', lineHeight: 1.6 },
  avisoVencido: { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '12px 14px', fontSize: 12.5, color: '#7f1d1d', marginBottom: 14, lineHeight: 1.6 },
  info: { fontSize: 13, color: '#94a3b8', padding: '16px', margin: 0 },
  pie: { fontSize: 12, color: '#94a3b8', marginTop: 12, maxWidth: 880, lineHeight: 1.6 },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
