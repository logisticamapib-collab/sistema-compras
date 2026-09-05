import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { comoSeVe } from '../lib/accesoInterno'
import Captcha, { CAPTCHA_ACTIVO, reiniciarCaptcha } from '../components/Captcha'

// Cambiar la propia contrasena.
//
// POR QUE HACIA FALTA
//
// No existia. La unica forma de cambiar una contrasena era pedirle al
// administrador que pusiera una temporal, lo que significa que el
// administrador vuelve a conocerla y se la pasa por mensaje. Eso tira por la
// borda el sentido del alta por invitacion, donde la gracia es justamente que
// nadie mas la conozca. Y si alguien sospecha que le vieron la contrasena, no
// tenia forma de arreglarlo por su cuenta.
//
// POR QUE SE PIDE LA CONTRASENA ACTUAL
//
// supabase.auth.updateUser cambia la contrasena con solo tener la sesion
// abierta. En una planta con computadoras compartidas eso significa que quien
// pase frente a una sesion sin bloquear puede cambiarla y dejar afuera al
// dueno. Pedir la actual convierte "estar sentado ahi" en "saber la
// contrasena", que es otra cosa.
//
// Se verifica iniciando sesion otra vez con la contrasena actual. Es el mismo
// usuario, asi que la sesion solo se renueva. Funciona igual para quien entra
// con correo y para quien entra con numero de empleado, que es lo que
// necesitabamos: los de piso no tienen correo a donde mandarles un codigo.
export default function MiCuenta({ onVolver }) {
  const { perfil, user } = useAuth()
  const [actual, setActual] = useState('')
  const [nueva, setNueva] = useState('')
  const [repetir, setRepetir] = useState('')
  const [captcha, setCaptcha] = useState('')
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [guardando, setGuardando] = useState(false)

  const limpiarCaptcha = () => { reiniciarCaptcha(); setCaptcha('') }

  const guardar = async () => {
    setError(''); setExito('')
    if (!actual) { setError('Escribe tu contrasena actual.'); return }
    if (nueva.length < 8) { setError('La contrasena nueva debe tener al menos 8 caracteres.'); return }
    if (nueva !== repetir) { setError('Las dos contrasenas nuevas no son iguales.'); return }
    if (nueva === actual) { setError('La contrasena nueva tiene que ser distinta de la actual.'); return }
    setGuardando(true)

    // 1. Comprobar que de verdad es quien dice ser.
    const { error: eVerifica } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: actual,
      ...(CAPTCHA_ACTIVO ? { options: { captchaToken: captcha } } : {}),
    })
    if (eVerifica) {
      setError(/captcha/i.test(eVerifica.message)
        ? 'Falta la verificacion CAPTCHA. Espera a que termine y vuelve a intentar.'
        : 'Tu contrasena actual no es correcta.')
      limpiarCaptcha(); setGuardando(false); return
    }

    // 2. Ahora si, cambiarla.
    const { error: eCambio } = await supabase.auth.updateUser({ password: nueva })
    if (eCambio) { setError(eCambio.message); limpiarCaptcha(); setGuardando(false); return }

    setActual(''); setNueva(''); setRepetir(''); limpiarCaptcha()
    setGuardando(false)
    setExito('Listo. Tu contrasena quedo cambiada. La proxima vez entra con la nueva.')
  }

  return (
    <div style={s.fondo}>
      <div style={s.caja}>
        <h2 style={s.titulo}>Mi cuenta</h2>
        <p style={s.dato}><strong>{perfil?.nombre}</strong></p>
        <p style={s.dato}>Entras con: {comoSeVe(perfil)}</p>

        <h3 style={s.sub}>Cambiar mi contraseña</h3>
        <p style={s.nota}>
          Nadie mas la va a conocer. Si crees que alguien vio la tuya, cambiala aqui mismo
          sin tener que pedirsela a nadie.
        </p>

        <label style={s.label}>Contraseña actual</label>
        <input style={s.input} type="password" value={actual} autoFocus
          onChange={e => setActual(e.target.value)} />

        <label style={s.label}>Contraseña nueva</label>
        <input style={s.input} type="password" value={nueva}
          onChange={e => setNueva(e.target.value)} placeholder="Mínimo 8 caracteres" />

        <label style={s.label}>Repítela</label>
        <input style={s.input} type="password" value={repetir}
          onChange={e => setRepetir(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && guardar()} />

        <div style={{ marginTop: 14 }}><Captcha onToken={setCaptcha} /></div>

        {error && <p style={s.error}>{error}</p>}
        {exito && <p style={s.exito}>{exito}</p>}

        <button
          style={{ ...s.boton, opacity: (guardando || (CAPTCHA_ACTIVO && !captcha)) ? 0.6 : 1 }}
          onClick={guardar}
          disabled={guardando || (CAPTCHA_ACTIVO && !captcha)}>
          {guardando ? 'Guardando...' : 'Cambiar mi contraseña'}
        </button>
        <button style={s.volver} onClick={onVolver}>Volver</button>
      </div>
    </div>
  )
}

const s = {
  fondo: { padding: '28px', display: 'flex', justifyContent: 'center' },
  caja: { background: '#fff', padding: '28px', borderRadius: 8, boxShadow: '0 2px 12px rgba(0,0,0,.06)', width: '100%', maxWidth: 440 },
  titulo: { margin: '0 0 12px', fontSize: 19 },
  dato: { margin: '0 0 4px', fontSize: 13, color: '#555' },
  sub: { margin: '22px 0 6px', fontSize: 15 },
  nota: { margin: '0 0 16px', fontSize: 12.5, color: '#666', lineHeight: 1.6 },
  label: { display: 'block', fontSize: 12, color: '#444', marginBottom: 4, marginTop: 12 },
  input: { width: '100%', padding: 10, fontSize: 14, border: '1px solid #ccc', borderRadius: 4, boxSizing: 'border-box' },
  error: { color: '#c62828', fontSize: 13, margin: '12px 0 0' },
  exito: { color: '#2e7d32', fontSize: 13, margin: '12px 0 0' },
  boton: { width: '100%', marginTop: 18, padding: 11, fontSize: 14, background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' },
  volver: { width: '100%', marginTop: 8, padding: 9, fontSize: 13, background: 'transparent', color: '#666', border: 'none', cursor: 'pointer' },
}
