// Edge Function: crear-usuario
//
// POR QUE EXISTE
//
// El alta se hacia desde el navegador con supabase.auth.signUp y la llave
// publica, lo que obliga a dejar el registro publico abierto. Aqui la hace el
// servidor con la llave de servicio, que nunca sale de Supabase.
//
// LO QUE ESTA FUNCION NO SE CREE
//
// La sesion: verify_jwt solo comprueba que el token venga firmado, y la llave
// anonima ES un token firmado. Por eso se llama a auth.getUser() con el
// encabezado de quien llama: eso solo devuelve usuario si la sesion es real.
//
// El cuerpo del mensaje: la empresa NUNCA se toma de lo que mandan, se toma del
// perfil de quien llama.
//
// TRES CAMINOS DE ALTA
//
//   invitacion  tiene correo. Recibe un enlace y crea su contrasena. Nadie mas
//               la conoce.
//   temporal    tiene correo. El administrador le pone una y el sistema le
//               exige cambiarla al entrar.
//   interno     NO tiene correo. Su identidad es 10432@interno.syntia, que
//               nunca recibe nada, y en el login teclea solo su numero.
//
// El tercero existe porque la gente de piso no tiene correo corporativo, y
// usar su correo personal como identidad regala el control: en un ERP la
// cuenta es la firma de quien aprueba, y esa firma no puede vivir en un buzon
// que la empresa no puede cerrar el dia que la persona se va.
//
// Por eso tambien email_notificacion esta separado de email: cambiar a donde
// te llegan los avisos no deberia cambiar quien eres.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

