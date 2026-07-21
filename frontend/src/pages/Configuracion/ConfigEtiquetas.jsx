import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../context/AuthContext'
import EtiquetaProducto, { CONFIG_DEFECTO } from '../../components/EtiquetaProducto'
import PortalImpresion from '../../components/PortalImpresion'
import { imprimirAislado } from '../../lib/impresion'

// Configuracion de la etiqueta de material: tamano fisico, campos visibles y
// tamanos de fuente. Pensado para que cada empresa la ajuste a su impresora
// (Zebra 4x2, 4x6, etc.) sin tocar codigo. Vista previa en vivo.

const CAMPOS = [
  { clave: 'logo', label: 'Logo de la empresa' },
  { clave: 'numero_parte', label: 'Numero de parte del cliente' },
  { clave: 'descripcion', label: 'Descripcion' },
  { clave: 'snp', label: 'SNP / cantidad' },
  { clave: 'lado', label: 'Lado (RH / LH)' },
  { clave: 'tipo', label: 'Tipo (PT / WIP / MP)' },
  { clave: 'lote', label: 'Lote' },
  { clave: 'maquina', label: 'Maquina' },
  { clave: 'cliente', label: 'Cliente' },
  { clave: 'fecha', label: 'Fecha' },
  { clave: 'hora', label: 'Hora' },
  { clave: 'sello', label: 'Recuadro de sello' },
  { clave: 'qr', label: 'Codigo QR (lote)' },
]

const TAMANOS = [
  { clave: 'numero_parte', label: 'Numero de parte (pt)', min: 8, max: 40 },
  { clave: 'descripcion', label: 'Descripcion (pt)', min: 6, max: 30 },
  { clave: 'snp', label: 'SNP / cantidad (pt)', min: 10, max: 48 },
  { clave: 'lado', label: 'Lado RH/LH (pt)', min: 8, max: 40 },
  { clave: 'tipo', label: 'Tipo PT/WIP (pt)', min: 8, max: 40 },
  { clave: 'lote', label: 'Lote (pt)', min: 6, max: 24 },
  { clave: 'fecha', label: 'Fecha (pt)', min: 6, max: 24 },
  { clave: 'qr_in', label: 'Tamano del QR (in)', min: 0.4, max: 2, paso: 0.02 },
]

const TAMANOS_COMUNES = [
  { label: '4 x 2 in (Zebra estandar)', ancho: 4, alto: 2 },
  { label: '4 x 3 in', ancho: 4, alto: 3 },
  { label: '4 x 6 in (embarque)', ancho: 4, alto: 6 },
  { label: '3 x 2 in', ancho: 3, alto: 2 },
]

const EJEMPLO = {
  numeroParte: 'T20 - 51301 - 3000', codigoInterno: 'SH1LA001A0000G10',
  descripcion: 'SEAT A RH', cantidad: 780, lote: '260721-1-001', maquina: 'INY-01',
  cliente: 'Cliente ejemplo', lado: 'RH', tipo: 'PT', logoUrl: '', empresa: 'Mi Empresa',
  fecha: '21/07/2026', hora: '12:27 p.m.',
}

