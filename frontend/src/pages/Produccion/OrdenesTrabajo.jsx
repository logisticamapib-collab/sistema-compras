import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { evaluarSemaforo, cargarDatosSemaforo } from '../../lib/semaforo'

// Ordenes de trabajo. Candado: solo se puede programar un articulo cuyo semaforo
// de preparacion (8 puntos) este completo. Calcula las cajas segun el SNP de la
// norma de empaque oficial, base para las etiquetas QR de la fase de escaneo.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : '-'
const TURNOS = ['1o', '2o', '3o']
const NOMBRE_EST = { programada: 'Programada', en_proceso: 'En proceso', terminada: 'Terminada', cerrada: 'Cerrada', cancelada: 'Cancelada' }

export default function OrdenesTrabajo() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('prod_ordenes', 'crear')

  const [ots, setOts] = useState([])
  const [articulos, setArticulos] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [moldes, setMoldes] = useState([])
  const [normas, setNormas] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [sites, setSites] = useState([])
  const [datosSem, setDatosSem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtro, setFiltro] = useState('activas')
  const [form, setForm] = useState(null)
  const [procesando, setProcesando] = useState(false)
  const [detalle, setDetalle] = useState(null)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [o, a, m, mo, n, u, s, ds] = await Promise.all([
      supabase.from('ordenes_trabajo').select('*, art:articulos(codigo_interno, descripcion, unidad_medida), maq:maquinas(clave, nombre), creador:usuarios!ordenes_trabajo_creado_por_fkey(nombre)').eq('empresa_id', perfil.empresa_id).order('created_at', { ascending: false }),
      supabase.from('articulos').select('*').eq('empresa_id', perfil.empresa_id).eq('origen', 'fabricado').eq('activo', true).order('codigo_interno'),
      supabase.from('maquinas').select('*').eq('activo', true).order('clave'),
      supabase.from('moldes').select('*'),
      supabase.from('normas_empaque').select('*').eq('activa', true).eq('tipo', 'oficial'),
      supabase.from('ubicaciones').select('*').eq('activo', true),
      supabase.from('sites').select('id, nombre').eq('activo', true),
      cargarDatosSemaforo(supabase, perfil.empresa_id),
    ])
    setOts(o.data || []); setArticulos(a.data || []); setMaquinas(m.data || []); setMoldes(mo.data || [])
    setNormas(n.data || []); setUbicaciones(u.data || []); setSites(s.data || []); setDatosSem(ds)
    setLoading(false)
  }

  const semaforoDe = (art) => datosSem ? evaluarSemaforo(art, datosSem) : { completo: false, faltantes: [] }
  const articulosListos = articulos.filter(a => semaforoDe(a).completo)
  const articulosBloqueados = articulos.filter(a => !semaforoDe(a).completo)

  const normaDe = (artId) => normas.find(n => n.articulo_id === artId)
  const ubicacionMpDe = (maquinaId) => ubicaciones.find(u => u.maquina_id === maquinaId)

  const nuevoForm = () => setForm({ articulo_id: '', cantidad: '', maquina_id: '', molde_id: '', site_id: '', fecha_programada: '', turno: '1o', notas: '' })

  const artSel = form?.articulo_id ? articulos.find(a => a.id === Number(form.articulo_id)) : null
  const normaSel = artSel ? normaDe(artSel.id) : null
  const piezasCaja = Number(normaSel?.piezas_por_empaque || 0)
  const cajas = piezasCaja > 0 && Number(form?.cantidad) > 0 ? Math.ceil(Number(form.cantidad) / piezasCaja) : 0
  const ubiMp = form?.maquina_id ? ubicacionMpDe(Number(form.maquina_id)) : null

  const guardar = async () => {
    setError('')
    if (!form.articulo_id || !(Number(form.cantidad) > 0)) { setError('Selecciona articulo y cantidad'); return }
    if (!form.maquina_id) { setError('Selecciona la maquina'); return }
    const sem = semaforoDe(artSel)
    if (!sem.completo) { setError('El articulo no tiene el semaforo completo: ' + sem.faltantes.map(f => f.nombre).join(', ')); return }
    if (!ubiMp) { setError('La maquina no tiene una ubicacion de materia prima ligada. Crea la ubicacion (ej. MP-MAQ1) en Almacenes y ligala a la maquina.'); return }
    setProcesando(true)
    try {
      const maq = maquinas.find(m => m.id === Number(form.maquina_id))
      const { error: e1 } = await supabase.from('ordenes_trabajo').insert({
        empresa_id: perfil.empresa_id, folio: `OT-${Date.now().toString().slice(-8)}`,
        site_id: form.site_id ? Number(form.site_id) : maq?.site_id || null,
        articulo_id: Number(form.articulo_id), cantidad_programada: Number(form.cantidad),
        maquina_id: Number(form.maquina_id), molde_id: form.molde_id ? Number(form.molde_id) : null,
        ubicacion_mp_id: ubiMp.id, norma_empaque_id: normaSel?.id || null,
        piezas_por_caja: piezasCaja || null, cajas_estimadas: cajas || null,
        fecha_programada: form.fecha_programada || null, turno: form.turno, notas: form.notas || null,
        creado_por: perfil.id,
      })
      if (e1) throw e1
      setExito('Orden de trabajo creada')
      setForm(null); await cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProcesando(false)
  }

  const cambiarEstatus = async (ot, estatus) => {
    setError(''); setExito('')
    const { error: e1 } = await supabase.from('ordenes_trabajo').update({ estatus }).eq('id', ot.id)
    if (e1) { setError('Error: ' + e1.message); return }
    setExito(`OT ${ot.folio}: ${NOMBRE_EST[estatus]}`)
    await cargar()
  }

  const imprimir = (ot) => {
    setDetalle(ot)
    setTimeout(() => window.print(), 100)
  }

  const lista = ots.filter(o => filtro === 'todas' ? true : filtro === 'activas' ? ['programada', 'en_proceso'].includes(o.estatus) : o.estatus === filtro)
  const badgeEst = (e) => e === 'en_proceso' ? styles.badgeAzul : e === 'programada' ? styles.badgeAmbar : e === 'cancelada' ? styles.badgeRojo : styles.badgeVerde

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // Vista de impresion / detalle
  if (detalle) {
    const norma = normas.find(n => n.id === detalle.norma_empaque_id)
    return (
      <div style={styles.container} className="aparecer">
        <button style={{ ...styles.botonSec, marginBottom: '14px' }} className="no-imprimir" onClick={() => setDetalle(null)}>&larr; Volver</button>
        <button style={{ ...styles.boton, marginLeft: '10px', marginBottom: '14px' }} className="no-imprimir" onClick={() => window.print()}>Imprimir</button>
        <div style={styles.hoja}>
          <h2 style={{ margin: '0 0 4px' }}>ORDEN DE TRABAJO</h2>
          <p style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 18px', letterSpacing: '1px' }}>{detalle.folio}</p>
          <div style={styles.gridImp}>
            <div><b>Articulo:</b> {detalle.art?.codigo_interno}</div>
            <div><b>Descripcion:</b> {detalle.art?.descripcion}</div>
            <div><b>Cantidad programada:</b> {fmtNum(detalle.cantidad_programada)} {detalle.art?.unidad_medida}</div>
            <div><b>Maquina:</b> {detalle.maq?.clave} - {detalle.maq?.nombre}</div>
            <div><b>Fecha programada:</b> {fmtFecha(detalle.fecha_programada)}</div>
            <div><b>Turno:</b> {detalle.turno || '-'}</div>
            <div><b>Piezas por caja (SNP):</b> {fmtNum(detalle.piezas_por_caja)}</div>
            <div><b>Cajas estimadas:</b> {fmtNum(detalle.cajas_estimadas)}</div>
            <div><b>Norma de empaque:</b> {norma?.nombre || '-'}</div>
            <div><b>Estatus:</b> {NOMBRE_EST[detalle.estatus]}</div>
          </div>
          {detalle.notas && <p style={{ marginTop: '16px' }}><b>Notas:</b> {detalle.notas}</p>}
          <div style={{ marginTop: '30px', borderTop: '1px solid #ccc', paddingTop: '10px', fontSize: '12px', color: '#666' }}>
            Produccion reportada: {fmtNum(detalle.cantidad_producida)} OK / {fmtNum(detalle.cantidad_scrap)} scrap
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Ordenes de Trabajo</h2>
        {puedeCrear && !form && <button style={styles.boton} onClick={nuevoForm}>+ Nueva OT</button>}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {form && (
        <div style={styles.form}>
          <h3 style={styles.formTitulo}>Nueva orden de trabajo</h3>
          <p style={styles.ayuda}>Solo aparecen articulos con el <b>semaforo de preparacion completo</b> ({articulosListos.length} de {articulos.length}). Los bloqueados se listan abajo con lo que les falta.</p>
          <div style={styles.fila}>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Articulo *</label>
              <select style={styles.input} value={form.articulo_id} onChange={e => setForm({ ...form, articulo_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {articulosListos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Cantidad *</label>
              <input type="number" min="0" style={styles.input} value={form.cantidad} onChange={e => setForm({ ...form, cantidad: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Maquina *</label>
              <select style={styles.input} value={form.maquina_id} onChange={e => setForm({ ...form, maquina_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {maquinas.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Molde</label>
              <select style={styles.input} value={form.molde_id} onChange={e => setForm({ ...form, molde_id: e.target.value })}>
                <option value="">Sin especificar</option>
                {moldes.map(m => <option key={m.id} value={m.id}>{m.clave || m.nombre}</option>)}
              </select>
            </div>
          </div>
          <div style={styles.fila}>
            <div style={styles.campo}>
              <label style={styles.label}>Fecha programada</label>
              <input type="date" style={styles.input} value={form.fecha_programada} onChange={e => setForm({ ...form, fecha_programada: e.target.value })} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Turno</label>
              <select style={styles.input} value={form.turno} onChange={e => setForm({ ...form, turno: e.target.value })}>
                {TURNOS.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Notas</label>
              <input style={styles.input} value={form.notas} onChange={e => setForm({ ...form, notas: e.target.value })} placeholder="Opcional" />
            </div>
          </div>
          {artSel && (
            <div style={styles.resumen}>
              <span>SNP: <b>{piezasCaja ? fmtNum(piezasCaja) + ' pzas/caja' : 'sin norma oficial'}</b></span>
              <span>Cajas estimadas: <b>{cajas || '-'}</b></span>
              <span>Consumo de MP desde: <b>{ubiMp ? ubiMp.clave : 'la maquina no tiene ubicacion de MP ligada'}</b></span>
            </div>
          )}
          <div style={{ ...styles.botones, marginTop: '14px' }}>
            <button style={styles.botonSec} onClick={() => setForm(null)} disabled={procesando}>Cancelar</button>
            <button style={styles.boton} onClick={guardar} disabled={procesando}>{procesando ? 'Guardando...' : 'Crear OT'}</button>
          </div>
          {articulosBloqueados.length > 0 && (
            <div style={styles.bloqueados}>
              <p style={{ margin: '0 0 6px', fontWeight: '600', fontSize: '13px' }}>Articulos bloqueados por semaforo incompleto:</p>
              {articulosBloqueados.slice(0, 8).map(a => (
                <p key={a.id} style={{ margin: '2px 0', fontSize: '12px' }}>
                  <b>{a.codigo_interno}</b>: falta {semaforoDe(a).faltantes.map(f => f.nombre).join(', ')}
                </p>
              ))}
              {articulosBloqueados.length > 8 && <p style={{ fontSize: '12px' }}>... y {articulosBloqueados.length - 8} mas</p>}
            </div>
          )}
        </div>
      )}

      <div style={styles.filtros}>
        <label style={{ ...styles.label, marginRight: '8px' }}>Ver:</label>
        <select style={styles.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="activas">Activas (programadas y en proceso)</option>
          <option value="programada">Programadas</option>
          <option value="en_proceso">En proceso</option>
          <option value="terminada">Terminadas</option>
          <option value="todas">Todas</option>
        </select>
      </div>

      {lista.length === 0 ? (
        <p style={{ color: '#666', padding: '10px 4px' }}>No hay ordenes con este filtro.</p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 0.9 }}>Folio</span>
            <span style={{ flex: 2 }}>Articulo</span>
            <span style={{ flex: 0.9 }}>Maquina</span>
            <span style={{ flex: 0.9 }}>Fecha / turno</span>
            <span style={{ flex: 1.3, textAlign: 'right' }}>Avance</span>
            <span style={{ flex: 0.8, textAlign: 'center' }}>Estatus</span>
            <span style={{ width: '230px' }}></span>
          </div>
          {lista.map(o => {
            const pct = Number(o.cantidad_programada) > 0 ? Math.min(100, Math.round(Number(o.cantidad_producida) / Number(o.cantidad_programada) * 100)) : 0
            return (
              <div key={o.id} style={styles.tablaFila} className="fila-hover">
                <span style={{ flex: 0.9, fontWeight: '600' }}>{o.folio}</span>
                <span style={{ flex: 2 }}><b>{o.art?.codigo_interno}</b> <span style={{ color: '#64748b', fontSize: '13px' }}>- {o.art?.descripcion}</span></span>
                <span style={{ flex: 0.9, color: '#64748b' }}>{o.maq?.clave}</span>
                <span style={{ flex: 0.9, color: '#64748b', fontSize: '13px' }}>{fmtFecha(o.fecha_programada)} {o.turno}</span>
                <span style={{ flex: 1.3, textAlign: 'right', fontSize: '13px' }}>
                  <b>{fmtNum(o.cantidad_producida)}</b> / {fmtNum(o.cantidad_programada)} ({pct}%)
                  {Number(o.cantidad_scrap) > 0 && <span style={{ color: '#dc2626' }}> - {fmtNum(o.cantidad_scrap)} scrap</span>}
                </span>
                <span style={{ flex: 0.8, textAlign: 'center' }}><span style={{ ...styles.badge, ...badgeEst(o.estatus) }}>{NOMBRE_EST[o.estatus]}</span></span>
                <span style={{ width: '230px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                  <button style={styles.botonAccion} onClick={() => imprimir(o)}>Imprimir</button>
                  {puedeCrear && o.estatus === 'programada' && <button style={styles.botonAccion} onClick={() => cambiarEstatus(o, 'en_proceso')}>Iniciar</button>}
                  {puedeCrear && o.estatus === 'en_proceso' && <button style={styles.botonAccion} onClick={() => cambiarEstatus(o, 'terminada')}>Terminar</button>}
                  {puedeCrear && ['programada', 'en_proceso'].includes(o.estatus) && <button style={{ ...styles.botonAccion, color: '#dc2626' }} onClick={() => cambiarEstatus(o, 'cancelada')}>Cancelar</button>}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 14px', lineHeight: '1.5' },
  form: { backgroundColor: '#fff', borderRadius: '10px', padding: '24px', marginBottom: '20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 10px 0' },
  fila: { display: 'flex', gap: '14px', marginBottom: '14px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '9px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  resumen: { display: 'flex', gap: '24px', backgroundColor: '#f8fafc', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: '#334155' },
  bloqueados: { backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', color: '#92400e', marginTop: '16px' },
  filtros: { display: 'flex', alignItems: 'center', marginBottom: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#c2410c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  hoja: { backgroundColor: '#fff', padding: '40px', borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  gridImp: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', fontSize: '14px' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
  badgeAzul: { backgroundColor: '#dbeafe', color: '#2563eb' },
  badgeRojo: { backgroundColor: '#fee2e2', color: '#dc2626' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
