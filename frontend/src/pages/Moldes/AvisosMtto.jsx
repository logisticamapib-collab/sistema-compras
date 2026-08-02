import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import FiltroSite from '../../components/FiltroSite'
import { siteEfectivo } from '../../lib/sites'

// Avisos de mantenimiento: Produccion/Calidad reportan piezas no conformes
// atribuidas al molde (rebaba, tiro corto...). Registran causa probable
// (molde / parametros de maquina / reparacion previa inefectiva) con maquina,
// turno y operador. Se convierten en una orden de mantenimiento correctivo.
const fFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : '-'
const CAUSAS = [
  { v: 'molde', l: 'Defecto del molde' },
  { v: 'parametros_maquina', l: 'Parametros de maquina (resina, botadores, presion, agua...)' },
  { v: 'reparacion_previa_inefectiva', l: 'Reparacion previa inefectiva' },
  { v: 'otro', l: 'Otro' },
]

const EXP_BTN = { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' }

export default function AvisosMtto() {
  const { perfil, tienePermiso } = useAuth()
  const puedeCrear = tienePermiso('mol_avisos', 'crear')
  const puedeConvertir = tienePermiso('mol_ordenes', 'crear')

  const [avisos, setAvisos] = useState([])
  const [site, setSite] = useState('')
  const [moldes, setMoldes] = useState([])
  const [defectos, setDefectos] = useState([])
  const [maquinas, setMaquinas] = useState([])
  const [turnos, setTurnos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [tipos, setTipos] = useState([])
  const [form, setForm] = useState(null)
  const [loading, setLoading] = useState(true)
  const [proc, setProc] = useState(false)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [filtro, setFiltro] = useState('abiertos')

  useEffect(() => { cargar() }, [site])
  const cargar = async () => {
    const sid = siteEfectivo(perfil, site)
    setLoading(true)
    const emp = perfil.empresa_id
    const [a, mo, de, mq, tu, us, ti] = await Promise.all([
      supabase.from('molde_avisos').select('*, molde:moldes(clave), defecto:causas_scrap(clave, nombre), maquina:maquinas(clave)').eq('empresa_id', emp).order('id', { ascending: false }),
      supabase.from('moldes').select('id, clave, nombre, shots_acumulados, estado').eq('empresa_id', emp).order('clave'),
      supabase.from('causas_scrap').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true),
      (sid ? supabase.from('maquinas').select('id, clave, site_id').eq('empresa_id', emp).eq('site_id', sid) : supabase.from('maquinas').select('id, clave, site_id').eq('empresa_id', emp)),
      supabase.from('turnos').select('*').eq('empresa_id', emp),
      supabase.from('usuarios').select('id, nombre, rol').eq('empresa_id', emp),
      supabase.from('mtto_tipos').select('*').eq('empresa_id', emp).eq('activo', true),
    ])
    setAvisos((a.data || []).filter(x => { if (!sid) return true; const _ids = (mq.data || []).map(z => z.id); return !x.maquina_id || _ids.includes(x.maquina_id) })); setMoldes(mo.data || []); setDefectos(de.data || []); setMaquinas(mq.data || [])
    setTurnos(tu.data || []); setUsuarios(us.data || []); setTipos(ti.data || [])
    setLoading(false)
  }

  const moldeDe = (id) => moldes.find(m => m.id === id)
  const areaDefault = ['calidad', 'gerente_calidad'].includes(perfil?.rol) ? 'calidad' : 'produccion'

  const abrirNuevo = () => { setError(''); setExito(''); setForm({ molde_id: '', area_reporta: areaDefault, defecto_id: '', maquina_id: '', turno_id: '', operador_id: '', causa_probable: '', descripcion: '' }); }

  const crear = async () => {
    setError('')
    if (!form.molde_id) { setError('Selecciona el molde.'); return }
    setProc(true)
    try {
      const folio = `AV-${Date.now().toString().slice(-8)}`
      const { error: e } = await supabase.from('molde_avisos').insert({
        empresa_id: perfil.empresa_id, folio, molde_id: Number(form.molde_id), area_reporta: form.area_reporta,
        reportado_por: perfil.id, defecto_id: form.defecto_id ? Number(form.defecto_id) : null,
        maquina_id: form.maquina_id ? Number(form.maquina_id) : null, turno_id: form.turno_id ? Number(form.turno_id) : null,
        operador_id: form.operador_id || null, causa_probable: form.causa_probable || null, descripcion: form.descripcion || null,
      })
      if (e) throw e
      setExito(`Aviso ${folio} registrado.`); setForm(null); cargar()
    } catch (err) { setError('Error: ' + err.message) }
    setProc(false)
  }

  const convertir = async (a) => {
    setError(''); setExito('')
    if (!window.confirm(`Convertir el aviso ${a.folio} en una orden de mantenimiento correctivo?`)) return
    setProc(true)
    try {
      const tipo = tipos.find(t => t.clase === 'correctivo') || tipos[0]
      const molde = moldeDe(a.molde_id)
      const folio = `MM-${Date.now().toString().slice(-8)}`
      const { data: mm, error: e1 } = await supabase.from('molde_mtto').insert({
        empresa_id: perfil.empresa_id, folio, molde_id: a.molde_id, tipo_id: tipo?.id || null,
        motivo_origen: 'interno', causa: a.causa_probable || 'molde', maquina_id: a.maquina_id,
        turno_id: a.turno_id, operador_id: a.operador_id, descripcion: `Desde aviso ${a.folio}: ${a.descripcion || ''}`.trim(),
        reinicia_contador: !!tipo?.reinicia_contador, shots_al_abrir: Number(molde?.shots_acumulados || 0),
        estatus: 'en_proceso', fecha_inicio: new Date().toISOString(), aviso_id: a.id, creado_por: perfil.id,
      }).select().single()
      if (e1) throw e1
      await supabase.from('moldes').update({ estado: 'en_reparacion' }).eq('id', a.molde_id)
      await supabase.from('molde_avisos').update({ estatus: 'convertido', mtto_id: mm.id }).eq('id', a.id)
      setExito(`Aviso convertido en orden ${folio}. Molde ${molde?.clave} -> en reparacion. Atiendela en Ordenes de Mantenimiento.`)
      cargar()
    } catch (err) { setError('Error al convertir: ' + err.message) }
    setProc(false)
  }

  const descartar = async (a) => {
    if (!window.confirm('Descartar el aviso?')) return
    await supabase.from('molde_avisos').update({ estatus: 'descartado' }).eq('id', a.id)
    cargar()
  }

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  if (form) {
    const operadores = usuarios.filter(u => ['produccion', 'gerente_produccion'].includes(u.rol))
    return (
      <div style={styles.container} className="aparecer">
        <button style={styles.volver} onClick={() => setForm(null)}>&larr; Volver</button>
        <h2 style={styles.titulo}>Nuevo aviso de mantenimiento</h2>
      <div style={{ marginBottom: 10 }} className="no-imprimir"><FiltroSite value={site} onChange={setSite} /></div>
        {error && <p style={styles.error}>{error}</p>}
        <div style={styles.tarjeta}>
          <div style={styles.fila}>
            <Campo label="Molde *"><select style={styles.input} value={form.molde_id} onChange={e => setForm({ ...form, molde_id: e.target.value })}><option value="">Selecciona...</option>{moldes.map(m => <option key={m.id} value={m.id}>{m.clave} - {m.nombre}</option>)}</select></Campo>
            <Campo label="Reporta"><select style={styles.input} value={form.area_reporta} onChange={e => setForm({ ...form, area_reporta: e.target.value })}><option value="produccion">Produccion</option><option value="calidad">Calidad</option></select></Campo>
            <Campo label="Defecto"><select style={styles.input} value={form.defecto_id} onChange={e => setForm({ ...form, defecto_id: e.target.value })}><option value="">Selecciona...</option>{defectos.map(d => <option key={d.id} value={d.id}>{d.clave} - {d.nombre}</option>)}</select></Campo>
          </div>
          <div style={styles.fila}>
            <Campo label="Maquina"><select style={styles.input} value={form.maquina_id} onChange={e => setForm({ ...form, maquina_id: e.target.value })}><option value="">-</option>{maquinas.map(m => <option key={m.id} value={m.id}>{m.clave}</option>)}</select></Campo>
            <Campo label="Turno"><select style={styles.input} value={form.turno_id} onChange={e => setForm({ ...form, turno_id: e.target.value })}><option value="">-</option>{turnos.map(t => <option key={t.id} value={t.id}>{t.nombre || t.clave || t.id}</option>)}</select></Campo>
            <Campo label="Operador"><select style={styles.input} value={form.operador_id} onChange={e => setForm({ ...form, operador_id: e.target.value })}><option value="">-</option>{operadores.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select></Campo>
            <Campo label="Causa probable"><select style={styles.input} value={form.causa_probable} onChange={e => setForm({ ...form, causa_probable: e.target.value })}><option value="">Selecciona...</option>{CAUSAS.map(c => <option key={c.v} value={c.v}>{c.l}</option>)}</select></Campo>
          </div>
          <Campo label="Descripcion del hallazgo"><input style={styles.input} value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} placeholder="Ej. rebaba en cavidad 2 / tiro corto" /></Campo>
          <div style={styles.botones}><button style={styles.botonSec} onClick={() => setForm(null)} disabled={proc}>Cancelar</button><button style={styles.boton} onClick={crear} disabled={proc}>{proc ? 'Guardando...' : 'Registrar aviso'}</button></div>
        </div>
      </div>
    )
  }

  const colsExp = [
    { label: 'Folio', get: a => a.folio }, { label: 'Fecha', get: a => a.fecha || '' },
    { label: 'Molde', get: a => a.molde?.clave || '' }, { label: 'Maquina', get: a => a.maquina?.clave || '' },
    { label: 'Area', get: a => a.area_reporta || '' }, { label: 'Defecto', get: a => a.defecto?.nombre || '' },
    { label: 'Descripcion', get: a => a.descripcion || '' }, { label: 'Causa probable', get: a => a.causa_probable || '' },
    { label: 'Estatus', get: a => a.estatus || '' },
  ]
  const lista = avisos.filter(a => filtro === 'todos' ? true : filtro === 'abiertos' ? ['abierto', 'en_atencion'].includes(a.estatus) : a.estatus === filtro)
  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Avisos de mantenimiento de molde</h2>
      <div style={{ display: 'flex', gap: '8px', margin: '0 0 12px' }} className="no-imprimir">
        <button style={EXP_BTN} onClick={() => exportarExcel('avisos_molde', colsExp, lista)}>Excel</button>
        <button style={EXP_BTN} onClick={() => imprimirTablaPDF('Avisos de Mantenimiento de Molde', colsExp, lista)}>PDF</button>
      </div>
        {puedeCrear && <button style={styles.boton} onClick={abrirNuevo}>Nuevo aviso</button>}
      </div>
      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}
      <div style={styles.tabs}>
        {[['abiertos', 'Abiertos'], ['convertido', 'Convertidos'], ['todos', 'Todos']].map(([id, n]) => (
          <button key={id} style={filtro === id ? styles.tabAct : styles.tab} onClick={() => setFiltro(id)}>{n}</button>
        ))}
      </div>
      <div style={styles.tabla}>
        <div style={styles.th}><span style={{ flex: 1 }}>Folio</span><span style={{ flex: 1 }}>Molde</span><span style={{ flex: 1 }}>Reporta</span><span style={{ flex: 1.4 }}>Defecto</span><span style={{ flex: 1.4 }}>Causa probable</span><span style={{ flex: 0.9 }}>Maquina</span><span style={{ flex: 1 }}>Estatus</span><span style={{ width: '150px' }}></span></div>
        {lista.map(a => (
          <div key={a.id} style={styles.tr}>
            <span style={{ flex: 1, fontWeight: 600 }}>{a.folio}</span>
            <span style={{ flex: 1 }}>{a.molde?.clave}</span>
            <span style={{ flex: 1 }}>{a.area_reporta}</span>
            <span style={{ flex: 1.4, color: '#475569', fontSize: '12px' }}>{a.defecto?.nombre || '-'}</span>
            <span style={{ flex: 1.4, color: '#64748b', fontSize: '12px' }}>{a.causa_probable ? a.causa_probable.replace(/_/g, ' ') : '-'}</span>
            <span style={{ flex: 0.9 }}>{a.maquina?.clave || '-'}</span>
            <span style={{ flex: 1 }}><span style={badge(a.estatus)}>{a.estatus.replace(/_/g, ' ')}</span></span>
            <span style={{ width: '150px', textAlign: 'right', display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
              {['abierto', 'en_atencion'].includes(a.estatus) && puedeConvertir && <button style={styles.botonMini} onClick={() => convertir(a)} disabled={proc}>A mtto</button>}
              {['abierto', 'en_atencion'].includes(a.estatus) && <button style={styles.botonMiniSec} onClick={() => descartar(a)} disabled={proc}>Descartar</button>}
            </span>
          </div>
        ))}
        {lista.length === 0 && <div style={styles.vacio}>Sin avisos.</div>}
      </div>
    </div>
  )
}

function Campo({ label, children }) { return (<div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1, minWidth: '160px' }}><label style={{ fontSize: '12px', fontWeight: 500, color: '#444' }}>{label}</label>{children}</div>) }
function badge(s) { const c = { abierto: ['#fef3c7', '#b45309'], en_atencion: ['#dbeafe', '#2563eb'], convertido: ['#ede9fe', '#7c3aed'], cerrado: ['#dcfce7', '#15803d'], descartado: ['#e2e8f0', '#475569'] }[s] || ['#f1f5f9', '#64748b']; return { padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 600, backgroundColor: c[0], color: c[1] } }

const styles = {
  container: { padding: '28px', maxWidth: '1080px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: 0 },
  volver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '14px' },
  tarjeta: { backgroundColor: '#fff', borderRadius: '10px', padding: '18px 20px', marginBottom: '14px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  fila: { display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '10px' },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '8px' },
  boton: { padding: '9px 18px', backgroundColor: '#a16207', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 18px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonMini: { padding: '5px 10px', backgroundColor: '#a16207', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  botonMiniSec: { padding: '5px 10px', backgroundColor: '#fff', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '14px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#a16207', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #a16207' },
  tabla: { border: '1px solid #eef2f7', borderRadius: '8px', overflow: 'hidden' },
  th: { display: 'flex', padding: '9px 14px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '11px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '10px 14px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  vacio: { padding: '12px 14px', color: '#94a3b8', fontSize: '13px' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
