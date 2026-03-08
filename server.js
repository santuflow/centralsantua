require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
const session = require('express-session');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;

// --- CONFIGURACIÓN DE BASE DE DATOS REAL (MONGODB) ---
const mongoose = require('mongoose');

mongoose.connect(process.env.MONGO_URI)
    .then(() => {
        console.log("------------------------------------------");
        console.log("✅ CONEXIÓN EXITOSA: Central Santua está en la nube.");
        console.log("------------------------------------------");
    })
    .catch(err => {
        console.log("------------------------------------------");
        console.log("❌ ERROR DE CONEXIÓN A MONGODB:");
        console.log(err.message);
        console.log("------------------------------------------");
    });

// Definimos el "Molde" de los Stickers para MongoDB
const stickerSchema = new mongoose.Schema({
    id_qr: { type: String, unique: true },
    activado: { type: Boolean, default: false },
    pago_confirmado: { type: Boolean, default: false },
    emailDuenio: String,
    alias: String,
    telefono: String,
    mensaje: String,
    tipo: String,
    fecha_creacion: { type: Date, default: Date.now }
});

const Sticker = mongoose.model('Sticker', stickerSchema);

// Molde para Hallazgos (Encontré algo)
const hallazgoSchema = new mongoose.Schema({
    nro: String,
    categoria: String,
    fecha: String,
    telefono: String,
    detalles: Object, // Guarda el resto de los datos del formulario
    idInterno: { type: Number, unique: true }
});
const Hallazgo = mongoose.model('Hallazgo', hallazgoSchema);

// Molde para Búsquedas (Perdí algo)
const busquedaSchema = new mongoose.Schema({
    nro: String,
    categoria: String,
    fecha: String,
    telefono: String,
    detalles: Object
});
const Busqueda = mongoose.model('Busqueda', busquedaSchema);

// Molde para Usuarios (Email y Contraseña)
const usuarioSchema = new mongoose.Schema({
    username: String,
    email: { type: String, unique: true },
    password: String, 
    google_id: String,
    foto: String
});
const Usuario = mongoose.model('Usuario', usuarioSchema);

const app = express();

// --- BASES DE DATOS EN MEMORIA ---
let hallazgos = []; 
let busquedas = []; 
let baseDeDatosSimulada = [];

// --- ESTADÍSTICAS REALES (Sustituye a tus variables anteriores) ---
let visitasTotales = 0;
let usuariosActivos = new Map(); 
const historialAntiSpam = new Map(); // NUEVO: Para límite de 2 registros/10min

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// 1. IMPORTANTE: Agregá esto justo antes de la sesión para que Render (el proxy) pase las cookies correctamente
app.set('trust proxy', 1); 

// 2. CONFIGURACIÓN DE SESIÓN PROFESIONAL
app.use(session({
    secret: process.env.SESSION_SECRET || 'santua_secreto_777', 
    resave: true, // Cambialo a true para forzar el guardado
    saveUninitialized: false,
    name: 'santua_session',
    cookie: { 
        maxAge: 1000 * 60 * 60 * 24 * 365,
        httpOnly: true,
        secure: false, // Ponelo en false hasta que tengas SSL/HTTPS funcionando perfecto
        sameSite: 'lax' // Más estable para navegadores móviles
    }
}));

app.use(passport.initialize());
app.use(passport.session());

// Configuración de Passport para Google
passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    proxy: true // <--- AGREGÁ ESTA LÍNEA (Es vital para Render)
}, (accessToken, refreshToken, profile, done) => {
    try {
        // Extraemos el email con cuidado
        const email = (profile.emails && profile.emails.length > 0) 
            ? profile.emails[0].value.toLowerCase() 
            : null;

        if (!email) return done(new Error("No se obtuvo email de Google"));

        // Buscamos en tu lista
        let usuario = usuariosDB.find(u => u.email === email);
        
        if (!usuario) {
            usuario = {
                username: profile.displayName || "Usuario Nuevo",
                email: email,
                foto: (profile.photos && profile.photos[0]) ? profile.photos[0].value : null,
                google_id: profile.id 
            };
            usuariosDB.push(usuario);
        }
        
        return done(null, usuario);
    } catch (err) {
        return done(err, null);
    }
}));

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

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

