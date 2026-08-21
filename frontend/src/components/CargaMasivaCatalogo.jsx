import { useState } from 'react'
import * as XLSX from 'xlsx'
import { supabase } from '../lib/supabase'

// Carga masiva de un catalogo simple (clientes, proveedores, y lo que venga)
// por plantilla de Excel. Se describe el catalogo con una lista de columnas y
// este componente se encarga de todo lo demas: genera la plantilla, la lee,
// valida fila por fila y muestra que paso con cada una antes de escribir nada.
//
// Por que un componente y no una pantalla de "Carga masiva" mas:
// la carga vive dentro del catalogo que carga, asi hereda su permiso y el
// usuario no tiene que ir a buscarla a otro menu. Una pantalla central que
// crece con cada catalogo nuevo es justo el tipo de lista escrita a mano que
// se desfasa.
//
// SOLO DA DE ALTA. Si el registro ya existe, la fila se marca con error y no
// se toca lo que ya estaba. Actualizar por archivo suena comodo hasta que una
// celda vacia borra un dato bueno y nadie se entera.
//
// Especificacion de una columna:
//   { campo, req, tipo: 'texto'|'num'|'bool'|'lista', opciones, upper, ayuda }

const boolCel = (v) => ['si', 'sí', 'x', '1', 'true', 'verdadero', 'y', 'yes'].includes(String(v ?? '').trim().toLowerCase())
const numCel = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isNaN(n) ? null : n }
const txt = (v) => String(v ?? '').trim()
const norm = (v) => txt(v).toLowerCase()

