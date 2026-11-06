/* Condominios · app de una sola página.
   Dos capas de datos con la misma interfaz:
   - Demo: datos de ejemplo en el navegador (sin config).
   - Nube: Supabase (auth por link mágico + RPC de supabase/schema.sql). */
(function () {
"use strict";

// ---------- Constantes y utilidades ----------
const CFG = window.CONDOMINIOS_CONFIG || {};
const MODO_DEMO = !(CFG.supabaseUrl && CFG.supabaseAnonKey);
const REGIONES = ["CABA", "GBA Norte", "GBA Oeste", "GBA Sur", "La Plata", "Interior"];
const ESTADOS = { nuevo: "Nuevo", presupuestando: "Recibiendo cotizaciones", aprobacion: "Espera aprobación", en_curso: "En curso", resuelto: "Resuelto", desestimado: "Desestimado" };
const EST_PRES = { pendiente: "Pendiente", aprobado: "Aprobado", desestimado: "No elegido" };
const ROL_LABEL = { vecino: "Vecino", administracion: "Administración", propietario: "Propietario", proveedor: "Proveedor" };
let RUBROS = [
  ["Plomería", 1], ["Electricidad", 1], ["Gas", 1], ["Ascensores", 1], ["Pintura", 1], ["Humedad y filtraciones", 1],
  ["Cerrajería", 1], ["Fumigación y plagas", 1], ["Albañilería", 1], ["Herrería", 1], ["Vidriería", 1],
  ["Aire acondicionado", 1], ["Jardinería", 1], ["Mudanzas y fletes", 1], ["Limpieza", 1], ["Seguridad y accesos", 1],
  ["Espacios comunes", 1], ["Ruidos y convivencia", 0], ["Otro", 1]
].map(([nombre, p]) => ({ nombre, requiere: !!p }));
const BUSQUEDAS = {
  "Pintura": ["latex interior 20 litros", "rodillo antigota", "enduido plastico interior", "esmalte sintetico 4 litros"],
  "Plomería": ["canilla monocomando cocina", "flexible agua mallado", "deposito inodoro mochila", "sellador roscas teflon"],
  "Electricidad": ["lampara led e27", "termica bipolar 20a", "fotocelula", "disyuntor diferencial"],
  "Gas": ["detector de gas", "flexible gas aprobado"],
  "Humedad y filtraciones": ["membrana liquida 20 kg", "hidrofugo", "pintura antihumedad"],
  "Cerrajería": ["cerradura de seguridad puerta", "cilindro cerradura", "cerradura electrica portero"],
  "Fumigación y plagas": ["cebo cucarachas gel", "cebo hormigas", "trampa ratones"],
  "Albañilería": ["cemento portland 50 kg", "adhesivo ceramicos 30 kg", "pastina"],
  "Herrería": ["convertidor de oxido", "bisagra porton"],
  "Vidriería": ["silicona transparente", "burlete ventana"],
  "Aire acondicionado": ["limpiador aire acondicionado", "soporte aire acondicionado"],
  "Jardinería": ["manguera 25 metros", "fertilizante cesped", "bordeadora electrica"],
  "Mudanzas y fletes": ["cajas carton mudanza", "cinta embalar", "film stretch"],
  "Limpieza": ["lavandina 5 litros", "desengrasante", "bolsas residuos consorcio"],
  "Seguridad y accesos": ["camara seguridad wifi", "luz emergencia led", "matafuego 5 kg"],
  "Espacios comunes": ["luz emergencia led", "matafuego 5 kg"]
};
const slugML = (q) => q.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, "-");
const linkListado = (q) => "https://listado.mercadolibre.com.ar/" + slugML(q);
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const requierePresup = (rubro) => (RUBROS.find((r) => r.nombre === rubro) || { requiere: true }).requiere;

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const ars = (n) => NF.format(n);
const num = (n) => new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 }).format(n);
const isoLocal = (d) => new Date(d).toLocaleDateString("sv-SE");
const hoyISO = () => isoLocal(Date.now());
const fd = (iso) => { const [, m, d] = iso.split("-"); return d + "/" + m; };
const fLarga = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" }); };
const diasHasta = (iso) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(); t.setHours(0, 0, 0, 0); return Math.round((new Date(y, m - 1, d) - t) / 86400000); };
const plural = (n, a, b) => n + " " + (n === 1 ? a : b);
const uni = (u, n) => (n === 1 || /[²³]$/.test(u) ? u : /[aeiouáéó]$/i.test(u) ? u + "s" : u + "es");
const sumaDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return isoLocal(d); };

function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), 2800); }

// ---------- Estado de la interfaz ----------
const ui = { rolDemo: "propietario", tab: null, prop: "all", filtro: "abiertos", q: "", cat: "", sel: null, form: null, opFiltro: "abiertos", opForm: null, compraForm: null, regionCompras: "todas", rubroProd: "Pintura", propPers: null, nuevaProp: false, busy: false };
const personasCache = {};
const productosCache = {};
let S = { usuario: null, props: [], roles: {}, unidades: {}, reclamos: [], proveedor: null, oportunidades: [], compras: [], avisos: [] };

// ======================================================================
// Capa de datos: DEMO
// ======================================================================
function seedDemo() {
  const h = (n) => sumaDias(-n);
  const pv = (id, razon, tel, rubros, zonas) => ({ id, razon, tel, rubros, zonas });
  return {
    seq: 1048, seqCompra: 504,
    props: [
      { id: "p1", nombre: "Rivadavia 4520", tipo: "Edificio · 24 UF", zona: "Caballito, CABA", region: "CABA" },
      { id: "p2", nombre: "Gorriti 5180", tipo: "Edificio · 40 UF", zona: "Palermo, CABA", region: "CABA" },
      { id: "p3", nombre: "Barrio Los Álamos", tipo: "Barrio cerrado · 62 lotes", zona: "Pilar", region: "GBA Norte" }
    ],
    proveedores: [
      pv("u-proveedor", "Mantenimiento Delta", "11 4567-8910", ["Plomería", "Electricidad", "Pintura", "Cerrajería"], ["CABA"]),
      pv("pv-norte", "Eléctrica Norte", "11 4789-2201", ["Electricidad"], ["CABA", "GBA Norte"]),
      pv("pv-pint", "Pinturerías del Centro", "11 5032-1100", ["Pintura"], ["CABA"]),
      pv("pv-color", "Colorshop Palermo", "11 4831-7720", ["Pintura"], ["CABA"]),
      pv("pv-fum", "Fumigaciones Pilar", "230 442-1180", ["Fumigación y plagas"], ["GBA Norte"]),
      pv("pv-fum2", "Plagas Cero", "11 6011-4433", ["Fumigación y plagas"], ["CABA"]),
      pv("pv-mud", "Mudanzas Rápidas", "11 3988-5500", ["Mudanzas y fletes"], ["CABA", "GBA Norte"]),
      pv("pv-cerr", "Cerrajería 24 h Caballito", "11 4902-3030", ["Cerrajería"], ["CABA"])
    ],
    reclamos: [
      { id: 1042, prop: "p1", uf: "UF 7A", cat: "Plomería", tit: "Filtración en el techo del baño", desc: "Cae agua del cielorraso del baño cuando usan la ducha en el 8A. La mancha creció en la última semana y ya se descascara la pintura.", autor: "Lucía Fernández", urg: "alta", estado: "aprobacion", fecha: h(8),
        pres: [{ id: "q1", prov: "Hidro Sur", monto: 485000, plazo: 3, det: "Rotura de piso en 8A, cambio de caño de descarga y sellado. Incluye reposición de cerámicos.", estado: "pendiente" },
               { id: "q2", prov: "Plomería Benítez", monto: 412000, plazo: 5, det: "Cambio de tramo de descarga. No incluye cerámicos ni pintura del cielorraso en 7A.", estado: "pendiente" }],
        ev: [{ f: h(8), q: "Lucía Fernández", t: "Cargó el reclamo." }, { f: h(8), q: "Sistema", t: "Se publicó para cotizar: 1 proveedor de Plomería recibió el aviso." }, { f: h(7), q: "Administración Quiroga", t: "Visitó la unidad 8A y confirmó pérdida en la descarga de la ducha." }, { f: h(3), q: "Administración Quiroga", t: "Cargó 2 presupuestos de proveedores propios." }] },
      { id: 1039, prop: "p1", uf: "Común", cat: "Ascensores", tit: "Ascensor B se detiene entre 4° y 5° piso", desc: "Desde el lunes el ascensor B frena entre pisos y hay que volver a llamarlo. Hubo un vecino atrapado 20 minutos el martes.", autor: "Encargado", urg: "alta", estado: "en_curso", fecha: h(16),
        pres: [{ id: "q3", prov: "Ascensores Del Plata", monto: 1250000, plazo: 10, det: "Cambio de placa de maniobra y operador de puerta. Garantía 12 meses.", estado: "aprobado" }],
        ev: [{ f: h(16), q: "Encargado", t: "Reportó el ascensor fuera de servicio." }, { f: h(15), q: "Administración Quiroga", t: "La conservadora revisó y pidió cambio de placa." }, { f: h(13), q: "Grupo Ribera S.A.", t: "Aprobó presupuesto de Ascensores Del Plata por $ 1.250.000." }, { f: h(4), q: "Administración Quiroga", t: "La placa llega el lunes. El ascensor A funciona normal." }] },
      { id: 1038, prop: "p1", uf: "Puerta de calle", cat: "Cerrajería", tit: "Cambiar cerradura de la puerta de entrada", desc: "La llave se traba y quedaron copias sin control. Pedimos cerradura de seguridad y 30 llaves nuevas.", autor: "Administración Quiroga", urg: "media", estado: "en_curso", fecha: h(6),
        pres: [{ id: "q7", provId: "u-proveedor", contacto: "11 4567-8910", prov: "Mantenimiento Delta", monto: 268000, plazo: 1, det: "Cerradura Kallay de doble paleta, 30 copias y ajuste de bisagras.", estado: "aprobado" },
               { id: "q8", provId: "pv-cerr", contacto: "11 4902-3030", prov: "Cerrajería 24 h Caballito", monto: 295000, plazo: 1, det: "Cerradura Trabex con 30 copias.", estado: "desestimado", motivo: "Se aprobó otra opción." }],
        ev: [{ f: h(6), q: "Administración Quiroga", t: "Cargó el reclamo." }, { f: h(6), q: "Sistema", t: "Se publicó para cotizar: 2 proveedores de Cerrajería recibieron el aviso." }, { f: h(5), q: "Mantenimiento Delta", t: "Mantenimiento Delta cotizó $ 268.000 desde la plataforma." }, { f: h(5), q: "Cerrajería 24 h Caballito", t: "Cerrajería 24 h Caballito cotizó $ 295.000 desde la plataforma." }, { f: h(4), q: "Grupo Ribera S.A.", t: "Aprobó presupuesto de Mantenimiento Delta por $ 268.000." }] },
      { id: 1045, prop: "p1", uf: "UF 9C", cat: "Ruidos y convivencia", tit: "Música fuerte después de las 23 h", desc: "Los viernes y sábados hay música alta hasta las 3 de la mañana en el 9C. Ya se habló con ellos sin resultado.", autor: "Vecinos del 9° y 10°", urg: "media", estado: "nuevo", fecha: h(1), pres: [],
        ev: [{ f: h(1), q: "Vecinos del 9° y 10°", t: "Cargaron el reclamo (3 unidades adhieren)." }] },
      { id: 1036, prop: "p2", uf: "Palier 3°", cat: "Pintura", tit: "Pintura descascarada en palier del 3° piso", desc: "Paredes y zócalos del palier con pintura saltada por una humedad vieja que ya se reparó. Son unos 40 m².", autor: "Martín Sosa", urg: "baja", estado: "presupuestando", fecha: h(21), pres: [],
        ev: [{ f: h(21), q: "Martín Sosa", t: "Cargó el reclamo." }, { f: h(21), q: "Sistema", t: "Se publicó para cotizar: 3 proveedores de Pintura recibieron el aviso." }] },
      { id: 1044, prop: "p2", uf: "Hall PB", cat: "Electricidad", tit: "Luces del hall de entrada cortan intermitente", desc: "Los apliques del hall se apagan solos varias veces por noche. El portero eléctrico funciona bien.", autor: "Encargado", urg: "media", estado: "aprobacion", fecha: h(3),
        pres: [{ id: "q4", provId: "pv-norte", contacto: "11 4789-2201", prov: "Eléctrica Norte", monto: 186000, plazo: 1, det: "Revisión de tablero de servicios comunes, cambio de fotocélula y contactor.", estado: "pendiente" }],
        ev: [{ f: h(3), q: "Encargado", t: "Reportó el problema." }, { f: h(3), q: "Sistema", t: "Se publicó para cotizar: 2 proveedores de Electricidad recibieron el aviso." }, { f: h(1), q: "Eléctrica Norte", t: "Eléctrica Norte cotizó $ 186.000 desde la plataforma." }] },
      { id: 1047, prop: "p2", uf: "Sala de residuos", cat: "Fumigación y plagas", tit: "Cucarachas en la sala de residuos y cocheras", desc: "Aparecen cucarachas en la sala de residuos y subieron por el montante a algunas cocinas.", autor: "Encargado", urg: "media", estado: "presupuestando", fecha: h(0), pres: [],
        ev: [{ f: h(0), q: "Encargado", t: "Cargó el reclamo." }, { f: h(0), q: "Sistema", t: "Se publicó para cotizar: 1 proveedor de Fumigación y plagas recibió el aviso." }] },
      { id: 1028, prop: "p2", uf: "Sala de medidores", cat: "Gas", tit: "Olor a gas en sala de medidores", desc: "Olor fuerte a gas al abrir la sala de medidores del subsuelo.", autor: "Encargado", urg: "alta", estado: "resuelto", fecha: h(29),
        pres: [{ id: "q5", prov: "Gasista matriculado R. Ortiz", monto: 240000, plazo: 1, det: "Ajuste de unión en regulador y prueba de hermeticidad.", estado: "aprobado" }],
        ev: [{ f: h(29), q: "Encargado", t: "Reportó olor a gas. Se cortó el suministro preventivamente." }, { f: h(29), q: "Grupo Ribera S.A.", t: "Aprobó presupuesto de Gasista matriculado R. Ortiz por $ 240.000." }, { f: h(28), q: "Administración Quiroga", t: "Reparado. Prueba de hermeticidad aprobada, suministro restablecido." }] },
      { id: 1046, prop: "p3", uf: "Lote 14", cat: "Humedad y filtraciones", tit: "Humedad en pared medianera con el lote 15", desc: "Aparece humedad en la pared que linda con el lote 15, del lado del jardín. Puede venir del riego del vecino.", autor: "Familia Rossi", urg: "media", estado: "nuevo", fecha: h(0), pres: [],
        ev: [{ f: h(0), q: "Familia Rossi", t: "Cargó el reclamo." }] },
      { id: 1033, prop: "p3", uf: "Plaza central", cat: "Espacios comunes", tit: "Cambiar los juegos de la plaza", desc: "Los juegos tienen más de 10 años. Se pide reemplazarlos por juegos nuevos.", autor: "Comisión de padres", urg: "baja", estado: "desestimado", fecha: h(35), pres: [], motivo: "Se trata en la asamblea ordinaria de marzo con el presupuesto anual.",
        ev: [{ f: h(35), q: "Comisión de padres", t: "Cargó el reclamo." }, { f: h(31), q: "Grupo Ribera S.A.", t: "Desestimó: se trata en la asamblea ordinaria de marzo con el presupuesto anual." }] }
    ],
    compras: [
      { id: 501, region: "CABA", rubro: "Pintura", producto: "Látex interior blanco mate 20 L", unidad: "lata", detalle: "Calidad premium lavable. Entrega en cada domicilio dentro de CABA.", cierre: sumaDias(12), estado: "abierta", creador: "u-vecino", fecha: h(4),
        part: [{ u: "u-vecino", cant: 3, zona: "Caballito" }, { u: "x1", cant: 4, zona: "Palermo" }, { u: "x2", cant: 2, zona: "Almagro" }] },
      { id: 502, region: "GBA Norte", rubro: "Fumigación y plagas", producto: "Fumigación de cucarachas y roedores por casa", unidad: "casa", detalle: "Interior y exterior, con certificado municipal. Mismo día para todo el barrio.", cierre: sumaDias(6), estado: "abierta", creador: "x3", fecha: h(2),
        part: [{ u: "x3", cant: 1, zona: "Los Álamos" }, { u: "x4", cant: 1, zona: "Los Álamos" }, { u: "x5", cant: 1, zona: "Los Álamos" }, { u: "x6", cant: 1, zona: "Pilar centro" }, { u: "x7", cant: 1, zona: "Los Álamos" }] },
      { id: 503, region: "CABA", rubro: "Mudanzas y fletes", producto: "Flete compartido Caballito → Pilar, sábado a la mañana", unidad: "m³", detalle: "Camión de 25 m³. Cada uno paga por el volumen que ocupa.", cierre: sumaDias(9), estado: "abierta", creador: "x8", fecha: h(1),
        part: [{ u: "x8", cant: 8, zona: "Caballito" }, { u: "x9", cant: 6, zona: "Flores" }] },
      { id: 504, region: "CABA", rubro: "Humedad y filtraciones", producto: "Membrana líquida para techos 20 kg", unidad: "balde", detalle: "", cierre: sumaDias(-3), estado: "cerrada", creador: "x1", fecha: h(20),
        part: [{ u: "x1", cant: 6, zona: "Palermo" }, { u: "x2", cant: 4, zona: "Almagro" }, { u: "x9", cant: 5, zona: "Flores" }] }
    ],
    ofertas: [
      { compra: 501, provId: "pv-pint", nombre: "Pinturerías del Centro · 11 5032-1100", escalas: [{ desde: 1, precio: 98000 }, { desde: 10, precio: 86000 }, { desde: 20, precio: 79000 }], detalle: "Envío sin cargo desde 10 latas." },
      { compra: 501, provId: "pv-color", nombre: "Colorshop Palermo · 11 4831-7720", escalas: [{ desde: 1, precio: 95000 }, { desde: 12, precio: 84500 }], detalle: "Retiro en local o envío a cargo." },
      { compra: 502, provId: "pv-fum", nombre: "Fumigaciones Pilar · 230 442-1180", escalas: [{ desde: 1, precio: 45000 }, { desde: 5, precio: 36000 }, { desde: 10, precio: 30000 }], detalle: "Garantía de 90 días con repaso sin cargo." },
      { compra: 503, provId: "pv-mud", nombre: "Mudanzas Rápidas · 11 3988-5500", escalas: [{ desde: 1, precio: 38000 }, { desde: 15, precio: 31000 }, { desde: 22, precio: 27000 }], detalle: "Incluye 2 operarios y seguro de carga." },
      { compra: 504, provId: "pv-pint", nombre: "Pinturerías del Centro · 11 5032-1100", escalas: [{ desde: 1, precio: 72000 }, { desde: 12, precio: 61000 }], detalle: "" }
    ],
    avisos: [
      { u: "u-proveedor", f: h(0), texto: "Nuevo pedido de Pintura en CABA: Pintura descascarada en palier del 3° piso", leido: false },
      { u: "u-proveedor", f: h(3), texto: "Nuevo pedido de Electricidad en CABA: Luces del hall de entrada cortan intermitente", leido: false },
      { u: "u-proveedor", f: h(4), texto: "Compra en conjunto en CABA: Látex interior blanco mate 20 L. Publicá tus precios por cantidad.", leido: false },
      { u: "u-proveedor", f: h(4), texto: "Aprobaron tu presupuesto para R-1038 (Cambiar cerradura de la puerta de entrada).", leido: true }
    ]
  };
}

