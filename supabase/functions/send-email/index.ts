// Edge Function: send-email
// Envia correos usando Resend. El remitente tecnico es siempre el de la empresa
// (para pasar SPF/DKIM), pero el nombre visible y el reply-to son los del usuario
// que genero la accion, para que se sienta personal aunque el dominio sea uno solo.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const {
      to,              // string[] - destinatarios
      subject,         // string
      html,            // string - cuerpo del correo
      remitenteEmpresa,   // string - correo tecnico verificado de la empresa (empresas.email_remitente)
      nombreUsuario,   // string - nombre del usuario que genero la accion (para el "From" visible)
      emailUsuario     // string - correo real del usuario (para Reply-To)
    } = await req.json()

    if (!to || !subject || !html) {
      return new Response(
        JSON.stringify({ error: 'Faltan campos obligatorios: to, subject, html' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const apiKey = Deno.env.get('RESEND_API_KEY')
    const correoTecnico = remitenteEmpresa || 'onboarding@resend.dev'
    const nombreVisible = nombreUsuario ? `${nombreUsuario} (via SYNTIA)` : 'SYNTIA'
    const from = `${nombreVisible} <${correoTecnico}>`

    const payload = {
      from,
      to: Array.isArray(to) ? to : [to],
      subject,
      html
    }

    if (emailUsuario) {
      payload.reply_to = emailUsuario
    }

    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })

    const data = await resendRes.json()

    if (!resendRes.ok) {
      return new Response(
        JSON.stringify({ error: 'Error de Resend', detalle: data }),
        { status: resendRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    return new Response(
      JSON.stringify({ success: true, data }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})