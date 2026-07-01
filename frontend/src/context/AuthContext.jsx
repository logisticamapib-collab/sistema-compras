import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [perfil, setPerfil] = useState(null)
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
    setLoading(false)
  }

  return (
    <AuthContext.Provider value={{ user, perfil, loading, cargarPerfil }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => useContext(AuthContext)