const DEMO_USERS = {
  vecino: { id: "u-vecino", nombre: "Lucía Fernández", saludo: "Lucía", props: { p1: "UF 7A" }, barrio: "Caballito" },
  administracion: { id: "u-admin", nombre: "Administración Quiroga", props: { p1: "", p2: "" } },
  propietario: { id: "u-prop", nombre: "Grupo Ribera S.A.", props: { p1: "", p2: "", p3: "" } },
  proveedor: { id: "u-proveedor", nombre: "Mantenimiento Delta", props: {} }
};

const Demo = {
  KEY: "condominios-demo-v3", d: null,
  async iniciar() { try { this.d = JSON.parse(localStorage.getItem(this.KEY)); } catch (e) {} if (!this.d || !this.d.reclamos) this.d = seedDemo(); return true; },
  guardar() { try { localStorage.setItem(this.KEY, JSON.stringify(this.d)); } catch (e) {} },
  reset() { this.d = seedDemo(); this.guardar(); },
  personas() {
    if (!this.d.personas) this.d.personas = {
      p1: [{ email: "lucia.fernandez@ejemplo.com", nombre: "Lucía Fernández", rol: "vecino", unidad: "UF 7A" }, { email: "martin.r@ejemplo.com", nombre: "Martín Ruiz", rol: "vecino", unidad: "UF 8A" },
           { email: "adm.quiroga@ejemplo.com", nombre: "Administración Quiroga", rol: "administracion", unidad: null }, { email: "ribera@ejemplo.com", nombre: "Grupo Ribera S.A.", rol: "propietario", unidad: null },
           { email: "sofia.p@ejemplo.com", nombre: null, rol: "vecino", unidad: "UF 2C", pendiente: true }],
      p2: [{ email: "martin.sosa@ejemplo.com", nombre: "Martín Sosa", rol: "vecino", unidad: "UF 3D" }, { email: "adm.quiroga@ejemplo.com", nombre: "Administración Quiroga", rol: "administracion", unidad: null }, { email: "ribera@ejemplo.com", nombre: "Grupo Ribera S.A.", rol: "propietario", unidad: null }],
      p3: [{ email: "rossi.familia@ejemplo.com", nombre: "Familia Rossi", rol: "vecino", unidad: "Lote 14" }, { email: "ribera@ejemplo.com", nombre: "Grupo Ribera S.A.", rol: "propietario", unidad: null }]
    };
    return this.d.personas;
  },
  async miembros(prop) {
    const yo = this.yo();
    return clone(this.personas()[prop] || []).map((m) => ({ ...m, pendiente: !!m.pendiente, soy_yo: m.nombre === yo.nombre }));
  },
  async productos(rubro) { return { rubro, conectado: false, grupos: (BUSQUEDAS[rubro] || []).map((b) => ({ busqueda: b, link: linkListado(b), items: [] })) }; },
  yo() { return DEMO_USERS[ui.rolDemo]; },
  async cargar() {
    const d = this.d, yo = this.yo(), rol = ui.rolDemo;
    const props = d.props.filter((p) => p.id in yo.props);
    const roles = {}, unidades = {};
    props.forEach((p) => { roles[p.id] = rol; unidades[p.id] = yo.props[p.id]; });
    const pv = d.proveedores.find((p) => p.id === yo.id) || null;
    const proveedor = pv ? { razon: pv.razon, tel: pv.tel, rubros: pv.rubros.slice(), zonas: pv.zonas.slice(), cuit: pv.cuit || "", matricula: pv.matricula || "", descripcion: pv.descripcion || "" } : null;
    const reclamos = clone(d.reclamos.filter((r) => r.prop in yo.props));
    // Oportunidades: mismo criterio que la función SQL
    let oportunidades = [];
    if (pv) {
      oportunidades = d.reclamos.map((r) => {
        const p = d.props.find((x) => x.id === r.prop);
        const mi = r.pres.filter((q) => q.provId === pv.id).slice(-1)[0] || null;
        const abierto = ["presupuestando", "aprobacion"].includes(r.estado) && pv.rubros.includes(r.cat) && pv.zonas.includes(p.region);
        if (!mi && !abierto) return null;
        return { id: r.id, rubro: r.cat, tit: r.tit, desc: r.desc, urg: r.urg, estado: r.estado, zona: p.zona, region: p.region, tipo: p.tipo, fecha: r.fecha,
          n: r.pres.filter((q) => q.estado !== "desestimado").length,
          mi: mi && { id: mi.id, monto: mi.monto, plazo: mi.plazo, det: mi.det, estado: mi.estado, motivo: mi.motivo },
          direccion: mi && mi.estado === "aprobado" ? p.nombre + " · " + r.uf : null };
      }).filter(Boolean).sort((a, b) => b.fecha.localeCompare(a.fecha));
    }
    const compras = d.compras.map((c) => ({
      id: c.id, region: c.region, rubro: c.rubro, producto: c.producto, unidad: c.unidad, detalle: c.detalle, cierre: c.cierre, estado: c.estado, fecha: c.fecha,
      participantes: c.part.length, total: c.part.reduce((s, p) => s + p.cant, 0),
      zonas: [...new Set(c.part.map((p) => p.zona).filter(Boolean))],
      mi: (c.part.find((p) => p.u === yo.id) || {}).cant || 0, soyCreador: c.creador === yo.id,
      ofertas: clone(d.ofertas.filter((o) => o.compra === c.id)).map((o) => ({ provId: o.provId, nombre: o.nombre, escalas: o.escalas, detalle: o.detalle }))
    }));
    const avisos = d.avisos.filter((a) => a.u === yo.id).map((a) => ({ texto: a.texto, f: a.f, leido: a.leido }));
    return { usuario: { id: yo.id, nombre: yo.nombre, saludo: yo.saludo || yo.nombre, barrio: yo.barrio || "" }, props, roles, unidades, reclamos, proveedor, oportunidades, compras, avisos };
  },
  async run(fn, a) {
    const d = this.d, yo = this.yo(), hoy = hoyISO();
    const R = (id) => { const r = d.reclamos.find((x) => x.id === id); if (!r) throw new Error("El reclamo no existe"); return r; };
    const log = (r, t, q) => r.ev.push({ f: hoy, q: q || yo.nombre, t });
    const pvYo = d.proveedores.find((p) => p.id === yo.id);
    const avisar = (r) => {
      const p = d.props.find((x) => x.id === r.prop);
      const lista = d.proveedores.filter((x) => x.rubros.includes(r.cat) && x.zonas.includes(p.region));
      lista.forEach((x) => d.avisos.unshift({ u: x.id, f: hoy, texto: `Nuevo pedido de ${r.cat} en ${p.region}: ${r.tit}`, leido: false }));
      return lista.length;
    };
    let out;
    switch (fn) {
      case "crear_reclamo": {
        if (!a.p_ubicacion || !a.p_titulo) throw new Error("Completá la unidad y el título del reclamo");
        const r = { id: ++d.seq, prop: a.p_propiedad, uf: a.p_ubicacion, cat: a.p_rubro, tit: a.p_titulo, desc: a.p_descripcion, urg: a.p_urgencia, estado: "nuevo", fecha: hoy, autor: yo.nombre, pres: [], ev: [] };
        log(r, "Cargó el reclamo.");
        if (requierePresup(r.cat)) { r.estado = "presupuestando"; const n = avisar(r); log(r, `Se publicó para cotizar: ${plural(n, "proveedor", "proveedores")} de ${r.cat} ${n === 1 ? "recibió" : "recibieron"} el aviso.`, "Sistema"); }
        d.reclamos.push(r); out = r.id; break;
      }
      case "pedir_presupuestos": { const r = R(a.p_reclamo); r.estado = "presupuestando"; const n = avisar(r); log(r, `Pidió presupuestos: ${plural(n, "proveedor inscripto", "proveedores inscriptos")} ${n === 1 ? "recibió" : "recibieron"} el aviso.`); break; }
      case "cargar_presupuesto": { const r = R(a.p_reclamo); r.pres.push({ id: "q" + Date.now(), prov: a.p_proveedor, monto: a.p_monto, plazo: a.p_plazo, det: a.p_detalle, estado: "pendiente" }); r.estado = "aprobacion"; log(r, `Cargó presupuesto de ${a.p_proveedor} por ${ars(a.p_monto)}.`); break; }
      case "aprobar_presupuesto": {
        const r = d.reclamos.find((x) => x.pres.some((p) => p.id === a.p_presupuesto)); const p = r.pres.find((x) => x.id === a.p_presupuesto);
        p.estado = "aprobado";
        r.pres.forEach((o) => { if (o !== p && o.estado === "pendiente") { o.estado = "desestimado"; o.motivo = "Se aprobó otra opción."; if (o.provId) d.avisos.unshift({ u: o.provId, f: hoy, texto: `El pedido R-${r.id} se adjudicó a otro proveedor.`, leido: false }); } });
        if (p.provId) d.avisos.unshift({ u: p.provId, f: hoy, texto: `Aprobaron tu presupuesto para R-${r.id} (${r.tit}). Ya podés coordinar el trabajo.`, leido: false });
        r.estado = "en_curso"; log(r, `Aprobó presupuesto de ${p.prov} por ${ars(p.monto)}.`); break;
      }
      case "desestimar_presupuesto": {
        const r = d.reclamos.find((x) => x.pres.some((p) => p.id === a.p_presupuesto)); const p = r.pres.find((x) => x.id === a.p_presupuesto);
        p.estado = "desestimado"; p.motivo = a.p_motivo;
        if (!r.pres.some((x) => x.estado === "pendiente")) r.estado = "presupuestando";
        log(r, `Desestimó presupuesto de ${p.prov}: ${a.p_motivo}`); break;
      }
      case "desestimar_reclamo": { const r = R(a.p_reclamo); r.estado = "desestimado"; r.motivo = a.p_motivo; r.pres.forEach((p) => { if (p.estado === "pendiente") { p.estado = "desestimado"; p.motivo = "Reclamo desestimado."; } }); log(r, "Desestimó: " + a.p_motivo); break; }
      case "resolver_reclamo": { const r = R(a.p_reclamo); r.estado = "resuelto"; log(r, "Marcó el reclamo como resuelto."); break; }
      case "reabrir_reclamo": { const r = R(a.p_reclamo); r.estado = r.pres.some((p) => p.estado === "aprobado") ? "en_curso" : "nuevo"; r.motivo = null; log(r, "Reabrió el reclamo."); break; }
      case "enviar_nota": { const r = R(a.p_reclamo); r.estado = "en_curso"; log(r, `Envió nota formal a ${r.uf} recordando el reglamento de copropiedad.`); break; }
      case "comentar": { const r = R(a.p_reclamo); log(r, a.p_texto); break; }
      case "registrar_proveedor": {
        if (!a.p_razon_social || !a.p_telefono) throw new Error("Completá nombre comercial y teléfono");
        if (!a.p_rubros.length) throw new Error("Elegí al menos un rubro");
        if (!a.p_zonas.length) throw new Error("Elegí al menos una zona");
        const x = { id: yo.id, razon: a.p_razon_social, tel: a.p_telefono, rubros: a.p_rubros, zonas: a.p_zonas, cuit: a.p_cuit, matricula: a.p_matricula, descripcion: a.p_descripcion };
        const i = d.proveedores.findIndex((p) => p.id === yo.id); if (i >= 0) d.proveedores[i] = x; else d.proveedores.push(x); break;
      }
      case "cotizar": {
        if (!pvYo) throw new Error("Inscribite como proveedor para cotizar");
        const r = R(a.p_reclamo);
        if (!["presupuestando", "aprobacion"].includes(r.estado)) throw new Error("Este pedido ya no recibe cotizaciones");
        if (r.pres.some((p) => p.provId === pvYo.id && p.estado !== "desestimado")) throw new Error("Ya cotizaste este pedido");
        if (!(a.p_monto > 0)) throw new Error("Indicá un monto válido");
        r.pres.push({ id: "q" + Date.now(), provId: pvYo.id, contacto: pvYo.tel, prov: pvYo.razon, monto: a.p_monto, plazo: a.p_plazo, det: a.p_detalle, estado: "pendiente" });
        r.estado = "aprobacion"; log(r, `${pvYo.razon} cotizó ${ars(a.p_monto)} desde la plataforma.`); break;
      }
      case "marcar_avisos_leidos": d.avisos.forEach((x) => { if (x.u === yo.id) x.leido = true; }); break;
      case "crear_compra": {
        if (!a.p_producto || !a.p_unidad) throw new Error("Completá producto y unidad");
        if (!(a.p_cantidad > 0)) throw new Error("Indicá cuántas unidades querés");
        if (a.p_cierre < hoy) throw new Error("La fecha de cierre ya pasó");
        const c = { id: ++d.seqCompra, region: a.p_region, rubro: a.p_rubro, producto: a.p_producto, unidad: a.p_unidad, detalle: a.p_detalle, cierre: a.p_cierre, estado: "abierta", creador: yo.id, fecha: hoy, part: [{ u: yo.id, cant: a.p_cantidad, zona: a.p_zona }] };
        d.compras.unshift(c);
        d.proveedores.filter((x) => x.rubros.includes(c.rubro) && x.zonas.includes(c.region)).forEach((x) => d.avisos.unshift({ u: x.id, f: hoy, texto: `Compra en conjunto en ${c.region}: ${c.producto}. Publicá tus precios por cantidad.`, leido: false }));
        out = c.id; break;
      }
      case "sumarse_compra": {
        const c = d.compras.find((x) => x.id === a.p_compra);
        if (!c || c.estado !== "abierta") throw new Error("Esta compra ya cerró");
        const i = c.part.findIndex((p) => p.u === yo.id);
        if (!(a.p_cantidad > 0)) { if (i >= 0) c.part.splice(i, 1); }
        else if (i >= 0) c.part[i].cant = a.p_cantidad; else c.part.push({ u: yo.id, cant: a.p_cantidad, zona: a.p_zona });
        break;
      }
      case "ofertar_compra": {
        if (!pvYo) throw new Error("Inscribite como proveedor para ofertar");
        const c = d.compras.find((x) => x.id === a.p_compra);
        if (!pvYo.rubros.includes(c.rubro)) throw new Error("No estás inscripto en " + c.rubro);
        if (!a.p_escalas.length || a.p_escalas.some((e) => !(e.desde >= 1 && e.precio > 0))) throw new Error("Revisá las escalas: cantidad desde 1 y precio mayor a 0");
        const o = { compra: c.id, provId: pvYo.id, nombre: pvYo.razon + " · " + pvYo.tel, escalas: a.p_escalas, detalle: a.p_detalle };
        const i = d.ofertas.findIndex((x) => x.compra === c.id && x.provId === pvYo.id); if (i >= 0) d.ofertas[i] = o; else d.ofertas.push(o); break;
      }
      case "invitar": {
        const email = (a.p_email || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("El email no es válido");
        if (ui.rolDemo === "administracion" && a.p_rol !== "vecino") throw new Error("Tu rol no permite sumar personas con ese rol");
        const lista = (this.personas()[a.p_propiedad] = this.personas()[a.p_propiedad] || []);
        const i = lista.findIndex((m) => m.email === email);
        const x = { email, nombre: a.p_nombre || null, rol: a.p_rol, unidad: a.p_unidad || null, pendiente: true };
        if (i >= 0) lista[i] = { ...lista[i], rol: a.p_rol, unidad: a.p_unidad || null }; else lista.push(x);
        out = i >= 0 && !lista[i].pendiente ? "agregado" : "invitado"; break;
      }
      case "quitar_persona": {
        const lista = this.personas()[a.p_propiedad] || [];
        const m = lista.find((x) => x.email === a.p_email);
        if (ui.rolDemo === "administracion" && m && m.rol !== "vecino") throw new Error("Tu rol no permite quitar a esta persona");
        this.personas()[a.p_propiedad] = lista.filter((x) => x.email !== a.p_email); break;
      }
      case "crear_propiedad": {
        if (!a.p_nombre) throw new Error("Poné el nombre o la dirección de la propiedad");
        const id = "p" + Date.now();
        d.props.push({ id, nombre: a.p_nombre, tipo: a.p_tipo, zona: a.p_zona, region: a.p_region || "CABA" });
        yo.props[id] = ""; this.personas()[id] = [{ email: "ribera@ejemplo.com", nombre: yo.nombre, rol: "propietario", unidad: null }];
        out = id; break;
      }
      case "editar_propiedad": {
        const pr = d.props.find((x) => x.id === a.p_propiedad);
        Object.assign(pr, { nombre: a.p_nombre, tipo: a.p_tipo, zona: a.p_zona, region: a.p_region, cotizacion_abierta: a.p_cotizacion_abierta }); break;
      }
      case "cerrar_compra": { const c = d.compras.find((x) => x.id === a.p_compra); if (c.creador !== yo.id) throw new Error("Solo quien creó la compra puede cerrarla"); c.estado = "cerrada"; break; }
      default: throw new Error("Acción desconocida: " + fn);
    }
    this.guardar(); return out;
  }
};
const clone = (x) => JSON.parse(JSON.stringify(x));

// ======================================================================
// Capa de datos: SUPABASE
// ======================================================================
const Nube = {
  sb: null, canal: null,
  async iniciar() {
    if (!this.sb) {
      if (!window.supabase) throw new Error("No se pudo cargar la librería de Supabase");
      this.sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
      this.sb.auth.onAuthStateChange((ev) => {
        if (ev === "SIGNED_IN" && vista === "login") arrancar();
        if (ev === "SIGNED_OUT") { S.usuario = null; mostrarLogin(); }
      });
    }
    const { data } = await this.sb.auth.getSession();
    return !!data.session;
  },
  async login(email) {
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
  },
  async salir() { await this.sb.auth.signOut(); },
  async cargar() {
    const sb = this.sb;
    const { data: { user } } = await sb.auth.getUser();
    const chk = (r) => { if (r.error) throw new Error(r.error.message); return r.data; };
    const [perfil, mem, props, rub, rec, pv, pvr, ops, comp, ofs, avs] = await Promise.all([
      sb.from("perfiles").select("nombre").eq("id", user.id).maybeSingle(),
      sb.from("membresias").select("propiedad_id,rol,unidad").eq("usuario_id", user.id),
      sb.from("propiedades").select("id,nombre,tipo,zona,region,cotizacion_abierta").order("nombre"),
      sb.from("rubros").select("nombre,requiere_presup").order("orden"),
      sb.from("reclamos").select("*,presupuestos(*),eventos(*)").order("id", { ascending: false }),
      sb.from("proveedores").select("*").eq("id", user.id).maybeSingle(),
      sb.from("proveedor_rubros").select("rubro").eq("proveedor_id", user.id),
      sb.rpc("oportunidades"),
      sb.rpc("compras_resumen"),
      sb.from("compra_ofertas").select("*"),
      sb.from("avisos").select("*").eq("usuario_id", user.id).order("id", { ascending: false }).limit(30)
    ]);
    const rubros = chk(rub); if (rubros.length) RUBROS = rubros.map((r) => ({ nombre: r.nombre, requiere: r.requiere_presup }));
    const roles = {}, unidades = {};
    chk(mem).forEach((m) => { roles[m.propiedad_id] = m.rol; unidades[m.propiedad_id] = m.unidad || ""; });
    const ficha = chk(pv);
    const ofertas = chk(ofs);
    if (!this.canal) {
      const recargarPronto = () => { clearTimeout(this.t); this.t = setTimeout(() => { if (!ui.form && !ui.opForm && !ui.compraForm) recargar(); }, 400); };
      this.canal = sb.channel("cambios")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "eventos" }, recargarPronto)
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "avisos" }, (p) => { toast(p.new.texto); recargarPronto(); })
        .on("postgres_changes", { event: "*", schema: "public", table: "compras" }, recargarPronto)
        .on("postgres_changes", { event: "*", schema: "public", table: "compra_ofertas" }, recargarPronto)
        .subscribe();
    }
    return {
      usuario: { id: user.id, nombre: (chk(perfil) || {}).nombre || user.email, email: user.email, barrio: "" },
      props: chk(props), roles, unidades,
      reclamos: chk(rec).map((r) => ({
        id: r.id, prop: r.propiedad_id, uf: r.ubicacion, cat: r.rubro, tit: r.titulo, desc: r.descripcion, autor: r.autor_nombre,
        urg: r.urgencia, estado: r.estado, motivo: r.motivo, fecha: isoLocal(r.creado_en),
        pres: (r.presupuestos || []).sort((a, b) => a.creado_en.localeCompare(b.creado_en)).map((p) => ({ id: p.id, provId: p.proveedor_id, contacto: p.contacto, prov: p.proveedor, monto: +p.monto, plazo: p.plazo_dias, det: p.detalle, estado: p.estado, motivo: p.motivo })),
        ev: (r.eventos || []).sort((a, b) => a.id - b.id).map((e) => ({ f: isoLocal(e.creado_en), q: e.autor_nombre, t: e.texto }))
      })),
      proveedor: ficha && { razon: ficha.razon_social, tel: ficha.telefono, rubros: chk(pvr).map((x) => x.rubro), zonas: ficha.zonas || [], cuit: ficha.cuit || "", matricula: ficha.matricula || "", descripcion: ficha.descripcion || "" },
      oportunidades: (ops.error ? [] : ops.data).map((o) => ({
        id: o.id, rubro: o.rubro, tit: o.titulo, desc: o.descripcion, urg: o.urgencia, estado: o.estado, zona: o.zona, region: o.region, tipo: o.tipo, fecha: isoLocal(o.creado_en), n: o.cotizaciones,
        mi: o.mi_id && { id: o.mi_id, monto: +o.mi_monto, plazo: o.mi_plazo, det: o.mi_detalle, estado: o.mi_estado, motivo: o.mi_motivo }, direccion: o.direccion })),
      compras: chk(comp).map((c) => ({
        id: c.id, region: c.region, rubro: c.rubro, producto: c.producto, unidad: c.unidad, detalle: c.detalle, cierre: c.cierre, estado: c.estado, fecha: isoLocal(c.creado_en),
        participantes: c.participantes, total: +c.total, zonas: c.zonas || [], mi: +(c.mi_cantidad || 0), soyCreador: !!c.soy_creador,
        ofertas: ofertas.filter((o) => o.compra_id === c.id).map((o) => ({ provId: o.proveedor_id, nombre: o.proveedor_nombre, escalas: o.escalas, detalle: o.detalle }))
      })),
      avisos: chk(avs).map((a) => ({ texto: a.texto, f: isoLocal(a.creado_en), leido: a.leido }))
    };
  },
  async run(fn, args) { const { data, error } = await this.sb.rpc(fn, args); if (error) throw new Error(error.message); return data; },
  async miembros(prop) { return (await this.run("miembros", { p_propiedad: prop })) || []; },
  async productos(rubro) {
    const { data } = await this.sb.auth.getSession();
    const r = await fetch(`${CFG.supabaseUrl}/functions/v1/mercadolibre/productos?rubro=${encodeURIComponent(rubro)}`, {
      headers: { Authorization: "Bearer " + data.session.access_token, apikey: CFG.supabaseAnonKey }
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || "No se pudieron traer los productos");
    return j;
  }
};

