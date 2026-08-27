import * as XLSX from 'xlsx'

// columnas: [{ label, get: (fila) => valor }]
export function exportarExcel(nombre, columnas, filas) {
  const aoa = [columnas.map(c => c.label)]
  filas.forEach(r => aoa.push(columnas.map(c => { const v = c.get(r); return v == null ? '' : v })))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Datos')
  XLSX.writeFile(wb, `${nombre}.xlsx`)
}

// Varias hojas en un solo archivo, para cuando el reporte no cabe en una tabla
// plana: un molde y sus cavidades son dos niveles distintos y aplanarlos
// repite el encabezado en cada renglon.
// hojas: [{ nombre, columnas, filas }]
export function exportarExcelHojas(nombre, hojas) {
  const wb = XLSX.utils.book_new()
  hojas.forEach(h => {
    const aoa = [h.columnas.map(c => c.label)]
    ;(h.filas || []).forEach(r => aoa.push(h.columnas.map(c => { const v = c.get(r); return v == null ? '' : v })))
    const ws = XLSX.utils.aoa_to_sheet(aoa)
    ws['!cols'] = h.columnas.map(c => ({ wch: Math.max(12, String(c.label).length + 4) }))
    // Excel corta los nombres de hoja a 31 caracteres y no acepta : \ / ? * [ ]
    XLSX.utils.book_append_sheet(wb, ws, String(h.nombre).replace(/[:\\/?*[\]]/g, '-').slice(0, 31))
  })
  XLSX.writeFile(wb, `${nombre}.xlsx`)
}

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[s]))

// Imprime SOLO la tabla en una ventana aparte (no toma la pantalla de la app).
export function imprimirTablaPDF(titulo, columnas, filas) {
  const w = window.open('', '_blank', 'width=1024,height=720')
  if (!w) { alert('Permite las ventanas emergentes para descargar el PDF.'); return }
  const th = columnas.map(c => `<th>${esc(c.label)}</th>`).join('')
  const trs = filas.map(r => `<tr>${columnas.map(c => `<td>${esc(c.get(r))}</td>`).join('')}</tr>`).join('')
  const fecha = new Date().toLocaleString('es-MX')
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>
      @page { margin: 12mm; }
      body { font-family: Arial, sans-serif; color: #1a1a2e; }
      h2 { font-size: 16px; margin: 0 0 2px; }
      .sub { color: #64748b; font-size: 11px; margin: 0 0 12px; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; }
      th { background: #f1f5f9; }
      tr:nth-child(even) td { background: #f8fafc; }
    </style></head><body>
    <h2>${esc(titulo)}</h2><p class="sub">${filas.length} registro(s) &middot; ${esc(fecha)}</p>
    <table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>
    </body></html>`)
  w.document.close(); w.focus()
  setTimeout(() => { w.print() }, 350)
}

// Ficha de UN registro: un encabezado de campo/valor y las tablas que lo
// acompanan. Es el papel que se pega en el tooling o se le entrega al auditor,
// donde una tabla plana no sirve porque lo que se quiere ver es un objeto y su
// detalle, no una lista.
// datos:  [[etiqueta, valor], ...]
// tablas: [{ titulo, columnas, filas, vacio }]
//
// `ventana` es opcional y existe por una razon concreta: el navegador solo
// deja abrir una ventana durante el gesto del usuario. Si la ficha necesita
// consultar datos antes de armarse, hay que abrir la ventana en el clic con
// abrirVentanaFicha(), esperar los datos, y pasarla aqui. Abrirla despues del
// await la bloquea el navegador.
export function imprimirFichaPDF(titulo, subtitulo, datos, tablas, ventana) {
  const w = ventana || window.open('', '_blank', 'width=1024,height=720')
  if (!w) { alert('Permite las ventanas emergentes para descargar el PDF.'); return }
  const fecha = new Date().toLocaleString('es-MX')
  const campos = (datos || []).map(([k, v]) =>
    `<div class="campo"><span class="k">${esc(k)}</span><span class="v">${esc(v)}</span></div>`).join('')
  const secciones = (tablas || []).map(t => {
    if (!t.filas || t.filas.length === 0) {
      return `<h3>${esc(t.titulo)}</h3><p class="vacio">${esc(t.vacio || 'Sin registros.')}</p>`
    }
    const th = t.columnas.map(c => `<th>${esc(c.label)}</th>`).join('')
    const trs = t.filas.map(r => `<tr>${t.columnas.map(c => `<td>${esc(c.get(r))}</td>`).join('')}</tr>`).join('')
    return `<h3>${esc(t.titulo)}</h3><table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`
  }).join('')

  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title>
    <style>
      @page { margin: 12mm; }
      body { font-family: Arial, sans-serif; color: #1a1a2e; }
      h2 { font-size: 17px; margin: 0 0 2px; }
      h3 { font-size: 12px; margin: 16px 0 6px; text-transform: uppercase; letter-spacing: .4px; color: #475569; }
      .sub { color: #64748b; font-size: 11px; margin: 0 0 14px; }
      .datos { display: flex; flex-wrap: wrap; gap: 6px 0; border: 1px solid #cbd5e1; border-radius: 4px; padding: 8px 10px; }
      .campo { width: 33%; font-size: 11px; display: flex; flex-direction: column; padding: 2px 0; }
      .k { color: #64748b; font-size: 9.5px; text-transform: uppercase; letter-spacing: .3px; }
      .v { font-weight: 600; }
      table { border-collapse: collapse; width: 100%; font-size: 11px; }
      th, td { border: 1px solid #cbd5e1; padding: 5px 7px; text-align: left; }
      th { background: #f1f5f9; }
      tr:nth-child(even) td { background: #f8fafc; }
      .vacio { font-size: 11px; color: #94a3b8; }
    </style></head><body>
    <h2>${esc(titulo)}</h2><p class="sub">${esc(subtitulo || '')}${subtitulo ? ' &middot; ' : ''}${esc(fecha)}</p>
    <div class="datos">${campos}</div>
    ${secciones}
    </body></html>`)
  w.document.close(); w.focus()
  setTimeout(() => { w.print() }, 350)
}

// Abre la ventana de la ficha durante el clic y le pone un aviso mientras se
// preparan los datos. Devuelve null si el navegador la bloqueo.
export function abrirVentanaFicha(mensaje = 'Preparando la ficha...') {
  const w = window.open('', '_blank', 'width=1024,height=720')
  if (!w) { alert('Permite las ventanas emergentes para poder imprimir la ficha.'); return null }
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(mensaje)}</title></head>
    <body style="font-family:Arial,sans-serif;color:#64748b;padding:40px">${esc(mensaje)}</body></html>`)
  return w
}

// Si algo falla despues de haber abierto la ventana, hay que decirlo ahi
// dentro: dejarla en blanco parece que el sistema se colgo.
export function fallaEnVentana(w, mensaje) {
  if (!w) return
  w.document.open()
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>No se pudo armar la ficha</title></head>
    <body style="font-family:Arial,sans-serif;color:#dc2626;padding:40px">${esc(mensaje)}</body></html>`)
  w.document.close()
}
