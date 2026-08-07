import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import { cargarRoles } from '../../lib/roles'

// ROLES, PUESTOS Y AREAS
//
// Tres cosas que se confundian en un solo campo de texto y que aqui viven
// separadas, porque responden preguntas distintas:
//
//   PUESTO  -> quien eres. Jefe de Moldes, Lider, Coordinador. Dato de RH,
//              descriptivo. No da ni quita permisos.
//   AREA    -> donde trabajas. Sirve para agrupar consumo, no conformidades y
//              costo, y para colgarle centro de costo y cuenta de gasto.
//   ROL     -> que puedes ver y hacer en el sistema.
//
// La regla que conviene sostener: los roles deben ser POCOS y por FUNCION, no
// por nivel. Un Lider y un Coordinador de Produccion necesitan exactamente los
// mismos permisos; lo que los distingue es el puesto y el nivel, no el acceso.
// Si cada nivel fuera un rol, cada modulo nuevo obligaria a decidir permisos
// siete veces en lugar de una, y casi todas las decisiones serian copias.
//
// Quien aprueba a quien NO se decide aqui: vive en el jefe de cada usuario.

const rolVacio = {
  clave: '', nombre: '', descripcion: '', nivel: 1,
  es_gerencial: false, omite_aprobacion: false, orden: 100,
}
const puestoVacio = { clave: '', nombre: '', nivel: 1, area_id: '', notas: '' }

