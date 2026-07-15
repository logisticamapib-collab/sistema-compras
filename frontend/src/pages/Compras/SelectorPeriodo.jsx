export default function SelectorPeriodo({ periodo, setPeriodo }) {
  return (
    <div style={styles.container}>
      <select style={styles.select} value={periodo.tipo}
        onChange={e => setPeriodo({ ...periodo, tipo: e.target.value })}>
        <option value="semana_actual">Semana actual</option>
        <option value="mes_actual">Mes actual</option>
        <option value="ultimos_n_meses">Ultimos N meses</option>
        <option value="rango_personalizado">Rango de fechas personalizado</option>
      </select>

      {periodo.tipo === 'ultimos_n_meses' && (
        <div style={styles.inline}>
          <input style={styles.inputN} type="number" min="1" max="36"
            value={periodo.valor || 1}
            onChange={e => setPeriodo({ ...periodo, valor: e.target.value })} />
          <span style={styles.textoInline}>mes(es)</span>
        </div>
      )}

      {periodo.tipo === 'rango_personalizado' && (
        <div style={styles.inline}>
          <input style={styles.inputFecha} type="date" value={periodo.desde || ''}
            onChange={e => setPeriodo({ ...periodo, desde: e.target.value })} />
          <span style={styles.textoInline}>a</span>
          <input style={styles.inputFecha} type="date" value={periodo.hasta || ''}
            onChange={e => setPeriodo({ ...periodo, hasta: e.target.value })} />
        </div>
      )}
    </div>
  )
}

const styles = {
  container: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
  select: { padding: '8px 12px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px', backgroundColor: '#fff' },
  inline: { display: 'flex', alignItems: 'center', gap: '6px' },
  inputN: { width: '55px', padding: '7px 8px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px' },
  inputFecha: { padding: '7px 8px', borderRadius: '7px', border: '1px solid #ddd', fontSize: '13px' },
  textoInline: { fontSize: '12px', color: '#666' },
}