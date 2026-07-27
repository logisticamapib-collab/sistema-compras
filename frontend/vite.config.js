import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// HTTPS opcional para poder usar la camara desde el celular en la red local.
// La camara del navegador (getUserMedia) solo funciona en contexto seguro:
// https:// o localhost. Si el plugin basic-ssl esta instalado, se habilita
// HTTPS con certificado autofirmado; si no, corre normal en HTTP.
// Para activarlo:  npm i -D @vitejs/plugin-basic-ssl
export default defineConfig(async () => {
  const plugins = [react()]
  try {
    const m = await import('@vitejs/plugin-basic-ssl')
    plugins.push(m.default())
  } catch {
    // plugin no instalado: se corre en HTTP normal
  }
  return {
    plugins,
    server: { host: true },   // expone en la red local (equivale a --host)
  }
})
