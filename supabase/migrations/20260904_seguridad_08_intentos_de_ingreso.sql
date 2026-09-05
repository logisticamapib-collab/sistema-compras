-- =====================================================================
-- SEGURIDAD 8 — Registrar y frenar los intentos de ingreso.
--
-- EL PROBLEMA
--
-- No habia ningun freno ni ningun registro. auth.audit_log_entries estaba
-- vacia: si alguien hubiera estado probando contrasenas, no habria forma de
-- saberlo. Y Supabase Auth no tiene bloqueo por intentos, no existe la funcion.
--
-- El limite que si existe es el de Supabase por IP sobre /auth/v1/token: 1800
-- peticiones por hora, y no es configurable. Para un script eso no es un
-- obstaculo, es un ritmo comodo.
--
-- POR QUE UN HOOK Y NO UN CONTADOR EN LA PANTALLA
--
-- Un atacante no usa la pantalla de login: pega directo al endpoint de
-- Supabase con la llave publica, que es publica por diseno. Cualquier contador
-- que viviera en el navegador se lo salta sin enterarse. El hook
-- PASSWORD_VERIFICATION_ATTEMPT corre DENTRO de la base y se dispara en cada
-- verificacion de contrasena, venga de donde venga.
--
-- FRENO, NO BLOQUEO
--
-- Bloquear la cuenta a los N fallos suena bien y es un arma: un atacante falla
-- a proposito contra cada numero de empleado y deja al turno sin poder
-- reportar produccion. Convierte un ataque de adivinanza en uno de denegacion,
-- que es mas facil y mas danino.
--
-- Aqui hay una escalera de espera medida contra el fallo ANTERIOR:
--
--   hasta 5 fallos en 15 min  ->  sin espera
--   6 a 10                    ->  5 segundos entre intentos
--   11 a 20                   ->  30 segundos
--   mas de 20                 ->  60 segundos
--
-- Un usuario legitimo que se equivoca seis veces espera cinco segundos. Un
-- script pasa de 1800 intentos por hora a unos 60. Y nadie queda bloqueado:
-- lo peor que le puede pasar a alguien atacado es esperar un minuto.
--
-- Nunca se devuelve should_logout_user: cerrarle la sesion a quien ya esta
-- trabajando SI seria una denegacion de servicio de verdad.
--
-- LO QUE ESTE HOOK NO PUEDE HACER
--
-- Frenar por IP. La entrada del hook trae user_id y valid, nada mas: no hay
-- direccion. El freno por IP solo puede venir del limite de Supabase y del
-- CAPTCHA, que es lo unico que rompe la automatizacion en lugar de contarla.
--
-- SI ESTA FUNCION FALLA, NADIE ENTRA
--
-- Por eso todo va envuelto en un manejador que, ante cualquier error, devuelve
-- 'continue'. Es preferible perder el registro de un intento que dejar a la
-- planta afuera a las dos de la manana.
--
-- NO SIRVE DE NADA HASTA QUE SE ACTIVE
--
-- Hay que prenderlo en el tablero: Authentication -> Hooks -> Password
-- Verification Attempt, apuntando a
--   pg-functions://postgres/public/hook_verificacion_password
-- =====================================================================

create table if not exists public.intentos_ingreso (
  id      bigserial primary key,
  user_id uuid,
  exito   boolean     not null,
  momento timestamptz not null default now()
);

comment on table public.intentos_ingreso is
  'Cada verificacion de contrasena, buena o mala, la escribe el hook '
  'PASSWORD_VERIFICATION_ATTEMPT. Es la unica evidencia que existe de quien '
  'intento entrar: auth.audit_log_entries esta vacia.';

create index if not exists intentos_ingreso_usuario on public.intentos_ingreso (user_id, momento desc);
create index if not exists intentos_ingreso_momento on public.intentos_ingreso (momento desc);

create or replace function public.hook_verificacion_password(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user   uuid;
  v_valido boolean;
  v_fallos int;
  v_ultimo timestamptz;
  v_espera int;
begin
  v_user   := nullif(event->>'user_id', '')::uuid;
  v_valido := coalesce((event->>'valid')::boolean, false);

  -- Los fallos ANTERIORES, antes de anotar el de ahora. Si se contara el
  -- actual, la espera se mediria contra si misma y la escalera se volveria un
  -- bloqueo de 15 minutos.
  select count(*), max(momento) into v_fallos, v_ultimo
  from public.intentos_ingreso
  where user_id = v_user and not exito and momento > now() - interval '15 minutes';

  insert into public.intentos_ingreso (user_id, exito) values (v_user, v_valido);

  if v_valido then
    return jsonb_build_object('decision', 'continue');
  end if;

  v_espera := case
    when v_fallos <= 5  then 0
    when v_fallos <= 10 then 5
    when v_fallos <= 20 then 30
    else 60
  end;

  if v_espera > 0 and v_ultimo is not null and v_ultimo > now() - make_interval(secs => v_espera) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'Demasiados intentos fallidos. Espera unos segundos antes de volver a intentar.'));
  end if;

  return jsonb_build_object('decision', 'continue');

exception when others then
  return jsonb_build_object('decision', 'continue');
end;
$$;

comment on function public.hook_verificacion_password(jsonb) is
  'Hook PASSWORD_VERIFICATION_ATTEMPT. Registra cada intento y aplica una '
  'escalera de espera sobre los fallos. No bloquea cuentas a proposito: el '
  'bloqueo por intentos es un arma de denegacion de servicio. Ante cualquier '
  'error interno devuelve continue, porque si esta funcion truena nadie entra.';

grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_verificacion_password(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_verificacion_password(jsonb) from anon, authenticated, public;

grant select, insert on table public.intentos_ingreso to supabase_auth_admin;
grant usage, select on sequence public.intentos_ingreso_id_seq to supabase_auth_admin;

grant select on table public.intentos_ingreso to authenticated;
revoke all on table public.intentos_ingreso from anon, public;

create or replace function public.purgar_intentos_ingreso(p_dias int default 180)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  delete from public.intentos_ingreso where momento < now() - make_interval(days => greatest(p_dias, 30));
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.purgar_intentos_ingreso(int) from anon, public;
grant execute on function public.purgar_intentos_ingreso(int) to authenticated;
