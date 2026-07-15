import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'

const acciones = [
  { clave: 'ver', label: 'Ver' },
  { clave: 'crear', label: 'Crear' },
  { clave: 'editar', label: 'Editar' },
  { clave: 'eliminar', label: 'Eliminar' },
  { clave: 'aprobar', label: 'Aprobar' },
]

export default function PermisosUsuario({ usuario, onVolver }) {
  const [modulos, setModulos] = useState([])
  const [permisosRol, setPermisosRol] = useState({})
  const [personalizados, setPersonalizados] = useState({})
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState('')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: m }, { data: pr }, { data: pu }] = await Promise.all([
      supabase.from('modulos').select('*').order('orden'),
      supabase.from('permisos_rol').select('*').eq('rol', usuario.rol),
      supabase.from('permisos_usuario').select('*').eq('usuario_id', usuario.id)
    ])
    setModulos(m || [])

    const mapaRol = {}
    for (const p of pr || []) mapaRol[p.modulo_id] = p
    setPermisosRol(mapaRol)

    const mapaExcepciones = {}
    for (const p of pu || []) mapaExcepciones[p.modulo_id] = { ...p, personalizado: true }
    setPersonalizados(mapaExcepciones)

    setLoading(false)
  }

  const efectivo = (moduloId) => {
    if (personalizados[moduloId]) return personalizados[moduloId]
    const base = permisosRol[moduloId] || {}
    return {
      puede_ver: !!base.puede_ver, puede_crear: !!base.puede_crear, puede_editar: !!base.puede_editar,
      puede_eliminar: !!base.puede_eliminar, puede_aprobar: !!base.puede_aprobar, personalizado: false
    }
  }

  const togglePersonalizar = (moduloId) => {
    setPersonalizados(prev => {
      if (prev[moduloId]) {
        const copia = { ...prev }
        delete copia[moduloId]
        return copia
      }
      const base = permisosRol[moduloId] || {}
      return {
        ...prev,
        [moduloId]: {
          puede_ver: !!base.puede_ver, puede_crear: !!base.puede_crear, puede_editar: !!base.puede_editar,
          puede_eliminar: !!base.puede_eliminar, puede_aprobar: !!base.puede_aprobar, personalizado: true
        }
      }
    })
  }

  const toggleAccion = (moduloId, accionClave) => {
    setPersonalizados(prev => ({
      ...prev,
      [moduloId]: {
        ...prev[moduloId],
        ['puede_' + accionClave]: !prev[moduloId]['puede_' + accionClave]
      }
    }))
  }

  const guardar = async () => {
    setGuardando(true)

    for (const modulo of modulos) {
      const tienePersonalizado = !!personalizados[modulo.id]

      if (tienePersonalizado) {
        const p = personalizados[modulo.id]
        await supabase.from('permisos_usuario').upsert({
          usuario_id: usuario.id,
          modulo_id: modulo.id,
          puede_ver: p.puede_ver,
          puede_crear: p.puede_crear,
          puede_editar: p.puede_editar,
          puede_eliminar: p.puede_eliminar,
          puede_aprobar: p.puede_aprobar
        }, { onConflict: 'usuario_id,modulo_id' })
      } else {
        await supabase.from('permisos_usuario')
          .delete()
          .eq('usuario_id', usuario.id)
          .eq('modulo_id', modulo.id)
      }
    }

    setGuardando(false)
    setExito('Excepciones guardadas correctamente')
    setTimeout(() => setExito(''), 3000)
  }

  return (
    <div>
      <button style={styles.botonVolver} onClick={onVolver}>&larr; Volver a usuarios</button>
      <h2 style={styles.titulo}>Permisos personalizados: {usuario.nombre}</h2>
      <p style={styles.subtitulo}>
        Por defecto este usuario hereda los permisos de su rol (<strong>{usuario.rol}</strong>).
        Marca "Personalizar" solo en los modulos donde este usuario en particular necesite algo distinto a su rol.
      </p>

      {exito && <p style={styles.exito}>{exito}</p>}

      {loading ? <p style={{ color: '#666' }}>Cargando...</p> : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 0.8 }}>Personalizar</span>
            <span style={{ flex: 2 }}>Modulo</span>
            {acciones.map(a => (
              <span key={a.clave} style={{ flex: 1, textAlign: 'center' }}>{a.label}</span>
            ))}
          </div>
          {modulos.map(modulo => {
            const p = efectivo(modulo.id)
            return (
              <div key={modulo.id} style={{ ...styles.tablaFila, backgroundColor: p.personalizado ? '#fffbeb' : '#fff' }}>
                <span style={{ flex: 0.8, textAlign: 'center' }}>
                  <input type="checkbox" checked={p.personalizado}
                    onChange={() => togglePersonalizar(modulo.id)}
                    style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                </span>
                <span style={{ flex: 2, fontWeight: '500' }}>{modulo.nombre}</span>
                {acciones.map(a => (
                  <span key={a.clave} style={{ flex: 1, textAlign: 'center' }}>
                    <input type="checkbox"
                      checked={!!p['puede_' + a.clave]}
                      disabled={!p.personalizado}
                      onChange={() => toggleAccion(modulo.id, a.clave)}
                      style={{ width: '18px', height: '18px', cursor: p.personalizado ? 'pointer' : 'default' }} />
                  </span>
                ))}
              </div>
            )
          })}
        </div>
      )}

      <div style={styles.botones}>
        <button style={styles.boton} onClick={guardar} disabled={guardando || loading}>
          {guardando ? 'Guardando...' : 'Guardar excepciones'}
        </button>
      </div>
    </div>
  )
}

const styles = {
  botonVolver: { padding: '6px 14px', backgroundColor: 'transparent', color: '#2563eb', border: '1px solid #2563eb', borderRadius: '6px', fontSize: '13px', cursor: 'pointer', marginBottom: '12px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px 0' },
  subtitulo: { fontSize: '13px', color: '#666', margin: '0 0 20px 0', maxWidth: '650px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '12px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '13px' },
  botones: { display: 'flex', justifyContent: 'flex-end', marginTop: '16px' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
}