import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'

// Cambio obligatorio de contrasena.
//
// Se muestra cuando el administrador dio de alta a la persona con una
// contrasena temporal que el mismo escribio. Esa contrasena la conocen dos
// personas y normalmente viajo por mensaje, asi que no es una contrasena: es
// un permiso prestado. Aqui se devuelve.
//
// No hay boton de "despues". Si lo hubiera, nadie la cambiaria nunca.
export default function CambiarPassword() {
  const { perfil, cargarPerfil, user } = useAuth()
  const esInvitacion = perfil?.password_pendiente === 'invitacion'
  const [p1, setP1] = useState('')
  const [p2, setP2] = useState('')
  const [error, setError] = useState('')
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    setError('')
    if (p1.length < 8) { setError('La contraseña debe tener al menos 8 caracteres.'); return }
    if (p1 !== p2) { setError('Las dos contraseñas no son iguales.'); return }
    setGuardando(true)

    const { error: e1 } = await supabase.auth.updateUser({ password: p1 })
    if (e1) { setError(e1.message); setGuardando(false); return }

    // Se apaga la bandera hasta DESPUES de que el cambio quedo hecho. Si se
    // apagara antes y fallara el cambio, la persona se quedaria con la
    // contrasena del administrador y sin quien le vuelva a pedir cambiarla.
    const { error: e2 } = await supabase.from('usuarios')
      .update({ password_pendiente: null }).eq('id', perfil.id)
    if (e2) { setError('Se cambió la contraseña pero no se pudo registrar: ' + e2.message); setGuardando(false); return }

    await cargarPerfil(user.id)
  }

  return (
    <div style={s.fondo}>
      <div style={s.caja}>
        <h2 style={s.titulo}>{esInvitacion ? 'Crea tu Password' : 'Cambia tu Password'}</h2>
        <p style={s.texto}>
          {esInvitacion
            ? 'Tu acceso quedó listo, pero todavía no tienes contraseña. Crea una ahora: es la que vas a usar de aquí en adelante y nadie más la va a conocer.'
            : 'Entraste con una contraseña temporal que te dio quien te dio de alta. Antes de continuar tienes que poner una que solo tú conozcas.'}
        </p>
        <label style={s.label}>Contraseña nueva</label>
        <input style={s.input} type="password" value={p1} autoFocus
          onChange={e => setP1(e.target.value)} placeholder="Mínimo 8 caracteres" />
        <label style={s.label}>Repítela</label>
        <input style={s.input} type="password" value={p2}
          onChange={e => setP2(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && guardar()} />
        {error && <p style={s.error}>{error}</p>}
        <button style={{ ...s.boton, opacity: guardando ? 0.6 : 1 }} onClick={guardar} disabled={guardando}>
          {guardando ? 'Guardando...' : 'Guardar y entrar'}
        </button>
        <button style={s.salir} onClick={() => supabase.auth.signOut()}>Salir</button>
      </div>
    </div>
  )
}

const s = {
  fondo: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f5f6f8', padding: '20px' },
  caja: { background: '#fff', padding: '32px', borderRadius: '8px', boxShadow: '0 2px 12px rgba(0,0,0,.08)', width: '100%', maxWidth: '420px' },
  titulo: { margin: '0 0 12px', fontSize: '20px' },
  texto: { margin: '0 0 20px', fontSize: '13px', color: '#555', lineHeight: 1.6 },
  label: { display: 'block', fontSize: '12px', color: '#444', marginBottom: '4px', marginTop: '12px' },
  input: { width: '100%', padding: '10px', fontSize: '14px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box' },
  error: { color: '#c62828', fontSize: '13px', margin: '12px 0 0' },
  boton: { width: '100%', marginTop: '20px', padding: '11px', fontSize: '14px', background: '#1976d2', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' },
  salir: { width: '100%', marginTop: '8px', padding: '9px', fontSize: '13px', background: 'transparent', color: '#666', border: 'none', cursor: 'pointer' },
}
