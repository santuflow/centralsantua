const express = require('express');
const cors = require('cors');
const path = require('path');
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// --- BASES DE DATOS EN MEMORIA ---
let hallazgos = []; 
let busquedas = []; 
let usuariosDB = [];
let baseDeDatosSimulada = [];

// --- ESTADÍSTICAS REALES (Sustituye a tus variables anteriores) ---
let visitasTotales = 0;
let usuariosActivos = new Map(); 
const historialAntiSpam = new Map(); // NUEVO: Para límite de 2 registros/10min

/**
 * NORMALIZAR: Limpia puntos, espacios, guiones y pasa a Mayúsculas
 * SE AGREGA AQUÍ PARA EVITAR EL ERROR DE "NOT DEFINED"
 */
const normalizar = (t) => t ? t.toUpperCase().replace(/[\s\.\-]/g, '').trim() : "";

// Middleware corregido: Cuenta visitas y rastrea actividad real
app.use((req, res, next) => {
    const ip = req.ip;
    const ahora = Date.now();
    
    // Contar visita solo si es la página principal
    if (req.url === '/index.html' || req.url === '/') {
        // Evitamos que el mismo usuario sume visitas cada vez que toca F5 (30 min de gracia)
        if (!usuariosActivos.has(ip) || (ahora - usuariosActivos.get(ip)) > 1800000) {
            visitasTotales++;
        }
    }
    
    // Registramos que esta IP está haciendo algo ahora
    usuariosActivos.set(ip, ahora);
    next();
});

// =========================================
// 1. RUTA PARA REPORTAR (ENCONTRÉ ALGO)
// =========================================
app.post('/api/reportar', (req, res) => {
    const { nro, categoria } = req.body; 
    const nroLimpio = normalizar(nro);
    const catFija = categoria ? categoria.toUpperCase() : "OTRO";

    // 1. BUSCAMOS SI YA EXISTE EN EL ADMIN
    const yaExisteEnAdmin = hallazgos.some(h => h.nro === nroLimpio && h.categoria === catFija);

    // 2. BUSCAMOS SI ALGUIEN LO ESTÁ BUSCANDO (MATCH)
    const alguienLoBusca = busquedas.find(b => b.nro === nroLimpio && b.categoria === catFija);

    // --- LÓGICA DE REGISTRO EN ADMIN ---
    // Si NO existe en el admin, lo guardamos siempre (sea match o no)
    if (!yaExisteEnAdmin) {
        const nuevo = { 
            ...req.body, 
            nro: nroLimpio, 
            categoria: catFija, 
            fecha: new Date().toLocaleString(),
            idInterno: Date.now() 
        };
        hallazgos.push(nuevo);
        console.log(`✅ HALLAZGO REGISTRADO EN ADMIN: [${catFija}] ${nroLimpio}`);
    }

    // --- LÓGICA DE RESPUESTA AL USUARIO ---
    
    // SI HAY MATCH: Prioridad absoluta, siempre responde Match
    if (alguienLoBusca) {
        return res.json({ 
            success: true, 
            matchInmediato: true, 
            datosDuenio: alguienLoBusca 
        });
    }

    // SI NO HAY MATCH Y YA EXISTÍA: Entonces avisamos que es repetido
    if (yaExisteEnAdmin) {
        return res.json({ 
            success: false, 
            error: "repetido",
            message: `El número ${nroLimpio} ya está registrado como hallazgo en la categoría ${catFija}.` 
        });
    }

    // SI ES TODO NUEVO Y NO HUBO MATCH: Registro normal exitoso
    res.json({ 
        success: true, 
        matchInmediato: false, 
        datosDuenio: null 
    });
});

// =========================================
// 2. RUTA PARA BUSCAR (PERDÍ ALGO) 
// =========================================
app.post('/api/buscar', (req, res) => {
    const { nro, categoria } = req.body;
    const nroLimpio = normalizar(nro);
    const catFija = categoria ? categoria.toUpperCase() : "OTRO";

    // 1. BUSCAMOS SI YA EXISTE ESTA BÚSQUEDA EN EL ADMIN
    const yaExisteBusquedaEnAdmin = busquedas.some(b => b.nro === nroLimpio && b.categoria === catFija);

    // 2. BUSCAMOS SI YA FUE ENCONTRADO (MATCH)
    const yaEncontrado = hallazgos.find(h => h.nro === nroLimpio && h.categoria === catFija);

    // --- LÓGICA DE REGISTRO EN ADMIN ---
    // Si la búsqueda es nueva, la guardamos para que aparezca en el panel admin
    if (!yaExisteBusquedaEnAdmin) {
        const busqueda = { 
            ...req.body, 
            nro: nroLimpio, 
            categoria: catFija,
            fecha: new Date().toLocaleString() 
        };
        busquedas.push(busqueda);
        console.log(`🔍 BÚSQUEDA REGISTRADA EN ADMIN: [${catFija}] ${nroLimpio}`);
    }

    // --- LÓGICA DE RESPUESTA AL USUARIO ---

    // SI YA APARECIÓ (MATCH): No importa si es repetido, ¡BOMBAZO SIEMPRE!
    if (yaEncontrado) {
        return res.json({ 
            success: true, 
            encontrado: true, 
            datos: yaEncontrado 
        });
    }

    // SI NO APARECIÓ Y YA LO ESTABA BUSCANDO: Avisamos que está repetido
    if (yaExisteBusquedaEnAdmin) {
        return res.json({ 
            success: false, 
            error: "repetido",
            message: `Ya tienes una búsqueda activa para el número ${nroLimpio}.` 
        });
    }

    // SI ES TODO NUEVO Y NO HAY MATCH: Éxito sin encuentro todavía
    res.json({ 
        success: true, 
        encontrado: false 
    });
});

