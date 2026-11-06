// Función "mercadolibre": productos más usados por rubro con precio actual de Mercado Libre.
//   GET /mercadolibre/productos?rubro=Pintura   (usuario con sesión)  → grupos de productos por búsqueda
//   GET /mercadolibre/conectar?clave=...        (solo administración) → autoriza la app en Mercado Libre
//   GET /mercadolibre/callback?code=...&state=…  (redirect de Mercado Libre) → guarda los tokens
// Secretos: ML_CLIENT_ID, ML_CLIENT_SECRET, ML_CLAVE_ADMIN. Opcional: ML_AFILIADO (parámetro de afiliado).
import { createClient } from "jsr:@supabase/supabase-js@2";

const URL_SB = Deno.env.get("SUPABASE_URL")!;
const sb = createClient(URL_SB, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
// Credenciales: secretos de la función o, si no están, la tabla protegida ml_config.
let ML_ID = Deno.env.get("ML_CLIENT_ID") ?? "";
let ML_SECRET = Deno.env.get("ML_CLIENT_SECRET") ?? "";
async function cargarCredenciales() {
  if (ML_ID && ML_SECRET) return;
  const { data } = await sb.from("ml_config").select("client_id, client_secret").eq("id", 1).maybeSingle();
  if (data) { ML_ID = ML_ID || data.client_id || ""; ML_SECRET = ML_SECRET || data.client_secret || ""; }
}
const CLAVE = Deno.env.get("ML_CLAVE_ADMIN") ?? "";
const AFILIADO = Deno.env.get("ML_AFILIADO") ?? "";
const REDIRECT = `${URL_SB}/functions/v1/mercadolibre/callback`;
const CACHE_HORAS = 12;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, "Content-Type": "application/json" } });
// Supabase sirve las respuestas de funciones como texto plano, así que los mensajes van sin HTML.
const html = (t: string, status = 200) =>
  new Response(t + "\n", { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

async function sha(s: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function guardarTokens(t: any) {
  const { error } = await sb.from("ml_tokens").upsert({
    id: 1, ml_user_id: t.user_id ?? null, access_token: t.access_token, refresh_token: t.refresh_token,
    expira: new Date(Date.now() + (t.expires_in ?? 21600) * 1000).toISOString(), actualizado: new Date().toISOString(),
  });
  if (error) throw new Error(error.message);
}

async function pedirToken(params: Record<string, string>) {
  const r = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ client_id: ML_ID, client_secret: ML_SECRET, ...params }),
  });
  const t = await r.json();
  if (!r.ok) throw new Error(t.message || t.error || "Mercado Libre rechazó el pedido de token");
  return t;
}

// Devuelve un access token vigente, renovándolo si hace falta. null si la app no está conectada.
async function tokenVigente(): Promise<string | null> {
  const { data } = await sb.from("ml_tokens").select("*").eq("id", 1).maybeSingle();
  if (!data) return null;
  if (new Date(data.expira).getTime() - Date.now() > 120_000) return data.access_token;
  const t = await pedirToken({ grant_type: "refresh_token", refresh_token: data.refresh_token });
  await guardarTokens(t);
  return t.access_token;
}

const slug = (q: string) => q.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, "-");
const conAfiliado = (link: string) => (AFILIADO ? link + (link.includes("?") ? "&" : "?") + AFILIADO : link);

async function buscar(q: string, token: string | null) {
  const { data: cache } = await sb.from("productos_ml").select("*").eq("busqueda", q).maybeSingle();
  if (cache && Date.now() - new Date(cache.actualizado).getTime() < CACHE_HORAS * 3600_000) return { items: cache.items, error: null };
  const r = await fetch(`https://api.mercadolibre.com/sites/MLA/search?q=${encodeURIComponent(q)}&limit=4`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!r.ok) return { items: cache?.items ?? [], error: `Mercado Libre respondió ${r.status}` };
  const d = await r.json();
  const items = (d.results ?? []).slice(0, 4).map((x: any) => ({
    id: x.id, titulo: x.title, precio: x.price, moneda: x.currency_id,
    imagen: (x.thumbnail || "").replace(/^http:/, "https:"),
    link: conAfiliado(x.permalink), envio_gratis: !!x.shipping?.free_shipping, tienda_oficial: !!x.official_store_id,
  }));
  await sb.from("productos_ml").upsert({ busqueda: q, items, actualizado: new Date().toISOString() });
  return { items, error: null };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const accion = url.pathname.split("/").filter(Boolean).pop();

  try {
    await cargarCredenciales();
    if (accion === "conectar") {
      if (!CLAVE || url.searchParams.get("clave") !== CLAVE) return html("Clave incorrecta. Reemplazá TU_CLAVE por el valor que cargaste en ML_CLAVE_ADMIN.", 403);
      if (!ML_ID || !ML_SECRET) return html("Faltan las credenciales de Mercado Libre (Client ID y Client Secret).", 500);
      const auth = new URL("https://auth.mercadolibre.com.ar/authorization");
      auth.search = new URLSearchParams({ response_type: "code", client_id: ML_ID, redirect_uri: REDIRECT, state: await sha(CLAVE) }).toString();
      return Response.redirect(auth.toString(), 302);
    }

    if (accion === "callback") {
      const code = url.searchParams.get("code");
      if (!code || !CLAVE || url.searchParams.get("state") !== (await sha(CLAVE))) return html("Pedido inválido.", 400);
      await guardarTokens(await pedirToken({ grant_type: "authorization_code", code, redirect_uri: REDIRECT }));
      return html("Mercado Libre quedó conectado a Condominios. Ya podés cerrar esta pestaña.");
    }

    if (accion === "productos") {
      const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
      const { data: u } = await sb.auth.getUser(jwt);
      if (!u?.user) return json({ error: "Iniciá sesión para ver productos" }, 401);
      const rubro = url.searchParams.get("rubro") ?? "";
      const { data: bs } = await sb.from("rubro_busquedas").select("busqueda").eq("rubro", rubro).order("orden");
      let token: string | null = null;
      try { token = await tokenVigente(); } catch (_) { token = null; }
      const grupos = [];
      for (const { busqueda } of bs ?? []) {
        const { items, error } = await buscar(busqueda, token);
        grupos.push({ busqueda, link: conAfiliado(`https://listado.mercadolibre.com.ar/${slug(busqueda)}`), items, error });
      }
      return json({ rubro, conectado: !!token, grupos });
    }

    return json({ error: "Ruta desconocida" }, 404);
  } catch (e) {
    return accion === "callback" ? html("No se pudo conectar: " + (e as Error).message, 500) : json({ error: (e as Error).message }, 500);
  }
});
