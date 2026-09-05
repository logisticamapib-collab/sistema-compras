import { useEffect, useRef } from 'react'

// Widget de Cloudflare Turnstile.
//
// Vive aqui y no dentro del login porque hay mas de un lugar que necesita
// verificar una contrasena: entrar, y cambiar la propia. Si el widget viviera
// en una sola pantalla, la otra tendria una copia, y el dia que Cloudflare
// cambie algo habria que acordarse de los dos lugares.
//
// Se activa con VITE_TURNSTILE_SITE_KEY. Si no esta, este componente no pinta
// nada y CAPTCHA_ACTIVO es false: la aplicacion funciona igual que siempre.
// Asi una llave que falta no deja a nadie afuera.
//
// OJO: la llave del navegador y el secreto que se pone en Supabase van en
// pareja. Un secreto de produccion rechaza los tokens de prueba y al reves, y
// el mensaje de error no dice que ese es el problema.
export const CLAVE_CAPTCHA = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
export const CAPTCHA_ACTIVO = !!CLAVE_CAPTCHA

export default function Captcha({ onToken }) {
  const caja = useRef(null)
  const idWidget = useRef(null)

  useEffect(() => {
    if (!CAPTCHA_ACTIVO) return

    const pintar = () => {
      if (!window.turnstile || !caja.current || caja.current.dataset.listo) return
      caja.current.dataset.listo = '1'
      idWidget.current = window.turnstile.render(caja.current, {
        sitekey: CLAVE_CAPTCHA,
        callback: onToken,
        // Si el token caduca antes de que la persona apriete el boton, se
        // limpia para que no mande uno muerto y vea un error que no entiende.
        'expired-callback': () => onToken(''),
        'error-callback': () => onToken(''),
      })
    }

    if (window.turnstile) { pintar(); return }
    const et = document.createElement('script')
    et.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    et.async = true
    et.onload = pintar
    document.head.appendChild(et)
  }, [])

  if (!CAPTCHA_ACTIVO) return null
  return <div ref={caja} style={{ display: 'flex', justifyContent: 'center' }} />
}

// Para pedir un token nuevo despues de un intento fallido: el token es de un
// solo uso, y reusarlo falla por el captcha y no por la contrasena.
export function reiniciarCaptcha() {
  if (CAPTCHA_ACTIVO && window.turnstile) window.turnstile.reset()
}