// =========================================
// 3. RUTA ADMIN (DATOS Y STATS)
// =========================================
app.get('/api/admin/data', (req, res) => {
    res.json({ hallazgos, busquedas });
});

// Ruta para las métricas de arriba del panel
app.get('/api/admin/stats', (req, res) => {
    const ahora = Date.now();
    // Limpieza de online real (1 min inactividad)
    for (let [ip, ultimoAcceso] of usuariosActivos) {
        if (ahora - ultimoAcceso > 60000) usuariosActivos.delete(ip);
    }

    res.json({ 
        online: usuariosActivos.size || 1, 
        visitas: visitasTotales 
    });
});

// =========================================
// 4. RUTAS DE BORRADO (CORREGIDAS PARA MATCH)
// =========================================

// Borrar ambos cuando es un MATCH
app.delete('/api/admin/borrar/match/:nro', (req, res) => {
    const nroABorrar = req.params.nro;
    
    const hallazgosAntes = hallazgos.length;
    const busquedasAntes = busquedas.length;

    hallazgos = hallazgos.filter(h => h.nro !== nroABorrar);
    busquedas = busquedas.filter(b => b.nro !== nroABorrar);

    console.log(`🧹 LIMPIEZA TOTAL DE MATCH: ${nroABorrar}`);
    res.json({ 
        success: true, 
        eliminadosH: hallazgosAntes - hallazgos.length,
        eliminadosB: busquedasAntes - busquedas.length 
    });
});

