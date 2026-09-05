import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { comoSeVe } from '../../lib/accesoInterno'

// Intentos de ingreso.
//
// Antes no habia forma de saber si alguien estaba probando contrasenas contra
// el sistema: auth.audit_log_entries estaba vacia y Supabase no guarda nada
// consultable. Ahora el hook PASSWORD_VERIFICATION_ATTEMPT escribe cada
// verificacion en intentos_ingreso, y esta pantalla es donde se ve.
//
// Lo importante no es el numero de fallos: es el PATRON. Seis fallos de una
// persona un lunes a las siete es alguien que no despierta. Sesenta fallos
// contra cinco cuentas distintas en diez minutos es un script.
//
// Lo que esta pantalla NO puede decir es de que direccion vinieron: el hook
// recibe user_id y si la contrasena era buena, nada mas. Contra un ataque
// automatizado el freno real es el CAPTCHA, no este registro.

const RANGOS = [
  { horas: 1, etiqueta: 'Ultima hora' },
  { horas: 24, etiqueta: 'Ultimas 24 horas' },
  { horas: 24 * 7, etiqueta: 'Ultimos 7 dias' },
  { horas: 24 * 30, etiqueta: 'Ultimos 30 dias' },
]

export default function Seguridad() {
  const [horas, setHoras] = useState(24)
  const [intentos, setIntentos] = useState([])
  const [usuarios, setUsuarios] = useState([])
  const [soloFallos, setSoloFallos] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => { cargar() }, [horas])

  const cargar = async () => {
    setLoading(true); setError('')
    const desde = new Date(Date.now() - horas * 3600 * 1000).toISOString()
    const [rInt, rUsr] = await Promise.all([
      supabase.from('intentos_ingreso').select('*').gte('momento', desde)
        .order('momento', { ascending: false }).limit(500),
      supabase.from('usuarios').select('id, nombre, email, numero_empleado, acceso_interno, activo'),
    ])
    if (rInt.error) setError(rInt.error.message)
    setIntentos(rInt.data || [])
    setUsuarios(rUsr.data || [])
    setLoading(false)
  }

  const usuarioDe = (id) => usuarios.find(u => u.id === id)
  const nombreDe = (id) => {
    const u = usuarioDe(id)
    return u ? `${u.nombre} (${comoSeVe(u)})` : (id ? 'usuario desconocido' : 'sin identificar')
  }

  const fallos = intentos.filter(i => !i.exito)
  const aciertos = intentos.length - fallos.length

  // Resumen por usuario, ordenado por fallos.
  const porUsuario = {}
  for (const i of intentos) {
    const k = i.user_id || 'sin_id'
    porUsuario[k] = porUsuario[k] || { id: i.user_id, fallos: 0, aciertos: 0, ultimo: i.momento }
    if (i.exito) porUsuario[k].aciertos++; else porUsuario[k].fallos++
    if (i.momento > porUsuario[k].ultimo) porUsuario[k].ultimo = i.momento
  }
  const resumen = Object.values(porUsuario).filter(x => x.fallos > 0).sort((a, b) => b.fallos - a.fallos)

  // La misma escalera que aplica el hook en la base. Si cambia alla, cambia aqui.
  const esperaDe = (n) => (n <= 5 ? 0 : n <= 10 ? 5 : n <= 20 ? 30 : 60)

  const lista = soloFallos ? fallos : intentos
  const fecha = (t) => new Date(t).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'medium' })

  return (
    <div>
      <h2 style={s.titulo}>Intentos de ingreso</h2>
      <p style={s.intro}>
        Cada vez que alguien escribe una contrasena, buena o mala, queda aqui. Lo que hay que buscar no es
        un numero alto de fallos sino un patron raro: muchos fallos contra varias cuentas en poco tiempo,
        o intentos a una hora en que nadie deberia estar entrando.
      </p>

      <div style={s.barra}>
        <select style={s.select} value={horas} onChange={e => setHoras(Number(e.target.value))}>
          {RANGOS.map(r => <option key={r.horas} value={r.horas}>{r.etiqueta}</option>)}
        </select>
        <label style={s.check}>
          <input type="checkbox" checked={soloFallos} onChange={e => setSoloFallos(e.target.checked)} />
          Solo los fallidos
        </label>
        <button style={s.boton} onClick={cargar}>Actualizar</button>
      </div>

      {error && <p style={s.error}>{error}</p>}
      {loading ? <p>Cargando...</p> : (
        <>
          <div style={s.tarjetas}>
            <div style={s.tarjeta}><span style={s.numero}>{aciertos}</span><span style={s.etiqueta}>ingresos correctos</span></div>
            <div style={{ ...s.tarjeta, borderColor: fallos.length > 20 ? '#dc2626' : '#e5e7eb' }}>
              <span style={{ ...s.numero, color: fallos.length > 20 ? '#dc2626' : '#111' }}>{fallos.length}</span>
              <span style={s.etiqueta}>intentos fallidos</span>
            </div>
            <div style={s.tarjeta}><span style={s.numero}>{resumen.length}</span><span style={s.etiqueta}>cuentas con fallos</span></div>
          </div>

          {intentos.length >= 500 && (
            <p style={s.aviso}>
              Se estan mostrando los 500 mas recientes del periodo. Si llegaste a este tope, acorta el rango:
              tantos intentos en tan poco tiempo ya es en si mismo el dato.
            </p>
          )}

          {resumen.length > 0 && (
            <>
              <h3 style={s.sub}>Cuentas con intentos fallidos</h3>
              <div style={s.tabla}>
                <div style={{ ...s.fila, ...s.encabezado }}>
                  <span style={{ flex: 3 }}>Usuario</span>
                  <span style={{ flex: 1 }}>Fallos</span>
                  <span style={{ flex: 1 }}>Correctos</span>
                  <span style={{ flex: 2 }}>Ultimo intento</span>
                  <span style={{ flex: 2 }}>Espera aplicada</span>
                </div>
                {resumen.map(x => (
                  <div key={x.id || 'sin'} style={s.fila}>
                    <span style={{ flex: 3 }}>{nombreDe(x.id)}</span>
                    <span style={{ flex: 1, color: x.fallos > 10 ? '#dc2626' : '#111', fontWeight: x.fallos > 10 ? 600 : 400 }}>{x.fallos}</span>
                    <span style={{ flex: 1 }}>{x.aciertos}</span>
                    <span style={{ flex: 2 }}>{fecha(x.ultimo)}</span>
                    <span style={{ flex: 2, color: '#666' }}>
                      {esperaDe(x.fallos) === 0 ? 'ninguna' : `${esperaDe(x.fallos)} s entre intentos`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}

          <h3 style={s.sub}>Detalle {soloFallos ? '(solo fallidos)' : ''}</h3>
          {lista.length === 0 ? <p style={{ color: '#666', fontSize: 13 }}>Nada en este periodo.</p> : (
            <div style={s.tabla}>
              <div style={{ ...s.fila, ...s.encabezado }}>
                <span style={{ flex: 2 }}>Momento</span>
                <span style={{ flex: 4 }}>Usuario</span>
                <span style={{ flex: 1 }}>Resultado</span>
              </div>
              {lista.slice(0, 200).map(i => (
                <div key={i.id} style={s.fila}>
                  <span style={{ flex: 2, fontSize: 12 }}>{fecha(i.momento)}</span>
                  <span style={{ flex: 4 }}>{nombreDe(i.user_id)}</span>
                  <span style={{ flex: 1, color: i.exito ? '#059669' : '#dc2626' }}>{i.exito ? 'entro' : 'fallo'}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

const s = {
  titulo: { margin: '0 0 8px', fontSize: 18 },
  intro: { margin: '0 0 16px', fontSize: 13, color: '#555', lineHeight: 1.6, maxWidth: 760 },
  barra: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' },
  select: { padding: '7px 10px', border: '1px solid #ccc', borderRadius: 4, fontSize: 13 },
  check: { fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: '#444' },
  boton: { padding: '7px 14px', background: '#2563eb', color: '#fff', border: 'none', borderRadius: 4, fontSize: 13, cursor: 'pointer' },
  tarjetas: { display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' },
  tarjeta: { border: '1px solid #e5e7eb', borderRadius: 6, padding: '12px 18px', minWidth: 140, display: 'flex', flexDirection: 'column', gap: 2 },
  numero: { fontSize: 24, fontWeight: 600 },
  etiqueta: { fontSize: 11.5, color: '#666' },
  aviso: { background: '#fff8e1', border: '1px solid #ffca28', borderRadius: 6, padding: 10, fontSize: 12.5, margin: '0 0 16px' },
  sub: { margin: '20px 0 8px', fontSize: 14 },
  tabla: { border: '1px solid #e5e7eb', borderRadius: 6, overflow: 'hidden' },
  fila: { display: 'flex', gap: 10, padding: '8px 12px', borderBottom: '1px solid #f1f1f1', fontSize: 13, alignItems: 'center' },
  encabezado: { background: '#f9fafb', fontWeight: 600, fontSize: 12, color: '#555' },
  error: { color: '#dc2626', fontSize: 13 },
}