export default function CargaMasivaCatalogo({
  titulo,            // 'Clientes'
  tabla,             // 'clientes'
  columnas,          // [{ campo, req, tipo, ... }]
  dedupe = [],       // [{ campo, etiqueta }] campos que no pueden repetirse
  ejemplos = [],     // filas de ejemplo para la plantilla
  notas = [],        // lineas extra para la hoja de Instrucciones
  existentes = [],   // registros ya en el sistema, para detectar duplicados
  empresaId,
  puedeCargar = false,
  onCargado,
  onCerrar,
}) {
  const [filas, setFilas] = useState([])
  const [error, setError] = useState('')
  const [proc, setProc] = useState(false)
  const [resultado, setResultado] = useState(null)

  const cols = columnas.map(c => c.campo)

  const descargarPlantilla = () => {
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.aoa_to_sheet([cols, ...ejemplos])
    ws['!cols'] = cols.map(() => ({ wch: 18 }))
    XLSX.utils.book_append_sheet(wb, ws, titulo.slice(0, 28))

    const instr = [
      [`INSTRUCCIONES — Carga masiva de ${titulo}`],
      ['Esta plantilla SOLO da de alta. Si el registro ya existe, la fila se rechaza y no se modifica nada.'],
      ['No cambies los nombres de las columnas ni el orden de la primera fila.'],
      ['Borra las filas de ejemplo antes de subir el archivo.'],
      [''],
      ['Columna', 'Que va aqui'],
      ...columnas.map(c => [
        c.campo + (c.req ? ' (obligatorio)' : ''),
        c.ayuda || (c.tipo === 'bool' ? 'escribe si / no'
          : c.tipo === 'num' ? 'numero'
            : c.tipo === 'lista' ? (c.opciones || []).join(' / ')
              : 'texto'),
      ]),
      ...(notas.length ? [[''], ['NOTAS'], ...notas.map(n => [n])] : []),
    ]
    const wsi = XLSX.utils.aoa_to_sheet(instr)
    wsi['!cols'] = [{ wch: 30 }, { wch: 70 }]
    XLSX.utils.book_append_sheet(wb, wsi, 'Instrucciones')
    XLSX.writeFile(wb, `plantilla_${tabla}.xlsx`)
  }

  const leer = (e) => {
    setError(''); setResultado(null); setFilas([])
    const f = e.target.files?.[0]
    if (!f) return
    const reader = new FileReader()
    reader.onload = (ev) => {
      try {
        const wb = XLSX.read(ev.target.result, { type: 'array' })
        // Se busca la hoja por nombre; si el usuario la renombro, se toma la primera.
        const ws = wb.Sheets[titulo.slice(0, 28)] || wb.Sheets[wb.SheetNames[0]]
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
        if (!rows.length) { setError('El archivo no tiene filas de datos.'); return }
        validar(rows)
      } catch (err) {
        setError('No se pudo leer el archivo: ' + err.message)
      }
    }
    reader.readAsArrayBuffer(f)
    e.target.value = ''
  }

  const validar = (rows) => {
    // vistos: por cada campo de dedupe, lo que ya salio en ESTE archivo.
    const vistos = {}
    dedupe.forEach(d => { vistos[d.campo] = new Set() })

    const out = rows.map((r, i) => {
      const err = []
      const payload = { empresa_id: empresaId, activo: true }

      for (const c of columnas) {
        const crudo = r[c.campo]
        if (c.tipo === 'bool') {
          payload[c.campo] = boolCel(crudo)
          continue
        }
        if (c.tipo === 'num') {
          const n = numCel(crudo)
          if (c.req && n == null) err.push(`${c.campo} vacio o no numerico`)
          else if (txt(crudo) && n == null) err.push(`${c.campo} no es un numero`)
          payload[c.campo] = n ?? (c.defecto ?? null)
          continue
        }
        let v = txt(crudo)
        if (c.upper) v = v.toUpperCase()
        if (c.tipo === 'lista' && v) {
          const op = (c.opciones || []).find(o => norm(o) === norm(v))
          if (!op) err.push(`${c.campo} debe ser: ${(c.opciones || []).join(' / ')}`)
          else v = op
        }
        if (c.req && !v) err.push(`${c.campo} vacio`)
        payload[c.campo] = v || null
      }

      // Duplicados: contra el archivo y contra lo que ya esta en el sistema.
      for (const d of dedupe) {
        const v = norm(payload[d.campo])
        if (!v) continue
        if (vistos[d.campo].has(v)) err.push(`${d.etiqueta} repetida en el archivo`)
        else vistos[d.campo].add(v)
        if (existentes.some(x => norm(x[d.campo]) === v)) err.push(`${d.etiqueta} ya existe en el sistema`)
      }

      const etiqueta = txt(r[columnas.find(c => c.req)?.campo]) || txt(r[cols[0]])
      return { n: i + 2, payload, errores: err, etiqueta }
    })
    setFilas(out)
  }

  const cargar = async () => {
    setError(''); setProc(true)
    const validas = filas.filter(f => f.errores.length === 0)
    let ok = 0
    const fallos = []
    // Una por una a proposito: si la fila 40 choca, las 39 buenas ya entraron
    // y el reporte dice exactamente cual fallo y por que.
    for (const f of validas) {
      const { error: e } = await supabase.from(tabla).insert(f.payload)
      if (e) fallos.push({ n: f.n, etiqueta: f.etiqueta, msg: e.message.includes('duplicate key') ? 'ya existe en el sistema' : e.message })
      else ok++
    }
    setResultado({ ok, fallos })
    setFilas([])
    setProc(false)
    if (onCargado) await onCargado()
  }

  const conError = filas.filter(f => f.errores.length > 0).length
  const validas = filas.length - conError

  return (
    <div style={S.caja}>
      <div style={S.encab}>
        <h3 style={S.titulo}>Carga masiva de {titulo}</h3>
        {onCerrar && <button style={S.btnSec} onClick={onCerrar}>Cerrar</button>}
      </div>

      {error && <p style={S.err}>{error}</p>}

      <div style={S.pasos}>
        <div style={S.paso}>
          <b>1.</b> Descarga la plantilla y llenala. Trae una hoja de Instrucciones.
          <button style={S.btnSec} onClick={descargarPlantilla}>Descargar plantilla</button>
        </div>
        <div style={S.paso}>
          <b>2.</b> Sube el archivo lleno (.xlsx). Se revisa antes de guardar nada.
          <label style={{ ...S.btn, opacity: puedeCargar ? 1 : 0.5, cursor: puedeCargar ? 'pointer' : 'not-allowed' }}>
            Subir archivo
            <input type="file" accept=".xlsx,.xls" disabled={!puedeCargar} style={{ display: 'none' }} onChange={leer} />
          </label>
        </div>
      </div>

      {!puedeCargar && <p style={S.aviso}>No tienes permiso para dar de alta en este catalogo.</p>}

      {filas.length > 0 && (
        <>
          <p style={S.resumen}>
            {filas.length} filas · <b style={{ color: '#16a34a' }}>{validas} validas</b>
            {conError ? <span style={{ color: '#dc2626' }}> · {conError} con error</span> : ''}
          </p>
          <div style={S.tabla}>
            <div style={S.th}>
              <span style={{ width: 50 }}>Fila</span>
              <span style={{ flex: 1 }}>Registro</span>
              <span style={{ flex: 2 }}>Revision</span>
            </div>
            {filas.slice(0, 300).map((f, i) => (
              <div key={i} style={S.tr}>
                <span style={{ width: 50, color: '#64748b' }}>{f.n}</span>
                <span style={{ flex: 1, fontWeight: 600 }}>{f.etiqueta || '-'}</span>
                <span style={{ flex: 2 }}>
                  {f.errores.length === 0
                    ? <span style={S.pillOk}>OK</span>
                    : <span style={S.errTxt}>{f.errores.join(' · ')}</span>}
                </span>
              </div>
            ))}
            {filas.length > 300 && <div style={{ ...S.tr, color: '#64748b' }}>… y {filas.length - 300} filas mas (se cargan todas las validas)</div>}
          </div>
          {puedeCargar && validas > 0 && (
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <button style={S.btn} onClick={cargar} disabled={proc}>
                {proc ? 'Cargando...' : `Cargar ${validas} validos`}
              </button>
            </div>
          )}
        </>
      )}

      {resultado && (
        <div style={S.result}>
          <p style={{ margin: 0 }}><b>Cargados:</b> {resultado.ok}</p>
          {resultado.fallos.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <b style={{ color: '#dc2626' }}>Con error:</b>
              {resultado.fallos.map((x, i) => (
                <div key={i} style={S.errTxt}>Fila {x.n} ({x.etiqueta}): {x.msg}</div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const S = {
  caja: { background: '#fff', borderRadius: 10, padding: 24, marginBottom: 20, boxShadow: '0 1px 4px rgba(0,0,0,0.06)' },
  encab: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  titulo: { fontSize: 15, fontWeight: 600, color: '#1a1a2e', margin: 0 },
  pasos: { display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 },
  paso: { flex: 1, minWidth: 280, background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 8, padding: 16, fontSize: 13, color: '#334155', display: 'flex', flexDirection: 'column', gap: 10 },
  resumen: { fontSize: 13, color: '#334155', margin: '10px 0 8px' },
  tabla: { border: '1px solid #eef2f7', borderRadius: 8, overflow: 'hidden' },
  th: { display: 'flex', padding: '10px 16px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: 11, fontWeight: 600, color: '#64748b', textTransform: 'uppercase' },
  tr: { display: 'flex', padding: '9px 16px', borderBottom: '1px solid #f1f5f9', alignItems: 'center', fontSize: 13 },
  result: { marginTop: 14, background: '#f8fafc', border: '1px solid #eef2f7', borderRadius: 8, padding: 16, fontSize: 13 },
  btn: { padding: '9px 18px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 7, fontSize: 14, fontWeight: 500, cursor: 'pointer', textAlign: 'center' },
  btnSec: { padding: '8px 14px', background: '#fff', color: '#2563eb', border: '1px solid #2563eb', borderRadius: 7, fontSize: 13, cursor: 'pointer' },
  pillOk: { padding: '2px 10px', borderRadius: 20, fontSize: 11, fontWeight: 700, background: '#dcfce7', color: '#15803d' },
  errTxt: { color: '#dc2626', fontSize: 12 },
  err: { color: '#dc2626', fontSize: 13, marginBottom: 12 },
  aviso: { color: '#b45309', fontSize: 13, margin: '4px 0 0' },
}
