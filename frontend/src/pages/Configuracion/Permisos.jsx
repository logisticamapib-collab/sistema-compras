import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { ROLES as roles } from '../../lib/roles'


const acciones = [
  { clave: 'ver', label: 'Ver' },
  { clave: 'crear', label: 'Crear' },
  { clave: 'editar', label: 'Editar' },
  { clave: 'eliminar', label: 'Eliminar' },
  { clave: 'aprobar', label: 'Aprobar' },
]

export default function Permisos() {
  const [modulos, setModulos] = useState([])
  const [permisos, setPermisos] = useState([])
  const [rolSeleccionado, setRolSeleccionado] = useState('solicitante')
  const [loading, setLoading] = useState(true)
  const [guardando, setGuardando] = useState(false)
  const [exito, setExito] = useState('')

  useEffect(() => { cargarDatos() }, [])

  const cargarDatos = async () => {
    setLoading(true)
    const [{ data: m }, { data: p }] = await Promise.all([
      supabase.from('modulos').select('*').order('orden'),
      supabase.from('permisos_rol').select('*')
    ])
    setModulos(m || [])
    setPermisos(p || [])
    setLoading(false)
  }

  const permisoDe = (rol, moduloId) => {
    return permisos.find(p => p.rol === rol && p.modulo_id === moduloId) || {
      puede_ver: false, puede_crear: false, puede_editar: false, puede_eliminar: false, puede_aprobar: false
    }
  }

  const toggle = (moduloId, accionClave) => {
    setPermisos(prev => {
      const campo = 'puede_' + accionClave
      const existe = prev.find(p => p.rol === rolSeleccionado && p.modulo_id === moduloId)
      if (existe) {
        return prev.map(p =>
          p.rol === rolSeleccionado && p.modulo_id === moduloId
            ? { ...p, [campo]: !p[campo] }
            : p
        )
      }
      return [...prev, {
        rol: rolSeleccionado, modulo_id: moduloId,
        puede_ver: false, puede_crear: false, puede_editar: false, puede_eliminar: false, puede_aprobar: false,
        [campo]: true
      }]
    })
  }

  const guardarCambios = async () => {
    setGuardando(true)
    const filasDelRol = permisos.filter(p => p.rol === rolSeleccionado)

    for (const fila of filasDelRol) {
      await supabase.from('permisos_rol').upsert({
        rol: fila.rol,
        modulo_id: fila.modulo_id,
        puede_ver: fila.puede_ver,
        puede_crear: fila.puede_crear,
        puede_editar: fila.puede_editar,
        puede_eliminar: fila.puede_eliminar,
        puede_aprobar: fila.puede_aprobar
      }, { onConflict: 'rol,modulo_id' })
    }

    setGuardando(false)
    setExito('Permisos guardados correctamente')
    await cargarDatos()
    setTimeout(() => setExito(''), 3000)
  }

  return (
    <div>
      <div style={styles.encabezado}>
        <div>
          <h2 style={styles.titulo}>Permisos por rol</h2>
          <p style={styles.subtitulo}>
            Define que puede ver, crear, editar, eliminar o aprobar cada rol en cada modulo del sistema.
            El rol Administrador siempre tiene acceso total y no se configura aqui.
          </p>
        </div>
      </div>

      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.tabsRoles}>
        {roles.map(r => (
          <button key={r.value}
            style={rolSeleccionado === r.value ? styles.tabActivo : styles.tab}
            onClick={() => setRolSeleccionado(r.value)}>
            {r.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p style={{ color: '#666' }}>Cargando...</p>
      ) : (
        <div style={styles.tabla}>
          <div style={styles.tablaHeader}>
            <span style={{ flex: 2 }}>Modulo</span>
            {acciones.map(a => (
              <span key={a.clave} style={{ flex: 1, textAlign: 'center' }}>{a.label}</span>
            ))}
          </div>
          {modulos.map(modulo => {
            const permiso = permisoDe(rolSeleccionado, modulo.id)
            return (
              <div key={modulo.id} style={styles.tablaFila}>
                <span style={{ flex: 2, fontWeight: '500' }}>{modulo.nombre}</span>
                {acciones.map(a => (
                  <span key={a.clave} style={{ flex: 1, textAlign: 'center' }}>
                    <input type="checkbox"
                      checked={!!permiso['puede_' + a.clave]}
                      onChange={() => toggle(modulo.id, a.clave)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer' }} />
                  </span>
                ))}
              </div>
            )
          })}
        </div>
      )}

      <div style={styles.botones}>
        <button style={styles.boton} onClick={guardarCambios} disabled={guardando || loading}>
          {guardando ? 'Guardando...' : `Guardar permisos de ${roles.find(r => r.value === rolSeleccionado)?.label}`}
        </button>
      </div>
    </div>
  )
}

const styles = {
  encabezado: { marginBottom: '16px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 6px 0' },
  subtitulo: { fontSize: '13px', color: '#666', margin: '0', maxWidth: '600px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
  tabsRoles: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' },
  tab: { padding: '7px 14px', border: '1px solid #e2e8f0', borderRadius: '7px', backgroundColor: '#fff', fontSize: '13px', cursor: 'pointer', color: '#444' },
  tabActivo: { padding: '7px 14px', border: '1px solid #2563eb', borderRadius: '7px', backgroundColor: '#eff6ff', fontSize: '13px', cursor: 'pointer', color: '#2563eb', fontWeight: '500' },
  tabla: { backgroundColor: '#fff', borderRadius: '10px', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  tablaHeader: { display: 'flex', padding: '12px 20px', backgroundColor: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '12px', fontWeight: '600', color: '#64748b', textTransform: 'uppercase' },
  tablaFila: { display: 'flex', padding: '14px 20px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: '14px' },
  botones: { display: 'flex', justifyContent: 'flex-end', marginTop: '16px' },
  boton: { padding: '10px 24px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
}