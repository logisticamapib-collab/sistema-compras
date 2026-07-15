const UNIDADES = ['', 'UNO', 'DOS', 'TRES', 'CUATRO', 'CINCO', 'SEIS', 'SIETE', 'OCHO', 'NUEVE']
const DECENAS = ['DIEZ', 'ONCE', 'DOCE', 'TRECE', 'CATORCE', 'QUINCE', 'DIECISEIS', 'DIECISIETE', 'DIECIOCHO', 'DIECINUEVE']
const DIEZ_A_NOVENTA = ['', '', 'VEINTE', 'TREINTA', 'CUARENTA', 'CINCUENTA', 'SESENTA', 'SETENTA', 'OCHENTA', 'NOVENTA']
const CENTENAS = ['', 'CIENTO', 'DOSCIENTOS', 'TRESCIENTOS', 'CUATROCIENTOS', 'QUINIENTOS', 'SEISCIENTOS', 'SETECIENTOS', 'OCHOCIENTOS', 'NOVECIENTOS']

function convertirGrupo(n) {
  if (n === 0) return ''
  if (n === 100) return 'CIEN'
  let texto = ''
  const c = Math.floor(n / 100)
  const resto = n % 100
  if (c > 0) texto += CENTENAS[c] + ' '
  if (resto >= 10 && resto < 20) {
    texto += DECENAS[resto - 10]
  } else {
    const d = Math.floor(resto / 10)
    const u = resto % 10
    if (d >= 2) {
      texto += DIEZ_A_NOVENTA[d]
      if (u > 0) texto += ' Y ' + UNIDADES[u]
    } else if (resto > 0) {
      texto += UNIDADES[u]
    }
  }
  return texto.trim()
}

export function numeroALetras(numero, moneda = 'MXN') {
  const entero = Math.floor(Math.abs(numero))
  const centavos = Math.round((Math.abs(numero) - entero) * 100)

  let texto = ''
  if (entero === 0) {
    texto = 'CERO'
  } else {
    const millones = Math.floor(entero / 1000000)
    const miles = Math.floor((entero % 1000000) / 1000)
    const cientos = entero % 1000

    if (millones > 0) {
      texto += (millones === 1 ? 'UN MILLON ' : convertirGrupo(millones) + ' MILLONES ')
    }
    if (miles > 0) {
      texto += (miles === 1 ? 'MIL ' : convertirGrupo(miles) + ' MIL ')
    }
    if (cientos > 0) {
      texto += convertirGrupo(cientos)
    }
  }

  const nombreMoneda = { MXN: 'PESOS', USD: 'DOLARES', EUR: 'EUROS' }[moneda] || 'PESOS'
  const sufijo = moneda === 'USD' ? 'USD' : moneda === 'EUR' ? 'EUR' : 'M.N.'
  return `${texto.trim()} ${nombreMoneda} ${centavos.toString().padStart(2, '0')}/100 ${sufijo}`
}