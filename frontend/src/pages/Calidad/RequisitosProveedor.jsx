import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'

// Requisitos de calidad por articulo-proveedor (los administra Calidad/SQA).
// Define si requiere certificado de calidad por entrega y si requiere PPAP con su vigencia.
// Tambien autoriza desviaciones de PPAP (permiten recibir con PPAP vencido/faltante).

const fmtFecha = (f) => f ? new Date(f + 'T00:00:00').toLocaleDateString('es-MX') : '-'
const hoy = () => new Date().toISOString().split('T')[0]

export default function RequisitosProveedor() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('cal_requisitos_prov', 'editar')

  const [vista, setVista] = useState('requisitos')
  const [rels, setRels] = useState([])
  const [articulos, setArticulos] = useState([])
  const [proveedores, setProveedores] = useState([])
  const [desviaciones, setDesviaciones] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [texto, setTexto] = useState('')
  const [edit, setEdit] = useState(null) // rel en edicion
  const [desv, setDesv] = useState(null) // nueva desviacion

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [r, a, p, d] = await Promise.all([
      supabase.from('articulo_proveedor').select('*').eq('activo', true),
      supabase.from('articulos').select('id, codigo_interno, descripcion').eq('empresa_id', perfil.empresa_id),
      supabase.from('proveedores').select('id, nombre'),
      supabase.from('desviaciones_ppap').select('*, autorizador:usuarios!desviaciones_ppap_autorizado_por_fkey(nombre)').order('created_at', { ascending: false }),
    ])
    setRels(r.data || [])
    setArticulos(a.data || [])
    setProveedores(p.data || [])
    setDesviaciones(d.data || [])
    setLoading(false)
  }

  const artDe = (id) => articulos.find(a => a.id === id)
  const provDe = (id) => proveedores.find(p => p.id === id)

  const guardar = async () => {
    setError(''); setExito('')
    const { error: e1 } = await supabase.from('articulo_proveedor').update({
      requiere_certificado: edit.requiere_certificado,
      requiere_ppap: edit.requiere_ppap,
      ppap_vigencia: edit.ppap_vigencia || null,
    }).eq('id', edit.id)
    if (e1) { setError('Error: ' + e1.message); return }
    setExito('Requisitos actualizados')
    setEdit(null)
    await cargarDatos()
  }

  const guardarDesviacion = async () => {
    setError(''); setExito('')
    if (!desv.motivo.trim() || !desv.vigente_hasta) { setError('Motivo y vigencia son obligatorios'); return }
    const rel = rels.find(r => r.id === Number(desv.rel_id))
    const { error: e1 } = await supabase.from('desviaciones_ppap').insert({
      empresa_id: perfil.empresa_id, articulo_id: rel.articulo_id, proveedor_id: rel.proveedor_id,
      motivo: desv.motivo.trim(), vigente_hasta: desv.vigente_hasta, autorizado_por: perfil.id,
    })
    if (e1) { setError('Error: ' + e1.message); return }
    setExito('Desviacion autorizada')
    setDesv(null)
    await cargarDatos()
  }

  const revocarDesviacion = async (d) => {
    await supabase.from('desviaciones_ppap').update({ activo: false }).eq('id', d.id)
    await cargarDatos()
  }

  const estadoPPAP = (rel) => {
    if (!rel.requiere_ppap) return { txt: 'No requiere', color: '#64748b' }
    if (!rel.ppap_vigencia) return { txt: 'Falta PPAP', color: '#dc2626' }
    if (rel.ppap_vigencia < hoy()) return { txt: `Vencido ${fmtFecha(rel.ppap_vigencia)}`, color: '#dc2626' }
    return { txt: `Vigente a ${fmtFecha(rel.ppap_vigencia)}`, color: '#16a34a' }
  }

  const filas = rels.map(r => ({ ...r, _art: artDe(r.articulo_id), _prov: provDe(r.proveedor_id) }))
    .filter(r => r._art && r._prov)
    .filter(r => {
      if (!texto) return true
      const t = texto.toLowerCase()
      return r._art.codigo_interno.toLowerCase().includes(t) || r._art.descripcion.toLowerCase().includes(t) || r._prov.nombre.toLowerCase().includes(t)
    })
    .sort((a, b) => a._art.codigo_interno.localeCompare(b._art.codigo_interno))

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Requisitos de Proveedor</h2>
      </div>
      <div style={styles.tabs}>
        {[['requisitos', 'Requisitos por articulo-proveedor'], ['desviaciones', `Desviaciones PPAP${desviaciones.filter(d => d.activo && d.vigente_hasta >= hoy()).length ? ` (${desviaciones.filter(d => d.activo && d.vigente_hasta >= hoy()).length})` : ''}`]].map(([id, n]) => (
          <button key={id} style={vista === id ? styles.tabActiva : styles.tab} onClick={() => setVista(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      {vista === 'requisitos' && (
        <>
          <div style={styles.filtros}>
            <input style={{ ...styles.input, flex: 1 }} placeholder="Buscar articulo o proveedor..." value={texto} onChange={e => setTexto(e.target.value)} />
          </div>
          {filas.length === 0 ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>No hay relaciones articulo-proveedor. Se dan de alta al asignar proveedores a los articulos comprados.</p>
          ) : (
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 2.2 }}>Articulo</span>
                <span style={{ flex: 1.4 }}>Proveedor</span>
                <span style={{ flex: 0.9, textAlign: 'center' }}>Certificado</span>
                <span style={{ flex: 0.8, textAlign: 'center' }}>PPAP</span>
                <span style={{ flex: 1.3 }}>Estado PPAP</span>
                <span style={{ width: '90px' }}></span>
              </div>
              {filas.map(r => {
                const est = estadoPPAP(r)
                return (
                  <div key={r.id} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
                    <span style={{ flex: 2.2 }}><b>{r._art.codigo_interno}</b> <span style={{ color: '#64748b' }}>- {r._art.descripcion}</span></span>
                    <span style={{ flex: 1.4 }}>{r._prov.nombre}</span>
                    <span style={{ flex: 0.9, textAlign: 'center' }}>{r.requiere_certificado ? <span style={{ ...styles.badge, ...styles.badgeAzul }}>Si</span> : <span style={{ color: '#94a3b8' }}>No</span>}</span>
                    <span style={{ flex: 0.8, textAlign: 'center' }}>{r.requiere_ppap ? <span style={{ ...styles.badge, ...styles.badgeAzul }}>Si</span> : <span style={{ color: '#94a3b8' }}>No</span>}</span>
                    <span style={{ flex: 1.3, color: est.color, fontWeight: '500' }}>{est.txt}</span>
                    <span style={{ width: '90px', textAlign: 'right' }}>
                      {puedeEditar && <button style={styles.botonAccion} onClick={() => setEdit({ ...r })}>Editar</button>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {vista === 'desviaciones' && (
        <>
          {puedeEditar && (
            <div style={{ marginBottom: '16px' }}>
              <button style={styles.boton} onClick={() => setDesv({ rel_id: '', motivo: '', vigente_hasta: '' })}>+ Autorizar desviacion</button>
            </div>
          )}
          {desviaciones.length === 0 ? (
            <p style={{ color: '#666', padding: '10px 4px' }}>No hay desviaciones autorizadas.</p>
          ) : (
            <div style={styles.tabla}>
              <div style={styles.tablaHeader}>
                <span style={{ flex: 2 }}>Articulo</span>
                <span style={{ flex: 1.3 }}>Proveedor</span>
                <span style={{ flex: 2 }}>Motivo</span>
                <span style={{ flex: 1 }}>Vigente hasta</span>
                <span style={{ flex: 1.2 }}>Autorizo</span>
                <span style={{ flex: 0.9, textAlign: 'center' }}>Estatus</span>
                <span style={{ width: '90px' }}></span>
              </div>
              {desviaciones.map(d => {
                const vig = d.activo && d.vigente_hasta >= hoy()
                return (
                  <div key={d.id} style={{ ...styles.tablaFila, fontSize: '13px' }} className="fila-hover">
                    <span style={{ flex: 2 }}>{artDe(d.articulo_id)?.codigo_interno}</span>
                    <span style={{ flex: 1.3 }}>{provDe(d.proveedor_id)?.nombre}</span>
                    <span style={{ flex: 2, color: '#64748b' }}>{d.motivo}</span>
                    <span style={{ flex: 1 }}>{fmtFecha(d.vigente_hasta)}</span>
                    <span style={{ flex: 1.2, color: '#64748b' }}>{d.autorizador?.nombre}</span>
                    <span style={{ flex: 0.9, textAlign: 'center' }}>
                      <span style={{ ...styles.badge, ...(vig ? styles.badgeVerde : styles.badgeGris) }}>{vig ? 'Vigente' : (d.activo ? 'Vencida' : 'Revocada')}</span>
                    </span>
                    <span style={{ width: '90px', textAlign: 'right' }}>
                      {puedeEditar && vig && <button style={styles.botonAccion} onClick={() => revocarDesviacion(d)}>Revocar</button>}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Modal editar requisitos */}
      {edit && (
        <div style={styles.overlay} onClick={() => setEdit(null)}>
          <div style={styles.modal} onClick={ev => ev.stopPropagation()}>
            <h3 style={styles.formTitulo}>Requisitos: {artDe(edit.articulo_id)?.codigo_interno} / {provDe(edit.proveedor_id)?.nombre}</h3>
            <label style={styles.check}>
              <input type="checkbox" checked={edit.requiere_certificado} onChange={e => setEdit({ ...edit, requiere_certificado: e.target.checked })} />
              Requiere certificado de calidad en cada entrega
            </label>
            <label style={styles.check}>
              <input type="checkbox" checked={edit.requiere_ppap} onChange={e => setEdit({ ...edit, requiere_ppap: e.target.checked })} />
              Requiere PPAP aprobado
            </label>
            {edit.requiere_ppap && (
              <div style={{ ...styles.campo, marginTop: '10px' }}>
                <label style={styles.label}>Vigencia del PPAP</label>
                <input type="date" style={styles.input} value={edit.ppap_vigencia || ''} onChange={e => setEdit({ ...edit, ppap_vigencia: e.target.value })} />
              </div>
            )}
            <div style={{ ...styles.botones, marginTop: '20px' }}>
              <button style={styles.botonSec} onClick={() => setEdit(null)}>Cancelar</button>
              <button style={styles.boton} onClick={guardar}>Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nueva desviacion */}
      {desv && (
        <div style={styles.overlay} onClick={() => setDesv(null)}>
          <div style={styles.modal} onClick={ev => ev.stopPropagation()}>
            <h3 style={styles.formTitulo}>Autorizar desviacion de PPAP</h3>
            <div style={{ ...styles.campo, marginBottom: '12px' }}>
              <label style={styles.label}>Articulo - proveedor *</label>
              <select style={styles.input} value={desv.rel_id} onChange={e => setDesv({ ...desv, rel_id: e.target.value })}>
                <option value="">Selecciona...</option>
                {filas.map(r => <option key={r.id} value={r.id}>{r._art.codigo_interno} - {r._prov.nombre}</option>)}
              </select>
            </div>
            <div style={{ ...styles.campo, marginBottom: '12px' }}>
              <label style={styles.label}>Motivo de la desviacion *</label>
              <input style={styles.input} value={desv.motivo} onChange={e => setDesv({ ...desv, motivo: e.target.value })} placeholder="Ej. PPAP en renovacion, entrega urgente autorizada" />
            </div>
            <div style={{ ...styles.campo, marginBottom: '12px' }}>
              <label style={styles.label}>Vigente hasta *</label>
              <input type="date" style={styles.input} value={desv.vigente_hasta} onChange={e => setDesv({ ...desv, vigente_hasta: e.target.value })} />
            </div>
            <div style={styles.botones}>
              <button style={styles.botonSec} onClick={() => setDesv(null)}>Cancelar</button>
              <button style={styles.boton} onClick={guardarDesviacion}>Autorizar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  tabs: { display: 'flex', gap: '4px', marginBottom: '16px', borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActiva: { padding: '8px 16px', border: 'none', backgroundColor: 'transparent', fontSize: '14px', color: '#b91c1c', fontWeight: '600', cursor: 'pointer', borderBottom: '2px solid #b91c1c' },
  filtros: { display: 'flex', gap: '10px', marginBottom: '16px', backgroundColor: '#fff', borderRadius: '10px', padding: '14px 20px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', alignItems: 'center' },
  input: { padding: '8px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', outline: 'none', fontFamily: 'inherit', backgroundColor: '#fff' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  check: { display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', cursor: 'pointer', padding: '6px 0' },
  botones: { display: 'flex', justifyContent: 'flex-end', gap: '10px' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  botonAccion: { padding: '4px 10px', backgroundColor: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: '5px', fontSize: '12px', cursor: 'pointer' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '11px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  overlay: { position: 'fixed', inset: 0, backgroundColor: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 },
  modal: { backgroundColor: '#fff', borderRadius: '12px', padding: '28px', width: '520px', maxWidth: '92vw', boxShadow: '0 10px 40px rgba(0,0,0,0.2)' },
  formTitulo: { fontSize: '15px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 16px 0' },
  badge: { padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '600' },
  badgeVerde: { backgroundColor: '#dcfce7', color: '#16a34a' },
  badgeAzul: { backgroundColor: '#dbeafe', color: '#2563eb' },
  badgeGris: { backgroundColor: '#f1f5f9', color: '#64748b' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
