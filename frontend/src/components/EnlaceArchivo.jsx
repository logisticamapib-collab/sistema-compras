import { useState } from 'react'
import { enlaceDe } from '../lib/archivos'

// Enlace a un archivo guardado. Se ve como un enlace normal, pero el enlace
// real se pide al hacer clic y dura una hora.
//
// La ventana se abre DENTRO del clic, antes de esperar la respuesta. Si se
// abriera despues, el navegador la bloquea por considerarla emergente: es el
// mismo tropiezo que ya nos costo la ficha del molde.
export default function EnlaceArchivo({ valor, children, style, title }) {
  const [abriendo, setAbriendo] = useState(false)

  const abrir = async (e) => {
    e.preventDefault()
    if (abriendo || !valor) return
    setAbriendo(true)

    const ventana = window.open('', '_blank')
    const { url, error } = await enlaceDe(valor)
    setAbriendo(false)

    if (error || !url) {
      const msg = 'No se pudo abrir el archivo. ' + (error || '')
      if (ventana) {
        ventana.document.write(`<p style="font-family:sans-serif;padding:24px">${msg}</p>`)
        ventana.document.close()
      } else {
        window.alert(msg)
      }
      return
    }
    if (ventana) ventana.location = url
    else window.location.href = url
  }

  if (!valor) return null
  return (
    <a href="#" onClick={abrir} style={style} title={title}>
      {abriendo ? 'Abriendo...' : children}
    </a>
  )
}