const DB = MODO_DEMO ? Demo : Nube;

// ======================================================================
// Arranque, carga y acciones
// ======================================================================
let vista = "cargando";

async function arrancar() {
  $("#demoBadge").hidden = !MODO_DEMO;
  $("#footNote").hidden = !MODO_DEMO;
  try {
    const conSesion = await DB.iniciar();
    if (!conSesion) return mostrarLogin();
    await recargar();
  } catch (e) {
    $("#view").innerHTML = `<div class="card login"><h2>No pudimos conectar</h2><p class="muted">${esc(e.message)}</p><button class="btn primary" data-act="reintentar">Reintentar</button></div>`;
  }
}

async function recargar() {
  Object.assign(S, await DB.cargar());
  const tabs = tabsDisponibles();
  if (!tabs.length) { vista = "registro"; return render(); }
  vista = "app";
  if (!tabs.some((t) => t.id === ui.tab)) ui.tab = tabs[0].id;
  if (ui.prop !== "all" && !S.props.some((p) => p.id === ui.prop)) ui.prop = "all";
  if (S.props.length === 1) ui.prop = S.props[0].id;
  if (!S.reclamos.some((r) => r.id === ui.sel)) ui.sel = (filtrados()[0] || {}).id ?? null;
  render();
}

async function correr(fn, args, msg) {
  if (ui.busy) return;
  ui.busy = true;
  try {
    const out = await DB.run(fn, args);
    ui.form = null; ui.opForm = null; ui.compraForm = null;
    await recargar();
    if (msg) toast(typeof msg === "function" ? msg(out) : msg);
    return out ?? true;
  } catch (e) { toast(e.message || "No se pudo completar la acción"); }
  finally { ui.busy = false; }
}

