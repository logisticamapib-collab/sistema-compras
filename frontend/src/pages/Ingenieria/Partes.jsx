import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { exportarExcel, imprimirTablaPDF } from '../../lib/exportar'
import { useAuth } from '../../context/AuthContext'

// Partes equivalentes: codigos de articulo que son la MISMA pieza fisica
// aunque salgan de moldes distintos. El molde 001 saca A (LH) y B (RH), el
// molde 002 saca C (LH) y D (RH); A y C son intercambiables para el cliente
// y los codigos difieren solo para saber de que molde salio cada caja.
//
// Agrupar no fusiona los codigos: cada uno se sigue produciendo, etiquetando
// y rastreando por separado. La parte solo le dice al sistema "estos son la
// misma pieza", para poder ver el disponible junto y surtir de cualquiera.

const vacio = { clave: '', nombre: '', descripcion: '', activo: true }

export default function Partes() {
  const { perfil, tienePermiso } = useAuth()
  const emp = perfil.empresa_id
  const puedeEditar = tienePermiso('ing_partes', 'editar') || tienePermiso('ing_partes', 'crear')

  const [partes, setPartes] = useState([])
  const [articulos, setArticulos] = useState([])
  const [cavidades, setCavidades] = useState([])
  const [moldes, setMoldes] = useState([])
  const [form, setForm] = useState(null)
  const [editando, setEditando] = useState(null)
  const [expandida, setExpandida] = useState(null)
  const [asignar, setAsignar] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')

  useEffect(() => { cargar() }, [])
  const cargar = async () => {
    setLoading(true)
    const [p, a, c, m] = await Promise.all([
      supabase.from('partes').select('*').eq('empresa_id', emp).order('clave'),
      supabase.from('articulos').select('id, codigo_interno, descripcion, parte_id')
        .eq('empresa_id', emp).eq('activo', true).order('codigo_interno'),
      supabase.from('molde_cavidades').select('molde_id, articulo_id').eq('activa', true),
      supabase.from('moldes').select('id, clave').eq('empresa_id', emp),
    ])
    setPartes(p.data || []); setArticulos(a.data || [])
    setCavidades(c.data || []); setMoldes(m.data || [])
    setLoading(false)
  }

  const moldeDe = (artId) => {
    const cav = cavidades.find(x => x.articulo_id === artId)
    return cav ? (moldes.find(m => m.id === cav.molde_id)?.clave || '-') : '-'
  }
  const miembros = (parteId) => articulos.filter(a => a.parte_id === parteId)

  const guardar = async () => {
    setError(''); setExito('')
    if (!form.clave || !form.nombre) { setError('Clave y nombre son obligatorios'); return }
    const payload = {
      empresa_id: emp, clave: form.clave.toUpperCase(), nombre: form.nombre,
      descripcion: form.descripcion || null, activo: !!form.activo,
    }
    const r = editando
      ? await supabase.from('partes').update(payload).eq('id', editando.id)
      : await supabase.from('partes').insert(payload)
    if (r.error) {
      setError(r.error.message.includes('duplicate')
        ? `Ya existe una parte con la clave ${payload.clave}` : 'No se pudo guardar: ' + r.error.message)
      return
    }
    setForm(null); setEditando(null); setExito('Parte guardada'); cargar()
  }

  const agregarArticulo = async (parteId) => {
    if (!asignar) return
    setError(''); setExito('')
    const { error: e } = await supabase.from('articulos').update({ parte_id: parteId }).eq('id', Number(asignar))
    if (e) { setError('No se pudo asignar: ' + e.message); return }
    setAsignar(''); setExito('Articulo agregado a la parte'); cargar()
  }

  const quitarArticulo = async (artId, codigo) => {
    if (!confirm(`Estas a punto de sacar ${codigo} de esta parte. Dejara de considerarse intercambiable y su inventario ya no se vera junto con los demas. Confirma para continuar.`)) return
    const { error: e } = await supabase.from('articulos').update({ parte_id: null }).eq('id', artId)
    if (e) { setError('No se pudo quitar: ' + e.message); return }
    setExito('Articulo separado de la parte'); cargar()
  }

  const sinParte = articulos.filter(a => !a.parte_id)

  const COLS = [
    { label: 'Clave', get: p => p.clave },
    { label: 'Nombre', get: p => p.nombre },
    { label: 'Descripcion', get: p => p.descripcion || '' },
    { label: 'Codigos', get: p => miembros(p.id).map(a => a.codigo_interno).join(' / ') },
    { label: 'Activo', get: p => p.activo ? 'Si' : 'No' },
  ]

  return (
    <div style={S.wrap}>
      <div style={S.top}>
        <div>
          <h2 style={S.h2}>Partes equivalentes</h2>
          <p style={S.sub}>
            Agrupa los codigos de articulo que son la <b>misma pieza fisica</b> aunque salgan de moldes
            distintos. Sirve cuando el molde 001 saca A y B, y el molde 002 saca C y D siendo A y C la
            misma parte. Agrupar no fusiona nada: cada codigo se sigue produciendo, etiquetando y
            rastreando por separado.
          </p>
        </div>
        {puedeEditar && !form && (
          <button style={S.boton} onClick={() => { setForm({ ...vacio }); setEditando(null); setError('') }}>+ Nueva parte</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginBottom: '12px' }}>
        <button style={S.expBtn} onClick={() => exportarExcel('partes_equivalentes', COLS, partes)}>Excel</button>
        <button style={S.expBtn} onClick={() => imprimirTablaPDF('Partes equivalentes', COLS, partes)}>PDF</button>
      </div>

      {error && <p style={S.err}>{error}</p>}
      {exito && <p style={S.ok}>{exito}</p>}
      {loading && <p style={S.info}>Cargando...</p>}

      {form && (
        <div style={S.card}>
          <h3 style={S.cardTit}>{editando ? 'Editar parte' : 'Nueva parte'}</h3>
          <div style={S.fila}>
            <div style={S.campo}>
              <label style={S.label}>Clave *</label>
              <input style={S.input} value={form.clave} maxLength={20}
                onChange={e => setForm({ ...form, clave: e.target.value.toUpperCase() })} placeholder="MANIJA-LH" />
            </div>
            <div style={{ ...S.campo, flex: 2 }}>
              <label style={S.label}>Nombre *</label>
              <input style={S.input} value={form.nombre}
                onChange={e => setForm({ ...form, nombre: e.target.value })} placeholder="Manija izquierda" />
            </div>
          </div>
          <div style={S.campo}>
            <label style={S.label}>Descripcion</label>
            <input style={S.input} value={form.descripcion}
              onChange={e => setForm({ ...form, descripcion: e.target.value })} />
          </div>
          <label style={S.check}>
            <input type="checkbox" checked={form.activo} onChange={e => setForm({ ...form, activo: e.target.checked })} />
            <span>Activa</span>
          </label>
          <div style={S.acciones}>
            <button style={S.botonSec} onClick={() => { setForm(null); setEditando(null) }}>Cancelar</button>
            <button style={S.boton} onClick={guardar}>Guardar</button>
          </div>
        </div>
      )}

      {!loading && partes.length === 0 && !form && (
        <div style={S.card}>
          <p style={S.vacio}>
            Aun no hay partes. Mientras no crees ninguna, cada codigo se trata por separado, que es el
            comportamiento de siempre.
          </p>
        </div>
      )}

      {partes.map(p => {
        const ms = miembros(p.id)
        const abierta = expandida === p.id
        return (
          <div key={p.id} style={S.card}>
            <div style={S.parteTop} onClick={() => { setExpandida(abierta ? null : p.id); setAsignar('') }}>
              <div>
                <span style={{ fontSize: '14px', fontWeight: 600, color: '#1a1a2e' }}>
                  {abierta ? '▼' : '▶'} {p.clave} &middot; {p.nombre}
                </span>
                {!p.activo && <span style={S.badgeGris}>inactiva</span>}
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>
                  {ms.length === 0
                    ? 'Sin codigos asignados todavia'
                    : ms.map(a => `${a.codigo_interno} (${moldeDe(a.id)})`).join('  ·  ')}
                </div>
              </div>
              {puedeEditar && (
                <button style={S.botonAccion} onClick={ev => { ev.stopPropagation(); setEditando(p); setForm({ ...p }); setError('') }}>Editar</button>
              )}
            </div>

            {abierta && (
              <div style={{ marginTop: '12px', borderTop: '1px solid #f1f5f9', paddingTop: '12px' }}>
                {ms.length > 0 && (
                  <table style={S.tabla}>
                    <thead>
                      <tr><th style={S.th}>Codigo</th><th style={S.th}>Descripcion</th><th style={S.th}>Molde</th><th style={S.th}></th></tr>
                    </thead>
                    <tbody>
                      {ms.map(a => (
                        <tr key={a.id}>
                          <td style={{ ...S.td, fontWeight: 600 }}>{a.codigo_interno}</td>
                          <td style={S.td}>{a.descripcion}</td>
                          <td style={S.td}>{moldeDe(a.id)}</td>
                          <td style={{ ...S.td, textAlign: 'right' }}>
                            {puedeEditar && <button style={S.botonAccion} onClick={() => quitarArticulo(a.id, a.codigo_interno)}>Quitar</button>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {ms.length === 1 && (
                  <p style={S.ayuda}>
                    Una parte con un solo codigo no cambia nada. Agrega el codigo del otro molde para que
                    el sistema los trate como intercambiables.
                  </p>
                )}
                {puedeEditar && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    <select style={{ ...S.input, flex: 1, minWidth: '260px' }} value={asignar} onChange={e => setAsignar(e.target.value)}>
                      <option value="">Agregar un codigo a esta parte...</option>
                      {sinParte.map(a => (
                        <option key={a.id} value={a.id}>{a.codigo_interno} - {a.descripcion} ({moldeDe(a.id)})</option>
                      ))}
                    </select>
                    <button style={S.boton} onClick={() => agregarArticulo(p.id)} disabled={!asignar}>Agregar</button>
                  </div>
                )}
                {sinParte.length === 0 && puedeEditar && (
                  <p style={S.ayuda}>Todos los articulos ya pertenecen a alguna parte.</p>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

const S = {
  wrap: { padding: '24px 28px' },
  top: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px', gap: '14px' },
  h2: { fontSize: '20px', color: '#1a1a2e', margin: 0 },
  sub: { color: '#64748b', fontSize: '13px', margin: '4px 0 0', maxWidth: '780px', lineHeight: 1.5 },
  card: { background: '#fff', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px 16px', marginBottom: '12px' },
  cardTit: { fontSize: '14px', fontWeight: 600, color: '#1a1a2e', margin: '0 0 10px' },
  parteTop: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px', cursor: 'pointer' },
  fila: { display: 'flex', gap: '14px', flexWrap: 'wrap', marginBottom: '10px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '5px', flex: 1, minWidth: '160px', marginBottom: '10px' },
  label: { fontSize: '12px', color: '#444', fontWeight: 500 },
  input: { padding: '9px 11px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13.5px', outline: 'none', background: '#fff' },
  check: { display: 'flex', gap: '8px', alignItems: 'center', fontSize: '13px', color: '#334155', margin: '4px 0' },
  acciones: { display: 'flex', gap: '9px', justifyContent: 'flex-end', marginTop: '10px' },
  boton: { padding: '9px 18px', background: '#0891b2', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '13.5px', cursor: 'pointer', fontWeight: 500 },
  botonSec: { padding: '9px 16px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13.5px', cursor: 'pointer' },
  botonAccion: { padding: '5px 11px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '6px', fontSize: '12px', cursor: 'pointer' },
  expBtn: { padding: '8px 14px', background: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '13px', cursor: 'pointer' },
  ayuda: { fontSize: '12px', color: '#64748b', lineHeight: 1.5, margin: '8px 0 0' },
  vacio: { color: '#64748b', fontSize: '13.5px', margin: 0, lineHeight: 1.55 },
  err: { color: '#b91c1c', fontSize: '13px', margin: '0 0 10px' },
  ok: { color: '#15803d', fontSize: '13px', margin: '0 0 10px' },
  info: { color: '#64748b', fontSize: '13px' },
  tabla: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: { textAlign: 'left', padding: '7px 9px', borderBottom: '2px solid #e2e8f0', color: '#64748b', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.03em' },
  td: { padding: '7px 9px', borderBottom: '1px solid #f1f5f9', color: '#1a1a2e' },
  badgeGris: { fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '20px', background: '#f1f5f9', color: '#64748b', marginLeft: '8px' },
}
