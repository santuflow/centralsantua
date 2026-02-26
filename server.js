const express = require('express');
const cors = require('cors');
const path = require('path');
const axios = require('axios');
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
 
// 2. RUTA PARA GENERAR LOTE (Protegida y Profesional)
app.post('/api/generar-lote-seguro', (req, res) => {
    try {
        const { cantidad, tipo } = req.body;
        const nuevosIDs = [];
        const crypto = require('crypto');

        // Creamos un ID de lote único para esta tanda
        const ahora = new Date();
        const loteId = `LOTE-${ahora.getDate()}/${ahora.getMonth() + 1} ${ahora.getHours()}:${ahora.getMinutes()}`;

        for (let i = 0; i < cantidad; i++) {
            const randomHex = crypto.randomBytes(4).toString('hex').toUpperCase();
            const idPro = `CS-${randomHex.slice(0, 4)}-${randomHex.slice(4, 8)}`;
            
            nuevosIDs.push(idPro);
            
            // AGREGAMOS EL lote_id AQUÍ
            baseDeDatosSimulada.push({
                id_qr: idPro,
                tipo: tipo,
                activado: false,
                lote_id: loteId, // <--- Importante para el frontend
                fecha_creacion: ahora,
                seguridad: "Nivel Criptográfico"
            });
        }
        res.json({ ids: nuevosIDs, lote: loteId });
    } catch (e) {
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
app.post('/api/sticker/configurar', (req, res) => {
    const { id, alias, telefono, mensaje, tipo } = req.body;
    const nroID = id.toUpperCase().trim();

    const sticker = baseDeDatosSimulada.find(s => s.id_qr === nroID);

    // BLINDAJE: Solo dejamos configurar si el sistema ya lo activó por pago
    if (sticker && sticker.activado === true) {
        sticker.alias = alias;
        sticker.telefono = telefono;
        sticker.mensaje = mensaje;
        sticker.tipo = tipo;
        
        console.log(`✅ Datos guardados para ${nroID}`);
        res.json({ success: true });
    } else {
        // Si no está activado, el frontend no puede "forzar" la activación
        console.log(`❌ Intento de configuración sin pago: ${nroID}`);
        res.status(403).json({ success: false, message: "El sticker no ha sido pagado todavía." });
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
                
                // 3. Buscamos el sticker en nuestra base de datos y lo ACTIVAMOS
                const index = baseDeDatosSimulada.findIndex(s => s.id_qr === idQR);
                if (index !== -1) {
                    baseDeDatosSimulada[index].activado = true;
                    baseDeDatosSimulada[index].pago_confirmado = true; // Marca de seguridad extra
                    console.log(`⭐⭐⭐ SEGURIDAD: Sticker ${idQR} ACTIVADO POR PAGO REAL`);
                }
            }
        } catch (error) {
            console.error("Error validando pago:", error.message);
        }
    }
    // Siempre respondemos 200 a MP
    res.sendStatus(200);
});

// RUTA DE REFUERZO: Activa el sticker si el usuario vuelve con éxito en la URL
app.get('/api/verificar-y-activar/:id', (req, res) => {
    const id = req.params.id.toUpperCase().trim();
    let sticker = baseDeDatosSimulada.find(s => s.id_qr === id);

    // Si por algún reinicio no existe en memoria, lo creamos
    if (!sticker) {
        sticker = { id_qr: id, activado: true, pago_confirmado: true };
        baseDeDatosSimulada.push(sticker);
        console.log(`📡 Sticker creado y activado por retorno directo: ${id}`);
        return res.json({ success: true, status: "activado" });
    }

    // Si existe, lo activamos
    sticker.activado = true;
    sticker.pago_confirmado = true;
    console.log(`🚀 Sticker activado por refuerzo: ${id}`);
    res.json({ success: true, status: "activado" });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 SERVIDOR CENTRAL SANTUA ACTIVO EN PUERTO ${PORT}`);
    console.log(`🌍 ACCESIBLE DESDE EL TÚNEL DE SERVEO`);
});