function tabsDisponibles() {
  const t = [];
  if (S.props.length) t.push({ id: "reclamos", label: "Reclamos" });
  if (S.proveedor) t.push({ id: "pedidos", label: "Pedidos para cotizar", badge: S.avisos.filter((a) => !a.leido).length });
  if (S.props.length || S.proveedor) t.push({ id: "compras", label: "Compras en conjunto" });
  if (S.props.length) t.push({ id: "productos", label: "Productos" });
  if (propsGestion().length) t.push({ id: "personas", label: "Personas" });
  if (S.proveedor) t.push({ id: "inscripcion", label: "Mi inscripción" });
  return t;
}

// ======================================================================
// Render
// ======================================================================
const propNombre = (id) => (S.props.find((p) => p.id === id) || {}).nombre || "";
const abierto = (r) => !["resuelto", "desestimado"].includes(r.estado);
const rolDe = (r) => S.roles[r.prop];
const rolPrincipal = () => MODO_DEMO ? ui.rolDemo : (S.props.length ? S.roles[ui.prop !== "all" ? ui.prop : S.props[0].id] : (S.proveedor ? "proveedor" : null));

function render() {
  renderHeader();
  const enApp = vista === "app";
  $("#hero").hidden = !(enApp || vista === "registro");
  $("#tabs").hidden = !enApp;
  if (vista === "registro") return renderRegistro();
  if (!enApp) return;
  renderHero(); renderTabs();
  ({ reclamos: renderReclamos, pedidos: renderPedidos, compras: renderCompras, inscripcion: renderInscripcion, productos: renderProductos, personas: renderPersonas })[ui.tab]();
}

function renderHeader() {
  const seg = $("#roleSeg"), box = $("#userBox");
  seg.hidden = !MODO_DEMO; box.hidden = MODO_DEMO || !S.usuario;
  if (MODO_DEMO) seg.innerHTML = `<span class="label" style="align-self:center;padding:0 8px 0 10px">Ver como</span>` + Object.keys(ROL_LABEL).map((k) => `<button data-rol="${k}" aria-pressed="${ui.rolDemo === k}">${ROL_LABEL[k]}</button>`).join("");
  else if (S.usuario) box.innerHTML = `<span class="avatar" aria-hidden="true">${esc(S.usuario.nombre.trim()[0] || "?").toUpperCase()}</span><span>${esc(S.usuario.nombre)}</span><button class="btn sm" data-act="salir">Salir</button>`;
}

function renderHero() {
  const n = (S.usuario.saludo || S.usuario.nombre.split(" ")[0]).replace(/\.$/, "");
  let sub = "";
  const rol = rolPrincipal();
  const rs = S.reclamos.filter((r) => ui.prop === "all" || r.prop === ui.prop);
  if (ui.tab === "compras") sub = "Sumate a compras con vecinos de tu zona. Cuantos más se suman, más baja el precio por unidad.";
  else if (ui.tab === "personas") sub = "Sumá vecinos, administración y propietarios a cada propiedad. Entran con su email y ya ven su edificio.";
  else if (ui.tab === "productos") sub = "Lo que más se usa en cada arreglo, con precios de Mercado Libre. Si conviene comprar en cantidad, armá una compra en conjunto.";
  else if (ui.tab === "pedidos" || ui.tab === "inscripcion") {
    const k = S.oportunidades.filter((o) => !o.mi).length;
    sub = k ? `Tenés ${plural(k, "pedido", "pedidos")} de tus rubros esperando cotización.` : "Te avisamos apenas aparezca un pedido de tus rubros en tus zonas.";
  } else if (rol === "propietario") {
    const k = rs.filter((r) => r.estado === "aprobacion").length;
    sub = k ? `Tenés ${plural(k, "reclamo", "reclamos")} con presupuestos esperando tu aprobación.` : "No hay presupuestos esperando tu aprobación.";
  } else if (rol === "administracion") {
    const k = rs.filter((r) => r.estado === "nuevo").length, c = rs.filter((r) => r.estado === "en_curso").length;
    sub = `${plural(k, "reclamo nuevo", "reclamos nuevos")} para revisar y ${plural(c, "trabajo", "trabajos")} en curso.`;
  } else {
    const k = rs.filter(abierto).length;
    sub = k ? `Hay ${plural(k, "reclamo abierto", "reclamos abiertos")} en tu edificio. Contá lo que pasa y lo seguís desde acá.` : "Todo en orden en tu edificio.";
  }
  $("#heroTitle").innerHTML = `Hola, <span class="name">${esc(n)}</span>. ${ui.tab === "compras" ? "¿Qué compramos juntos?" : ui.tab === "productos" ? "¿Qué te hace falta?" : ui.tab === "personas" ? "¿A quién sumamos?" : ui.tab === "pedidos" || ui.tab === "inscripcion" ? "¿Qué cotizamos hoy?" : "¿Qué resolvemos hoy?"}`;
  $("#heroSub").textContent = sub;
}

function renderTabs() {
  $("#tabs").innerHTML = tabsDisponibles().map((t) => `<button class="tab" role="tab" data-tab="${t.id}" aria-selected="${ui.tab === t.id}">${t.label}${t.badge ? `<span class="dot">${t.badge}</span>` : ""}</button>`).join("");
}

// ---------- Reclamos ----------
function filtrados() {
  const q = ui.q.trim().toLowerCase();
  const o = { alta: 0, media: 1, baja: 2 };
  return S.reclamos.filter((r) => {
    if (ui.prop !== "all" && r.prop !== ui.prop) return false;
    if (ui.filtro === "abiertos" && !abierto(r)) return false;
    if (ui.filtro === "aprobacion" && r.estado !== "aprobacion") return false;
    if (ui.filtro === "en_curso" && r.estado !== "en_curso") return false;
    if (ui.filtro === "cerrados" && abierto(r)) return false;
    if (ui.cat && r.cat !== ui.cat) return false;
    if (q && !(r.tit + " " + r.uf + " " + r.autor + " " + r.cat + " " + r.pres.map((p) => p.prov).join(" ") + " R-" + r.id).toLowerCase().includes(q)) return false;
    return true;
  }).sort((a, b) => (abierto(b) - abierto(a)) || (o[a.urg] - o[b.urg]) || b.fecha.localeCompare(a.fecha));
}

