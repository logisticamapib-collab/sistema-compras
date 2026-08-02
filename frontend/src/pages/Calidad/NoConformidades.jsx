import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// No conformidades (IATF): registro de NC internas / de cliente / proveedor / auditoria,
// con disposicion del material, contencion, causa raiz, acciones correctivas/preventivas
// y cierre. Puede generar una alerta de calidad ligada.
const fmt = (n) => Number(n ?? 0).toLocaleString('es-MX', { maximumFractionDigits: 2 })
const fFecha = (f) => f ? new Date(f).toLocaleDateString('es-MX') : '-'
const ORIGENES = [['interno', 'Interno'], ['cliente', 'Cliente'], ['proveedor', 'Proveedor'], ['auditoria', 'Auditoria']]
const SEV = ['menor', 'mayor', 'critica']
const DISPOS = [['pendiente', 'Pendiente'], ['retrabajo', 'Retrabajo'], ['scrap', 'Scrap'], ['uso_como_esta', 'Uso como esta'], ['devolucion', 'Devolucion'], ['clasificar', 'Clasificar/seleccionar']]
const ESTS = [['abierta', 'Abierta'], ['en_analisis', 'En analisis'], ['contenida', 'Contenida'], ['en_accion', 'En accion'], ['cerrada', 'Cerrada']]
const TIPO_ACC = [['contencion', 'Contencion'], ['correctiva', 'Correctiva'], ['preventiva', 'Preventiva']]

const EXP_BTN = { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }

