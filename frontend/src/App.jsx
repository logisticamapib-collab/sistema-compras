import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ConfiguracionInicial from './pages/ConfiguracionInicial'

function Contenido() {
  const { user, perfil, loading } = useAuth()

  if (loading) return <p style={{ textAlign: 'center', marginTop: '40px' }}>Cargando...</p>
  if (!user) return <Login />
  if (!perfil?.empresa_id) return <ConfiguracionInicial />
  return <Dashboard />
}

function App() {
  return (
    <AuthProvider>
      <Contenido />
    </AuthProvider>
  )
}

export default App