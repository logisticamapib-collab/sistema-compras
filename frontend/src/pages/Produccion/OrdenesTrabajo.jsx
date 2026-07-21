import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { evaluarSemaforo, cargarDatosSemaforo } from '../../lib/semaforo'
import PortalImpresion from '../../components/PortalImpresion'
import { imprimirAislado } from '../../lib/impresion'

// Ordenes de trabajo.
// - Candado: el semaforo de preparacion (8 puntos) debe estar completo. En molde
//   familiar se exige para TODOS los articulos del molde (no puedes correr el
//   izquierdo si el derecho no esta liberado).
// - Molde familiar (co-productos): al elegir un articulo, si su molde produce
//   otros articulos, la OT los incluye y calcula sus cantidades por proporcion
//   de cavidades. Editable.
// - Articulos de solo ensamble no requieren molde; la maquina se filtra por tipo.

const fmtNum = (n) => (Number(n) || 0).toLocaleString('es-MX')
const fmtFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : '-'
const TURNOS = ['1o', '2o', '3o']
const NOMBRE_EST = { programada: 'Programada', en_proceso: 'En proceso', terminada: 'Terminada', cerrada: 'Cerrada', cancelada: 'Cancelada' }
const REQUIERE_MOLDE = ['solo_inyeccion', 'inyeccion_y_ensamble', 'doble_inyeccion']

