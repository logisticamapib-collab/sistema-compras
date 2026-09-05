import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// HTTP o HTTPS, segun como se arranque. Antes bastaba con que el plugin
// basic-ssl estuviera instalado para que el servidor se volviera HTTPS, y eso
// hacia imposible entrar desde otra maquina de la red sin pelearse con el
// aviso de certificado no confiable: el certificado autofirmado se emite para
// localhost, no para la IP con la que te ven los demas equipos.
//
//   npm run dev        -> http://<tu-ip>:5173   entrar desde otro equipo
//   npm run dev:https  -> https://localhost     usar la camara del celular
//
// La diferencia importa por una sola cosa: getUserMedia -- la camara que usa
// el escaner de codigos -- solo funciona en "contexto seguro". localhost
// cuenta como seguro aunque sea http; http://192.168.x.x NO. Entonces:
//
//   en HTTP  desde otro equipo: todo el sistema funciona, MENOS el escaner
//                               de camara, que avisa y deja capturar a mano.
//   en HTTPS desde otro equipo: el escaner funciona, pero el navegador
//                               reclama el certificado en cada equipo.
//
// Las llamadas a Supabase van por https:// de todas formas, asi que servir la
// pagina por HTTP no expone los datos en la red: lo que viaja sin cifrar es
// el HTML y el JavaScript, no la sesion ni las consultas.
export default defineConfig(async ({ mode }) => {
  const plugins = [react()]

  if (mode === 'https') {
    try {
      const m = await import('@vitejs/plugin-basic-ssl')
      plugins.push(m.default())
    } catch {
      console.warn('\n  Se pidio HTTPS pero falta el plugin. Instalalo con:\n'
        + '    npm i -D @vitejs/plugin-basic-ssl\n'
        + '  Mientras tanto se arranca en HTTP.\n')
    }
  }

  return {
    plugins,
    // host: true expone el servidor en la red local. La primera vez, Windows
    // pregunta si permite Node en redes privadas: hay que decir que si, o el
    // resto de los equipos no lo alcanzan aunque el servidor este corriendo.
    server: { host: true },
  }
})