export default function NoConformidades() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('cal_nc', 'crear')
  const puedeEditar = tienePermiso('cal_nc', 'editar') || puedeCrear

  const [vista, setVista] = useState('lista')
  const [site, setSite] = useState('')
  const [ncs, setNcs] = useState([])
  const [sel, setSel] = useState(null)
  const [acciones, setAcciones] = useState([])
  const [articulos, setArticulos] = useState([])
  const [defectos, setDefectos] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [clientes, setClientes] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [ots, setOts] = useState([])
  const [form, setForm] = useState(null)
  const [ed, setEd] = useState({})
  const [acc, setAcc] = useState({ tipo: 'correctiva', descripcion: '', responsable_id: '', fecha_compromiso: '' })
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtro, setFiltro] = useState('abiertas')

  useEffect(() => { cargar() }, [site])
  const cargar = async () => {
    const sid = siteEfectivo(perfil, site)
    setLoading(true)
    const emp = perfil.empresa_id
    const [n, ar, de, mq, pv, cl, us, ot] = await Promise.all([
      supabase.from('no_conformidades').select('*, articulo:articulos(codigo_interno), defecto:causas_scrap(nombre), cliente:clientes(nombre), proveedor:proveedores(nombre)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', emp),
      supabase.from('causas_scrap').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true),
      (sid ? supabase.from('maquinas').select('id, clave, site_id').eq('empresa_id', emp).eq('site_id', sid) : supabase.from('maquinas').select('id, clave, site_id').eq('empresa_id', emp)),
      supabase.from('proveedores').select('id, nombre').eq('empresa_id', emp),
      supabase.from('clientes').select('id, nombre').eq('empresa_id', emp),
      supabase.from('usuarios').select('id, nombre, rol').eq('empresa_id', emp),
      supabase.from('ordenes_trabajo').select('id, folio').eq('empresa_id', emp).order('id', { ascending: false }).limit(200),
    ])
    setNcs((n.data || []).filter(x => { if (!sid) return true; const _ids = (mq.data || []).map(z => z.id); return !x.maquina_id || _ids.includes(x.maquina_id) })); setArticulos(ar.data || []); setDefectos(de.data || []); setMaquinas(mq.data || [])
    setProveedores(pv.data || []); setClientes(cl.data || []); setUsuarios(us.data || []); setOts(ot.data || [])
    setLoading(false)
  }
  const artDe = (id) => articulos.find(a => a.id === id)
  const usrDe = (id) => usuarios.find(u => u.id === id)?.nombre || '-'

  const abrirNueva = () => { setError(''); setExito(''); setForm({ origen: 'interno', articulo_id: '', lote_id: '', cantidad_afectada: '', defecto_id: '', descripcion: '', severidad: 'menor', area: '', maquina_id: '', ot_id: '', proveedor_id: '', cliente_id: '', responsable_id: '' }); setVista('nueva') }

  const crear = async () => {
    setError('')
    if (!form.descripcion.trim()) { setError('Captura la descripcion.'); return }
    setProc(true)
    try {
      const folio = `NC-${Date.now().toString().slice(-8)}`
      const { data: nc, error: e } = await supabase.from('no_conformidades').insert({
        empresa_id: perfil.empresa_id, folio, origen: form.origen, detectado_por: perfil.id, area: form.area || null,
        articulo_id: form.articulo_id ? Number(form.articulo_id) : null, cantidad_afectada: form.cantidad_afectada !== '' ? Number(form.cantidad_afectada) : null,
        defecto_id: form.defecto_id ? Number(form.defecto_id) : null, descripcion: form.descripcion, severidad: form.severidad,
        maquina_id: form.maquina_id ? Number(form.maquina_id) : null, ot_id: form.ot_id ? Number(form.ot_id) : null,
        proveedor_id: form.origen === 'proveedor' && form.proveedor_id ? Number(form.proveedor_id) : null,
        cliente_id: form.origen === 'cliente' && form.cliente_id ? Number(form.cliente_id) : null,
        responsable_id: form.responsable_id || null, creado_por: perfil.id,
      }).select().single()
      if (e) throw e
      setExito(`NC ${folio} registrada.`); await cargar(); abrirDetalle(nc)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const abrirDetalle = async (o) => {
    setError(''); setExito('')
    const { data: nc } = await supabase.from('no_conformidades').select('*, articulo:articulos(codigo_interno, descripcion), defecto:causas_scrap(nombre), cliente:clientes(nombre), proveedor:proveedores(nombre), maquina:maquinas(clave)').eq('id', o.id).single()
    const { data: ac } = await supabase.from('nc_acciones').select('*').eq('nc_id', o.id).order('id')
    setSel(nc); setAcciones(ac || [])
    setEd({ disposicion: nc.disposicion, contencion: nc.contencion || '', causa_raiz: nc.causa_raiz || '', accion_correctiva: nc.accion_correctiva || '', severidad: nc.severidad, responsable_id: nc.responsable_id || '', estatus: nc.estatus })
    setAcc({ tipo: 'correctiva', descripcion: '', responsable_id: '', fecha_compromiso: '' })
    setVista('detalle')
  }

  const guardar = async () => {
    setProc(true); setError('')
    try {
      const patch = { disposicion: ed.disposicion, contencion: ed.contencion || null, causa_raiz: ed.causa_raiz || null, accion_correctiva: ed.accion_correctiva || null, severidad: ed.severidad, responsable_id: ed.responsable_id || null, estatus: ed.estatus }
      if (ed.estatus === 'cerrada' && sel.estatus !== 'cerrada') { patch.fecha_cierre = new Date().toISOString(); patch.cerrada_por = perfil.id }
      await supabase.from('no_conformidades').update(patch).eq('id', sel.id)
      setExito('NC actualizada.'); await cargar(); await abrirDetalle(sel)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }
  const agregarAccion = async () => {
    if (!acc.descripcion.trim()) { setError('Describe la accion.'); return }
    setProc(true); setError('')
    try {
      await supabase.from('nc_acciones').insert({ nc_id: sel.id, tipo: acc.tipo, descripcion: acc.descripcion, responsable_id: acc.responsable_id || null, fecha_compromiso: acc.fecha_compromiso || null })
      await abrirDetalle(sel)
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }
  const cerrarAccion = async (a) => { await supabase.from('nc_acciones').update({ estatus: 'cerrada', fecha_cierre: new Date().toISOString().split('T')[0] }).eq('id', a.id); await abrirDetalle(sel) }

  const generarAlerta = async () => {
    setProc(true); setError('')
    try {
      const folio = `AC-${Date.now().toString().slice(-8)}`
      await supabase.from('calidad_alertas').insert({ empresa_id: perfil.empresa_id, folio, titulo: `NC ${sel.folio}: ${artDe(sel.articulo_id)?.codigo_interno || ''}`.trim(), articulo_id: sel.articulo_id, defecto_id: sel.defecto_id, mensaje: sel.descripcion, severidad: sel.severidad, nc_id: sel.id, creado_por: perfil.id })
      setExito('Alerta de calidad generada (vigente).')
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  if (vista === 'nueva') {
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => setVista('lista')}>&larr; Volver</button>
        <h2 style={styles.titulo}>Nueva no conformidad</h2>
      <div style={{ marginBottom: 10 }} className="no-imprimir"><FiltroSite value={site} onChange={setSite} /></div>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.tarjeta}>
          <div style={styles.fila}>
            <Campo label="Origen"><select style={styles.input} value={form.origen} onChange={e => setForm({ ...form, origen: e.target.value })}>{ORIGENES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
            <Campo label="Severidad"><select style={styles.input} value={form.severidad} onChange={e => setForm({ ...form, severidad: e.target.value })}>{SEV.map(s => <option key={s} value={s}>{s}</option>)}</select></Campo>
            <Campo label="Area"><input style={styles.input} value={form.area} onChange={e => setForm({ ...form, area: e.target.value })} placeholder="Ej. Inyeccion, Almacen" /></Campo>
          </div>
          <div style={styles.fila}>
            <Campo label="Articulo"><select style={styles.input} value={form.articulo_id} onChange={e => setForm({ ...form, articulo_id: e.target.value })}><option value="">-</option>{articulos.map(a => <option key={a.id} value={a.id}>{a.codigo_interno}</option>)}</select></Campo>
            <Campo label="Cantidad afectada"><input type="number" min="0" style={styles.input} value={form.cantidad_afectada} onChange={e => setForm({ ...form, cantidad_afectada: e.target.value })} /></Campo>
            <Campo label="Defecto"><select style={styles.input} value={form.defecto_id} onChange={e => setForm({ ...form, defecto_id: e.target.value })}><option value="">-</option>{defectos.map(d => <option key={d.id} value={d.id}>{d.clave} - {d.nombre}</option>)}</select></Campo>
          </div>
          <div style={styles.fila}>
            {form.origen === 'proveedor' && <Campo label="Proveedor"><select style={styles.input} value={form.proveedor_id} onChange={e => setForm({ ...form, proveedor_id: e.target.value })}><option value="">-</option>{proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></Campo>}
            {form.origen === 'cliente' && <Campo label="Cliente"><select style={styles.input} value={form.cliente_id} onChange={e => setForm({ ...form, cliente_id: e.target.value })}><option value="">-</option>{clientes.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></Campo>}
            <Campo label="Maquina"><select style={styles.input} value={form.maquina_id} onChange={e => setForm({ ...form, maquina_id: e.target.value })}><option value="">-</option>{maquinas.map(m => <option key={m.id} value={m.id}>{m.clave}</option>)}</select></Campo>
            <Campo label="OT"><select style={styles.input} value={form.ot_id} onChange={e => setForm({ ...form, ot_id: e.target.value })}><option value="">-</option>{ots.map(o => <option key={o.id} value={o.id}>{o.folio}</option>)}</select></Campo>
            <Campo label="Responsable"><select style={styles.input} value={form.responsable_id} onChange={e => setForm({ ...form, responsable_id: e.target.value })}><option value="">-</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
          </div>
          <Campo label="Descripcion de la no conformidad *"><input style={styles.input} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} /></Campo>
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setVista('lista')} disabled={proc}>Cancelar</button><button style={styles.boton} onClick={crear} disabled={proc}>{proc ? 'Guardando...' : 'Registrar NC'}</button></div>
        </div>
      </div>
    )
  }

  if (vista === 'detalle' && sel) {
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => { setVista('lista'); cargar() }}>&larr; Volver</button>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={styles.titulo}>{sel.folio} · {sel.articulo?.codigo_interno || 'Sin articulo'}</h2>
          <span style={badge(sel.estatus)}>{sel.estatus.replace(/_/g, ' ')}</span>
        </div>
        <p style={styles.sub}>Origen {sel.origen}{sel.cliente?.nombre ? ` (${sel.cliente.nombre})` : ''}{sel.proveedor?.nombre ? ` (${sel.proveedor.nombre})` : ''} · severidad {sel.severidad} · defecto {sel.defecto?.nombre || '-'} · cantidad {fmt(sel.cantidad_afectada)} {sel.maquina?.clave ? `· maq ${sel.maquina.clave}` : ''}</p>
        <p style={styles.desc}>{sel.descripcion}</p>
        {error && <p style={styles.error}>{error}</p>}
        {exito && <p style={styles.exito}>{exito}</p>}

        <div style={styles.tarjeta}>
          <h3 style={styles.h3}>Analisis y disposicion</h3>
          <div style={styles.fila}>
            <Campo label="Disposicion del material"><select style={styles.input} value={ed.disposicion} disabled={!puedeEditar} onChange={e => setEd({ ...ed, disposicion: e.target.value })}>{DISPOS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
            <Campo label="Severidad"><select style={styles.input} value={ed.severidad} disabled={!puedeEditar} onChange={e => setEd({ ...ed, severidad: e.target.value })}>{SEV.map(s => <option key={s} value={s}>{s}</option>)}</select></Campo>
            <Campo label="Responsable"><select style={styles.input} value={ed.responsable_id} disabled={!puedeEditar} onChange={e => setEd({ ...ed, responsable_id: e.target.value })}><option value="">-</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
            <Campo label="Estatus"><select style={styles.input} value={ed.estatus} disabled={!puedeEditar} onChange={e => setEd({ ...ed, estatus: e.target.value })}>{ESTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
          </div>
          <Campo label="Contencion (accion inmediata)"><input style={styles.input} value={ed.contencion} disabled={!puedeEditar} onChange={e => setEd({ ...ed, contencion: e.target.value })} /></Campo>
          <Campo label="Causa raiz"><input style={styles.input} value={ed.causa_raiz} disabled={!puedeEditar} onChange={e => setEd({ ...ed, causa_raiz: e.target.value })} /></Campo>
          <Campo label="Accion correctiva"><input style={styles.input} value={ed.accion_correctiva} disabled={!puedeEditar} onChange={e => setEd({ ...ed, accion_correctiva: e.target.value })} /></Campo>
          {puedeEditar && <div style={styles.botones}><button style={styles.botonSec} onClick={generarAlerta} disabled={proc}>Generar alerta de calidad</button><button style={styles.boton} onClick={guardar} disabled={proc}>{proc ? 'Guardando...' : 'Guardar'}</button></div>}
          {sel.fecha_cierre && <p style={styles.exito}>Cerrada por {usrDe(sel.cerrada_por)} el {fFecha(sel.fecha_cierre)}.</p>}
        </div>

        <div style={styles.tarjeta}>
          <h3 style={styles.h3}>Acciones (8D / seguimiento)</h3>
          <div style={styles.tabla}>
            <div style={styles.th}><span style={{ flex: 1 }}>Tipo</span><span style={{ flex: 2.4 }}>Descripcion</span><span style={{ flex: 1 }}>Responsable</span><span style={{ flex: 1 }}>Compromiso</span><span style={{ flex: 1 }}>Estatus</span><span style={{ width: '70px' }}></span></div>
            {acciones.map(a => (
              <div key={a.id} style={styles.tr}>
                <span style={{ flex: 1 }}>{(TIPO_ACC.find(t => t[0] === a.tipo) || [])[1]}</span>
                <span style={{ flex: 2.4 }}>{a.descripcion}</span>
                <span style={{ flex: 1, color: '#64748b' }}>{usrDe(a.responsable_id)}</span>
                <span style={{ flex: 1, color: '#64748b' }}>{fFecha(a.fecha_compromiso)}</span>
                <span style={{ flex: 1 }}><span style={a.estatus === 'cerrada' ? styles.pillOk : styles.pillAb}>{a.estatus}</span></span>
                <span style={{ width: '70px', textAlign: 'right' }}>{a.estatus !== 'cerrada' && puedeEditar && <button style={styles.botonAccion} onClick={() => cerrarAccion(a)}>Cerrar</button>}</span>
              </div>
            ))}
            {acciones.length === 0 && <div style={styles.vacio}>Sin acciones.</div>}
          </div>
          {puedeEditar && (
            <div style={{ ...styles.fila, marginTop: '12px', alignItems: 'flex-end' }}>
              <Campo label="Tipo"><select style={styles.input} value={acc.tipo} onChange={e => setAcc({ ...acc, tipo: e.target.value })}>{TIPO_ACC.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Campo>
              <Campo label="Descripcion"><input style={styles.input} value={acc.descripcion} onChange={e => setAcc({ ...acc, descripcion: e.target.value })} /></Campo>
              <Campo label="Responsable"><select style={styles.input} value={acc.responsable_id} onChange={e => setAcc({ ...acc, responsable_id: e.target.value })}><option value="">-</option>{usuarios.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
              <Campo label="Compromiso"><input type="date" style={styles.input} value={acc.fecha_compromiso} onChange={e => setAcc({ ...acc, fecha_compromiso: e.target.value })} /></Campo>
              <button style={styles.boton} onClick={agregarAccion} disabled={proc}>Agregar</button>
            </div>
          )}
        </div>
      </div>
    )
  }

  const colsExp = [
    { label: 'Folio', get: r => r.folio }, { label: 'Fecha', get: r => r.fecha },
    { label: 'Articulo', get: r => r.articulo?.codigo_interno || '' }, { label: 'Defecto', get: r => r.defecto?.nombre || '' },
    { label: 'Cantidad', get: r => r.cantidad_afectada }, { label: 'Severidad', get: r => r.severidad || '' },
    { label: 'Disposicion', get: r => r.disposicion || '' }, { label: 'Estatus', get: r => r.estatus || '' },
    { label: 'Cliente', get: r => r.cliente?.nombre || '' }, { label: 'Proveedor', get: r => r.proveedor?.nombre || '' },
  ]
  const lista = ncs.filter(o => filtro === 'todas' ? true : filtro === 'abiertas' ? o.estatus !== 'cerrada' && o.estatus !== 'cancelada' : o.estatus === 'cerrada')
  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}><h2 style={styles.titulo}>No conformidades</h2>{puedeCrear && <button style={styles.boton} onClick={abrirNueva}>Nueva NC</button>}</div>
      <div style={{ display: 'flex', gap: '8px', margin: '0 0 12px' }} className="no-imprimir">
        <button style={EXP_BTN} onClick={() => exportarExcel('no_conformidades', colsExp, lista)}>Excel</button>
        <button style={EXP_BTN} onClick={() => imprimirTablaPDF('No Conformidades', colsExp, lista)}>PDF</button>
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      <div style={styles.tabs}>{[['abiertas', 'Abiertas'], ['cerradas', 'Cerradas'], ['todas', 'Todas']].map(([id, n]) => <button key={id} style={filtro === id ? styles.tabAct : styles.tab} onClick={() => setFiltro(id)}>{n}</button>)}</div>
      <div style={styles.tabla}>
        <div style={styles.th}><span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1 }}>Origen</span><span style={{ flex: 1.2 }}>Articulo</span><span style={{ flex: 1.4 }}>Defecto</span><span style={{ flex: 0.8 }}>Sev.</span><span style={{ flex: 1 }}>Disposicion</span><span style={{ flex: 1 }}>Estatus</span><span style={{ width: '70px' }}></span></div>
        {lista.map(o => (
          <div key={o.id} style={styles.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{o.folio}</span>
            <span style={{ flex: 1, color: '#64748b' }}>{o.origen}</span>
            <span style={{ flex: 1.2 }}>{o.articulo?.codigo_interno || '-'}</span>
            <span style={{ flex: 1.4, color: '#64748b', fontSize: '12px' }}>{o.defecto?.nombre || '-'}</span>
            <span style={{ flex: 0.8 }}><span style={sevBadge(o.severidad)}>{o.severidad}</span></span>
            <span style={{ flex: 1, color: '#64748b', fontSize: '12px' }}>{o.disposicion.replace(/_/g, ' ')}</span>
            <span style={{ flex: 1 }}><span style={badge(o.estatus)}>{o.estatus.replace(/_/g, ' ')}</span></span>
            <span style={{ width: '70px', textAlign: 'right' }}><button style={styles.botonAccion} onClick={() => abrirDetalle(o)}>Abrir</button></span>
          </div>
        ))}
        {lista.length === 0 && <div style={styles.vacio}>Sin no conformidades.</div>}
      </div>
    </div>
  )
}

function Campo({ label, children }) { return (<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '160px' }}><label style={{ fontSize: '12px', fontWeight: 500, color: '#444' }}>{label}</label>{children}</div>) }
function badge(s) { const c = { abierta: ['#fee2e2', '#b91c1c'], en_analisis: ['#fef3c7', '#b45309'], contenida: ['#dbeafe', '#2563eb'], en_accion: ['#e0e7ff', '#4338ca'], cerrada: ['#dcfce7', '#15803d'], cancelada: ['#e2e8f0', '#475569'] }[s] || ['#f1f5f9', '#64748b']; return { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, backgroundColor: c[0], color: c[1] } }
function sevBadge(s) { const c = { menor: ['#f1f5f9', '#64748b'], mayor: ['#fef3c7', '#b45309'], critica: ['#fee2e2', '#b91c1c'] }[s] || ['#f1f5f9', '#64748b']; return { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: c[0], color: c[1] } }

const styles = {
  container: { padding: '28px', maxWidth: '1080px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  sub: { fontSize: '13px', color: '#64748b', margin: '6px 0 6px' },
  desc: { fontSize: '13px', color: '#334155', margin: '0 0 10px' },
  h3: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 12px' },
  volver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '14px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' },
  boton: { padding: '9px 18px', backgroundColor: '#b91c1c', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '5px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#b91c1c', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #b91c1c' },
  tabla: { border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  pillOk: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#dcfce7', color: '#15803d' },
  pillAb: { padding: '2px 8px', borderRadius: '20px', fontSize: '10px', fontWeight: 700, backgroundColor: '#fef3c7', color: '#b45309' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
