import { supabase } from './supabase'

// Envia un correo usando la Edge Function send-email.
// perfilQuienActua = perfil del usuario que realizo la accion (para el nombre visible y reply-to)
export async function enviarCorreo({ to, subject, html, perfilQuienActua }) {
  if (!to || to.length === 0) return

  try {
    await supabase.functions.invoke('send-email', {
      body: {
        to,
        subject,
        html,
        remitenteEmpresa: perfilQuienActua?.empresas?.email_remitente || null,
        nombreUsuario: perfilQuienActua?.nombre || null,
        emailUsuario: perfilQuienActua?.email || null
      }
    })
  } catch (err) {
    // Si el correo falla no debe detener el flujo del sistema, solo se registra en consola
    console.error('Error al enviar notificacion por correo:', err)
  }
}

// Junta los correos de todos los que han intervenido en una requisicion + su(s) orden(es) de compra:
// solicitante, comprador, y todos los aprobadores que ya dieron una decision.
export async function obtenerInvolucrados({ requisicionId, ordenId }) {
  const usuarioIds = new Set()

  if (requisicionId) {
    const { data: req } = await supabase.from('requisiciones').select('solicitante_id').eq('id', requisicionId).single()
    if (req?.solicitante_id) usuarioIds.add(req.solicitante_id)

    const { data: aprobsReq } = await supabase.from('aprobaciones')
      .select('aprobador_id').eq('tipo', 'requisicion').eq('referencia_id', requisicionId)
    for (const a of aprobsReq || []) usuarioIds.add(a.aprobador_id)
  }

  if (ordenId) {
    const { data: oc } = await supabase.from('ordenes_compra').select('comprador_id').eq('id', ordenId).single()
    if (oc?.comprador_id) usuarioIds.add(oc.comprador_id)

    const { data: aprobsOC } = await supabase.from('aprobaciones')
      .select('aprobador_id').eq('tipo', 'orden_compra').eq('referencia_id', ordenId)
    for (const a of aprobsOC || []) usuarioIds.add(a.aprobador_id)
  }

  if (usuarioIds.size === 0) return []

  const { data: usuarios } = await supabase
    .from('usuarios')
    .select('id, nombre, email, email_notificacion, acceso_interno')
    .in('id', Array.from(usuarioIds))

  // A donde se le escribe a cada quien NO es su identidad. Quien entra con
  // numero de empleado tiene una identidad interna que no recibe correo, y
  // quien si tiene correo puede haber pedido que los avisos le lleguen a otro.
  // Se devuelve el campo `email` ya resuelto para que las pantallas que llaman
  // a esta funcion no tengan que saber nada de esto, y se deja fuera a quien no
  // tiene a donde escribirle: esa persona ve todo dentro de la aplicacion.
  return (usuarios || [])
    .map(u => ({ ...u, email: u.email_notificacion || (u.acceso_interno ? null : u.email) }))
    .filter(u => !!u.email)
}