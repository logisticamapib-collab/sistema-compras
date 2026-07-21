// Impresion aislada: marca el body para que solo se imprima el contenedor
// del portal (.contenedor-impresion) y no la pantalla completa.

export function imprimirAislado() {
  const body = document.body
  body.classList.add('modo-aislado')
  const limpiar = () => {
    body.classList.remove('modo-aislado')
    window.removeEventListener('afterprint', limpiar)
  }
  window.addEventListener('afterprint', limpiar)
  window.print()
  // Respaldo por si el navegador no dispara afterprint
  setTimeout(limpiar, 2000)
}
