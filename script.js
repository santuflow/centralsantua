// 1. CONFIGURACIÓN CENTRAL
const serverURL = "https://centralsantua.com.ar";
const MI_WHATSAPP = "5491151436396";

// Variable global para capturar la categoría seleccionada en la UI
let categoriaSeleccionada = "";

// 2. LIMPIEZA DE DATOS
function limpiarDato(texto) {
    if (!texto) return "";
    return texto.toUpperCase().replace(/[\s\.\-]/g, '').trim();
}

/**
 * FUNCIÓN PARA CAPTURAR LA CATEGORÍA
 * Debe llamarse cuando el usuario toca los botones de DNI, Patente, etc.
 */
function seleccionarCategoria(nombre) {
    categoriaSeleccionada = nombre;
    console.log("Categoría activa:", categoriaSeleccionada);
    
    // Sincronización con los IDs de tus contenedores de pasos
    const selector = document.getElementById('step-1') || document.getElementById('selector-categorias');
    const formulario = document.getElementById('step-2') || document.getElementById('form-contenedor');
    
    if(selector && formulario) {
        selector.style.display = 'none';
        formulario.style.display = 'block';
    }
}

// 3. FUNCIÓN DEL MODAL "BOMBAZO" 🚀
function mostrarModal(titulo, mensaje, icono, mostrarBotonWhatsApp = false, nroObjeto = "") {
    const modal = document.getElementById('modal-resultado');
    const areaContacto = document.getElementById('area-contacto');
    const mContenido = document.querySelector('.modal-content');
    const iconoElemento = document.getElementById('modal-icono');
    
    if (!modal) return;

    document.getElementById('modal-titulo').innerText = titulo;
    document.getElementById('modal-mensaje').innerText = mensaje;
    
    if (mostrarBotonWhatsApp) {
        iconoElemento.innerHTML = `
            <div style="position: relative; display: inline-block;">
                <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" style="width:80px; height:80px; filter: drop-shadow(0 0 10px #25d366);">
                <span style="position: absolute; top: -10px; right: -10px; font-size: 30px;">✨</span>
            </div>`;
    } else {
        iconoElemento.innerHTML = `<span style="font-size:60px;">${icono}</span>`;
    }
    
    if (mContenido) {
        mContenido.style.border = mostrarBotonWhatsApp ? "3px solid #4facfe" : "2px solid #333";
        mContenido.style.boxShadow = mostrarBotonWhatsApp ? "0 0 30px rgba(79, 172, 254, 0.5)" : "none";
    }

    if (mostrarBotonWhatsApp && areaContacto) {
        const textoMsg = encodeURIComponent(`¡HOLA CENTRAL SANTUA! 🚀 ¡TENGO UN BOMBAZO! Hay una coincidencia con el objeto: ${nroObjeto} (${categoriaSeleccionada}). ¡Quiero coordinar ya mismo!`);
        const urlFinal = `https://wa.me/${MI_WHATSAPP}?text=${textoMsg}`;
        
        areaContacto.innerHTML = `
            <div style="margin: 25px 0;">
                <p style="color: #4facfe; font-weight: bold; margin-bottom: 10px;">¡DALE CLICK ABAJO PARA TERMINAR EL TRÁMITE! 👇</p>
                <a href="${urlFinal}" target="_blank" 
                    style="display: flex; align-items: center; justify-content: center; background: #25d366; color: white; padding: 20px; border-radius: 15px; text-decoration: none; font-weight: 900; font-size: 1.2rem; box-shadow: 0 10px 20px rgba(37, 211, 102, 0.4); transition: 0.3s; border: 2px solid white;">
                    <img src="https://upload.wikimedia.org/wikipedia/commons/6/6b/WhatsApp.svg" width="25" style="margin-right: 12px;">
                    HABLAR CON CENTRAL SANTUA
                </a>
            </div>
        `;
        areaContacto.style.display = 'block';
    } else if (areaContacto) {
        areaContacto.style.display = 'none';
        areaContacto.innerHTML = "";
    }

    modal.style.display = 'flex';
    modal.classList.add('active');
}

function cerrarModal() {
    const modal = document.getElementById('modal-resultado');
    if(modal) {
        modal.style.display = 'none';
        modal.classList.remove('active');
    }
}
// Listener para el botón de cerrar modal si existe
document.getElementById('btn-entendido')?.addEventListener('click', cerrarModal);