// OJO: esta constante esta repetida en frontend/src/lib/accesoInterno.js.
// Si cambia aqui y no alla, las identidades que arme el servidor no van a
// coincidir con las que arme el login, y nadie de piso podra entrar.
const DOMINIO_INTERNO = 'interno.syntia'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const responder = (cuerpo: unknown, status = 200) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function mandarAcceso(o: {
  para: string, nombre: string, enlace: string | null,
  deNombre: string, deCorreo: string, remitente: string, empresa: string | null, esReenvio: boolean,
}): Promise<string | null> {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return 'No hay RESEND_API_KEY configurada, asi que el correo no salio.'
  if (!o.enlace) return 'Supabase no devolvio el enlace.'

  const intro = o.esReenvio
    ? `${o.deNombre} te esta reenviando el acceso a SYNTIA.`
    : `${o.deNombre} te dio de alta en SYNTIA${o.empresa ? ` (${o.empresa})` : ''}.`

  const html = `
    <p>Hola ${o.nombre},</p>
    <p>${intro}</p>
    <p>Al abrir el enlace, el sistema te va a pedir que crees tu contrase&ntilde;a. Nadie m&aacute;s la va a conocer.</p>
    <p><a href="${o.enlace}">Entrar y crear mi contrase&ntilde;a</a></p>
    <p style="color:#666;font-size:12px">Si el bot&oacute;n no abre, copia esta direcci&oacute;n en tu navegador:<br>${o.enlace}</p>
    <p style="color:#666;font-size:12px">El enlace caduca y es de un solo uso. Si ya no sirve, pide que te lo reenv&iacute;en.</p>`

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${o.deNombre} (via SYNTIA) <${o.remitente}>`,
      to: [o.para], reply_to: o.deCorreo,
      subject: 'Tu acceso a SYNTIA', html,
    }),
  })
  return r.ok ? null : 'El correo no salio.'
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const URL_SB = Deno.env.get('SUPABASE_URL')!
    const ANON = Deno.env.get('SUPABASE_ANON_KEY')!
    const SERVICIO = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const autorizacion = req.headers.get('Authorization') ?? ''
    if (!autorizacion) return responder({ error: 'Falta la sesion.' }, 401)

    const comoElQueLlama = createClient(URL_SB, ANON, { global: { headers: { Authorization: autorizacion } } })
    const { data: { user: quien }, error: errSesion } = await comoElQueLlama.auth.getUser()
    if (errSesion || !quien) return responder({ error: 'Sesion invalida. Vuelve a iniciar sesion.' }, 401)

    const admin = createClient(URL_SB, SERVICIO, { auth: { persistSession: false } })

    const { data: perfil } = await admin.from('usuarios')
      .select('id, nombre, email, email_notificacion, empresa_id, rol, activo').eq('id', quien.id).maybeSingle()
    if (!perfil) return responder({ error: 'Tu usuario no tiene perfil en el sistema.' }, 403)
    if (!perfil.activo) return responder({ error: 'Tu usuario esta desactivado.' }, 403)

    // Permiso: la excepcion por usuario manda sobre la del rol.
    let puede = perfil.rol === 'admin'
    if (!puede) {
      const { data: modulo } = await admin.from('modulos').select('id').eq('clave', 'config_usuarios').maybeSingle()
      if (modulo) {
        const { data: exc } = await admin.from('permisos_usuario')
          .select('puede_crear').eq('usuario_id', perfil.id).eq('modulo_id', modulo.id).maybeSingle()
        if (exc) puede = !!exc.puede_crear
        else {
          const { data: pr } = await admin.from('permisos_rol')
            .select('puede_crear').eq('rol', perfil.rol).eq('modulo_id', modulo.id).maybeSingle()
          puede = !!pr?.puede_crear
        }
      }
    }
    if (!puede) return responder({ error: 'No tienes permiso para dar de alta usuarios.' }, 403)

    const c = await req.json()

    const { data: empresa } = await admin.from('empresas')
      .select('nombre, email_remitente').eq('id', perfil.empresa_id).maybeSingle()
    const remitente = empresa?.email_remitente || 'onboarding@resend.dev'
    const deCorreo = perfil.email_notificacion || perfil.email

    const origen = req.headers.get('origin') ?? ''
    const esLocal = /localhost|127\.0\.0\.1/i.test(origen)
    const avisoLocal = esLocal
      ? 'Ojo: generaste este enlace desde localhost, asi que solo abre en esta computadora. '
        + 'Si la persona lo va a abrir en otro equipo o en su celular, entra al sistema por la IP de red y reenviale el acceso.'
      : null

    // =============== PONER UNA CONTRASENA TEMPORAL ===============
    // Sirve para cualquiera, y es la UNICA salida para las cuentas internas,
    // que no tienen a donde recibir un enlace.
    if (c.accion === 'nueva_temporal') {
      if (String(c.password ?? '').length < 8) {
        return responder({ error: 'La contrasena temporal debe tener al menos 8 caracteres.' }, 400)
      }
      const { data: destino } = await admin.from('usuarios')
        .select('id, nombre').eq('id', c.usuario_id).eq('empresa_id', perfil.empresa_id).maybeSingle()
      if (!destino) return responder({ error: 'Ese usuario no existe o no es de tu empresa.' }, 404)

      const { error } = await admin.auth.admin.updateUserById(destino.id, { password: String(c.password) })
      if (error) return responder({ error: error.message }, 400)
      await admin.from('usuarios').update({ password_pendiente: 'temporal' }).eq('id', destino.id)
      return responder({ ok: true, accion: 'nueva_temporal' })
    }

    // =============== REENVIAR EL ACCESO POR CORREO ===============
    if (c.accion === 'reenviar') {
      const { data: destino } = await admin.from('usuarios')
        .select('id, nombre, email, email_notificacion, acceso_interno')
        .eq('id', c.usuario_id).eq('empresa_id', perfil.empresa_id).maybeSingle()
      if (!destino) return responder({ error: 'Ese usuario no existe o no es de tu empresa.' }, 404)
      if (destino.acceso_interno) {
        return responder({ error: 'Esa cuenta entra con numero de empleado y no tiene correo, asi que no hay a donde mandarle un enlace. Usa "Contrasena temporal".' }, 400)
      }

      let enlace: string | null = null
      const r1 = await admin.auth.admin.generateLink({
        type: 'recovery', email: destino.email,
        options: origen ? { redirectTo: `${origen}/` } : undefined,
      })
      if (!r1.error) enlace = r1.data.properties?.action_link ?? null
      else {
        const r2 = await admin.auth.admin.generateLink({
          type: 'invite', email: destino.email,
          options: origen ? { redirectTo: `${origen}/` } : undefined,
        })
        if (r2.error) return responder({ error: r2.error.message }, 400)
        enlace = r2.data.properties?.action_link ?? null
      }

      await admin.from('usuarios').update({ password_pendiente: 'invitacion' }).eq('id', destino.id)

      const fallo = await mandarAcceso({
        para: destino.email_notificacion || destino.email, nombre: destino.nombre, enlace,
        deNombre: perfil.nombre, deCorreo, remitente, empresa: empresa?.nombre ?? null, esReenvio: true,
      })
      const aviso = [fallo, avisoLocal].filter(Boolean).join(' ') || null
      return responder({ ok: true, accion: 'reenviar', aviso, enlace: aviso ? enlace : null })
    }

    // =================== ALTA ===================
    const modo = ['temporal', 'interno'].includes(c.modo) ? c.modo : 'invitacion'
    const nombre = String(c.nombre ?? '').trim()
    if (!nombre) return responder({ error: 'Falta el nombre.' }, 400)

    let email = String(c.email ?? '').trim().toLowerCase()
    let numeroEmpleado: string | null = null

    if (modo === 'interno') {
      numeroEmpleado = String(c.numero_empleado ?? '').trim().toLowerCase()
      if (!numeroEmpleado) return responder({ error: 'Falta el numero de empleado.' }, 400)
      // Se vuelve parte de un correo, asi que no puede traer espacios ni signos
      // raros: si no, la identidad que arma el servidor no es la que arma el
      // login y la persona no puede entrar nunca.
      if (!/^[a-z0-9._-]+$/.test(numeroEmpleado)) {
        return responder({ error: 'El numero de empleado solo puede traer letras, numeros, punto, guion y guion bajo.' }, 400)
      }
      email = `${numeroEmpleado}@${DOMINIO_INTERNO}`
    } else {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return responder({ error: 'El correo no es valido.' }, 400)
      if (email.endsWith(`@${DOMINIO_INTERNO}`)) {
        return responder({ error: `El dominio ${DOMINIO_INTERNO} esta reservado para las cuentas sin correo.` }, 400)
      }
    }

    if (modo !== 'invitacion' && String(c.password ?? '').length < 8) {
      return responder({ error: 'La contrasena temporal debe tener al menos 8 caracteres.' }, 400)
    }
    if (c.rol === 'admin' && perfil.rol !== 'admin') {
      return responder({ error: 'Solo un administrador puede crear otro administrador.' }, 403)
    }

    const siteId = c.site_id ? Number(c.site_id) : null
    if (siteId) {
      const { data: site } = await admin.from('sites').select('id').eq('id', siteId)
        .eq('empresa_id', perfil.empresa_id).maybeSingle()
      if (!site) return responder({ error: 'Ese site no pertenece a tu empresa.' }, 400)
    }
    const gerenteId = c.gerente_id || null
    if (gerenteId) {
      const { data: g } = await admin.from('usuarios').select('id').eq('id', gerenteId)
        .eq('empresa_id', perfil.empresa_id).maybeSingle()
      if (!g) return responder({ error: 'Ese jefe no pertenece a tu empresa.' }, 400)
    }

    // El numero de empleado no se puede repetir. Se revisa antes de crear nada
    // en auth, para no tener que deshacerlo despues.
    if (numeroEmpleado) {
      const { data: repetido } = await admin.from('usuarios').select('nombre')
        .eq('empresa_id', perfil.empresa_id).eq('numero_empleado', numeroEmpleado).maybeSingle()
      if (repetido) return responder({ error: `El numero ${numeroEmpleado} ya lo tiene ${repetido.nombre}.` }, 400)
    }

    let nuevoId: string | null = null
    let enlace: string | null = null

    if (modo === 'invitacion') {
      const { data, error } = await admin.auth.admin.generateLink({
        type: 'invite', email,
        options: origen ? { redirectTo: `${origen}/` } : undefined,
      })
      if (error) return responder({ error: error.message.includes('already') ? `Ya existe un usuario con el correo ${email}.` : error.message }, 400)
      nuevoId = data.user!.id
      enlace = data.properties?.action_link ?? null
    } else {
      const { data, error } = await admin.auth.admin.createUser({
        email, password: String(c.password), email_confirm: true,
      })
      if (error) {
        const yaExiste = error.message.includes('already')
        return responder({
          error: yaExiste
            ? (modo === 'interno'
                ? `El numero ${numeroEmpleado} ya esta ocupado.`
                : `Ya existe un usuario con el correo ${email}.`)
            : error.message,
        }, 400)
      }
      nuevoId = data.user!.id
    }

    const correoAvisos = String(c.email_notificacion ?? '').trim().toLowerCase()
      || (modo === 'interno' ? null : email)

    const { error: errPerfil } = await admin.from('usuarios').insert({
      id: nuevoId,
      nombre,
      email,
      numero_empleado: numeroEmpleado,
      acceso_interno: modo === 'interno',
      email_notificacion: correoAvisos,
      rol: c.rol || 'solicitante',
      empresa_id: perfil.empresa_id,
      site_id: siteId,
      puesto_id: c.puesto_id ? Number(c.puesto_id) : null,
      area_id: c.area_id ? Number(c.area_id) : null,
      gerente_id: gerenteId,
      nivel_aprobacion: Number(c.nivel_aprobacion) || 1,
      puede_aprobar_como_director: !!c.puede_aprobar_como_director,
      monto_maximo_aprobacion: c.monto_maximo_aprobacion ? Number(c.monto_maximo_aprobacion) : null,
      // Los TRES caminos lo marcan. El enlace de invitacion no pide contrasena:
      // si la aplicacion no pregunta, nadie pregunta.
      password_pendiente: modo === 'invitacion' ? 'invitacion' : 'temporal',
      activo: true,
    })

    if (errPerfil) {
      // Sin esto queda alguien que puede iniciar sesion y no tiene empresa.
      await admin.auth.admin.deleteUser(nuevoId!)
      return responder({ error: 'No se pudo crear el perfil: ' + errPerfil.message }, 400)
    }

    let fallo: string | null = null
    if (modo === 'invitacion') {
      fallo = await mandarAcceso({
        para: email, nombre, enlace,
        deNombre: perfil.nombre, deCorreo, remitente, empresa: empresa?.nombre ?? null, esReenvio: false,
      })
    }

    const aviso = [fallo, modo === 'invitacion' ? avisoLocal : null].filter(Boolean).join(' ') || null
    return responder({ ok: true, id: nuevoId, modo, numero_empleado: numeroEmpleado, aviso, enlace: aviso ? enlace : null })
  } catch (e) {
    return responder({ error: 'Error inesperado: ' + (e as Error).message }, 500)
  }
})
