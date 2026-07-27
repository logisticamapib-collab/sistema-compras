import * as XLSX from 'xlsx'

// columnas: [{ label, get: (fila) => valor }]
export function exportarExcel(nombre, columnas, filas) {
  const aoa = [columnas.map(c => c.label)]
  filas.forEach(r => aoa.push(columnas.map(c => { const v = c.get(r); return v == null ? '' : v })))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'Datos')
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