// --- FUNCIÓN DE SEGURIDAD PARA ADMIN ---
function asegurarAdmin(req, res, next) {
    // 1. ¿Está logueado con Google?
    // 2. ¿Su mail es el tuyo?
    const miEmailAdmin = "rodrigosantua2@gmail.com"; 

    if (req.isAuthenticated() && req.user.email === miEmailAdmin) {
        return next(); // Sos vos, pasá tranquilo
    }
    
    // Si no sos vos, lo mandamos al login con un mensaje de error
    console.log(`⚠️ INTENTO DE INTRUSIÓN de: ${req.user ? req.user.email : 'Anónimo'}`);
    res.status(403).send("<h1>Acceso Denegado</h1><p>No tenés permisos para estar acá.</p><a href='/login.html'>Volver</a>");
}

// =========================================
// 1. RUTA PARA REPORTAR (ENCONTRÉ ALGO)
// =========================================
app.post('/api/reportar', async (req, res) => { // <--- Verificá que tenga el 'async'
    const { nro, categoria, telefono } = req.body;
    const nroLimpio = normalizar(nro);
    const catFija = categoria ? categoria.toUpperCase() : "OTRO";

    const yaExisteEnAdmin = hallazgos.some(h => h.nro === nroLimpio && h.categoria === catFija);
    const alguienLoBusca = busquedas.find(b => b.nro === nroLimpio && b.categoria === catFija);

    if (!yaExisteEnAdmin) {
        const nuevo = { 
            ...req.body, 
            nro: nroLimpio, 
            categoria: catFija,
            telefono: telefono, 
            fecha: new Date().toLocaleString(),
            idInterno: Date.now() 
        };
        hallazgos.push(nuevo);

        // --- SOLO AGREGAMOS ESTO ---
        await new Hallazgo(nuevo).save(); 
        console.log(`✅ NUBE: Hallazgo guardado en base de datos: ${nroLimpio}`);
        // ---------------------------
    }

    if (alguienLoBusca) {
        return res.json({ 
            success: true, 
            matchInmediato: true, 
            datosDuenio: alguienLoBusca 
        });
    }

    if (yaExisteEnAdmin) {
        return res.json({ 
            success: false, 
            error: "repetido",
            message: `El número ${nroLimpio} ya está registrado como hallazgo en la categoría ${catFija}.` 
        });
    }

    res.json({ 
        success: true, 
        matchInmediato: false, 
        datosDuenio: null 
    });

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
app.post('/api/buscar', async (req, res) => { // <--- Agregamos 'async'
    const { nro, categoria, telefono } = req.body;
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
            telefono: telefono,
            fecha: new Date().toLocaleString() 
        };
        busquedas.push(busqueda);

        // --- SOLO AGREGAMOS ESTO PARA LA NUBE ---
        await new Busqueda(busqueda).save(); 
        // ----------------------------------------

        console.log(`🔍 BÚSQUEDA REGISTRADA EN ADMIN Y NUBE: [${catFija}] ${nroLimpio}`);
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
    // Enviamos TODO al admin para que pueda gestionar
    res.json({ 
        hallazgos, 
        busquedas, 
        stickers: baseDeDatosSimulada // <--- Agregamos esto
    });
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

// Borrar ambos cuando es un MATCH (Memoria + Nube)
app.delete('/api/admin/borrar/match/:nro', async (req, res) => { // <--- Agregamos async
    const nroABorrar = req.params.nro;
    
    // 1. Mantenemos tus contadores para la respuesta
    const hallazgosAntes = hallazgos.length;
    const busquedasAntes = busquedas.length;

    // 2. BORRADO EN LA NUBE (Nuevo)
    try {
        await Hallazgo.deleteMany({ nro: nroABorrar });
        await Busqueda.deleteMany({ nro: nroABorrar });
    } catch (err) {
        console.log("Error borrando en nube:", err.message);
    }

    // 3. BORRADO EN MEMORIA (Tu código original intacto)
    hallazgos = hallazgos.filter(h => h.nro !== nroABorrar);
    busquedas = busquedas.filter(b => b.nro !== nroABorrar);

    console.log(`🧹 LIMPIEZA TOTAL DE MATCH (NUBE Y MEMORIA): ${nroABorrar}`);
    
    // 4. Tu respuesta original sin cambios
    res.json({ 
        success: true, 
        eliminadosH: hallazgosAntes - hallazgos.length,
        eliminadosB: busquedasAntes - busquedas.length 
    });
});

// Borrar solo Hallazgo (Nube + Memoria)
app.delete('/api/admin/borrar/hallazgo/:nro', async (req, res) => { // <--- Agregamos async
    const nroABorrar = req.params.nro;

    // 1. Intentamos borrar en la Nube
    try {
        await Hallazgo.deleteOne({ nro: nroABorrar });
    } catch (err) {
        console.log("Error borrando hallazgo en nube:", err.message);
    }

    // 2. Tu lógica original de Memoria (Intacta)
    const index = hallazgos.findIndex(h => h.nro === nroABorrar);
    if (index !== -1) {
        hallazgos.splice(index, 1);
        console.log(`🧹 Hallazgo eliminado de Nube y Memoria: ${nroABorrar}`);
        return res.json({ success: true });
    }
    res.status(404).json({ success: false });
});

// Borrar solo Búsqueda (Nube + Memoria)
app.delete('/api/admin/borrar/busqueda/:nro', async (req, res) => { // <--- Agregamos async
    const nroABorrar = req.params.nro;

    // 1. Intentamos borrar en la Nube
    try {
        await Busqueda.deleteOne({ nro: nroABorrar });
    } catch (err) {
        console.log("Error borrando búsqueda en nube:", err.message);
    }

    // 2. Tu lógica original de Memoria (Intacta)
    const index = busquedas.findIndex(b => b.nro === nroABorrar);
    if (index !== -1) {
        busquedas.splice(index, 1);
        console.log(`🧹 Búsqueda eliminada de Nube y Memoria: ${nroABorrar}`);
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

app.post('/api/registro', async (req, res) => { // Agregamos 'async' para poder usar la base de datos
    const { username, password } = req.body;
    const email = req.body.email.toLowerCase().trim();

    try {
        // 1. Buscamos en MongoDB si ya existe (en lugar de usuariosDB)
        const existe = await Usuario.findOne({ email: email });
        
        if (existe) {
            return res.status(400).json({ message: "El correo ya está registrado" });
        }

        // 2. Guardamos el nuevo usuario en MongoDB (Persistencia real)
        const nuevoUsuario = new Usuario({ username, email, password });
        await nuevoUsuario.save();
        
        console.log("✅ Usuario registrado con éxito en NUBE:", username, "(" + email + ")");
        res.status(200).json({ message: "Usuario guardado correctamente" });

    } catch (error) {
        console.error("Error al registrar en MongoDB:", error);
        res.status(500).json({ message: "Error interno del servidor" });
    }
});

app.post('/api/login', async (req, res, next) => { // Agregamos async
    const email = req.body.email.toLowerCase().trim();
    const { password } = req.body;

    try {
        // BUSCAMOS EN LA NUBE (En lugar de usuariosDB)
        const usuarioEncontrado = await Usuario.findOne({ email: email, password: password });

        if (usuarioEncontrado) {
            // LOGUEAR MANUALMENTE EN PASSPORT (Tal como lo tenías)
            req.login(usuarioEncontrado, (err) => {
                if (err) return next(err);

                // Aseguramos que la sesión guarde el email para los stickers
                req.session.user = { email: usuarioEncontrado.email }; 

                return res.status(200).json({ 
                    message: "Bienvenido",
                    username: usuarioEncontrado.username,
                    logueado: true 
                });
            });
        } else {
            res.status(401).json({ message: "Correo o contraseña incorrectos" });
        }
    } catch (error) {
        console.error("Error en login:", error);
        res.status(500).json({ message: "Error interno" });
    }
});

// =========================================
// CONFIGURACIÓN MERCADO PAGO
// =========================================
const { MercadoPagoConfig, Preference } = require('mercadopago');

const client = new MercadoPagoConfig({ 
    accessToken: 'APP_USR-7751639628824719-021612-dbddd90a31825e1b6fa2cb41fa93b3e4-2118365527' 
});
 
// 2. RUTA PARA GENERAR LOTE (Actualizada con MongoDB y manteniendo compatibilidad)
app.post('/api/generar-lote-seguro', async (req, res) => { // Agregamos async
    try {
        const { cantidad, tipo, lote_id } = req.body; 
        const nuevosIDs = [];
        const crypto = require('crypto');
        const ahora = new Date();

        const nombreFinalLote = lote_id || `LOTE-${ahora.getDate()}/${ahora.getMonth() + 1} ${ahora.getHours()}:${ahora.getMinutes()}:${ahora.getSeconds()}`;

        for (let i = 0; i < cantidad; i++) {
            const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
            const idPro = `CS-${randomHex.slice(0, 4)}-${randomHex.slice(4, 8)}`;
            
            nuevosIDs.push(idPro);

            // Objeto de datos que respeta tu estructura original
            const datosSticker = {
                id_qr: idPro,
                tipo: tipo,
                activado: false,
                lote_id: nombreFinalLote,
                fecha_creacion: ahora,
                seguridad: "Nivel Criptográfico"
            };

            // 1. GUARDAR EN MONGODB (Persistencia real)
            const nuevoStickerDB = new Sticker(datosSticker);
            await nuevoStickerDB.save();

            // 2. GUARDAR EN LA BASE SIMULADA (Mantenemos esto para que nada se rompa)
            baseDeDatosSimulada.push(datosSticker);
        }
        
        console.log(`✅ Lote ${nombreFinalLote} guardado en la nube y en memoria.`);
        res.json({ ids: nuevosIDs, lote: nombreFinalLote });
    } catch (e) {
        console.error("Error al generar lote:", e);
        res.status(500).send("Error");
    }
});

// 3. RUTA DE ESTADÍSTICAS
app.get('/api/stats', (req, res) => {
    const generados = baseDeDatosSimulada.length;
    const activados = baseDeDatosSimulada.filter(qr => qr.activado === true).length;
    
    console.log(`Enviando stats: Generados ${generados}`);
    res.json({ generados, activados });
});


// REEMPLAZA TU RUTA /crear-preferencia POR ESTA:
app.post("/crear-preferencia", async (req, res) => {
    try {
        const { id_qr } = req.body; 
        const preference = new Preference(client);
        
        const result = await preference.create({
            body: {
                items: [{
                    title: `Activación Central Santua ID: ${id_qr}`,
                    quantity: 1,
                    unit_price: 2.00, 
                    currency_id: "ARS"
                }],
                external_reference: id_qr, 
                notification_url: `https://centralsantua.com.ar/api/webhook-pagos`, 
                back_urls: {
                    // AGREGAMOS EL ID A LAS URLS DE RETORNO
                    success: `https://centralsantua.com.ar/perfil.html?activacion=exitosa&id=${id_qr}`,
                    failure: `https://centralsantua.com.ar/presentacion_pago.html?error=pago_fallido&id=${id_qr}`,
                    pending: `https://centralsantua.com.ar/perfil.html?id=${id_qr}`
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



// REEMPLAZA TU RUTA /api/sticker/configurar POR ESTA:
app.post('/api/sticker/configurar', async (req, res) => { // <--- Agregamos async
    const { id, alias, telefono, mensaje, tipo } = req.body;
    const nroID = id.toUpperCase().trim();

    try {
        // 1. ACTUALIZAMOS EN LA NUBE (MongoDB)
        const stickerDB = await Sticker.findOneAndUpdate(
            { id_qr: nroID },
            { alias, telefono, mensaje, tipo },
            { new: true }
        );

        if (stickerDB && stickerDB.activado) {
            // 2. ACTUALIZAMOS EN MEMORIA (Para que el Panel Admin lo vea al toque)
            const stickerMemoria = baseDeDatosSimulada.find(s => s.id_qr === nroID);
            if (stickerMemoria) {
                stickerMemoria.alias = alias;
                stickerMemoria.telefono = telefono;
                stickerMemoria.mensaje = mensaje;
                stickerMemoria.tipo = tipo;
            }
            
            console.log(`✅ NUBE: Datos guardados para sticker ${nroID}`);
            res.json({ success: true });
        } else {
            console.log(`❌ Intento de configuración sin pago o inexistente: ${nroID}`);
            res.status(403).json({ success: false, message: "El sticker no ha sido pagado todavía." });
        }
    } catch (error) {
        console.error("Error al configurar sticker:", error);
        res.status(500).json({ success: false });
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

// nada
// --- NUEVO: WEBHOOK DE ACTIVACIÓN BLINDADA ---
app.post('/api/webhook-pagos', async (req, res) => {
    const { query } = req;
    
    // Si Mercado Pago nos avisa de un pago
    if (query.type === "payment") {
        const paymentId = query['data.id'];
        
        try {
            // 1. Verificamos el pago directamente con Mercado Pago usando tu Token
            const response = await axios.get(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
                headers: { 'Authorization': `Bearer APP_USR-7751639628824719-021612-dbddd90a31825e1b6fa2cb41fa93b3e4-2118365527` }
            });

            const data = response.data;

            // 2. Si el pago está aprobado de verdad...
            if (data.status === "approved") {
                const idQR = data.external_reference; // El ID que guardamos al crear la preferencia
                
                // 3. Buscamos y activamos directamente en MongoDB (Base real)
            const stickerDB = await Sticker.findOneAndUpdate(
                { id_qr: idQR }, 
                { activado: true, pago_confirmado: true },
                { new: true }
            );

            if (stickerDB) {
                console.log(`⭐⭐⭐ SEGURIDAD: Sticker ${idQR} ACTIVADO EN MONGODB POR PAGO REAL`);
                // Actualizamos también la memoria para el panel admin actual
                const indexMemoria = baseDeDatosSimulada.findIndex(s => s.id_qr === idQR);
                if (indexMemoria !== -1) {
                    baseDeDatosSimulada[indexMemoria].activado = true;
                    baseDeDatosSimulada[indexMemoria].pago_confirmado = true;
                }
            }
            }
        } catch (error) {
            console.error("Error validando pago:", error.message);
        }
    }
    // Siempre respondemos 200 a MP
    res.sendStatus(200);
});

// RUTA DE REFUERZO: Activa el sticker en MongoDB y Memoria
app.get('/api/verificar-y-activar/:id', async (req, res) => { // <--- Importante el async
    const id = req.params.id.toUpperCase().trim();
    const emailUsuario = (req.user && req.user.email) || (req.session.user && req.session.user.email) || "Sin Correo";

    try {
        // 1. Grabamos en la Nube (MongoDB)
        const stickerDB = await Sticker.findOneAndUpdate(
            { id_qr: id },
            { activado: true, pago_confirmado: true, emailDuenio: emailUsuario },
            { new: true, upsert: true } // Lo crea si no existe
        );

        // 2. Sincronizamos la memoria para el Panel Admin
        const index = baseDeDatosSimulada.findIndex(s => s.id_qr === id);
        if (index !== -1) {
            baseDeDatosSimulada[index].activado = true;
            baseDeDatosSimulada[index].pago_confirmado = true;
            baseDeDatosSimulada[index].emailDuenio = emailUsuario;
        } else {
            baseDeDatosSimulada.push(stickerDB);
        }

        console.log(`📡 NUBE: Sticker ${id} blindado para ${emailUsuario}`);
        res.json({ success: true, status: "activado" });
    } catch (error) {
        console.error("Error en refuerzo:", error);
        res.status(500).json({ success: false });
    }
});

// RUTA PROTEGIDA: Solo deja leer el archivo si sos el admin
app.get('/admin.html', asegurarAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- RUTAS DE AUTENTICACIÓN GOOGLE ---

// 1. Dispara la ventana de Google
app.get('/auth/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

// 2. Recibe al usuario de vuelta de Google
app.get('/auth/google/callback', 
    passport.authenticate('google', { failureRedirect: '/login.html' }),
    (req, res) => {
        // MODIFICADO: Agregamos la señal para que index.html active el menú al toque
        res.redirect('/index.html?login=success'); 
    }
);

// 3. Ruta para que el frontend sepa quién está conectado
app.get('/api/usuario_actual', (req, res) => {
    if (req.isAuthenticated()) {
        res.json({ logueado: true, user: req.user });
    } else {
        res.json({ logueado: false });
    }
});

// 4. Cerrar sesión (Corregido para limpieza total)
app.get('/api/logout', (req, res) => {
    req.session.destroy((err) => { // Destruye la sesión en el servidor
        req.logout(() => {
            res.clearCookie('connect.sid'); // Borra la cookie del navegador
            res.status(200).json({ status: "OK" }); 
        });
    });
});

// FUNCIÓN PARA BAJAR TODO DE LA NUBE AL EMPEZAR EL SERVIDOR
async function cargarDatosDeNube() {
    try {
        // Bajamos los 3 tipos de datos al mismo tiempo
        const [stickersEnNube, hallazgosEnNube, busquedasEnNube] = await Promise.all([
            Sticker.find({}),
            Hallazgo.find({}),
            Busqueda.find({})
        ]);

        // Llenamos las listas de memoria con lo que habia en la nube
        baseDeDatosSimulada = stickersEnNube;
        hallazgos = hallazgosEnNube;
        busquedas = busquedasEnNube;

        console.log("------------------------------------------");
        console.log(`☁️  SANTUA CLOUD SYNC COMPLETA:`);
        console.log(`   ✅ Stickers: ${baseDeDatosSimulada.length}`);
        console.log(`   ✅ Hallazgos: ${hallazgos.length}`);
        console.log(`   ✅ Búsquedas: ${busquedas.length}`);
        console.log("------------------------------------------");
    } catch (err) {
        console.log("❌ Error en sincronización inicial:", err.message);
    }
}

// Ejecutamos la carga apenas arranca el server
cargarDatosDeNube();

// ESTA ES LA RUTA QUE LE FALTA A TU SERVIDOR
app.get('/api/mis-stickers', async (req, res) => {
    try {
        // 1. Verificamos si hay un usuario logueado por Google
        const emailUsuario = req.user ? req.user.email.toLowerCase() : null;

        if (!emailUsuario) {
            return res.json({ success: false, message: "No logueado", stickers: [] });
        }

        // 2. Buscamos en MongoDB SOLO los stickers que le pertenecen a este email
        const misStickers = await Sticker.find({ emailDuenio: emailUsuario });

        console.log(`Buscando stickers para: ${emailUsuario} - Encontrados: ${misStickers.length}`);

        res.json({ 
            success: true, 
            stickers: misStickers 
        });
    } catch (error) {
        console.error("Error al obtener stickers:", error);
        res.status(500).json({ success: false, stickers: [] });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVIDOR CENTRAL SANTUA ACTIVO EN PUERTO ${PORT}`);
    console.log(`🌍 ACCESIBLE DESDE EL TÚNEL DE SERVEO`);
});