// Borrar solo Hallazgo
app.delete('/api/admin/borrar/hallazgo/:nro', (req, res) => {
    const nroABorrar = req.params.nro;
    const index = hallazgos.findIndex(h => h.nro === nroABorrar);
    if (index !== -1) {
        hallazgos.splice(index, 1);
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

// Borrar solo Búsqueda
app.delete('/api/admin/borrar/busqueda/:nro', (req, res) => {
    const nroABorrar = req.params.nro;
    const index = busquedas.findIndex(b => b.nro === nroABorrar);
    if (index !== -1) {
        busquedas.splice(index, 1);
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

// RUTA PARA LOS CONTADORES DE LA HOME
app.get('/api/contadores', (req, res) => {
    res.json({
        totalHallazgos: hallazgos.length,
        totalBusquedas: busquedas.length
    });
});

app.post('/api/registro', (req, res) => {
    const { username, password } = req.body;
    // Forzamos el mail a minúsculas antes de guardarlo
    const email = req.body.email.toLowerCase().trim();

    // Verificamos si el usuario ya existe
    const existe = usuariosDB.find(u => u.email === email);
    if (existe) {
        return res.status(400).json({ message: "El correo ya está registrado" });
    }

    // Guardamos el nuevo usuario en nuestra lista
    usuariosDB.push({ username, email, password });
    
    console.log("Usuario registrado con éxito:", username, "(" + email + ")");
    res.status(200).json({ message: "Usuario guardado correctamente" });
});

app.post('/api/login', (req, res) => {
    // También pasamos a minúsculas lo que el usuario escribe al intentar entrar
    const email = req.body.email.toLowerCase().trim();
    const { password } = req.body;

    // Buscamos al usuario en nuestra lista
    const usuarioEncontrado = usuariosDB.find(u => u.email === email && u.password === password);

    if (usuarioEncontrado) {
        console.log("Login exitoso para:", usuarioEncontrado.username);
        // Enviamos el username de vuelta para que el frontend lo use
        res.status(200).json({ 
            message: "Bienvenido",
            username: usuarioEncontrado.username 
        });
    } else {
        res.status(401).json({ message: "Correo o contraseña incorrectos" });
    }
});

// =========================================
// CONFIGURACIÓN MERCADO PAGO
// =========================================
const { MercadoPagoConfig, Preference } = require('mercadopago');

const client = new MercadoPagoConfig({ 
    accessToken: 'APP_USR-7751639628824719-021612-dbddd90a31825e1b6fa2cb41fa93b3e4-2118365527' 
});
 
// 2. RUTA PARA GENERAR (Solo una vez)
app.post('/api/generar-lote-seguro', (req, res) => {
    const { cantidad, tipo } = req.body;
    const nuevosIDs = [];

    for (let i = 0; i < cantidad; i++) {
        const id = "SN" + Math.random().toString(36).substr(2, 6).toUpperCase();
        nuevosIDs.push(id);
        
        // AQUÍ ES DONDE SE GUARDA REALMENTE
        baseDeDatosSimulada.push({
            id_qr: id,
            tipo: tipo,
            activado: false,
            fecha_creacion: new Date()
        });
    }

    console.log(`Lote generado. Total en memoria: ${baseDeDatosSimulada.length}`);
    res.json({ ids: nuevosIDs });
});

// 3. RUTA DE ESTADÍSTICAS
app.get('/api/stats', (req, res) => {
    const generados = baseDeDatosSimulada.length;
    const activados = baseDeDatosSimulada.filter(qr => qr.activado === true).length;
    
    console.log(`Enviando stats: Generados ${generados}`);
    res.json({ generados, activados });
});


// PAGO DE ACTIVACION QR
app.post("/crear-preferencia", async (req, res) => {
    try {
        const { id_qr } = req.body; // Recibimos el ID que el usuario quiere activar
        
        const preference = new Preference(client);
        const result = await preference.create({
            body: {
                items: [{
                    title: `Activación Sticker ID: ${id_qr}`,
                    quantity: 1,
                    unit_price: 2.00, // Precio de prueba
                    currency_id: "ARS"
                }],
                // Guardamos el ID en la referencia externa para rastrearlo
                external_reference: id_qr, 
                back_urls: {
                    // Render detectará automáticamente tu dominio
                    success: `https://${req.get('host')}/perfil.html?activacion=exitosa&id=${id_qr}`,
                    failure: `https://${req.get('host')}/presentacion_pago.html?error=pago_fallido`,
                    pending: `https://${req.get('host')}/perfil.html`
                },
                auto_return: "approved",
            }
        });
        res.json({ id: result.id });
    } catch (error) {
        console.error("Error MP:", error);
        res.status(500).json({ error: error.message });
    }
});

// BUSCA ESTO AL FINAL DE TU SERVER.JS Y REEMPLÁZALO:
app.get("/api/validar-qr/:id", (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const sticker = baseDeDatosSimulada.find(s => s.id_qr === id);

    if (sticker && sticker.activado) {
        // SI YA ESTÁ ACTIVO: Mandamos a recuperar.html
        return res.json({ 
            status: "activado", 
            redirect: `recuperar.html?id=${id}` 
        });
    } else {
        // SI ES NUEVO: Mandamos a pagar
        return res.json({ 
            status: "nuevo", 
            redirect: `presentacion_pago.html?id=${id}` 
        });
    }
});



app.post('/api/sticker/configurar', (req, res) => {
    const { id, alias, telefono, mensaje, tipo } = req.body;
    const nroID = id.toUpperCase().trim();

    const index = baseDeDatosSimulada.findIndex(s => s.id_qr === nroID);

    if (index !== -1) {
        // Actualizamos los datos y lo marcamos como ACTIVADO
        baseDeDatosSimulada[index] = {
            ...baseDeDatosSimulada[index],
            alias,
            telefono,
            mensaje,
            tipo,
            activado: true // <--- Esto es lo que hace que deje de pedir pago
        };
        console.log(`✅ Sticker ${nroID} configurado y activado por el dueño.`);
        res.json({ success: true });
    } else {
        // Si por alguna razón el ID no existía en el lote, lo creamos y activamos
        baseDeDatosSimulada.push({
            id_qr: nroID,
            alias,
            telefono,
            mensaje,
            tipo,
            activado: true
        });
        res.json({ success: true });
    }
});

app.get('/api/sticker/consultar/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    const sticker = baseDeDatosSimulada.find(s => s.id_qr === id);

    if (sticker && sticker.activado) {
        res.json({
            telefono: sticker.telefono,
            mensaje: sticker.mensaje,
            tipo: sticker.tipo
        });
    } else {
        res.status(404).json({ error: "No activado o no existe" });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVIDOR CENTRAL SANTUA ACTIVO EN PUERTO ${PORT}`);
    console.log(`🌍 ACCESIBLE DESDE EL TÚNEL DE SERVEO`);
});