function renderReclamos() {
  const rs = S.reclamos.filter((r) => ui.prop === "all" || r.prop === ui.prop);
  const ab = rs.filter(abierto), ap = rs.filter((r) => r.estado === "aprobacion");
  const monto = ap.reduce((s, r) => { const v = r.pres.filter((p) => p.estado === "pendiente").map((p) => p.monto); return s + (v.length ? Math.min(...v) : 0); }, 0);
  const cot = rs.filter((r) => r.estado === "presupuestando").length;
  const propSel = S.props.length > 1 ? `<select id="propSel" aria-label="Propiedad" style="max-width:320px"><option value="all">Todas las propiedades (${S.props.length})</option>${S.props.map((p) => `<option value="${p.id}" ${ui.prop === p.id ? "selected" : ""}>${esc(p.nombre)} · ${esc(p.zona)}</option>`).join("")}</select>` : `<span class="muted">${esc(S.props[0].nombre)} · ${esc(S.props[0].zona)}</span>`;
  $("#view").innerHTML = `<div class="wrap" style="gap:16px">
    <div class="row" style="justify-content:space-between">${propSel}</div>
    <div class="stats">
      <div class="stat"><span class="label">Abiertos</span><b>${ab.length}</b><small>${ab.filter((r) => r.urg === "alta").length} con urgencia alta</small></div>
      <div class="stat"><span class="label">Cotizando</span><b>${cot}</b><small>publicados a proveedores</small></div>
      <div class="stat ${ap.length ? "hot" : ""}"><span class="label">Esperan aprobación</span><b>${ap.length}</b><small>${ap.length ? ars(monto) + " con la opción más baja" : "nada pendiente"}</small></div>
      <div class="stat"><span class="label">Resueltos</span><b>${rs.filter((r) => r.estado === "resuelto").length}</b><small>de ${rs.length} cargados</small></div>
    </div>
    <button class="composer" data-act="nuevo-reclamo"><span class="plus" aria-hidden="true">+</span><span>Contá qué pasa en tu edificio o barrio…</span></button>
    <div class="main">
      <div class="list-col">
        <div class="card filters">
          <div class="chips" id="chips"></div>
          <div class="row" style="flex-wrap:nowrap">
            <input type="text" class="search" id="q" placeholder="Buscar por título, unidad o proveedor" aria-label="Buscar" value="${esc(ui.q)}">
            <select id="catSel" aria-label="Rubro" style="max-width:170px"><option value="">Todos los rubros</option>${RUBROS.map((c) => `<option ${ui.cat === c.nombre ? "selected" : ""}>${esc(c.nombre)}</option>`).join("")}</select>
          </div>
        </div>
        <div class="card"><ul class="items" id="list"></ul></div>
      </div>
      <div class="detail-col"><div class="card" id="detail"></div></div>
    </div></div>`;
  renderLista(); renderDetalle();
}

function renderLista() {
  const f = [["abiertos", "Abiertos"], ["aprobacion", "Por aprobar"], ["en_curso", "En curso"], ["cerrados", "Cerrados"], ["todos", "Todos"]];
  $("#chips").innerHTML = f.map(([k, l]) => `<button class="chip" data-f="${k}" aria-pressed="${ui.filtro === k}">${l}</button>`).join("");
  const rs = filtrados();
  $("#list").innerHTML = rs.length ? rs.map((r) => `<li class="item" aria-current="${r.id === ui.sel}"><button data-sel="${r.id}">
      <span class="stripe u-${r.urg}" title="Urgencia ${r.urg}"></span>
      <span><span class="it-head"><span class="tag">${esc(r.cat)}</span><span class="pill e-${r.estado}">${ESTADOS[r.estado]}</span></span>
      <div class="it-title">${esc(r.tit)}</div>
      <div class="it-meta"><span class="mono">R-${r.id}</span> · ${esc(propNombre(r.prop))} · ${esc(r.uf)} · ${fd(r.fecha)}</div></span></button></li>`).join("")
    : `<li class="empty">No hay reclamos con estos filtros.</li>`;
}

function acciones(r) {
  const R = rolDe(r), b = []; let hint = "";
  const sinP = !requierePresup(r.cat);
  if (!abierto(r)) {
    hint = r.estado === "resuelto" ? "Reclamo cerrado como resuelto." : "Desestimado: " + esc(r.motivo || "");
    if (R !== "vecino") b.push(`<button class="btn sm" data-act="reabrir">Reabrir</button>`);
    return { hint, b };
  }
  if (R === "vecino") hint = { nuevo: "La administración va a revisar tu reclamo.", presupuestando: "Publicado: los proveedores inscriptos ya pueden cotizar.", aprobacion: "Hay presupuestos esperando la aprobación del propietario.", en_curso: "El trabajo está en curso." }[r.estado];
  if (R === "administracion") {
    if (sinP) { hint = "Los reclamos de convivencia se gestionan con notas a la unidad."; if (r.estado === "nuevo") b.push(`<button class="btn sm primary" data-act="nota">Enviar nota a ${esc(r.uf)}</button>`); }
    else {
      if (r.estado === "nuevo") { hint = "Revisá el reclamo y publicalo para que coticen."; b.push(`<button class="btn sm primary" data-act="pedir">Publicar para cotizar</button>`); }
      if (r.estado === "presupuestando") hint = "Publicado a proveedores. También podés cargar presupuestos propios.";
      if (r.estado === "aprobacion") hint = "Esperando la decisión del propietario.";
      if (["nuevo", "presupuestando", "aprobacion"].includes(r.estado)) b.push(`<button class="btn sm tonal" data-act="form-pres">Cargar presupuesto</button>`);
    }
    if (r.estado === "en_curso") { hint = "Cuando el trabajo esté terminado, cerralo."; b.push(`<button class="btn sm primary" data-act="resolver">Marcar resuelto</button>`); }
  }
  if (R === "propietario") {
    hint = { nuevo: "La administración todavía no lo publicó.", presupuestando: "Publicado: esperando cotizaciones.", aprobacion: "Elegí un presupuesto o desestimalo abajo.", en_curso: "Trabajo aprobado y en curso." }[r.estado];
    if (sinP) hint = "Reclamo de convivencia: lo gestiona la administración.";
  }
  if (R !== "vecino") b.push(`<button class="btn sm bad" data-act="form-desest">Desestimar</button>`);
  return { hint, b };
}

function renderDetalle() {
  const r = S.reclamos.find((x) => x.id === ui.sel), el = $("#detail");
  if (!r) { el.innerHTML = `<div class="placeholder">Elegí un reclamo de la lista para ver el detalle.</div>`; return; }
  const R = rolDe(r), { hint, b } = acciones(r), sinP = !requierePresup(r.cat);
  const pend = r.pres.filter((p) => p.estado === "pendiente"), min = pend.length > 1 ? Math.min(...pend.map((p) => p.monto)) : null;
  const verContacto = R !== "vecino";
  el.innerHTML = `<div class="detail">
    <button class="btn sm back" data-act="volver">← Reclamos</button>
    <div class="d-head">
      <div class="row"><span class="mono muted">R-${r.id}</span><span class="pill e-${r.estado}">${ESTADOS[r.estado]}</span><span class="tag">${esc(r.cat)}</span><span class="tag">· Urgencia ${r.urg}</span></div>
      <h2>${esc(r.tit)}</h2>
      <div class="d-meta"><span>${esc(propNombre(r.prop))} · ${esc(r.uf)}</span><span>Reportó ${esc(r.autor)}</span><span>${fLarga(r.fecha)}</span></div>
    </div>
    ${r.desc ? `<p class="d-desc">${esc(r.desc)}</p>` : ""}
    <div class="actions"><span class="hint">${hint || ""}</span>${b.join("")}</div>
    ${ui.form === "desest" ? `<form class="inline-form" data-form="desest"><label class="label" for="dsMot">Motivo</label><input type="text" id="dsMot" required placeholder="Corresponde a la unidad, no al consorcio"><div class="row"><button class="btn sm bad">Desestimar reclamo</button><button type="button" class="btn sm" data-act="cancelar">Cancelar</button></div></form>` : ""}
    ${sinP ? "" : `<section><h3>Presupuestos</h3><div class="quotes">
      ${r.pres.length ? r.pres.map((p) => `<div class="quote ${p.estado}">
        <div><div class="q-name">${esc(p.prov)}${p.provId ? `<span class="via">Cotizó en la plataforma</span>` : ""}</div><div class="q-det">${esc(p.det || "")}</div>${p.contacto && verContacto ? `<div class="q-det mono">Tel. ${esc(p.contacto)}</div>` : ""}</div>
        <div><div class="q-amt">${ars(p.monto)}</div><div class="q-sub">${p.plazo ? plural(p.plazo, "día", "días") + " de trabajo" : ""}</div></div>
        <div class="q-foot">
          <span class="pill e-${p.estado}">${EST_PRES[p.estado]}</span>${p.estado === "desestimado" && p.motivo ? `<span class="q-det">${esc(p.motivo)}</span>` : ""}
          ${p.monto === min && p.estado === "pendiente" ? `<span class="best">Más bajo</span>` : ""}
          ${R === "propietario" && p.estado === "pendiente" && abierto(r) ? `<span class="push"><button class="btn sm ok" data-act="aprobar" data-p="${p.id}">Aprobar</button><button class="btn sm bad" data-act="form-rech" data-p="${p.id}">Desestimar</button></span>` : ""}
        </div>
        ${ui.form === "rech:" + p.id ? `<form class="inline-form" data-form="rech" data-p="${p.id}"><label class="label" for="rcMot">Motivo</label><input type="text" id="rcMot" required placeholder="Precio alto, pedir otra cotización"><div class="row"><button class="btn sm bad">Desestimar presupuesto</button><button type="button" class="btn sm" data-act="cancelar">Cancelar</button></div></form>` : ""}
      </div>`).join("") : `<div class="q-det">${r.estado === "presupuestando" ? "Publicado a los proveedores inscriptos. Las cotizaciones aparecen acá apenas llegan." : "Todavía no hay presupuestos."}</div>`}
      ${ui.form === "pres" ? `<form class="inline-form" data-form="pres"><span class="label">Presupuesto de un proveedor propio</span>
        <div class="grid3"><input type="text" id="pfProv" placeholder="Proveedor" required aria-label="Proveedor"><input type="number" id="pfMonto" placeholder="Monto $" min="1" required aria-label="Monto"><input type="number" id="pfPlazo" placeholder="Días" min="1" value="3" aria-label="Días de trabajo"></div>
        <textarea id="pfDet" placeholder="Qué incluye y qué no" aria-label="Detalle"></textarea>
        <div class="row"><button class="btn sm primary">Enviar al propietario</button><button type="button" class="btn sm" data-act="cancelar">Cancelar</button></div></form>` : ""}
    </div></section>`}
    ${BUSQUEDAS[r.cat] ? `<section><h3>Materiales frecuentes</h3><div class="row">${BUSQUEDAS[r.cat].slice(0, 4).map((b) => `<a class="chip" href="${linkListado(b)}" target="_blank" rel="noopener">${esc(capital(b))} ↗</a>`).join("")}<button class="linkbtn" data-act="ver-productos" data-rubro="${esc(r.cat)}">Ver precios</button></div></section>` : ""}
    <section><h3>Seguimiento</h3><ul class="timeline">
      ${r.ev.map((e) => `<li><span class="mono tl-date">${fd(e.f)}</span><span><span class="tl-who">${esc(e.q)}</span> · ${esc(e.t)}</span></li>`).join("")}
    </ul>
    <form class="compose" data-form="comentar"><input type="text" id="cmTxt" placeholder="Escribí un comentario" aria-label="Comentario" required><button class="btn">Enviar</button></form></section>
  </div>`;
}

// ---------- Pedidos para cotizar (proveedor) ----------
function renderPedidos() {
  const ops = S.oportunidades;
  const grupos = { abiertos: ops.filter((o) => !o.mi && ["presupuestando", "aprobacion"].includes(o.estado)), cotizados: ops.filter((o) => o.mi && o.mi.estado === "pendiente"), ganados: ops.filter((o) => o.mi && o.mi.estado === "aprobado"), otros: ops.filter((o) => o.mi && o.mi.estado === "desestimado") };
  const lista = grupos[ui.opFiltro] || [];
  const nuevos = S.avisos.filter((a) => !a.leido);
  const f = [["abiertos", "Para cotizar"], ["cotizados", "Cotizados"], ["ganados", "Ganados"], ["otros", "No elegidos"]];
  $("#view").innerHTML = `<div class="wrap" style="gap:16px">
    <div class="stats">
      <div class="stat ${grupos.abiertos.length ? "hot" : ""}"><span class="label">Para cotizar</span><b>${grupos.abiertos.length}</b><small>en ${esc(S.proveedor.zonas.join(", "))}</small></div>
      <div class="stat"><span class="label">Cotizados</span><b>${grupos.cotizados.length}</b><small>esperando decisión</small></div>
      <div class="stat"><span class="label">Ganados</span><b>${grupos.ganados.length}</b><small>${ars(grupos.ganados.reduce((s, o) => s + o.mi.monto, 0))} adjudicados</small></div>
    </div>
    ${S.avisos.length ? `<div class="card avisos"><div class="row" style="justify-content:space-between"><span class="label">Avisos${nuevos.length ? " · " + nuevos.length + " nuevos" : ""}</span>${nuevos.length ? `<button class="linkbtn" data-act="leidos">Marcar como leídos</button>` : ""}</div>
      ${S.avisos.slice(0, 5).map((a) => `<div class="aviso ${a.leido ? "leido" : ""}"><span><span class="mono muted">${fd(a.f)}</span> ${esc(a.texto)}</span></div>`).join("")}</div>` : ""}
    <div class="chips">${f.map(([k, l]) => `<button class="chip" data-opf="${k}" aria-pressed="${ui.opFiltro === k}">${l} (${grupos[k].length})</button>`).join("")}</div>
    <div class="cards">${lista.length ? lista.map(cardPedido).join("") : `<div class="card empty">${ui.opFiltro === "abiertos" ? "No hay pedidos nuevos de tus rubros. Te avisamos apenas aparezca uno." : "Nada por acá todavía."}</div>`}</div>
  </div>`;
}