export default function ConfigEtiquetas() {
  const { perfil, tienePermiso } = useAuth()
  const puedeEditar = tienePermiso('config_etiquetas', 'editar')

  const [cfg, setCfg] = useState(null)
  const [empresa, setEmpresa] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [exito, setExito] = useState('')
  const [guardando, setGuardando] = useState(false)

  useEffect(() => { cargar() }, [])

  const cargar = async () => {
    setLoading(true)
    const [c, e] = await Promise.all([
      supabase.from('config_etiquetas').select('*').eq('empresa_id', perfil.empresa_id).maybeSingle(),
      supabase.from('empresas').select('nombre, logo_url').eq('id', perfil.empresa_id).maybeSingle(),
    ])
    setCfg(c.data || { empresa_id: perfil.empresa_id, nombre: 'Etiqueta de producto', ...CONFIG_DEFECTO })
    setEmpresa(e.data || null)
    setLoading(false)
  }

  const setCampo = (clave, valor) => setCfg(c => ({ ...c, campos: { ...CONFIG_DEFECTO.campos, ...c.campos, [clave]: valor } }))
  const setTamano = (clave, valor) => setCfg(c => ({ ...c, tamanos: { ...CONFIG_DEFECTO.tamanos, ...c.tamanos, [clave]: Number(valor) } }))

  const guardar = async () => {
    setError(''); setExito(''); setGuardando(true)
    const datos = {
      empresa_id: perfil.empresa_id, nombre: cfg.nombre || 'Etiqueta de producto',
      ancho_in: Number(cfg.ancho_in), alto_in: Number(cfg.alto_in),
      campos: { ...CONFIG_DEFECTO.campos, ...cfg.campos },
      tamanos: { ...CONFIG_DEFECTO.tamanos, ...cfg.tamanos },
    }
    const res = cfg.id
      ? await supabase.from('config_etiquetas').update(datos).eq('id', cfg.id)
      : await supabase.from('config_etiquetas').insert(datos)
    if (res.error) setError('Error: ' + res.error.message)
    else { setExito('Configuracion guardada'); await cargar() }
    setGuardando(false)
  }

  const restaurar = () => setCfg(c => ({ ...c, ...CONFIG_DEFECTO }))

  if (loading) return <p style={{ padding: '28px', color: '#666' }}>Cargando...</p>

  const campos = { ...CONFIG_DEFECTO.campos, ...cfg.campos }
  const tamanos = { ...CONFIG_DEFECTO.tamanos, ...cfg.tamanos }
  const ejemplo = { ...EJEMPLO, logoUrl: empresa?.logo_url || '', empresa: empresa?.nombre || 'Mi Empresa' }

  return (
    <div style={styles.container} className="aparecer">
      <div style={styles.encabezado}>
        <h2 style={styles.titulo}>Configuracion de Etiquetas</h2>
        {puedeEditar && (
          <div style={{ display: 'flex', gap: '10px' }}>
            <button style={styles.botonSec} onClick={restaurar}>Restaurar valores</button>
            <button style={styles.boton} onClick={guardar} disabled={guardando}>{guardando ? 'Guardando...' : 'Guardar'}</button>
          </div>
        )}
      </div>
      <p style={styles.ayuda}>Ajusta el tamano fisico, que campos se imprimen y el tamano de cada dato. La vista previa se actualiza al momento; el QR siempre contiene el codigo de lote.</p>

      {error && <p style={styles.error}>{error}</p>}
      {exito && <p style={styles.exito}>{exito}</p>}

      <div style={styles.columnas}>
        {/* Panel de ajustes */}
        <div style={styles.panel}>
          <h3 style={styles.subtitulo}>Tamano de la etiqueta</h3>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
            <div style={styles.campo}>
              <label style={styles.label}>Ancho (in)</label>
              <input type="number" step="0.1" min="1" style={styles.input} value={cfg.ancho_in}
                onChange={e => setCfg({ ...cfg, ancho_in: e.target.value })} disabled={!puedeEditar} />
            </div>
            <div style={styles.campo}>
              <label style={styles.label}>Alto (in)</label>
              <input type="number" step="0.1" min="1" style={styles.input} value={cfg.alto_in}
                onChange={e => setCfg({ ...cfg, alto_in: e.target.value })} disabled={!puedeEditar} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '18px' }}>
            {TAMANOS_COMUNES.map(t => (
              <button key={t.label} style={styles.chip} disabled={!puedeEditar}
                onClick={() => setCfg({ ...cfg, ancho_in: t.ancho, alto_in: t.alto })}>{t.label}</button>
            ))}
          </div>

          <h3 style={styles.subtitulo}>Campos a mostrar</h3>
          <div style={styles.grid}>
            {CAMPOS.map(c => (
              <label key={c.clave} style={styles.check}>
                <input type="checkbox" checked={!!campos[c.clave]} disabled={!puedeEditar}
                  onChange={e => setCampo(c.clave, e.target.checked)} />
                {c.label}
              </label>
            ))}
          </div>

          <h3 style={{ ...styles.subtitulo, marginTop: '18px' }}>Tamanos</h3>
          {TAMANOS.map(t => (
            <div key={t.clave} style={styles.filaTamano}>
              <span style={styles.labelTamano}>{t.label}</span>
              <input type="range" min={t.min} max={t.max} step={t.paso || 1} value={tamanos[t.clave]}
                onChange={e => setTamano(t.clave, e.target.value)} disabled={!puedeEditar} style={{ flex: 1 }} />
              <span style={styles.valorTamano}>{tamanos[t.clave]}</span>
            </div>
          ))}
        </div>

        {/* Vista previa */}
        <div style={styles.panel}>
          <h3 style={styles.subtitulo}>Vista previa</h3>
          <p style={{ fontSize: '12px', color: '#64748b', marginTop: 0 }}>Tamano real {cfg.ancho_in} x {cfg.alto_in} in</p>
          <style>{`@media print { @page { size: ${cfg.ancho_in}in ${cfg.alto_in}in; margin: 0; } }`}</style>
          <div style={styles.previa}>
            <EtiquetaProducto datos={ejemplo} config={{ ancho_in: cfg.ancho_in, alto_in: cfg.alto_in, campos, tamanos }} />
          </div>
          <PortalImpresion>
            <EtiquetaProducto datos={ejemplo} config={{ ancho_in: cfg.ancho_in, alto_in: cfg.alto_in, campos, tamanos }} />
          </PortalImpresion>
          <button style={{ ...styles.botonSec, marginTop: '14px' }} onClick={imprimirAislado}>Imprimir prueba</button>
        </div>
      </div>
    </div>
  )
}