export default function RolesPuestos() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('config_roles', 'crear') || tienePermiso('config_roles', 'editar')

  const [tab, setTab] = useState('roles')
  const [roles, setRoles] = useState([])
  const [puestos, setPuestos] = useState([])
  const [niveles, setNiveles] = useState([])
  const [areas, setAreas] = useState([])
  const [usoRol, setUsoRol] = useState({})
  const [usoPuesto, setUsoPuesto] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  const [formRol, setFormRol] = useState(null)
  const [clonarDe, setClonarDe] = useState('')
  const [formPuesto, setFormPuesto] = useState(null)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true); setError('')
    const [r, p, n, a, u] = await Promise.all([
      supabase.from('roles').select('*').order('orden'),
      supabase.from('puestos').select('*').eq('empresa_id', emp).order('nivel').order('nombre'),
      supabase.from('niveles_jerarquicos').select('*').order('orden'),
      supabase.from('areas').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true).order('clave'),
      supabase.from('usuarios').select('rol, puesto_id').eq('empresa_id', emp),
    ])
    setRoles(r.data || []); setPuestos(p.data || []); setNiveles(n.data || []); setAreas(a.data || [])

    const ur = {}, up = {}
    ;(u.data || []).forEach(x => {
      ur[x.rol] = (ur[x.rol] || 0) + 1
      if (x.puesto_id) up[x.puesto_id] = (up[x.puesto_id] || 0) + 1
    })
    setUsoRol(ur); setUsoPuesto(up)

    // Conteo de modulos por rol
    const { data: pr } = await supabase.from('permisos_rol').select('rol')
    const cnt = {}
    ;(pr || []).forEach(x => { cnt[x.rol] = (cnt[x.rol] || 0) + 1 })
    setRoles((r.data || []).map(x => ({ ...x, modulos: cnt[x.clave] || 0 })))
    setLoading(false)
  }

  // ---------- Roles ----------
  const guardarRol = async () => {
    setError(''); setExito('')
    if (!formRol.clave || !formRol.nombre) { setError('La clave y el nombre son obligatorios'); return }
    const clave = formRol.clave.toLowerCase().replace(/[^a-z0-9_]/g, '_')
    const payload = {
      clave, nombre: formRol.nombre, descripcion: formRol.descripcion || null,
      nivel: Number(formRol.nivel) || 1,
      es_gerencial: !!formRol.es_gerencial, omite_aprobacion: !!formRol.omite_aprobacion,
      orden: Number(formRol.orden) || 100,
    }
    if (formRol.editando) {
      const { error: e } = await supabase.from('roles').update(payload).eq('clave', formRol.editando)
      if (e) { setError('No se pudo guardar: ' + e.message); return }
    } else {
      const { error: e } = await supabase.from('roles').insert(payload)
      if (e) {
        setError(e.message.includes('duplicate')
          ? `Ya existe un rol con la clave ${clave}`
          : 'No se pudo guardar: ' + e.message)
        return
      }
      // Clonar permisos: sin esto el rol nace sin acceso a nada y habria que
      // palomear ochenta modulos a mano antes de que sirva.
      if (clonarDe) {
        const { data: base } = await supabase.from('permisos_rol').select('*').eq('rol', clonarDe)
        if (base && base.length) {
          await supabase.from('permisos_rol').insert(base.map(b => ({
            rol: clave, modulo_id: b.modulo_id,
            puede_ver: b.puede_ver, puede_crear: b.puede_crear, puede_editar: b.puede_editar,
            puede_eliminar: b.puede_eliminar, puede_aprobar: b.puede_aprobar,
          })))
        }
      }
    }
    setFormRol(null); setClonarDe('')
    setExito(formRol.editando ? 'Rol actualizado' : 'Rol creado. Ajusta sus permisos en Permisos por Rol.')
    await cargarRoles(true); cargar()
  }

  const toggleRol = async (r, campo) => {
    const { error: e } = await supabase.from('roles').update({ [campo]: !r[campo] }).eq('clave', r.clave)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    await cargarRoles(true); cargar()
  }

  const borrarRol = async (r) => {
    if (r.del_sistema) { setError(`${r.nombre} es un rol base del sistema y no se puede borrar. Si no lo usas, desactivalo.`); return }
    if (usoRol[r.clave]) { setError(`${r.nombre} lo tienen ${usoRol[r.clave]} usuario(s). Cambialos de rol antes de borrarlo.`); return }
    if (!confirm(`Se va a borrar el rol ${r.nombre} y sus permisos. Confirma para continuar.`)) return
    const { error: e } = await supabase.from('roles').delete().eq('clave', r.clave)
    if (e) { setError('No se pudo borrar: ' + e.message); return }
    setExito('Rol borrado'); await cargarRoles(true); cargar()
  }

  // ---------- Puestos ----------
  const guardarPuesto = async () => {
    setError(''); setExito('')
    if (!formPuesto.clave || !formPuesto.nombre) { setError('La clave y el nombre son obligatorios'); return }
    const payload = {
      empresa_id: emp, clave: formPuesto.clave.toUpperCase(), nombre: formPuesto.nombre,
      nivel: Number(formPuesto.nivel) || 1,
      area_id: formPuesto.area_id ? Number(formPuesto.area_id) : null,
      notas: formPuesto.notas || null,
    }
    const r = formPuesto.id
      ? await supabase.from('puestos').update(payload).eq('id', formPuesto.id)
      : await supabase.from('puestos').insert(payload)
    if (r.error) {
      setError(r.error.message.includes('duplicate')
        ? `Ya existe un puesto con la clave ${payload.clave}` : 'No se pudo guardar: ' + r.error.message)
      return
    }
    setFormPuesto(null); setExito('Puesto guardado'); cargar()
  }

  const togglePuesto = async (p) => {
    const { error: e } = await supabase.from('puestos').update({ activo: !p.activo }).eq('id', p.id)
    if (e) { setError('No se pudo guardar: ' + e.message); return }
    cargar()
  }

  const nivelNombre = (n) => niveles.find(x => x.nivel === n)?.nombre || n

  return (
    <div style={S.wrap}>
      <h2 style={S.h2}>Roles y puestos</h2>
      <p style={S.sub}>
        El <b>puesto</b> dice quien eres y el <b>rol</b> dice que puedes hacer. Se separan a
        proposito: un Lider y un Coordinador de Produccion necesitan los mismos permisos, y lo que
        los distingue es el puesto y su nivel, no el acceso. Quien aprueba a quien no se decide
        aqui, sale del jefe de cada usuario.
      </p>

      <div style={S.tabs}>
        {[['roles', `Roles del sistema (${roles.length})`], ['puestos', `Puestos (${puestos.length})`]].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => setTab(id)}>{n}</button>
        ))}
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      {/* ================= ROLES ================= */}
      {tab === 'roles' && (
        <>
          <p style={S.nota}>
            Antes de crear un rol nuevo, pregunta si de verdad necesita <b>ver modulos distintos</b>.
            Si solo cambia el nivel jerarquico, eso es un puesto, no un rol. Cada rol nuevo hay que
            mantenerlo cada vez que se agregue un modulo.
          </p>

          {formRol && (
            <div style={S.card}>
              <p style={S.cardTit}>{formRol.editando ? 'Editar rol' : 'Nuevo rol'}</p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Clave *</label>
                  <input style={S.input} value={formRol.clave} disabled={!!formRol.editando}
                    onChange={e => setFormRol({ ...formRol, clave: e.target.value })}
                    placeholder="gerente_rh" />
                  <span style={S.ayuda}>Sin espacios ni acentos. No se puede cambiar despues.</span>
                </div>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Nombre *</label>
                  <input style={S.input} value={formRol.nombre}
                    onChange={e => setFormRol({ ...formRol, nombre: e.target.value })}
                    placeholder="Gerente de Recursos Humanos" />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Nivel</label>
                  <select style={S.input} value={formRol.nivel}
                    onChange={e => setFormRol({ ...formRol, nivel: e.target.value })}>
                    {niveles.map(n => <option key={n.nivel} value={n.nivel}>{n.nombre}</option>)}
                  </select>
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Orden en la lista</label>
                  <input type="number" style={S.input} value={formRol.orden}
                    onChange={e => setFormRol({ ...formRol, orden: e.target.value })} />
                </div>
              </div>
              <div style={S.fila}>
                <div style={{ ...S.campo, flex: 3 }}>
                  <label style={S.label}>Descripcion</label>
                  <input style={S.input} value={formRol.descripcion}
                    onChange={e => setFormRol({ ...formRol, descripcion: e.target.value })} />
                </div>
                {!formRol.editando && (
                  <div style={{ ...S.campo, flex: 2 }}>
                    <label style={S.label}>Copiar permisos de</label>
                    <select style={S.input} value={clonarDe} onChange={e => setClonarDe(e.target.value)}>
                      <option value="">Empezar sin permisos</option>
                      {roles.map(r => <option key={r.clave} value={r.clave}>{r.nombre} ({r.modulos} modulos)</option>)}
                    </select>
                    <span style={S.ayuda}>
                      Casi siempre conviene copiar de un rol parecido y quitarle lo que sobre.
                    </span>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                <label style={S.check}>
                  <input type="checkbox" checked={!!formRol.es_gerencial}
                    onChange={e => setFormRol({ ...formRol, es_gerencial: e.target.checked })} />
                  <span>Puede ser jefe que aprueba requisiciones</span>
                </label>
                <label style={S.check}>
                  <input type="checkbox" checked={!!formRol.omite_aprobacion}
                    onChange={e => setFormRol({ ...formRol, omite_aprobacion: e.target.checked })} />
                  <span>Su requisicion se va directo a compras, sin firma</span>
                </label>
              </div>
              <div style={S.acciones}>
                <button style={S.botonSec} onClick={() => { setFormRol(null); setClonarDe('') }}>Cancelar</button>
                <button style={S.boton} onClick={guardarRol}>Guardar</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={S.cardHead}>
              <p style={S.cardTit}>Roles</p>
              {puedeEditar && !formRol && (
                <button style={S.boton} onClick={() => { setFormRol({ ...rolVacio }); setError('') }}>+ Nuevo rol</button>
              )}
            </div>
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Rol</th><th style={S.th}>Clave</th><th style={S.th}>Nivel</th>
                  <th style={S.thR}>Usuarios</th><th style={S.thR}>Modulos</th>
                  <th style={S.th}>Aprueba</th><th style={S.th}>Sin firma</th>
                  <th style={S.th}>Activo</th><th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {roles.map(r => (
                  <tr key={r.clave} style={r.activo ? {} : { opacity: 0.5 }}>
                    <td style={{ ...S.td, fontWeight: 600 }}>
                      {r.nombre}
                      {r.del_sistema && <span style={S.tagGris}>base</span>}
                      {r.descripcion && <div style={S.mini}>{r.descripcion}</div>}
                    </td>
                    <td style={S.td}><code style={S.code}>{r.clave}</code></td>
                    <td style={S.td}>{r.nivel ? nivelNombre(r.nivel) : '-'}</td>
                    <td style={S.tdR}>{usoRol[r.clave] || 0}</td>
                    <td style={{ ...S.tdR, color: r.modulos === 0 ? '#b91c1c' : '#1a1a2e' }}>{r.modulos}</td>
                    <td style={S.td}>
                      <input type="checkbox" disabled={!puedeEditar} checked={!!r.es_gerencial}
                        onChange={() => toggleRol(r, 'es_gerencial')} />
                    </td>
                    <td style={S.td}>
                      <input type="checkbox" disabled={!puedeEditar} checked={!!r.omite_aprobacion}
                        onChange={() => toggleRol(r, 'omite_aprobacion')} />
                    </td>
                    <td style={S.td}>
                      <input type="checkbox" disabled={!puedeEditar} checked={!!r.activo}
                        onChange={() => toggleRol(r, 'activo')} />
                    </td>
                    <td style={S.td}>
                      {puedeEditar && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button style={S.btnMini} onClick={() => { setFormRol({ ...r, editando: r.clave }); setError('') }}>Editar</button>
                          {!r.del_sistema && <button style={S.btnMiniSec} onClick={() => borrarRol(r)}>Borrar</button>}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={S.ayuda}>
              <b>Aprueba</b> significa que puede aparecer como jefe en la cadena de compras.
              <b> Sin firma</b> significa que su propia requisicion se va directo a compras.
              Un rol con cero modulos no puede hacer nada: asignale permisos en Permisos por Rol.
            </p>
          </div>
        </>
      )}

      {/* ================= PUESTOS ================= */}
      {tab === 'puestos' && (
        <>
          {formPuesto && (
            <div style={S.card}>
              <p style={S.cardTit}>{formPuesto.id ? 'Editar puesto' : 'Nuevo puesto'}</p>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Clave *</label>
                  <input style={S.input} maxLength={12} value={formPuesto.clave}
                    onChange={e => setFormPuesto({ ...formPuesto, clave: e.target.value.toUpperCase() })} />
                </div>
                <div style={{ ...S.campo, flex: 3 }}>
                  <label style={S.label}>Nombre *</label>
                  <input style={S.input} value={formPuesto.nombre}
                    onChange={e => setFormPuesto({ ...formPuesto, nombre: e.target.value })}
                    placeholder="Jefe de Moldes" />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Nivel</label>
                  <select style={S.input} value={formPuesto.nivel}
                    onChange={e => setFormPuesto({ ...formPuesto, nivel: e.target.value })}>
                    {niveles.map(n => <option key={n.nivel} value={n.nivel}>{n.nombre}</option>)}
                  </select>
                </div>
                <div style={{ ...S.campo, flex: 1.5 }}>
                  <label style={S.label}>Area tipica</label>
                  <select style={S.input} value={formPuesto.area_id}
                    onChange={e => setFormPuesto({ ...formPuesto, area_id: e.target.value })}>
                    <option value="">Cualquiera</option>
                    {areas.map(a => <option key={a.id} value={a.id}>{a.clave} - {a.nombre}</option>)}
                  </select>
                </div>
              </div>
              <div style={S.acciones}>
                <button style={S.botonSec} onClick={() => setFormPuesto(null)}>Cancelar</button>
                <button style={S.boton} onClick={guardarPuesto}>Guardar</button>
              </div>
            </div>
          )}

          <div style={S.card}>
            <div style={S.cardHead}>
              <p style={S.cardTit}>Puestos por nivel</p>
              {puedeEditar && !formPuesto && (
                <button style={S.boton} onClick={() => { setFormPuesto({ ...puestoVacio }); setError('') }}>+ Nuevo puesto</button>
              )}
            </div>
            <table style={S.tabla}>
              <thead>
                <tr>
                  <th style={S.th}>Nivel</th><th style={S.th}>Puesto</th><th style={S.th}>Clave</th>
                  <th style={S.th}>Area tipica</th><th style={S.thR}>Usuarios</th><th style={S.th}>Activo</th>
                  <th style={S.th}></th>
                </tr>
              </thead>
              <tbody>
                {puestos.map(p => (
                  <tr key={p.id} style={p.activo ? {} : { opacity: 0.5 }}>
                    <td style={S.td}>{nivelNombre(p.nivel)}</td>
                    <td style={{ ...S.td, fontWeight: 600 }}>{p.nombre}</td>
                    <td style={S.td}><code style={S.code}>{p.clave}</code></td>
                    <td style={S.td}>{areas.find(a => a.id === p.area_id)?.nombre || '-'}</td>
                    <td style={S.tdR}>{usoPuesto[p.id] || 0}</td>
                    <td style={S.td}>
                      <input type="checkbox" disabled={!puedeEditar} checked={!!p.activo}
                        onChange={() => togglePuesto(p)} />
                    </td>
                    <td style={S.td}>
                      {puedeEditar && (
                        <button style={S.btnMini} onClick={() => setFormPuesto({
                          id: p.id, clave: p.clave, nombre: p.nombre, nivel: p.nivel,
                          area_id: p.area_id || '', notas: p.notas || '',
                        })}>Editar</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  h2: { fontSize: 20, color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: 13, margin: '4px 0 14px', maxWidth: 860, lineHeight: 1.5 },
  tabs: { display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' },
  tab: { padding: '8px 15px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  tabAct: { padding: '8px 15px', background: '#1e3a8a', color: '#fff', border: '1px solid #1e3a8a', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: '15px 17px', marginBottom: 13 },
  cardHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 10 },
  cardTit: { fontSize: 14, fontWeight: 600, color: '#1a1a2e', margin: '0 0 4px' },
  nota: { background: '#f0f9ff', border: '1px solid #bae6fd', borderRadius: 8, padding: '10px 12px', fontSize: 12.5, color: '#075985', marginBottom: 13, lineHeight: 1.55 },
  fila: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: 5, flex: 1, minWidth: 140, marginBottom: 8 },
  label: { fontSize: 12, color: '#444', fontWeight: 500 },
  input: { padding: '9px 11px', borderRadius: 7, border: '1px solid #ddd', fontSize: 13.5, outline: 'none', background: '#fff', width: '100%', boxSizing: 'border-box' },
  ayuda: { fontSize: 11.5, color: '#64748b', lineHeight: 1.45, margin: '6px 0 0' },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#444', margin: '6px 0' },
  acciones: { display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 },
  boton: { padding: '8px 17px', background: '#1e3a8a', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, cursor: 'pointer', fontWeight: 500 },
  botonSec: { padding: '8px 17px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  btnMini: { padding: '4px 10px', background: '#1e3a8a', color: '#fff', border: 'none', borderRadius: 6, fontSize: 11.5, cursor: 'pointer' },
  btnMiniSec: { padding: '4px 10px', background: '#fff', color: '#b91c1c', border: '1px solid #fecaca', borderRadius: 6, fontSize: 11.5, cursor: 'pointer' },
  err: { color: '#b91c1c', fontSize: 13, margin: '0 0 10px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '9px 12px', lineHeight: 1.5 },
  ok: { color: '#15803d', fontSize: 13, margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: 13 },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 },
  th: { textAlign: 'left', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  thR: { textAlign: 'right', padding: '8px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.03em', whiteSpace: 'nowrap' },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  tdR: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e', textAlign: 'right' },
  mini: { fontSize: 10.5, color: '#64748b', marginTop: 2 },
  code: { fontSize: 11, background: '#f1f5f9', padding: '1px 5px', borderRadius: 4, color: '#475569' },
  tagGris: { fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20, background: '#e5e7eb', color: '#374151', marginLeft: 6 },
}
