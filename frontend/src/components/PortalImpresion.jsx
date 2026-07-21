import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

// Monta su contenido como hijo directo de <body> dentro de .contenedor-impresion.
// En pantalla no se ve (CSS lo oculta); al imprimir con imprimirAislado() es lo
// unico que sale en el papel.

export default function PortalImpresion({ children }) {
  const [nodo, setNodo] = useState(null)

  useEffect(() => {
    const div = document.createElement('div')
    div.className = 'contenedor-impresion'
    document.body.appendChild(div)
    setNodo(div)
    return () => { if (div.parentNode) div.parentNode.removeChild(div) }
  }, [])

  if (!nodo) return null
  return createPortal(children, nodo)
}