export default function OrdenesTrabajo() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('prod_ordenes', 'crear')

  const [ots, setOts] = useState([])
  const [otArts, setOtArts] = useState([])
  const [articulos, setArticulos] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [moldes, setMoldes] = useState([])
  const [cavidades, setCavidades] = useState([])
  const [normas, setNormas] = useState([])
  const [ubicaciones, setUbicaciones] = useState([])
  const [datosSem, setDatosSem] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtro, setFiltro] = useState('activas')
  const [form, setForm] = useState(null)
  const [procesando, setProcesando] = useState(false)
  const [detalle, setDetalle] = useState(null)
  const [expandido, setExpandido] = useState(null)
  const [fDesde, setFDesde] = useState('')
  const [fHasta, setFHasta] = useState('')
  const [fMaquina, setFMaquina] = useState('')
  const [fCliente, setFCliente] = useState('')
  const [clientes, setClientes] = useState([])
  const [artCliente, setArtCliente] = useState([])
  const [listado, setListado] = useState(false)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [o, oa, a, m, mo, cav, n, u, ds, cli, ac] = await Promise.all([
      supabase.from('ordenes_trabajo').select('*, maq:maquinas(clave, nombre, tipo), mol:moldes(clave)').eq('empresa_id', perfil.empresa_id).order('created_at', { ascending: false }),
      supabase.from('ot_articulos').select('*'),
      supabase.from('articulos').select('*').eq('empresa_id', perfil.empresa_id).eq('origen', 'fabricado').eq('activo', true).order('codigo_interno'),
      supabase.from('maquinas').select('*').eq('activo', true).order('clave'),
      supabase.from('moldes').select('*'),
      supabase.from('molde_cavidades').select('*').eq('activa', true),
      supabase.from('normas_empaque').select('*').eq('activa', true).eq('tipo', 'oficial'),
      supabase.from('ubicaciones').select('*').eq('activo', true),
      cargarDatosSemaforo(supabase, perfil.empresa_id),
      supabase.from('clientes').select('id, nombre').eq('activo', true),
      supabase.from('articulo_cliente').select('articulo_id, cliente_id').eq('activo', true),
    ])
    setOts(o.data || []); setOtArts(oa.data || []); setArticulos(a.data || []); setMaquinas(m.data || [])
    setMoldes(mo.data || []); setCavidades(cav.data || []); setNormas(n.data || [])
    setUbicaciones(u.data || []); setDatosSem(ds); setClientes(cli.data || []); setArtCliente(ac.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const semaforoDe = (art) => datosSem && art ? evaluarSemaforo(art, datosSem) : { completo: false, faltantes: [] }
  const normaDe = (artId) => normas.find(n => n.articulo_id === artId)
  const ubicacionMpDe = (maqId) => ubicaciones.find(u => u.maquina_id === maqId)
  const artsDeOt = (otId) => otArts.filter(x => x.ot_id === otId)

  // Molde del articulo (por cavidades) y familia de articulos de ese molde
  const moldeDeArticulo = (artId) => {
    const cav = cavidades.find(c => c.articulo_id === artId)
    return cav ? cav.molde_id : null
  }
  const familiaDeMolde = (moldeId) => {
    const cavs = cavidades.filter(c => c.molde_id === moldeId)
    const porArt = {}
    cavs.forEach(c => { porArt[c.articulo_id] = (porArt[c.articulo_id] || 0) + 1 })
    return Object.keys(porArt).map(id => ({ articulo_id: Number(id), cavidades: porArt[id] }))
  }

  const articulosListos = articulos.filter(a => semaforoDe(a).completo)
  const articulosBloqueados = articulos.filter(a => !semaforoDe(a).completo)

  const nuevoForm = () => setForm({ articulo_id: '', cantidad: '', maquina_id: '', molde_id: '', fecha_programada: '', turno: '1o', notas: '', lineas: [] })

  // Al elegir articulo: arma la familia del molde y calcula por cavidades
  const elegirArticulo = (articuloId) => {
    const art = artDe(Number(articuloId))
    const moldeId = art ? moldeDeArticulo(art.id) : null
    const familia = moldeId ? familiaDeMolde(moldeId) : []
    const cavPrincipal = familia.find(f => f.articulo_id === art?.id)?.cavidades || 1
    const lineas = familia.length > 1
      ? familia.map(f => ({ ...f, principal: f.articulo_id === art.id, cantidad: '' }))
      : [{ articulo_id: art?.id, cavidades: familia[0]?.cavidades || null, principal: true, cantidad: '' }]
    setForm(f => ({ ...f, articulo_id: articuloId, molde_id: moldeId ? String(moldeId) : '', lineas, cantidad: '', _cavPrincipal: cavPrincipal }))
  }

  // Recalcula co-productos por proporcion de cavidades al capturar la cantidad principal
  const setCantidadPrincipal = (valor) => {
    setForm(f => {
      const cavP = f._cavPrincipal || 1
      const lineas = f.lineas.map(l => l.principal
        ? { ...l, cantidad: valor }
        : { ...l, cantidad: valor && Number(valor) > 0 ? String(Math.round(Number(valor) / cavP * (l.cavidades || 1))) : '' })
      return { ...f, cantidad: valor, lineas }
    })
  }
  const setCantidadLinea = (articuloId, valor) => {
    setForm(f => ({ ...f, lineas: f.lineas.map(l => l.articulo_id === articuloId ? { ...l, cantidad: valor } : l) }))
  }

  const artSel = form?.articulo_id ? artDe(Number(form.articulo_id)) : null
  const esFamilia = (form?.lineas?.length || 0) > 1
  const ubiMp = form?.maquina_id ? ubicacionMpDe(Number(form.maquina_id)) : null
  const maquinasFiltradas = artSel
    ? maquinas.filter(m => REQUIERE_MOLDE.includes(artSel.tipo_proceso) ? m.tipo === 'inyeccion' : m.tipo === 'ensamble')
    : maquinas
  // Semaforo de todos los articulos de la familia
  const semaforoFamilia = (form?.lineas || []).map(l => ({ art: artDe(l.articulo_id), sem: semaforoDe(artDe(l.articulo_id)) }))
  const familiaBloqueada = semaforoFamilia.filter(x => !x.sem.completo)

  const guardar = async () => {
    setError('')
    if (!artSel) { setError('Selecciona el articulo'); return }
    const lineas = (form.lineas || []).filter(l => Number(l.cantidad) > 0)
    if (lineas.length === 0) { setError('Captura la cantidad a producir'); return }
    if (!form.maquina_id) { setError('Selecciona la maquina'); return }
    if (familiaBloqueada.length > 0) {
      setError('Semaforo incompleto en: ' + familiaBloqueada.map(x => `${x.art?.codigo_interno} (${x.sem.faltantes.map(f => f.nombre).join(', ')})`).join(' | '))
      return
    }
    if (REQUIERE_MOLDE.includes(artSel.tipo_proceso) && !form.molde_id) { setError('El proceso requiere molde y el articulo no tiene molde/cavidad asignado'); return }
    if (!ubiMp) { setError('La maquina no tiene ubicacion de materia prima ligada. Creala en Almacenes (ej. MP-MAQ1) y ligala a la maquina.'); return }
    setProcesando(true)
    try {
      const maq = maquinas.find(m => m.id === Number(form.maquina_id))
      const { data: ot, error: e1 } = await supabase.from('ordenes_trabajo').insert({
        empresa_id: perfil.empresa_id, folio: `OT-${Date.now().toString().slice(-8)}`,
        site_id: maq?.site_id || null, articulo_id: artSel.id,
        cantidad_programada: Number(form.cantidad) || lineas[0].cantidad,
        maquina_id: Number(form.maquina_id), molde_id: form.molde_id ? Number(form.molde_id) : null,
        ubicacion_mp_id: ubiMp.id, fecha_programada: form.fecha_programada || null,
        turno: form.turno, notas: form.notas || null, creado_por: perfil.id,
      }).select().single()
      if (e1) throw e1
      const filas = lineas.map(l => {
        const norma = normaDe(l.articulo_id)
        const pxc = Number(norma?.piezas_por_empaque || 0)
        return {
          ot_id: ot.id, articulo_id: l.articulo_id, principal: !!l.principal, cavidades: l.cavidades || null,
          cantidad_programada: Number(l.cantidad), norma_empaque_id: norma?.id || null,
          piezas_por_caja: pxc || null, cajas_estimadas: pxc > 0 ? Math.ceil(Number(l.cantidad) / pxc) : null,
        }
      })
      const { error: e2 } = await supabase.from('ot_articulos').insert(filas)
      if (e2) throw e2
      setExito(`OT ${ot.folio} creada${esFamilia ? ` con ${filas.length} articulos del molde` : ''}`)
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

  const clientesDeOt = (otId) => {
    const arts = artsDeOt(otId).map(x => x.articulo_id)
    return artCliente.filter(x => arts.includes(x.articulo_id)).map(x => x.cliente_id)
  }
  const lista = ots
    .filter(o => filtro === 'todas' ? true : filtro === 'activas' ? ['programada', 'en_proceso'].includes(o.estatus) : o.estatus === filtro)
    .filter(o => !fDesde || (o.fecha_programada && o.fecha_programada >= fDesde))
    .filter(o => !fHasta || (o.fecha_programada && o.fecha_programada <= fHasta))
    .filter(o => !fMaquina || o.maquina_id === Number(fMaquina))
    .filter(o => !fCliente || clientesDeOt(o.id).includes(Number(fCliente)))
  const badgeEst = (e) => e === 'en_proceso' ? styles.badgeAzul : e === 'programada' ? styles.badgeAmbar : e === 'cancelada' ? styles.badgeRojo : styles.badgeVerde

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  // Listado imprimible segun los filtros activos
  if (listado) {
    const desc = [
      filtro !== 'todas' ? `Estatus: ${filtro === 'activas' ? 'activas' : NOMBRE_EST[filtro]}` : 'Todas',
      fDesde ? `desde ${fmtFecha(fDesde)}` : '', fHasta ? `hasta ${fmtFecha(fHasta)}` : '',
      fMaquina ? `Maquina: ${maquinas.find(m => m.id === Number(fMaquina))?.clave}` : '',
      fCliente ? `Cliente: ${clientes.find(c => c.id === Number(fCliente))?.nombre}` : '',
    ].filter(Boolean).join('  |  ')
    const hoja = (
      <div style={{ padding: '0.5in', fontFamily: 'Arial, Helvetica, sans-serif', color: '#000' }}>
        <h2 style={{ margin: '0 0 2px' }}>LISTADO DE ORDENES DE TRABAJO</h2>
        <p style={{ fontSize: '12px', color: '#444', margin: '0 0 4px' }}>{desc}</p>
        <p style={{ fontSize: '11px', color: '#666', margin: '0 0 14px' }}>Generado {new Date().toLocaleString('es-MX')} - {lista.length} orden(es)</p>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
          <thead>
            <tr style={{ backgroundColor: '#f1f5f9' }}>
              <th style={styles.th}>Folio</th><th style={styles.th}>Articulo(s)</th><th style={styles.th}>Maquina</th>
              <th style={styles.th}>Molde</th><th style={styles.th}>Fecha</th><th style={styles.th}>Turno</th>
              <th style={styles.th}>Programado</th><th style={styles.th}>Producido</th><th style={styles.th}>Estatus</th>
            </tr>
          </thead>
          <tbody>
            {lista.map(o => {
              const arts = artsDeOt(o.id)
              return (
                <tr key={o.id}>
                  <td style={styles.td}>{o.folio}</td>
                  <td style={styles.td}>{arts.map(x => artDe(x.articulo_id)?.codigo_interno).join(' + ') || artDe(o.articulo_id)?.codigo_interno}</td>
                  <td style={styles.td}>{o.maq?.clave}</td>
                  <td style={styles.td}>{o.mol?.clave || '-'}</td>
                  <td style={styles.td}>{fmtFecha(o.fecha_programada)}</td>
                  <td style={styles.td}>{o.turno || '-'}</td>
                  <td style={styles.td}>{arts.map(x => fmtNum(x.cantidad_programada)).join(' / ')}</td>
                  <td style={styles.td}>{arts.map(x => fmtNum(x.cantidad_producida)).join(' / ')}</td>
                  <td style={styles.td}>{NOMBRE_EST[o.estatus]}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
    return (
      <div style={styles.container} className="aparecer">
        <style>{`@media print { @page { size: letter landscape; margin: 0; } }`}</style>
        <div style={{ display: 'flex', gap: '10px', marginBottom: '14px' }} className="no-imprimir">
          <button style={styles.botonSec} onClick={() => setListado(false)}>&larr; Volver</button>
          <button style={styles.boton} onClick={imprimirAislado}>Imprimir</button>
        </div>
        <PortalImpresion>{hoja}</PortalImpresion>
        <div style={{ backgroundColor: '#fff', borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>{hoja}</div>
      </div>
    )
  }

  // Impresion
  if (detalle) {
    const arts = artsDeOt(detalle.id)
    return (
      <div style={styles.container} className="aparecer">
        <button style={{ ...styles.botonSec, marginBottom: '14px' }} className="no-imprimir" onClick={() => setDetalle(null)}>&larr; Volver</button>
        <button style={{ ...styles.boton, marginLeft: '10px', marginBottom: '14px' }} className="no-imprimir" onClick={imprimirAislado}>Imprimir</button>
        <PortalImpresion>
          <div style={{ ...styles.hoja, boxShadow: 'none', padding: '0.5in' }}>
            <h2 style={{ margin: '0 0 4px' }}>ORDEN DE TRABAJO</h2>
            <p style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 18px', letterSpacing: '1px' }}>{detalle.folio}</p>
            <div style={styles.gridImp}>
              <div><b>Maquina:</b> {detalle.maq?.clave} - {detalle.maq?.nombre}</div>
              <div><b>Molde:</b> {detalle.mol?.clave || 'N/A (ensamble)'}</div>
              <div><b>Fecha programada:</b> {fmtFecha(detalle.fecha_programada)}</div>
              <div><b>Turno:</b> {detalle.turno || '-'}</div>
              <div><b>Estatus:</b> {NOMBRE_EST[detalle.estatus]}</div>
            </div>
            <table style={{ width: '100%', marginTop: '20px', borderCollapse: 'collapse', fontSize: '14px' }}>
              <thead>
                <tr style={{ backgroundColor: '#f1f5f9' }}>
                  <th style={styles.th}>Articulo</th><th style={styles.th}>Cav.</th><th style={styles.th}>Programado</th>
                  <th style={styles.th}>SNP</th><th style={styles.th}>Cajas</th><th style={styles.th}>Producido</th>
                </tr>
              </thead>
              <tbody>
                {artsDeOt(detalle.id).map(x => (
                  <tr key={x.id}>
                    <td style={styles.td}>{artDe(x.articulo_id)?.codigo_interno} - {artDe(x.articulo_id)?.descripcion}</td>
                    <td style={styles.td}>{x.cavidades || '-'}</td>
                    <td style={styles.td}>{fmtNum(x.cantidad_programada)}</td>
                    <td style={styles.td}>{fmtNum(x.piezas_por_caja)}</td>
                    <td style={styles.td}>{fmtNum(x.cajas_estimadas)}</td>
                    <td style={styles.td}>{fmtNum(x.cantidad_producida)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {detalle.notas && <p style={{ marginTop: '16px' }}><b>Notas:</b> {detalle.notas}</p>}
          </div>
        </PortalImpresion>
        <div style={styles.hoja}>
          <h2 style={{ margin: '0 0 4px' }}>ORDEN DE TRABAJO</h2>
          <p style={{ fontSize: '22px', fontWeight: '700', margin: '0 0 18px', letterSpacing: '1px' }}>{detalle.folio}</p>
          <div style={styles.gridImp}>
            <div><b>Maquina:</b> {detalle.maq?.clave} - {detalle.maq?.nombre}</div>
            <div><b>Molde:</b> {detalle.mol?.clave || 'N/A (ensamble)'}</div>
            <div><b>Fecha programada:</b> {fmtFecha(detalle.fecha_programada)}</div>
            <div><b>Turno:</b> {detalle.turno || '-'}</div>
            <div><b>Estatus:</b> {NOMBRE_EST[detalle.estatus]}</div>
          </div>
          <table style={{ width: '100%', marginTop: '20px', borderCollapse: 'collapse', fontSize: '14px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f1f5f9' }}>
                <th style={styles.th}>Articulo</th><th style={styles.th}>Cav.</th><th style={styles.th}>Programado</th>
                <th style={styles.th}>SNP</th><th style={styles.th}>Cajas</th><th style={styles.th}>Producido</th>
              </tr>
            </thead>
            <tbody>
              {arts.map(x => (
                <tr key={x.id}>
                  <td style={styles.td}>{artDe(x.articulo_id)?.codigo_interno} - {artDe(x.articulo_id)?.descripcion}</td>
                  <td style={styles.td}>{x.cavidades || '-'}</td>
                  <td style={styles.td}>{fmtNum(x.cantidad_programada)}</td>
                  <td style={styles.td}>{fmtNum(x.piezas_por_caja)}</td>
                  <td style={styles.td}>{fmtNum(x.cajas_estimadas)}</td>
                  <td style={styles.td}>{fmtNum(x.cantidad_producida)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {detalle.notas && <p style={{ marginTop: '16px' }}><b>Notas:</b> {detalle.notas}</p>}
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
          <p style={styles.ayuda}>Solo se listan articulos con <b>semaforo completo</b> ({articulosListos.length} de {articulos.length}). Si el molde produce varios articulos (familiar), se incluyen todos y se calculan por cavidades.</p>
          <div style={styles.fila}>
            <div style={{ ...styles.campo, flex: 2 }}>
              <label style={styles.label}>Articulo principal *</label>
              <select style={styles.input} value={form.articulo_id} onChange={e => elegirArticulo(e.target.value)}>
                <option value="">Selecciona...</option>
                {articulosListos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Cantidad principal *</label>
              <input type="number" min="0" style={styles.input} value={form.cantidad} onChange={e => setCantidadPrincipal(e.target.value)} disabled={!artSel} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Maquina * {artSel && <span style={{ color: '#94a3b8' }}>({REQUIERE_MOLDE.includes(artSel.tipo_proceso) ? 'inyeccion' : 'ensamble'})</span>}</label>
              <select style={styles.input} value={form.maquina_id} onChange={e => setForm({ ...form, maquina_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {maquinasFiltradas.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}
              </select>
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Molde</label>
              <select style={styles.input} value={form.molde_id} onChange={e => setForm({ ...form, molde_id: e.target.value })} disabled={!!form.molde_id}>
                <option value="">{artSel && !REQUIERE_MOLDE.includes(artSel.tipo_proceso) ? 'No aplica (ensamble)' : 'Sin molde'}</option>
                {moldes.map(m => <option key={m.id} value={m.id}>{m.clave || m.nombre}</option>)}
              </select>
            </div>
          </div>

          {form.lineas?.length > 0 && (
            <div style={esFamilia ? styles.familiaBox : styles.resumen}>
              {esFamilia && <p style={{ margin: '0 0 8px', fontWeight: '600', fontSize: '13px', color: '#1e40af' }}>Molde familiar: esta corrida produce {form.lineas.length} articulos simultaneamente</p>}
              {form.lineas.map(l => {
                const a = artDe(l.articulo_id)
                const norma = normaDe(l.articulo_id)
                const pxc = Number(norma?.piezas_por_empaque || 0)
                const cajas = pxc > 0 && Number(l.cantidad) > 0 ? Math.ceil(Number(l.cantidad) / pxc) : 0
                const sem = semaforoDe(a)
                return (
                  <div key={l.articulo_id} style={{ display: 'flex', gap: '12px', alignItems: 'center', padding: '5px 0', fontSize: '13px' }}>
                    <span style={{ flex: 2 }}>
                      <b>{a?.codigo_interno}</b> {l.principal && <span style={{ ...styles.badge, ...styles.badgeAzul }}>principal</span>}
                      {!sem.completo && <span style={{ ...styles.badge, ...styles.badgeRojo, marginLeft: '6px' }}>semaforo incompleto</span>}
                    </span>
                    <span style={{ flex: 0.6 }}>{l.cavidades ? `${l.cavidades} cav` : '-'}</span>
                    <input type="number" min="0" style={{ ...styles.input, flex: 0.8, padding: '6px 10px' }} value={l.cantidad}
                      onChange={e => setCantidadLinea(l.articulo_id, e.target.value)} disabled={l.principal} />
                    <span style={{ flex: 1, color: '#64748b' }}>{pxc ? `${fmtNum(pxc)} pzas/caja - ${cajas} cajas` : 'sin norma oficial'}</span>
                  </div>
                )
              })}
              {familiaBloqueada.length > 0 && (
                <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#dc2626' }}>
                  No se puede programar: {familiaBloqueada.map(x => `${x.art?.codigo_interno} falta ${x.sem.faltantes.map(f => f.nombre).join(', ')}`).join(' | ')}
                </p>
              )}
              <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b' }}>Consumo de MP desde: <b>{ubiMp ? ubiMp.clave : 'la maquina no tiene ubicacion de MP ligada'}</b></p>
            </div>
          )}

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

          <div style={styles.botones}>
            <button style={styles.botonSec} onClick={() => setForm(null)} disabled={procesando}>Cancelar</button>
            <button style={{ ...styles.boton, opacity: familiaBloqueada.length ? 0.5 : 1 }} onClick={guardar} disabled={procesando || familiaBloqueada.length > 0}>{procesando ? 'Guardando...' : 'Crear OT'}</button>
          </div>

          {articulosBloqueados.length > 0 && (
            <div style={styles.bloqueados}>
              <p style={{ margin: '0 0 6px', fontWeight: '600', fontSize: '13px' }}>Articulos bloqueados por semaforo incompleto:</p>
              {articulosBloqueados.slice(0, 8).map(a => (
                <p key={a.id} style={{ margin: '2px 0', fontSize: '12px' }}><b>{a.codigo_interno}</b>: falta {semaforoDe(a).faltantes.map(f => f.nombre).join(', ')}</p>
              ))}
              {articulosBloqueados.length > 8 && <p style={{ fontSize: '12px' }}>... y {articulosBloqueados.length - 8} mas</p>}
            </div>
          )}
        </div>
      )}

      <div style={styles.filtros}>
        <label style={styles.label}>Ver:</label>
        <select style={styles.input} value={filtro} onChange={e => setFiltro(e.target.value)}>
          <option value="activas">Activas</option>
          <option value="programada">Programadas</option>
          <option value="en_proceso">En proceso</option>
          <option value="terminada">Terminadas</option>
          <option value="todas">Todas</option>
        </select>
        <label style={styles.label}>Del:</label>
        <input type="date" style={styles.input} value={fDesde} onChange={e => setFDesde(e.target.value)} />
        <label style={styles.label}>Al:</label>
        <input type="date" style={styles.input} value={fHasta} onChange={e => setFHasta(e.target.value)} />
        <select style={styles.input} value={fMaquina} onChange={e => setFMaquina(e.target.value)}>
          <option value="">Toda maquina</option>
          {maquinas.map(m => <option key={m.id} value={m.id}>{m.clave}</option>)}
        </select>
        <select style={styles.input} value={fCliente} onChange={e => setFCliente(e.target.value)}>
          <option value="">Todo cliente</option>
          {clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}
        </select>
        <button style={styles.botonSec} onClick={() => { setFiltro('activas'); setFDesde(''); setFHasta(''); setFMaquina(''); setFCliente('') }}>Limpiar</button>
        {lista.length > 0 && <button style={styles.boton} onClick={() => setListado(true)}>Imprimir listado ({lista.length})</button>}
      </div>

      {lista.length === 0 ? (
        <p style={{ color: '#666', padding: '10px 4px' }}>No hay ordenes con este filtro.</p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 0.9 }}>Folio</span>
            <span style={{ flex: 2 }}>Articulos</span>
            <span style={{ flex: 0.8 }}>Maquina</span>
            <span style={{ flex: 0.8 }}>Molde</span>
            <span style={{ flex: 0.9 }}>Fecha / turno</span>
            <span style={{ flex: 0.8, textAlign: 'center' }}>Estatus</span>
            <span style={{ width: '230px' }}></span>
          </div>
          {lista.map(o => {
            const arts = artsDeOt(o.id)
            const abierto = expandido === o.id
            return (
              <div key={o.id}>
                <div style={{ ...styles.tablaFila, cursor: 'pointer' }} className="fila-hover" onClick={() => setExpandido(abierto ? null : o.id)}>
                  <span style={{ flex: 0.9, fontWeight: '600' }}>{abierto ? '▼' : '▶'} {o.folio}</span>
                  <span style={{ flex: 2, fontSize: '13px' }}>
                    {arts.map(x => artDe(x.articulo_id)?.codigo_interno).join(' + ') || artDe(o.articulo_id)?.codigo_interno}
                    {arts.length > 1 && <span style={{ ...styles.badge, ...styles.badgeAzul, marginLeft: '6px' }}>familiar</span>}
                  </span>
                  <span style={{ flex: 0.8, color: '#64748b' }}>{o.maq?.clave}</span>
                  <span style={{ flex: 0.8, color: '#64748b' }}>{o.mol?.clave || '-'}</span>
                  <span style={{ flex: 0.9, color: '#64748b', fontSize: '13px' }}>{fmtFecha(o.fecha_programada)} {o.turno}</span>
                  <span style={{ flex: 0.8, textAlign: 'center' }}><span style={{ ...styles.badge, ...badgeEst(o.estatus) }}>{NOMBRE_EST[o.estatus]}</span></span>
                  <span style={{ width: '230px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }} onClick={ev => ev.stopPropagation()}>
                    <button style={styles.botonAccion} onClick={() => setDetalle(o)}>Imprimir</button>
                    {puedeCrear && o.estatus === 'programada' && <button style={styles.botonAccion} onClick={() => cambiarEstatus(o, 'en_proceso')}>Iniciar</button>}
                    {puedeCrear && o.estatus === 'en_proceso' && <button style={styles.botonAccion} onClick={() => cambiarEstatus(o, 'terminada')}>Terminar</button>}
                    {puedeCrear && ['programada', 'en_proceso'].includes(o.estatus) && <button style={{ ...styles.botonAccion, color: '#dc2626' }} onClick={() => cambiarEstatus(o, 'cancelada')}>Cancelar</button>}
                  </span>
                </div>
                {abierto && (
                  <div style={styles.subTabla}>
                    <div style={{ ...styles.tablaHeader, backgroundColor: '#fff' }}>
                      <span style={{ flex: 2.4 }}>Articulo</span>
                      <span style={{ flex: 0.6, textAlign: 'center' }}>Cav.</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>Programado</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>Producido</span>
                      <span style={{ flex: 0.9, textAlign: 'right' }}>Scrap</span>
                      <span style={{ flex: 1, textAlign: 'right' }}>SNP / cajas</span>
                    </div>
                    {arts.map(x => {
                      const pct = Number(x.cantidad_programada) > 0 ? Math.min(100, Math.round(Number(x.cantidad_producida) / Number(x.cantidad_programada) * 100)) : 0
                      return (
                        <div key={x.id} style={{ ...styles.tablaFila, padding: '8px 20px', fontSize: '13px' }}>
                          <span style={{ flex: 2.4 }}><b>{artDe(x.articulo_id)?.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {artDe(x.articulo_id)?.descripcion}</span> {x.principal && <span style={{ ...styles.badge, ...styles.badgeAzul }}>principal</span>}</span>
                          <span style={{ flex: 0.6, textAlign: 'center' }}>{x.cavidades || '-'}</span>
                          <span style={{ flex: 1, textAlign: 'right' }}>{fmtNum(x.cantidad_programada)}</span>
                          <span style={{ flex: 1, textAlign: 'right', fontWeight: '600', color: '#16a34a' }}>{fmtNum(x.cantidad_producida)} ({pct}%)</span>
                          <span style={{ flex: 0.9, textAlign: 'right', color: Number(x.cantidad_scrap) > 0 ? '#dc2626' : '#94a3b8' }}>{fmtNum(x.cantidad_scrap)}</span>
                          <span style={{ flex: 1, textAlign: 'right', color: '#64748b' }}>{x.piezas_por_caja ? `${fmtNum(x.piezas_por_caja)} / ${fmtNum(x.cajas_estimadas)}` : '-'}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
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
  resumen: { backgroundColor: '#f8fafc', borderRadius: '8px', padding: '10px 16px', fontSize: '13px', color: '#334155', marginBottom: '14px' },
  familiaBox: { backgroundColor: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '8px', padding: '12px 16px', marginBottom: '14px' },
  bloqueados: { backgroundColor: '#fef3c7', border: '1px solid #fcd34d', borderRadius: '8px', padding: '12px 16px', color: '#92400e', marginTop: '16px' },
  filtros: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#c2410c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  subTabla: { backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '2px 0 6px' },
  hoja: { backgroundColor: '#fff', padding: '40px', borderRadius: '10px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  gridImp: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 24px', fontSize: '14px' },
  th: { textAlign: 'left', padding: '8px', borderBottom: '1px solid #cbd5e1', fontSize: '13px' },
  td: { padding: '8px', borderBottom: '1px solid #f1f5f9' },
  badge: { padding: '2px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeAmbar: { backgroundColor: '#fef3c7', color: '#b45309' },
  badgeAzul: { backgroundColor: '#dbeafe', color: '#2563eb' },
  badgeRojo: { backgroundColor: '#fee2e2', color: '#dc2626' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