const styles = {
  container: { padding: '28px' },
  encabezado: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' },
  titulo: { fontSize: '18px', fontWeight: '600', color: '#1a1a2e', margin: '0' },
  ayuda: { fontSize: '13px', color: '#64748b', margin: '0 0 18px', lineHeight: '1.5' },
  columnas: { display: 'flex', gap: '20px', alignItems: 'flex-start', flexWrap: 'wrap' },
  panel: { backgroundColor: '#fff', borderRadius: '10px', padding: '20px 24px', boxShadow: '0 1px 4px rgba(0,0,0,0.06)', flex: 1, minWidth: '340px' },
  subtitulo: { fontSize: '14px', fontWeight: '600', color: '#1a1a2e', margin: '0 0 10px' },
  campo: { display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 },
  label: { fontSize: '12px', fontWeight: '500', color: '#444' },
  input: { padding: '8px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '14px', outline: 'none', fontFamily: 'inherit' },
  chip: { padding: '5px 10px', backgroundColor: '#f1f5f9', border: '1px solid #e2e8f0', borderRadius: '20px', fontSize: '12px', cursor: 'pointer' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px' },
  check: { display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13px', cursor: 'pointer' },
  filaTamano: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' },
  labelTamano: { fontSize: '12px', color: '#444', width: '150px' },
  valorTamano: { fontSize: '12px', fontWeight: '600', width: '38px', textAlign: 'right' },
  previa: { border: '1px dashed #cbd5e1', borderRadius: '8px', padding: '14px', display: 'inline-block', backgroundColor: '#f8fafc' },
  boton: { padding: '9px 20px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '7px', fontSize: '14px', fontWeight: '500', cursor: 'pointer' },
  botonSec: { padding: '9px 20px', backgroundColor: '#fff', color: '#444', border: '1px solid #ddd', borderRadius: '7px', fontSize: '14px', cursor: 'pointer' },
  error: { color: '#dc2626', fontSize: '13px', marginBottom: '12px' },
  exito: { color: '#16a34a', fontSize: '13px', marginBottom: '12px' },
}