function cardPedido(o) {
  const form = ui.opForm === o.id;
  return `<article class="card op">
    <div class="row"><span class="pill e-presupuestando">${esc(o.rubro)}</span><span class="tag">Urgencia ${o.urg}</span><span class="mono muted" style="margin-left:auto">R-${o.id} · ${fd(o.fecha)}</span></div>
    <h4>${esc(o.tit)}</h4>
    ${o.desc ? `<p>${esc(o.desc)}</p>` : ""}
    <p>${esc(o.tipo || "")} · ${esc(o.zona || o.region)}</p>
    ${o.mi ? `<div class="mine"><span class="muted">Tu cotización</span><b>${ars(o.mi.monto)}</b>${o.mi.plazo ? `<span class="muted">${plural(o.mi.plazo, "día", "días")}</span>` : ""}<span class="pill e-${o.mi.estado}">${EST_PRES[o.mi.estado]}</span>
        ${o.mi.estado === "aprobado" && o.direccion ? `<span style="flex-basis:100%">Dirección del trabajo: <b style="font-size:15px">${esc(o.direccion)}</b></span>` : ""}
        ${o.mi.estado === "desestimado" && o.mi.motivo ? `<span class="muted" style="flex-basis:100%">${esc(o.mi.motivo)}</span>` : ""}</div>` : ""}
    ${form ? `<form class="inline-form" data-form="cotizar" data-r="${o.id}">
        <div class="grid2"><div class="field"><label for="ctMonto">Monto total $</label><input type="number" id="ctMonto" min="1" required></div><div class="field"><label for="ctPlazo">Días de trabajo</label><input type="number" id="ctPlazo" min="1" value="1"></div></div>
        <div class="field"><label for="ctDet">Qué incluye</label><textarea id="ctDet" placeholder="Materiales, mano de obra, garantía"></textarea></div>
        <div class="row"><button class="btn sm primary">Enviar cotización</button><button type="button" class="btn sm" data-act="cancelar">Cancelar</button></div></form>` : ""}
    <div class="foot"><span class="muted" style="font-size:14px">${o.n ? plural(o.n, "cotización recibida", "cotizaciones recibidas") : "Todavía nadie cotizó"}</span>
      ${!o.mi && !form ? `<span class="push"><button class="btn sm primary" data-act="form-cot" data-r="${o.id}">Cotizar</button></span>` : ""}</div>
  </article>`;
}

// ---------- Compras en conjunto ----------
function precioEn(oferta, q) { const t = oferta.escalas.filter((e) => e.desde <= q).sort((a, b) => b.desde - a.desde)[0]; return t ? t.precio : null; }
function analisisCompra(c) {
  const q = Math.max(c.total, 1);
  let mejor = null, base = null;
  c.ofertas.forEach((o) => {
    const p = precioEn(o, q); if (p != null && (mejor == null || p < mejor.precio)) mejor = { precio: p, nombre: o.nombre };
    const p1 = precioEn(o, 1); if (p1 != null && (base == null || p1 < base)) base = p1;
  });
  let prox = null;
  c.ofertas.forEach((o) => o.escalas.forEach((e) => { if (e.desde > c.total && (!mejor || e.precio < mejor.precio) && (!prox || e.desde < prox.desde || (e.desde === prox.desde && e.precio < prox.precio))) prox = { desde: e.desde, precio: e.precio }; }));
  const tope = Math.max(...c.ofertas.flatMap((o) => o.escalas.map((e) => e.desde)), c.total, 1);
  return { mejor, base, prox, tope };
}

function renderCompras() {
  const reg = ui.regionCompras;
  const regiones = [...new Set(S.compras.map((c) => c.region))];
  const lista = S.compras.filter((c) => reg === "todas" || c.region === reg).sort((a, b) => (a.estado === "abierta" ? 0 : 1) - (b.estado === "abierta" ? 0 : 1) || a.cierre.localeCompare(b.cierre));
  const mias = S.compras.filter((c) => c.mi > 0 && c.estado === "abierta").length;
  $("#view").innerHTML = `<div class="wrap" style="gap:16px">
    ${S.props.length || !S.proveedor ? `<button class="composer" data-act="nueva-compra"><span class="plus" aria-hidden="true">+</span><span>Proponé una compra en conjunto: pintura, membrana, fumigación, flete…</span></button>` : ""}
    <div class="row" style="justify-content:space-between">
      <div class="chips"><button class="chip" data-reg="todas" aria-pressed="${reg === "todas"}">Todas las zonas</button>${regiones.map((r) => `<button class="chip" data-reg="${esc(r)}" aria-pressed="${reg === r}">${esc(r)}</button>`).join("")}</div>
      ${mias ? `<span class="muted" style="font-size:14px">Participás en ${plural(mias, "compra abierta", "compras abiertas")}</span>` : ""}
    </div>
    <div class="cards">${lista.length ? lista.map(cardCompra).join("") : `<div class="card empty">No hay compras en esta zona. Proponé la primera.</div>`}</div>
  </div>`;
}

function cardCompra(c) {
  const { mejor, base, prox, tope } = analisisCompra(c);
  const abiertaC = c.estado === "abierta";
  const dias = diasHasta(c.cierre);
  const ahorro = mejor && base && mejor.precio < base ? Math.round((1 - mejor.precio / base) * 100) : 0;
  const esProv = !!S.proveedor && S.proveedor.rubros.includes(c.rubro);
  const miOferta = esProv && c.ofertas.find((o) => o.provId === S.usuario.id);
  const puedeSumarse = !!S.props.length || !S.proveedor;
  const f = ui.compraForm && ui.compraForm.id === c.id ? ui.compraForm.tipo : null;
  const escalasForm = (miOferta ? miOferta.escalas : [{ desde: 1, precio: "" }, { desde: "", precio: "" }, { desde: "", precio: "" }]).concat([{}, {}, {}]).slice(0, 3);
  return `<article class="card op">
    <div class="row"><span class="pill e-presupuestando">${esc(c.rubro)}</span><span class="tag">${esc(c.region)}</span>
      <span class="pill ${abiertaC ? (dias <= 3 ? "e-aprobacion" : "e-en_curso") : "e-desestimado"}" style="margin-left:auto">${abiertaC ? (dias <= 0 ? "Cierra hoy" : "Cierra en " + plural(dias, "día", "días")) : "Cerrada"}</span></div>
    <h4>${esc(c.producto)}</h4>
    ${c.detalle ? `<p>${esc(c.detalle)}</p>` : ""}
    <div class="progress">
      <div class="row" style="justify-content:space-between;font-size:14px"><span><b style="font-weight:500">${num(c.total)} ${esc(uni(c.unidad, c.total))}</b> <span class="muted">· ${plural(c.participantes, "vecino", "vecinos")}</span></span><span class="muted mono">C-${c.id}</span></div>
      <div class="bar"><span style="width:${Math.min(100, Math.round((c.total / tope) * 100))}%"></span></div>
      ${c.zonas.length ? `<div class="zonas">${c.zonas.map((z) => `<span class="zona">${esc(z)}</span>`).join("")}</div>` : ""}
    </div>
    ${mejor ? `<div class="price"><b>${ars(mejor.precio)}</b><span class="muted">por ${esc(c.unidad)} hoy</span>${ahorro ? `<span class="save">${ahorro}% menos que comprando solo</span>` : ""}</div>
      ${prox && abiertaC ? `<div class="next">Si se suman ${num(prox.desde - c.total)} ${esc(uni(c.unidad, prox.desde - c.total))} más, baja a ${ars(prox.precio)}.</div>` : ""}`
      : `<div class="muted" style="font-size:14px">Todavía no hay precios. Avisamos a los proveedores inscriptos del rubro.</div>`}
    ${c.ofertas.length ? `<details><summary class="muted" style="cursor:pointer;font-size:14px">${plural(c.ofertas.length, "oferta", "ofertas")} de proveedores</summary><div class="wrap" style="gap:8px;margin-top:10px">
      ${c.ofertas.map((o) => `<div class="offer"><span class="offer-name">${esc(o.nombre)}</span>${o.detalle ? `<span class="q-det">${esc(o.detalle)}</span>` : ""}
        <table class="tiers"><tr><th>Desde</th><th>Precio por ${esc(c.unidad)}</th></tr>${o.escalas.slice().sort((a, b) => a.desde - b.desde).map((e) => `<tr class="${precioEn(o, Math.max(c.total, 1)) === e.precio && e.desde <= c.total ? "on" : ""}"><td>${num(e.desde)} ${esc(uni(c.unidad, e.desde))}</td><td>${ars(e.precio)}</td></tr>`).join("")}</table></div>`).join("")}
    </div></details>` : ""}
    ${f === "sumar" ? `<form class="inline-form" data-form="sumar" data-c="${c.id}"><div class="grid2"><div class="field"><label for="smCant">Cantidad (${esc(uni(c.unidad, 2))})</label><input type="number" id="smCant" min="1" step="1" value="${c.mi || 1}" required></div><div class="field"><label for="smZona">Tu barrio</label><input type="text" id="smZona" value="${esc(S.usuario.barrio || "")}" placeholder="Caballito"></div></div>
      <div class="row"><button class="btn sm primary">${c.mi ? "Actualizar" : "Sumarme"}</button><button type="button" class="btn sm" data-act="cancelar">Cancelar</button></div></form>` : ""}
    ${f === "ofertar" ? `<form class="inline-form" data-form="ofertar" data-c="${c.id}"><span class="label">Precios por cantidad</span>
      ${escalasForm.map((e, i) => `<div class="grid2"><input type="number" min="1" id="ofD${i}" placeholder="Desde (${esc(uni(c.unidad, 2))})" value="${e.desde ?? ""}" aria-label="Desde cantidad, escala ${i + 1}" ${i === 0 ? "required" : ""}><input type="number" min="1" id="ofP${i}" placeholder="Precio por ${esc(c.unidad)}" value="${e.precio ?? ""}" aria-label="Precio, escala ${i + 1}" ${i === 0 ? "required" : ""}></div>`).join("")}
      <input type="text" id="ofDet" placeholder="Condiciones: envío, garantía, plazo" value="${esc(miOferta ? miOferta.detalle || "" : "")}" aria-label="Condiciones">
      <div class="row"><button class="btn sm primary">Publicar precios</button><button type="button" class="btn sm" data-act="cancelar">Cancelar</button></div></form>` : ""}
    <div class="foot">
      ${c.mi ? `<span class="pill e-en_curso">Te sumaste con ${num(c.mi)}</span>` : ""}
      ${miOferta ? `<span class="pill e-en_curso">Ya ofertaste</span>` : ""}
      <span class="push row">
        ${abiertaC && puedeSumarse && !f ? (c.mi ? `<button class="btn sm" data-act="salir-compra" data-c="${c.id}">Salir</button><button class="btn sm tonal" data-act="form-sumar" data-c="${c.id}">Cambiar cantidad</button>` : `<button class="btn sm primary" data-act="form-sumar" data-c="${c.id}">Sumarme</button>`) : ""}
        ${abiertaC && esProv && !f ? `<button class="btn sm ${miOferta ? "tonal" : "primary"}" data-act="form-ofertar" data-c="${c.id}">${miOferta ? "Editar precios" : "Ofertar precios"}</button>` : ""}
        ${abiertaC && c.soyCreador && !f ? `<button class="btn sm" data-act="cerrar-compra" data-c="${c.id}">Cerrar compra</button>` : ""}
      </span>
    </div>
  </article>`;
}

