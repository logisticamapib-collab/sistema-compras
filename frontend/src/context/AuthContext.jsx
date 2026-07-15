import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [perfil, setPerfil] = useState(null)
  const [permisos, setPermisos] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) cargarPerfil(session.user.id)
      else setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) cargarPerfil(session.user.id)
      else {
        setPerfil(null)
        setPermisos({})
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const cargarPerfil = async (userId) => {
    const { data } = await supabase
      .from('usuarios')
      .select('*, empresas(*), sites(*), gerente:gerente_id(id, nombre, rol, email)')
      .eq('id', userId)
      .single()
    setPerfil(data)
    if (data?.rol) await cargarPermisos(data.rol, data.id)
    setLoading(false)
  }

  const cargarPermisos = async (rol, usuarioId) => {
    // El admin siempre tiene acceso total a todo, sin depender de la tabla de permisos.
    if (rol === 'admin') {
      const { data: modulos } = await supabase.from('modulos').select('clave')
      const todo = {}
      for (const m of modulos || []) {
        todo[m.clave] = { ver: true, crear: true, editar: true, eliminar: true, aprobar: true }
      }
      setPermisos(todo)
      return
    }

    const [{ data: porRol }, { data: excepciones }] = await Promise.all([
      supabase
        .from('permisos_rol')
        .select('puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar, modulos(clave)')
        .eq('rol', rol),
      supabase
        .from('permisos_usuario')
        .select('puede_ver, puede_crear, puede_editar, puede_eliminar, puede_aprobar, modulos(clave)')
        .eq('usuario_id', usuarioId)
    ])

    const mapa = {}
    for (const p of porRol || []) {
      if (!p.modulos?.clave) continue
      mapa[p.modulos.clave] = {
        ver: p.puede_ver,
        crear: p.puede_crear,
        editar: p.puede_editar,
        eliminar: p.puede_eliminar,
        aprobar: p.puede_aprobar
      }
    }

    // Las excepciones por usuario reemplazan por completo el permiso del rol para ese modulo
    for (const p of excepciones || []) {
      if (!p.modulos?.clave) continue
      mapa[p.modulos.clave] = {
        ver: p.puede_ver,
        crear: p.puede_crear,
        editar: p.puede_editar,
        eliminar: p.puede_eliminar,
        aprobar: p.puede_aprobar
      }
    }

    setPermisos(mapa)
  }

  // Helper para checar permisos desde cualquier componente: tienePermiso('articulos', 'editar')
  const tienePermiso = (modulo, accion = 'ver') => {
    return !!permisos?.[modulo]?.[accion]
  }

  return (
    <AuthContext.Provider value={{ user, perfil, permisos, tienePermiso, loading, cargarPerfil }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)
