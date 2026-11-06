// Función "cuentas": alta de usuarios con email y contraseña, sin depender del envío de emails.
//   POST { accion: "registro", email, password, nombre }                          → cualquiera crea su cuenta
//   POST { accion: "crear", email, nombre, password, propiedad, rol, unidad }     → propietario/administración
//        crean la cuenta de otra persona (o la suman si ya existe) en una propiedad.
import { createClient } from "jsr:@supabase/supabase-js@2";

const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const emailOk = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const ROLES = ["vecino", "administracion", "propietario"];

async function uidPorEmail(email: string): Promise<string | null> {
  const { data, error } = await admin.rpc("_uid_por_email", { p_email: email });
  if (error) throw new Error(error.message);
  return data ?? null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Usá POST" }, 405);
  try {
    const b = await req.json();
    const email = String(b.email ?? "").trim().toLowerCase();
    const nombre = String(b.nombre ?? "").trim();
    const password = String(b.password ?? "");
    if (!emailOk(email)) return json({ error: "El email no es válido" }, 400);

    if (b.accion === "registro") {
      if (password.length < 8) return json({ error: "La contraseña tiene que tener al menos 8 caracteres" }, 400);
      if (await uidPorEmail(email)) return json({ error: "Ya existe una cuenta con ese email. Ingresá con tu contraseña." }, 409);
      const { error } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { nombre: nombre || null, autoregistro: true },
      });
      if (error) return json({ error: error.message }, 400);
      return json({ estado: "creado" });
    }

    if (b.accion === "crear") {
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: u } = await admin.auth.getUser(jwt);
      if (!u?.user) return json({ error: "Iniciá sesión" }, 401);
      if (!ROLES.includes(b.rol)) return json({ error: "Rol inválido" }, 400);
      const { data: m } = await admin.from("membresias").select("rol")
        .eq("usuario_id", u.user.id).eq("propiedad_id", b.propiedad).maybeSingle();
      const puede = m?.rol === "propietario" || (m?.rol === "administracion" && b.rol === "vecino");
      if (!puede) return json({ error: "Tu rol no permite sumar personas con ese rol" }, 403);

      let uid = await uidPorEmail(email);
      let estado = "agregado";
      if (!uid) {
        if (password.length < 8) return json({ error: "La contraseña inicial tiene que tener al menos 8 caracteres" }, 400);
        const { data, error } = await admin.auth.admin.createUser({
          email, password, email_confirm: true, user_metadata: { nombre: nombre || null },
        });
        if (error) return json({ error: error.message }, 400);
        uid = data.user!.id;
        estado = "creado";
      } else if (nombre) {
        await admin.from("perfiles").update({ nombre }).eq("id", uid).eq("nombre", email.split("@")[0]);
      }
      const { error: e2 } = await admin.from("membresias").upsert({
        usuario_id: uid, propiedad_id: b.propiedad, rol: b.rol, unidad: String(b.unidad ?? "").trim() || null,
      });
      if (e2) throw new Error(e2.message);
      await admin.from("invitaciones").delete().eq("email", email).eq("propiedad_id", b.propiedad);
      return json({ estado });
    }

    return json({ error: "Acción desconocida" }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
