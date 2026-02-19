// interfaz.js - Control General de la Interfaz

// --- 1. FUNCIÓN DEL MENÚ LATERAL ---
function toggleMenu() {
    const menu = document.getElementById("side-menu");
    if (menu) {
        // Si el ancho es mayor a 0, lo cerramos. Si no, lo abrimos.
        if (menu.style.width === "280px") {
            menu.style.width = "0";
        } else {
            menu.style.width = "280px";
        }
    }
}

// --- 2. FUNCIÓN PARA LOS TÉRMINOS (MENÚ Y FORMULARIOS) ---
function abrirModalTerminos(e) {
    if (e && e.preventDefault) e.preventDefault(); 
    
    const modal = document.getElementById('modal-terminos');
    if (modal) {
        modal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    // Si el menú lateral está abierto, lo cerramos para ver el modal
    const menu = document.getElementById("side-menu");
    if (menu) menu.style.width = "0";
}

function cerrarModalTerminos() {
    const modal = document.getElementById('modal-terminos');
    if (modal) {
        modal.style.display = 'none';
        document.body.style.overflow = 'auto';
    }
}

// --- 3. ACTUALIZAR ESTADÍSTICAS ---
async function actualizarEstadisticas() {
const base = "https://centralsantua.com.ar";
    try {
        const response = await fetch(`${base}/api/contadores`);
        const data = await response.json();
        
        const countHallazgos = document.getElementById('count-hallazgos');
        const countBusquedas = document.getElementById('count-busquedas');

        if (countHallazgos) countHallazgos.innerText = data.totalHallazgos || 0;
        if (countBusquedas) countBusquedas.innerText = data.totalBusquedas || 0;
    } catch (error) {
        console.warn("Servidor de estadísticas no disponible.");
    }
}

// Ejecutar al cargar la página
document.addEventListener('DOMContentLoaded', function() {
    actualizarEstadisticas();
});

// Cerrar modales si se hace clic fuera del contenido
window.onclick = function(event) {
    const modalTerminos = document.getElementById('modal-terminos');
    const modalGuia = document.getElementById('modal-guia');
    if (event.target === modalTerminos) cerrarModalTerminos();
    if (event.target === modalGuia && typeof cerrarGuia === "function") cerrarGuia();
};

// Función para simular el estado de login (Luego la conectaremos al servidor)
// --- 4. CONTROL DE SESIÓN (ESTO ES LO QUE ESTABA ROTO) ---
function chequearEstadoSesion() {
    // Leemos el valor real del almacenamiento del navegador
    const logueado = localStorage.getItem('estaLogueado') === 'true';

    const authButtons = document.getElementById('auth-buttons');
    const menuBtn = document.getElementById('boton-menu-privado');

    if (logueado) {
        if (authButtons) authButtons.style.setProperty('display', 'none', 'important');
        if (menuBtn) menuBtn.style.setProperty('display', 'flex', 'important');
    } else {
        if (authButtons) authButtons.style.setProperty('display', 'flex', 'important');
        if (menuBtn) menuBtn.style.setProperty('display', 'none', 'important');
    }
}

// Asegúrate de que se ejecute cuando carga el DOM
document.addEventListener('DOMContentLoaded', chequearEstadoSesion);

// --- 5. FUNCIÓN CERRAR SESIÓN (AGRÉGALA AQUÍ TAMBIÉN) ---
function cerrarSesion() {
    localStorage.clear();
    window.location.href = 'index.html';
}

// Ejecutar al cargar la página
document.addEventListener('DOMContentLoaded', chequearEstadoSesion);


// Simulamos una lista de usuarios que ya existen en Central Santua
// (Más adelante, esto vendrá de tu base de datos real)
let usuariosEnBaseDeDatos = ["rodrigo", "admin", "central_santua"];

const inputUsuario = document.getElementById("username");
const mensajeError = document.getElementById("error-msg");

inputUsuario.addEventListener("input", function() {
    // Convertimos a minúsculas para que "Rodrigo" y "rodrigo" sean lo mismo
    let nombreDigitado = inputUsuario.value.toLowerCase();

    if (usuariosEnBaseDeDatos.includes(nombreDigitado)) {
        // Si el nombre existe, mostramos error y borde rojo
        mensajeError.style.display = "block";
        inputUsuario.style.borderColor = "red";
    } else {
        // Si está libre, todo verde y escondemos error
        mensajeError.style.display = "none";
        inputUsuario.style.borderColor = "#ccc";
    }
});