// ---------- Productos (Mercado Libre) ----------
function renderProductos() {
  const rubros = RUBROS.filter((r) => BUSQUEDAS[r.nombre]).map((r) => r.nombre);
  if (!rubros.includes(ui.rubroProd)) ui.rubroProd = rubros[0];
  const data = productosCache[ui.rubroProd];
  $("#view").innerHTML = `<div class="wrap" style="gap:16px">
    <div class="chips">${rubros.map((r) => `<button class="chip" data-rubro-prod="${esc(r)}" aria-pressed="${ui.rubroProd === r}">${esc(r)}</button>`).join("")}</div>
    <div id="prodBody">${data ? cuerpoProductos(data) : `<div class="card empty">Buscando productos de ${esc(ui.rubroProd)}…</div>`}</div>
  </div>`;
  if (!data) cargarProductos(ui.rubroProd);
}
async function cargarProductos(rubro) {
  try { productosCache[rubro] = await DB.productos(rubro); }
  catch (e) { productosCache[rubro] = { rubro, conectado: false, error: e.message, grupos: (BUSQUEDAS[rubro] || []).map((b) => ({ busqueda: b, link: linkListado(b), items: [] })) }; }
  if (ui.tab === "productos" && ui.rubroProd === rubro && $("#prodBody")) $("#prodBody").innerHTML = cuerpoProductos(productosCache[rubro]);
}
function cuerpoProductos(d) {
  const aviso = d.conectado ? "" : `<div class="card" style="padding:14px 18px;font-size:14px" ><span class="muted">${d.error ? esc(d.error) + ". " : ""}Los precios en vivo aparecen cuando Mercado Libre esté conectado. Mientras tanto, cada búsqueda abre Mercado Libre.</span></div>`;
  return `<div class="wrap" style="gap:14px">${aviso}${d.grupos.map((g) => `<section class="card op">
    <div class="row" style="justify-content:space-between"><h4>${esc(capital(g.busqueda))}</h4>
      <span class="row"><a class="btn sm" href="${esc(g.link)}" target="_blank" rel="noopener">Ver todos ↗</a><button class="btn sm tonal" data-act="compra-producto" data-busqueda="${esc(g.busqueda)}">Comprar en conjunto</button></span></div>
    ${g.items.length ? `<div class="prod-grid">${g.items.map((it) => `<a class="prod" href="${esc(it.link)}" target="_blank" rel="noopener">
        ${it.imagen ? `<img src="${esc(it.imagen)}" alt="" loading="lazy">` : `<span class="prod-img"></span>`}
        <span class="prod-tit">${esc(it.titulo)}</span>
        <span class="prod-precio">${it.moneda === "USD" ? "US$ " + num(it.precio) : ars(it.precio)}</span>
        <span class="row" style="gap:6px">${it.envio_gratis ? `<span class="save">Envío gratis</span>` : ""}${it.tienda_oficial ? `<span class="zona">Tienda oficial</span>` : ""}</span>
      </a>`).join("")}</div>` : ""}
  </section>`).join("")}</div>`;
}

// ---------- Personas y propiedades ----------
const propsGestion = () => S.props.filter((p) => ["propietario", "administracion"].includes(S.roles[p.id]));
const urlApp = () => location.origin + location.pathname;

