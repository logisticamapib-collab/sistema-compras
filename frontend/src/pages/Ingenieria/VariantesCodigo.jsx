import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'

// Catalogo de variantes de codigo.
//
// El cliente manda la misma pieza a distintos paises o plataformas y pide que
// le facturemos codigos distintos. La A del molde 1 nos la piden como A1 y
// como A2: misma geometria, mismo material, mismo color. Solo cambia el codigo
// y, a veces, el empaque.
//
// Sin esto el sistema creia que A1 y A2 salian del mismo disparo y las
// programaba juntas. Son corridas separadas.
//
// A diferencia del color, el cambio NO cuesta purga: no se toca el material,
// solo se cambia la documentacion del puesto. Por eso los minutos arrancan en
// cero. Se dejan capturables porque cuando ademas cambia el empaque -- otro
// contenedor, otra tarima -- eso si toma tiempo real, y esos minutos se cobran
// como setup en la programacion a capacidad finita.

const vacio = { clave: '', nombre: '', descripcion: '', minutos_cambio: 0, activo: true }

export default function VariantesCodigo() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('ing_variantes_codigo', 'editar') || tienePermiso('ing_variantes_codigo', 'crear')

  const [variantes, setVariantes] = useState([])
  const [moldes, setMoldes] = useState([])
  const [form, setForm] = useState(null)
  const [editando, setEditando] = useState(null)
  const [tab, setTab] = useState('catalogo')
  const [moldeSel, setMoldeSel] = useState('')
  const [uso, setUso] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    // Ojo: el orden de las variables sigue el orden de las consultas.
    const [rVar, rMol] = await Promise.all([
      supabase.from('variantes_codigo').select('*').eq('empresa_id', emp).order('clave'),
      supabase.from('moldes').select('id, clave, nombre').eq('empresa_id', emp).eq('activo', true).order('clave'),
    ])
    setVariantes(rVar.data || [])
    setMoldes(rMol.data || [])
    setLoading(false)
  }

  const guardar = async () => {
    setError(''); setExito('')
    if (!form.clave || !form.nombre) { setError('Clave y nombre son obligatorios'); return }
    const min = Number(form.minutos_cambio)
    if (isNaN(min) || min < 0) { setError('Los minutos de cambio deben ser un numero positivo o cero'); return }

    const payload = {
      empresa_id: emp,
      clave: form.clave.toUpperCase(),
      nombre: form.nombre,
      descripcion: form.descripcion || null,
      minutos_cambio: min,
      activo: !!form.activo,
    }
    const r = editando
      ? await supabase.from('variantes_codigo').update(payload).eq('id', editando.id)
      : await supabase.from('variantes_codigo').insert(payload)
    if (r.error) {
      setError(r.error.message.includes('duplicate')
        ? `Ya existe una variante con la clave ${payload.clave}`
        : 'No se pudo guardar: ' + r.error.message)
      return
    }
    setForm(null); setEditando(null); setExito('Variante guardada'); cargar()
    setTimeout(() => setExito(''), 3000)
  }

  const verUso = async (moldeId) => {
    setMoldeSel(moldeId)
    setUso([])
    if (!moldeId) return
    const { data, error: e } = await supabase.rpc('variantes_codigo_molde', {
      p_molde_id: Number(moldeId), p_color_id: null,
    })
    if (e) { setError('No se pudo consultar el molde: ' + e.message); return }
    setUso(data || [])
  }

  const COLS = [
    { label: 'Clave', get: v => v.clave },
    { label: 'Nombre', get: v => v.nombre },
    { label: 'Descripcion', get: v => v.descripcion },
    { label: 'Minutos de cambio', get: v => v.minutos_cambio },
    { label: 'Activo', get: v => v.activo ? 'Si' : 'No' },
  ]

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Variantes de codigo</h2>
          <p style={S.sub}>
            Cuando el cliente pide la <b>misma pieza</b> con codigos distintos porque la manda a otro pais o a otra
            plataforma. Sirve para que el sistema deje de creer que esos codigos salen del mismo disparo y los
            programe por separado. No cuesta purga: solo cambia la documentacion del puesto.
          </p>
        </div>
        {puedeEditar && tab === 'catalogo' && !form && (
          <button style={S.boton} onClick={() => { setForm({ ...vacio }); setEditando(null); setError('') }}>
            + Nueva variante
          </button>
        )}
      </div>

      <div style={S.tabs}>
        {[['catalogo', 'Catalogo'], ['uso', 'Uso por molde']].map(([id, n]) => (
          <button key={id} style={tab === id ? S.tabAct : S.tab} onClick={() => { setTab(id); setError('') }}>{n}</button>
        ))}
        <div style={{ flex: 1 }} />
        {tab === 'catalogo' && (
          <>
            <button style={S.expBtn} onClick={() => exportarExcel('variantes_codigo', COLS, variantes)}>Excel</button>
            <button style={S.expBtn} onClick={() => imprimirTablaPDF('Variantes de codigo', COLS, variantes)}>PDF</button>
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
              <h3 style={S.cardTit}>{editando ? 'Editar variante' : 'Nueva variante'}</h3>
              <div style={S.fila}>
                <div style={S.campo}>
                  <label style={S.label}>Clave *</label>
                  <input style={S.input} value={form.clave} maxLength={10}
                    onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="BR" />
                </div>
                <div style={{ ...S.campo, flex: 2 }}>
                  <label style={S.label}>Nombre *</label>
                  <input style={S.input} value={form.nombre}
                    onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Planta Brasil" />
                </div>
                <div style={S.campo}>
                  <label style={S.label}>Minutos de cambio</label>
                  <input style={S.input} type="number" min="0" step="1" value={form.minutos_cambio}
                    onChange={e => setForm({ ...form, minutos_cambio: e.target.value })} />
                </div>
              </div>
              <div style={S.fila}>
                <div style={{ ...S.campo, flex: 3 }}>
                  <label style={S.label}>Descripcion</label>
                  <input style={S.input} value={form.descripcion}
                    onChange={e => setForm({ ...form, descripcion: e.target.value })}
                    placeholder="Para que sepa el que captura de que se trata" />
                </div>
              </div>
              <p style={S.ayuda}>
                <b>Dejalo en cero</b> si al pasar a esta variante lo unico que cambia es la documentacion del puesto,
                que es lo normal. Captura minutos solo cuando ademas cambia el empaque y eso obliga a mover
                contenedores o tarimas. Lo que captures se suma como <b>setup</b> en la programacion a capacidad
                finita, no como purga: lo que se prepara es el puesto, no el material.
              </p>
              <label style={S.check}>
                <input type="checkbox" checked={form.activo}
                  onChange={e => setForm({ ...form, activo: e.target.checked })} />
                <span>Activa</span>
              </label>
              <div style={S.acciones}>
                <button style={S.botonGris} onClick={() => { setForm(null); setEditando(null); setError('') }}>Cancelar</button>
                <button style={S.boton} onClick={guardar}>Guardar</button>
              </div>
            </div>
          )}

          <div style={S.tabla}>
            <div style={S.th}>
              <span style={{ width: 90 }}>Clave</span>
              <span style={{ flex: 2 }}>Nombre</span>
              <span style={{ flex: 3 }}>Descripcion</span>
              <span style={{ width: 130 }}>Min. de cambio</span>
              <span style={{ width: 90 }}>Estatus</span>
              <span style={{ width: 90 }}>Acciones</span>
            </div>
            {!loading && variantes.length === 0 && (
              <p style={S.info}>
                No hay variantes capturadas. Mientras no exista ninguna, todo agrupa exactamente como antes:
                los articulos sin variante siguen considerandose del mismo disparo.
              </p>
            )}
            {variantes.map(v => (
              <div key={v.id} style={S.tr}>
                <span style={{ width: 90, fontWeight: 600, color: '#2563eb' }}>{v.clave}</span>
                <span style={{ flex: 2 }}>{v.nombre}</span>
                <span style={{ flex: 3, color: '#64748b', fontSize: 13 }}>{v.descripcion}</span>
                <span style={{ width: 130 }}>
                  {Number(v.minutos_cambio) > 0
                    ? <span style={S.pillAmbar}>{Number(v.minutos_cambio)} min</span>
                    : <span style={S.pillGris}>sin costo</span>}
                </span>
                <span style={{ width: 90 }}>
                  <span style={{ ...S.pill, background: v.activo ? '#f0fdf4' : '#fef2f2', color: v.activo ? '#16a34a' : '#dc2626' }}>
                    {v.activo ? 'Activa' : 'Inactiva'}
                  </span>
                </span>
                <span style={{ width: 90 }}>
                  {puedeEditar && (
                    <button style={S.btnMini} onClick={() => {
                      setEditando(v)
                      setForm({
                        clave: v.clave, nombre: v.nombre, descripcion: v.descripcion || '',
                        minutos_cambio: v.minutos_cambio ?? 0, activo: !!v.activo,
                      })
                      setError('')
                    }}>Editar</button>
                  )}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ---------- Uso por molde ---------- */}
      {tab === 'uso' && (
        <div style={S.card}>
          <p style={S.ayuda}>
            Cuantas corridas distintas tiene que hacer un molde por culpa del codigo. Cada renglon es una corrida
            aparte: no salen juntas aunque compartan molde y color.
          </p>
          <div style={S.fila}>
            <div style={{ ...S.campo, flex: 2 }}>
              <label style={S.label}>Molde</label>
              <select style={S.input} value={moldeSel} onChange={e => verUso(e.target.value)}>
                <option value="">Elige un molde</option>
                {moldes.map(m => <option key={m.id} value={m.id}>{m.clave} — {m.nombre}</option>)}
              </select>
            </div>
          </div>

          {moldeSel && uso.length === 0 && (
            <p style={S.info}>Ese molde no tiene articulos con cavidad asignada.</p>
          )}

          {uso.length > 0 && (
            <>
              <div style={{ ...S.tabla, marginTop: 12 }}>
                <div style={S.th}>
                  <span style={{ width: 140 }}>Variante</span>
                  <span style={{ flex: 3 }}>Codigos</span>
                  <span style={{ width: 130 }}>Min. de cambio</span>
                </div>
                {uso.map((u, i) => (
                  <div key={i} style={S.tr}>
                    <span style={{ width: 140, fontWeight: 600 }}>
                      {u.variante_clave || <span style={{ color: '#94a3b8', fontWeight: 400 }}>sin variante</span>}
                    </span>
                    <span style={{ flex: 3, fontSize: 13 }}>{u.articulos}</span>
                    <span style={{ width: 130 }}>
                      {Number(u.minutos_cambio) > 0
                        ? <span style={S.pillAmbar}>{Number(u.minutos_cambio)} min</span>
                        : <span style={S.pillGris}>sin costo</span>}
                    </span>
                  </div>
                ))}
              </div>
              {uso.length > 1 && (
                <p style={S.aviso}>
                  Este molde corre {uso.length} grupos de codigos por separado. Programalos aparte:
                  no salen del mismo disparo.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

const S = {
  wrap: { padding: 24 },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, marginBottom: 16 },
  h2: { fontSize: 18, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  sub: { fontSize: 13, color: '#64748b', margin: '6px 0 0', maxWidth: 860, lineHeight: 1.6 },
  tabs: { display: 'flex', gap: 4, alignItems: 'center', marginBottom: 16, borderBottom: '1px solid #e2e8f0' },
  tab: { padding: '8px 18px', border: 'none', background: 'transparent', fontSize: 14, color: '#64748b', cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabAct: { padding: '8px 18px', border: 'none', background: 'transparent', fontSize: 14, color: '#2563eb', fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid #2563eb' },
  expBtn: { padding: '7px 12px', background: '#fff', color: '#475569', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 12, cursor: 'pointer', marginLeft: 6 },
  card: { background: '#fff', borderRadius: 10, padding: 20, marginBottom: 16, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  cardTit: { fontSize: 15, fontWeight: 600, color: '#1a1a2e', margin: '0 0 14px' },
  fila: { display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' },
  campo: { display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 160 },
  label: { fontSize: 12, fontWeight: 500, color: '#444' },
  input: { padding: '9px 12px', borderRadius: 7, border: '1px solid #ddd', fontSize: 14, outline: 'none', width: '100%', boxSizing: 'border-box' },
  ayuda: { fontSize: 12, color: '#64748b', margin: '4px 0 12px', lineHeight: 1.6, maxWidth: 860 },
  check: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, color: '#334155', cursor: 'pointer', marginBottom: 12 },
  acciones: { display: 'flex', gap: 10, justifyContent: 'flex-end' },
  boton: { padding: '9px 20px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: 'pointer' },
  botonGris: { padding: '9px 20px', background: '#e2e8f0', color: '#444', border: 'none', borderRadius: 7, fontSize: 14, cursor: 'pointer' },
  btnMini: { padding: '4px 10px', background: '#f1f5f9', color: '#444', border: '1px solid #e2e8f0', borderRadius: 5, fontSize: 12, cursor: 'pointer' },
  tabla: { background: '#fff', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  th: { display: 'flex', gap: 12, padding: '11px 18px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', gap: 12, padding: '12px 18px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 14 },
  pill: { padding: '3px 10px', borderRadius: 20, fontSize: 12, fontWeight: 500 },
  pillAmbar: { padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: '#fffbeb', color: '#b45309', border: '1px solid #fde68a' },
  pillGris: { padding: '2px 9px', borderRadius: 20, fontSize: 11, fontWeight: 500, background: '#f8fafc', color: '#94a3b8', border: '1px solid #e2e8f0' },
  info: { fontSize: 13, color: '#64748b', padding: '16px 18px', margin: 0 },
  aviso: { fontSize: 13, color: '#b45309', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 8, padding: '10px 12px', marginTop: 12 },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  ok: { color: '#16a34a', fontSize: 13, marginBottom: 12 },
}
