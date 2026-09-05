import { AuthProvider, useAuth } from './context/AuthContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import ConfiguracionInicial from './pages/ConfiguracionInicial'
import CambiarPassword from './pages/CambiarPassword'

function Contenido() {
  const { user, perfil, loading } = useAuth()

  if (loading) return <p style={{ textAlign: 'center', marginTop: '40px' }}>Cargando...</p>
  if (!user) return <Login />
  if (!perfil?.empresa_id) return <ConfiguracionInicial />
  // Va DESPUES de tener empresa y ANTES del Dashboard: quien entro con una
  // contrasena que le dieron no ve ninguna pantalla hasta poner la suya.
  if (perfil.password_pendiente) return <CambiarPassword />
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