function renderPersonas() {
  const ps = propsGestion();
  if (!ps.some((p) => p.id === ui.propPers)) ui.propPers = (ps.find((p) => p.id === ui.prop) || ps[0]).id;
  const prop = S.props.find((p) => p.id === ui.propPers), miRol = S.roles[prop.id], esProp = miRol === "propietario";
  const lista = personasCache[prop.id];
  const roles = esProp ? [["vecino", "Vecino"], ["administracion", "Administración"], ["propietario", "Propietario"]] : [["vecino", "Vecino"]];
  $("#view").innerHTML = `<div class="wrap" style="gap:16px">
    <div class="row" style="justify-content:space-between">
      <select id="propPersSel" aria-label="Propiedad" style="max-width:340px">${ps.map((p) => `<option value="${p.id}" ${p.id === prop.id ? "selected" : ""}>${esc(p.nombre)} · ${esc(p.zona || p.region || "")}</option>`).join("")}</select>
      ${S.props.some((p) => S.roles[p.id] === "propietario") || !S.props.length ? `<button class="btn tonal" data-act="nueva-prop">+ Nueva propiedad</button>` : ""}
    </div>
    ${ui.nuevaProp ? formPropiedad(null) : ""}
    <div class="main" style="grid-template-columns:minmax(0,1fr) minmax(0,380px)">
      <section class="card op">
        <div class="row" style="justify-content:space-between"><h4>Personas en ${esc(prop.nombre)}</h4>${lista ? `<span class="muted" style="font-size:14px">${plural(lista.filter((m) => !m.pendiente).length, "activa", "activas")}${lista.some((m) => m.pendiente) ? " · " + plural(lista.filter((m) => m.pendiente).length, "invitación pendiente", "invitaciones pendientes") : ""}</span>` : ""}</div>
        ${lista ? (lista.length ? `<ul class="people">${lista.map((m) => `<li>
            <span class="avatar sm" aria-hidden="true">${esc((m.nombre || m.email).trim()[0].toUpperCase())}</span>
            <span class="people-main"><b>${esc(m.nombre || m.email)}${m.soy_yo ? " (vos)" : ""}</b><span class="muted">${m.nombre ? esc(m.email) : "Todavía no entró a la app"}</span></span>
            <span class="row" style="gap:6px;justify-content:flex-end">${m.unidad ? `<span class="zona">${esc(m.unidad)}</span>` : ""}<span class="pill ${m.pendiente ? "e-aprobacion" : m.rol === "propietario" ? "e-en_curso" : m.rol === "administracion" ? "e-nuevo" : "e-presupuestando"}">${m.pendiente ? "Invitado · " : ""}${ROL_LABEL[m.rol]}</span>
              ${!m.soy_yo && (esProp || m.rol === "vecino") ? `<button class="btn sm bad" data-act="quitar-persona" data-email="${esc(m.email)}" aria-label="Quitar a ${esc(m.nombre || m.email)}">Quitar</button>` : ""}</span>
          </li>`).join("")}</ul>` : `<p>Todavía no hay nadie más en esta propiedad.</p>`) : `<p>Cargando…</p>`}
      </section>
      <div class="wrap" style="gap:16px">
        <form class="card panel-form" data-form="invitar" style="padding:20px">
          <h3 style="margin:0">Sumar persona</h3>
          <div class="field"><label for="ivEmail">Email</label><input type="email" id="ivEmail" required placeholder="nombre@ejemplo.com"></div>
          <div class="field"><label for="ivNombre">Nombre <span class="muted">(opcional)</span></label><input type="text" id="ivNombre" placeholder="Lucía Fernández"></div>
          <div class="grid2"><div class="field"><label for="ivRol">Rol</label><select id="ivRol">${roles.map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select></div>
            <div class="field"><label for="ivUni">Unidad</label><input type="text" id="ivUni" placeholder="UF 7A, Lote 14"></div></div>
          <button class="btn primary">Sumar a ${esc(prop.nombre)}</button>
          <p class="muted" style="margin:0;font-size:13.5px">Mandale este link para que entre con ese email:</p>
          <div class="row" style="flex-wrap:nowrap"><input type="text" id="ivLink" readonly value="${esc(urlApp())}" aria-label="Link de la app"><button type="button" class="btn sm" data-act="copiar-link">Copiar</button></div>
        </form>
        ${esProp ? formPropiedad(prop) : ""}
      </div>
    </div>
  </div>`;
  if (!lista) cargarPersonas(prop.id);
}
function formPropiedad(p) {
  const n = !p, id = n ? "np" : "ep";
  return `<form class="card panel-form" data-form="${n ? "crear-prop" : "editar-prop"}" style="padding:20px">
    <h3 style="margin:0">${n ? "Nueva propiedad" : "Datos de la propiedad"}</h3>
    <div class="field"><label for="${id}Nom">Nombre o dirección</label><input type="text" id="${id}Nom" required value="${esc(p ? p.nombre : "")}" placeholder="Av. Corrientes 1234"></div>
    <div class="grid2"><div class="field"><label for="${id}Tipo">Tipo</label><input type="text" id="${id}Tipo" value="${esc(p ? p.tipo || "" : "")}" placeholder="Edificio · 30 UF"></div>
      <div class="field"><label for="${id}Zona">Barrio</label><input type="text" id="${id}Zona" value="${esc(p ? p.zona || "" : "")}" placeholder="Almagro, CABA"></div></div>
    <div class="field"><label for="${id}Reg">Zona para proveedores</label><select id="${id}Reg">${REGIONES.map((r) => `<option ${p && p.region === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
    ${p ? `<label class="row" style="gap:8px;font-size:14px"><input type="checkbox" id="epCot" ${p.cotizacion_abierta !== false ? "checked" : ""}> Publicar los reclamos nuevos a los proveedores apenas se cargan</label>` : ""}
    <div class="row"><button class="btn ${n ? "primary" : ""}">${n ? "Crear propiedad" : "Guardar cambios"}</button>${n ? `<button type="button" class="btn" data-act="cancelar-prop">Cancelar</button>` : ""}</div>
  </form>`;
}
async function cargarPersonas(prop) {
  try { personasCache[prop] = await DB.miembros(prop); } catch (e) { personasCache[prop] = []; toast(e.message); }
  if (ui.tab === "personas" && ui.propPers === prop) renderPersonas();
}

// ---------- Inscripción de proveedores ----------
function formInscripcion(p) {
  p = p || { razon: "", tel: "", rubros: [], zonas: ["CABA"], cuit: "", matricula: "", descripcion: "" };
  const ofrecibles = RUBROS.filter((r) => r.requiere).map((r) => r.nombre);
  return `<form class="card panel-form" data-form="inscripcion">
    <div><h3 style="margin-bottom:4px">${S.proveedor ? "Tu inscripción" : "Inscribite como proveedor"}</h3><p class="muted" style="margin:0">Te avisamos en el momento cada vez que un edificio o barrio de tus zonas pide presupuesto de tus rubros, y cotizás desde acá.</p></div>
    <div class="grid2"><div class="field"><label for="inRazon">Nombre comercial</label><input type="text" id="inRazon" required value="${esc(p.razon)}" placeholder="Cerrajería Don Pepe"></div>
      <div class="field"><label for="inTel">Teléfono o WhatsApp</label><input type="tel" id="inTel" required value="${esc(p.tel)}" placeholder="11 5555-1234"></div></div>
    <div class="grid2"><div class="field"><label for="inCuit">CUIT</label><input type="text" id="inCuit" value="${esc(p.cuit)}" placeholder="20-12345678-9"></div>
      <div class="field"><label for="inMat">Matrícula (gas, electricidad)</label><input type="text" id="inMat" value="${esc(p.matricula)}" placeholder="Opcional"></div></div>
    <div class="field"><span class="flabel">Rubros</span><div class="check-chips" id="inRubros">${ofrecibles.map((r, i) => `<label><input type="checkbox" value="${esc(r)}" id="rb${i}" ${p.rubros.includes(r) ? "checked" : ""}>${esc(r)}</label>`).join("")}</div></div>
    <div class="field"><span class="flabel">Zonas donde trabajás</span><div class="check-chips" id="inZonas">${REGIONES.map((r, i) => `<label><input type="checkbox" value="${esc(r)}" id="zn${i}" ${p.zonas.includes(r) ? "checked" : ""}>${esc(r)}</label>`).join("")}</div></div>
    <div class="field"><label for="inDesc">Sobre tu servicio</label><textarea id="inDesc" placeholder="Años de experiencia, garantía, urgencias 24 h">${esc(p.descripcion)}</textarea></div>
    <div class="row"><button class="btn primary">${S.proveedor ? "Guardar cambios" : "Inscribirme"}</button></div>
  </form>`;
}
function renderInscripcion() { $("#view").innerHTML = formInscripcion(S.proveedor); }

function renderRegistro() {
  $("#hero").hidden = false;
  $("#heroTitle").innerHTML = `Hola, <span class="name">${esc(S.usuario.nombre.split(" ")[0])}</span>. ¿Cómo vas a usar Condominios?`;
  $("#heroSub").textContent = "Elegí una opción para empezar.";
  if (ui.form === "inscribirme") { $("#view").innerHTML = formInscripcion(null); return; }
  if (ui.form === "propiedad") { $("#view").innerHTML = formPropiedad(null); return; }
  $("#view").innerHTML = `<div class="choices">
    <button class="choice" data-act="ir-inscripcion"><b>Ofrezco un servicio</b><span class="muted">Cerrajería, pintura, fumigación, electricidad, mudanzas… Inscribite y cotizá los pedidos de tu zona.</span></button>
    <button class="choice" data-act="ir-propiedad"><b>Soy propietario</b><span class="muted">Cargá tu edificio o barrio y sumá a la administración y a los vecinos.</span></button>
    <div class="choice"><b>Vivo o administro un edificio o barrio</b><span class="muted">La administración tiene que sumarte a tu propiedad. Pasale este email:</span><span class="mono">${esc(S.usuario.email || "")}</span><button class="btn sm" data-act="refrescar" style="align-self:flex-start">Ya me sumaron</button></div>
  </div>`;
}

function mostrarLogin() {
  vista = "login";
  ["#hero", "#tabs"].forEach((s) => ($(s).hidden = true));
  renderHeader();
  $("#view").innerHTML = `<form class="card login" data-form="login">
    <h2>Ingresá a Condominios</h2>
    <p class="muted" style="margin:0">Te mandamos un link a tu email para entrar, sin contraseña.</p>
    <div class="field"><label for="lgEmail">Email</label><input type="email" id="lgEmail" required placeholder="nombre@ejemplo.com" autocomplete="email"></div>
    <button class="btn primary">Enviarme el link</button>
    <p class="muted" id="lgMsg" style="margin:0;font-size:14px"></p>
  </form>`;
}

// ======================================================================
// Eventos
// ======================================================================
document.addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.close) { $("#" + t.dataset.close).hidden = true; return; }
  if (t.dataset.rol) { ui.rolDemo = t.dataset.rol; ui.form = ui.opForm = ui.compraForm = null; ui.tab = null; ui.prop = "all"; ui.sel = null; document.body.classList.remove("detail"); await recargar(); return; }
  if (t.dataset.tab) { ui.tab = t.dataset.tab; ui.form = ui.opForm = ui.compraForm = null; render(); if (ui.tab === "pedidos" && S.avisos.some((a) => !a.leido)) DB.run("marcar_avisos_leidos", {}).then(() => { S.avisos.forEach((x) => (x.leido = true)); renderTabs(); }).catch(() => {}); return; }
  if (t.dataset.f) { ui.filtro = t.dataset.f; renderLista(); return; }
  if (t.dataset.opf) { ui.opFiltro = t.dataset.opf; ui.opForm = null; renderPedidos(); return; }
  if (t.dataset.reg) { ui.regionCompras = t.dataset.reg; renderCompras(); return; }
  if (t.dataset.rubroProd) { ui.rubroProd = t.dataset.rubroProd; renderProductos(); return; }
  if (t.dataset.sel) { ui.sel = +t.dataset.sel; ui.form = null; document.body.classList.add("detail"); renderLista(); renderDetalle(); if (matchMedia("(max-width:900px)").matches) window.scrollTo({ top: 0 }); return; }
  const a = t.dataset.act; if (!a) return;
  const r = S.reclamos.find((x) => x.id === ui.sel);
  const cid = t.dataset.c ? +t.dataset.c : null;
  switch (a) {
    case "reintentar": return arrancar();
    case "refrescar": return recargar();
    case "salir": return Nube.salir();
    case "volver": document.body.classList.remove("detail"); return render();
    case "cancelar": ui.form = ui.opForm = ui.compraForm = null; return render();
    case "nuevo-reclamo": return abrirReclamo();
    case "nueva-compra": return abrirCompra();
    case "nueva-prop": ui.nuevaProp = true; renderPersonas(); return $("#npNom").focus();
    case "cancelar-prop": ui.nuevaProp = false; if (vista === "registro") { ui.form = null; return render(); } return renderPersonas();
    case "quitar-persona": { const em = t.dataset.email; const ok = await correr("quitar_persona", { p_propiedad: ui.propPers, p_email: em }, "Listo, " + em + " ya no está en la propiedad"); if (ok) { delete personasCache[ui.propPers]; render(); } return; }
    case "copiar-link": { const inp = $("#ivLink"); try { await navigator.clipboard.writeText(inp.value); toast("Link copiado"); } catch (e) { inp.select(); toast("Seleccioné el link: copialo con Ctrl+C"); } return; }
    case "ver-productos": ui.tab = "productos"; ui.rubroProd = t.dataset.rubro; document.body.classList.remove("detail"); render(); return window.scrollTo({ top: 0 });
    case "compra-producto": abrirCompra(); $("#ncCat").value = ui.rubroProd; $("#ncProd").value = capital(t.dataset.busqueda); $("#ncUni").focus(); return;
    case "ir-inscripcion": ui.form = "inscribirme"; return render();
    case "ir-propiedad": ui.form = "propiedad"; return render();
    case "form-pres": ui.form = "pres"; renderDetalle(); return $("#pfProv").focus();
    case "form-desest": ui.form = "desest"; renderDetalle(); return $("#dsMot").focus();
    case "form-rech": ui.form = "rech:" + t.dataset.p; renderDetalle(); return $("#rcMot").focus();
    case "form-cot": ui.opForm = +t.dataset.r; renderPedidos(); return $("#ctMonto").focus();
    case "form-sumar": ui.compraForm = { id: cid, tipo: "sumar" }; renderCompras(); return $("#smCant").focus();
    case "form-ofertar": ui.compraForm = { id: cid, tipo: "ofertar" }; renderCompras(); return $("#ofP0").focus();
    case "pedir": return correr("pedir_presupuestos", { p_reclamo: r.id }, "Publicado: los proveedores del rubro ya recibieron el aviso");
    case "nota": return correr("enviar_nota", { p_reclamo: r.id }, "Nota enviada a " + r.uf);
    case "resolver": return correr("resolver_reclamo", { p_reclamo: r.id }, "Reclamo resuelto");
    case "reabrir": return correr("reabrir_reclamo", { p_reclamo: r.id }, "Reclamo reabierto");
    case "aprobar": return correr("aprobar_presupuesto", { p_presupuesto: t.dataset.p }, "Presupuesto aprobado. Avisamos al proveedor.");
    case "leidos": return correr("marcar_avisos_leidos", {});
    case "salir-compra": return correr("sumarse_compra", { p_compra: cid, p_cantidad: 0 }, "Saliste de la compra");
    case "cerrar-compra": return correr("cerrar_compra", { p_compra: cid }, "Compra cerrada. Coordiná con el proveedor elegido.");
  }
});

document.addEventListener("submit", async (e) => {
  e.preventDefault();
  const f = e.target, k = f.dataset.form, r = S.reclamos.find((x) => x.id === ui.sel);
  const v = (id) => ($("#" + id) ? $("#" + id).value.trim() : "");
  if (f.id === "fReclamo") {
    const id = await correr("crear_reclamo", { p_propiedad: v("nrProp"), p_ubicacion: v("nrUf"), p_rubro: v("nrCat"), p_titulo: v("nrTit"), p_descripcion: v("nrDesc"), p_urgencia: v("nrUrg") }, (id) => `Reclamo R-${id} enviado`);
    if (id) { $("#ovReclamo").hidden = true; f.reset(); ui.tab = "reclamos"; ui.sel = id; ui.filtro = "abiertos"; ui.prop = S.props.length === 1 ? ui.prop : "all"; document.body.classList.add("detail"); render(); }
    return;
  }
  if (f.id === "fCompra") {
    const id = await correr("crear_compra", { p_rubro: v("ncCat"), p_producto: v("ncProd"), p_unidad: v("ncUni"), p_cantidad: +v("ncCant"), p_cierre: v("ncCierre"), p_region: v("ncReg"), p_zona: v("ncBarrio") || null, p_detalle: v("ncDet") }, "Compra publicada. Avisamos a los proveedores de la zona.");
    if (id) { $("#ovCompra").hidden = true; f.reset(); ui.regionCompras = "todas"; render(); }
    return;
  }
  switch (k) {
    case "login": {
      const msg = $("#lgMsg");
      try { await Nube.login(v("lgEmail")); msg.textContent = "Listo. Revisá tu email y tocá el link para entrar."; }
      catch (err) { msg.textContent = "No pudimos enviar el link: " + err.message; }
      return;
    }
    case "invitar": {
      const email = v("ivEmail");
      const r = await correr("invitar", { p_email: email, p_propiedad: ui.propPers, p_rol: v("ivRol"), p_unidad: v("ivUni") || null, p_nombre: v("ivNombre") || null },
        (r) => r === "agregado" ? email + " ya tenía cuenta: quedó sumado a la propiedad" : "Invitación guardada. Cuando " + email + " entre con su email, va a ver la propiedad");
      if (r) { delete personasCache[ui.propPers]; render(); }
      return;
    }
    case "crear-prop": {
      const id = await correr("crear_propiedad", { p_nombre: v("npNom"), p_tipo: v("npTipo"), p_zona: v("npZona"), p_region: v("npReg") }, "Propiedad creada");
      if (id) { ui.nuevaProp = false; ui.propPers = id; render(); }
      return;
    }
    case "editar-prop": return correr("editar_propiedad", { p_propiedad: ui.propPers, p_nombre: v("epNom"), p_tipo: v("epTipo"), p_zona: v("epZona"), p_region: v("epReg"), p_cotizacion_abierta: $("#epCot").checked }, "Propiedad actualizada");
    case "comentar": return correr("comentar", { p_reclamo: r.id, p_texto: v("cmTxt") });
    case "desest": return correr("desestimar_reclamo", { p_reclamo: r.id, p_motivo: v("dsMot") }, "Reclamo desestimado");
    case "rech": return correr("desestimar_presupuesto", { p_presupuesto: f.dataset.p, p_motivo: v("rcMot") }, "Presupuesto desestimado");
    case "pres": return correr("cargar_presupuesto", { p_reclamo: r.id, p_proveedor: v("pfProv"), p_monto: +v("pfMonto"), p_plazo: +v("pfPlazo") || null, p_detalle: v("pfDet") }, "Presupuesto enviado al propietario");
    case "cotizar": return correr("cotizar", { p_reclamo: +f.dataset.r, p_monto: +v("ctMonto"), p_plazo: +v("ctPlazo") || null, p_detalle: v("ctDet") }, "Cotización enviada. Te avisamos cuando decidan.");
    case "sumar": return correr("sumarse_compra", { p_compra: +f.dataset.c, p_cantidad: +v("smCant"), p_zona: v("smZona") || null }, "Listo, te sumaste a la compra");
    case "ofertar": {
      const escalas = [0, 1, 2].map((i) => ({ desde: +v("ofD" + i), precio: +v("ofP" + i) })).filter((x) => x.desde && x.precio).sort((a, b) => a.desde - b.desde);
      return correr("ofertar_compra", { p_compra: +f.dataset.c, p_escalas: escalas, p_detalle: v("ofDet") }, "Precios publicados");
    }
    case "inscripcion": {
      const marcados = (sel) => [...document.querySelectorAll(sel + " input:checked")].map((x) => x.value);
      return correr("registrar_proveedor", { p_razon_social: v("inRazon"), p_telefono: v("inTel"), p_rubros: marcados("#inRubros"), p_zonas: marcados("#inZonas"), p_cuit: v("inCuit"), p_matricula: v("inMat"), p_descripcion: v("inDesc") }, S.proveedor ? "Inscripción actualizada" : "¡Listo! Ya estás inscripto");
    }
  }
});

document.addEventListener("input", (e) => { if (e.target.id === "q") { ui.q = e.target.value; renderLista(); } });
document.addEventListener("change", (e) => {
  if (e.target.id === "propSel") { ui.prop = e.target.value; ui.sel = null; const f = filtrados(); ui.sel = f[0] ? f[0].id : null; render(); }
  if (e.target.id === "catSel") { ui.cat = e.target.value; renderLista(); }
  if (e.target.id === "propPersSel") { ui.propPers = e.target.value; ui.nuevaProp = false; renderPersonas(); }
  if (e.target.id === "nrCat" || e.target.id === "nrProp") hintReclamo();
});
["#ovReclamo", "#ovCompra"].forEach((s) => $(s).addEventListener("click", (e) => { if (e.target === $(s)) $(s).hidden = true; }));
document.addEventListener("keydown", (e) => { if (e.key === "Escape") ["#ovReclamo", "#ovCompra"].forEach((s) => ($(s).hidden = true)); });
$("#resetBtn").addEventListener("click", async () => { Demo.reset(); ui.sel = null; ui.form = ui.opForm = ui.compraForm = null; await recargar(); toast("Ejemplo restablecido"); });

function abrirReclamo() {
  $("#nrProp").innerHTML = S.props.map((p) => `<option value="${p.id}">${esc(p.nombre)}</option>`).join("");
  $("#nrProp").value = ui.prop !== "all" ? ui.prop : S.props[0].id;
  $("#nrCat").innerHTML = RUBROS.map((c) => `<option>${esc(c.nombre)}</option>`).join("");
  const u = S.unidades[$("#nrProp").value]; if (u) $("#nrUf").value = u;
  hintReclamo();
  $("#ovReclamo").hidden = false; $("#nrUf").focus();
}
function hintReclamo() {
  const cat = $("#nrCat").value;
  $("#nrHint").textContent = requierePresup(cat) ? `Al enviarlo se publica a los proveedores de ${cat} inscriptos en la zona para que coticen.` : "Este tipo de reclamo lo gestiona la administración directamente con la unidad.";
}
function abrirCompra() {
  $("#ncCat").innerHTML = RUBROS.filter((r) => r.requiere).map((c) => `<option ${c.nombre === "Pintura" ? "selected" : ""}>${esc(c.nombre)}</option>`).join("");
  $("#ncReg").innerHTML = REGIONES.map((r) => `<option>${r}</option>`).join("");
  const p = S.props.find((x) => x.id === ui.prop) || S.props[0];
  if (p) $("#ncReg").value = p.region || "CABA";
  $("#ncBarrio").value = S.usuario.barrio || (p ? (p.zona || "").split(",")[0] : "");
  $("#ncCierre").value = sumaDias(10); $("#ncCierre").min = hoyISO();
  $("#ovCompra").hidden = false; $("#ncProd").focus();
}

arrancar();
})();