// 4. LÓGICA ENCONTRÉ (ALEGRÍA TOTAL)
const formReporte = document.querySelector('.report-form') || document.getElementById('step-2');
if (formReporte) {
    formReporte.addEventListener('submit', async function(e) {
        if (document.getElementById('nro-search')) return; 
        e.preventDefault(); 

        // --- ESCUDO DE SEGURIDAD: 2 intentos cada 10 minutos ---
        const AHORA = Date.now();
        const DIEZ_MINUTOS = 10 * 60 * 1000;
        let historial = JSON.parse(localStorage.getItem('santua_ticks')) || [];

        // Limpiamos registros viejos
        historial = historial.filter(t => AHORA - t < DIEZ_MINUTOS);

        if (historial.length >= 5000) {
            const minRestantes = Math.ceil((DIEZ_MINUTOS - (AHORA - historial[0])) / 60000);
            mostrarModal("🛡️ Seguridad Activada", `Solo podés subir 2 reportes cada 10 min para evitar spam. Intentá de nuevo en ${minRestantes} min.`, "⏳");
            return;
        }
        // -------------------------------------------------------

        if (!categoriaSeleccionada) {
            alert("⚠️ Por favor, selecciona primero qué objeto encontraste.");
            return;
        }

        const inputNro = document.getElementById('nro-id');
        const nroLimpio = limpiarDato(inputNro.value);
        const whatsapp = document.getElementById('whatsapp')?.value || "";
        
        // Bloqueo visual del botón para evitar triple click
        const btnSubmit = e.target.querySelector('button[type="submit"]');
        btnSubmit.disabled = true;
        btnSubmit.innerText = "PROCESANDO...";

        try {
            const res = await fetch(`${serverURL}/api/reportar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    tipo: 'hallazgo',
                    categoria: categoriaSeleccionada,
                    nro: nroLimpio,
                    contacto: whatsapp
                })
            });
            const data = await res.json();

            if (data.error === "repetido" || data.success === false && data.message && data.message.includes("registrado")) {
                mostrarModal("¡Ya registrado! ⚠️", "Este número ya fue registrado previamente. Central Santua ya lo tiene bajo custodia.", "📂", false);
                return; // Esto detiene el código para que no salte el otro cartel
            }
            // Guardamos el intento exitoso en la memoria del navegador
            historial.push(AHORA);
            localStorage.setItem('santua_ticks', JSON.stringify(historial));

            if (data.matchInmediato) {
                mostrarModal("¡SÍII! ¡LO ESTABAN BUSCANDO! 😍", `¡Esto es un bombazo! El dueño ya reportó la pérdida.`, "🎉", true, nroLimpio);
            } else {
                mostrarModal("¡Hallazgo Protegido! 🛡️", 
        "Tu aviso ya está en nuestra base de datos. Si el dueño lo reclama, Central Santua te escribirá por WhatsApp para coordinar la entrega. ¡Gracias por confiar en el sistema!", 
        "✅", false);
            }
        } catch (e) { 
            mostrarModal("Ups!", "No pudimos conectar con el servidor.", "⚠️"); 
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerText = "PUBLICAR HALLAZGO";
        }
    });
}

// 5. LÓGICA PERDÍ (BOMBAZO DE ESPERANZA) - AQUÍ ESTABA EL ERROR DEL BOTÓN
// Agregamos múltiples selectores para que no falle nunca
const formBusqueda = document.getElementById('step-2') || document.querySelector('.report-form');

if (formBusqueda) {
    formBusqueda.addEventListener('submit', async function(e) {
        // Solo actúa si es efectivamente el formulario de búsqueda
        const inputNro = document.getElementById('nro-search');
        if (!inputNro) return; 

        e.preventDefault();

        if (!categoriaSeleccionada) {
            alert("⚠️ Por favor, selecciona qué estás buscando.");
            return;
        }

        const nroBuscado = limpiarDato(inputNro.value);
        const wapSearch = document.getElementById('whatsapp-search')?.value || "";

        try {
            const res = await fetch(`${serverURL}/api/buscar`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    nro: nroBuscado, 
                    contacto: wapSearch,
                    categoria: categoriaSeleccionada 
                })
            });
            const data = await res.json();

            if (data.error === "repetido" || data.success === false) {
                mostrarModal("Búsqueda Activa 📍", "Ya tenemos una búsqueda registrada con este número. Te avisaremos apenas tengamos novedades.", "🔎", false);
                return;
            }
            if (data.encontrado) {
                mostrarModal("¡BOMBAZO! ¡LO ENCONTRAMOS! 🎊", `¡Buenas noticias! El objeto ya fue localizado por un colaborador. ¡Dale al botón de abajo para recuperarlo!`, "🔥", true, nroBuscado);
            } else {
                mostrarModal("Búsqueda Registrada 📍", "Tu reporte ya está en nuestra guardia permanente. Si alguien lo encuentra y lo registra, el sistema hará 'Match' y te avisaremos de inmediato.", "💪", false);
            }
        } catch (e) { 
            mostrarModal("Error", "Problema de conexión con el servidor Central.", "❌"); 
        }
    });
}

function validarLongitud(input) {
    // 1. Pasamos a mayúsculas y limpiamos espacios/puntos
    input.value = input.value.toUpperCase().replace(/[\s\.\-]/g, '');

    // 2. Detectamos qué límite usar según la categoría activa
    let max = 15; // Por defecto para Licencias u otros
    if (categoriaSeleccionada === 'DNI') {
        max = 8;
        input.value = input.value.replace(/\D/g, ''); // Si es DNI, borra letras
    } else if (categoriaSeleccionada === 'PATENTE' || categoriaSeleccionada === 'CEDULA') {
        max = 7;
    }

    // 3. Bloqueo físico de dígitos
    if (input.value.length > max) {
        input.value = input.value.slice(0, max);
    }
}


function abrirModalTerminos(e) {
    if (e) e.preventDefault(); // Evita que la página salte al inicio al hacer clic
    document.getElementById('modal-terminos').style.display = 'flex';
    document.body.style.overflow = 'hidden'; // Bloquea el scroll del fondo
}

function cerrarModalTerminos() {
    document.getElementById('modal-terminos').style.display = 'none';
    document.body.style.overflow = 'auto'; // Libera el scroll
}

// Cerrar si hacen clic fuera del cuadradito negro
window.onclick = function(event) {
    let modal = document.getElementById('modal-terminos');
    if (event.target == modal) {
        cerrarModalTerminos();
    }
}