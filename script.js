/* ============================================================
   TusTareas — Lógica de la aplicación
   ============================================================ */

/* ------------------------------------------------------------
   1. DATOS
   ------------------------------------------------------------ */

/* Número de tarea -> en qué consiste */
const TAREAS = {
  1: 'Secar vidrios',
  2: 'Secar lo lavado',
  3: 'Barrer en el medio dia',
  4: 'Lavar en el Medio Día',
  5: 'Limpiar mesa',
  6: 'Limpiar mesa',
  7: 'Lavar vasos',
  8: 'Barrer noche'
};

const DIAS = ['LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES'];

/* Día -> [Tarea 1, Tarea 2, ... Tarea 8] */
const ASIGNACION = {
  LUNES:     ['Mía',       'Pedro',     'Pedro', 'Mía',   'Ayelen', 'Ayelen', 'Mía',   'Pedro'],
  MARTES:    ['Lucía',     'Lucía',     'Lucía', 'Lucía', 'Ayelen', 'Pedro',  'Ayelen','Mía'],
  MIERCOLES: ['Pedro',     'Mía',       'Mía',   'Pedro', 'Pedro',  'Mía',    'Ayelen','Pedro'],
  JUEVES:    ['Pedro',     'Pedro',     'Pedro', 'Pedro', 'X',      'Mía',    'Pedro', 'Ayelen'],
  VIERNES:   ['Mía/Pedro', 'Pedro/Mía', 'Mía',   'Pedro', 'X',      'X',      'X',     'X']
};

/* Lista de usuarios válidos, generada automáticamente desde la tabla */
const USUARIOS = [...new Set(
  DIAS
    .flatMap(dia => ASIGNACION[dia])
    .filter(celda => celda !== 'X')
    .flatMap(celda => celda.split('/'))
)].sort((a, b) => a.localeCompare(b, 'es'));

/* ------------------------------------------------------------
   2. CONFIGURACIÓN
   ------------------------------------------------------------ */

const STORAGE_SESION = 'tustareas.sesion';
const STORAGE_NOTIF  = 'tustareas.ultimaNotificacion';

const HORA_NOTIFICACION = 20;          // 20 = 8 de la tarde (poné 8 para las 8 de la mañana)
const REINTENTO_MS      = 2 * 60 * 1000; // 2 minutos
const CHEQUEO_MS        = 30 * 1000;     // cada cuánto se revisa el reloj

/* ------------------------------------------------------------
   3. UTILIDADES
   ------------------------------------------------------------ */

/** Quita tildes, pasa a minúsculas y recorta espacios. */
function normalizar(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Devuelve "2025-04-08" para la fecha indicada. */
function claveFecha(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Devuelve "LUNES", "MARTES", ... */
function nombreDia(fecha = new Date()) {
  return ['DOMINGO', 'LUNES', 'MARTES', 'MIERCOLES', 'JUEVES', 'VIERNES', 'SABADO'][fecha.getDay()];
}

/** Busca un usuario ignorando tildes y mayúsculas. Devuelve el nombre real o null. */
function buscarUsuario(entrada) {
  const buscado = normalizar(entrada);
  if (!buscado) return null;
  return USUARIOS.find(u => normalizar(u) === buscado) || null;
}

/** Devuelve el array de tareas (nombres) que le tocan a un usuario en una fecha. */
function tareasDeUsuario(usuario, fecha = new Date()) {
  const fila = ASIGNACION[nombreDia(fecha)];
  if (!fila) return [];

  const objetivo = normalizar(usuario);
  const resultado = [];

  fila.forEach((celda, indice) => {
    if (celda === 'X') return;
    const asignados = celda.split('/').map(normalizar);
    if (asignados.includes(objetivo)) resultado.push(TAREAS[indice + 1]);
  });

  return resultado;
}

/* ------------------------------------------------------------
   4. SESIÓN (guardado local)
   ------------------------------------------------------------ */

function guardarSesion(usuario) {
  try {
    localStorage.setItem(STORAGE_SESION, JSON.stringify({
      usuario,
      fecha: new Date().toISOString()
    }));
  } catch (e) {
    console.warn('No se pudo guardar la sesión:', e);
  }
}

function leerSesion() {
  try {
    const bruto = localStorage.getItem(STORAGE_SESION);
    if (!bruto) return null;

    const datos = JSON.parse(bruto);
    if (!datos || !datos.usuario) return null;
    if (!USUARIOS.includes(datos.usuario)) return null;

    return datos;
  } catch (e) {
    return null;
  }
}

function borrarSesion() {
  try {
    localStorage.removeItem(STORAGE_SESION);
  } catch (e) { /* nada */ }
}

/* ------------------------------------------------------------
   5. REFERENCIAS DEL DOM
   ------------------------------------------------------------ */

const tabsEl        = document.getElementById('tabs');
const botonesTab    = [...tabsEl.querySelectorAll('.tab-btn')];
const indicador     = document.getElementById('tab-indicator');

const paneles = {
  login:  document.getElementById('panel-login'),
  inicio: document.getElementById('panel-inicio')
};

const formLogin   = document.getElementById('login-form');
const inputUsuario= document.getElementById('username');
const errorLogin  = document.getElementById('login-error');

const btnLogout   = document.getElementById('logout-btn');
const userChip    = document.getElementById('user-chip');
const tabla       = document.getElementById('tareas-table');

const hoyTitulo   = document.getElementById('hoy-titulo');
const hoyLista    = document.getElementById('hoy-lista');

/* ------------------------------------------------------------
   6. PESTAÑAS
   ------------------------------------------------------------ */

function posicionarIndicador(animar = true) {
  const activo = tabsEl.querySelector('.tab-btn.active');
  if (!activo) return;

  const r = activo.getBoundingClientRect();
  const c = tabsEl.getBoundingClientRect();

  if (!animar) indicador.style.transition = 'none';

  indicador.style.width  = r.width  + 'px';
  indicador.style.height = r.height + 'px';
  indicador.style.transform = `translate(${r.left - c.left}px, ${r.top - c.top}px)`;

  if (!animar) {
    void indicador.offsetWidth; // forzar reflow
    requestAnimationFrame(() => { indicador.style.transition = ''; });
  }
}

function activarTab(nombre, animar = true) {
  botonesTab.forEach(b => b.classList.toggle('active', b.dataset.tab === nombre));

  Object.entries(paneles).forEach(([clave, el]) => {
    el.classList.toggle('active', clave === nombre);
  });

  posicionarIndicador(animar);
}

/* ------------------------------------------------------------
   7. RENDERIZADO
   ------------------------------------------------------------ */

function renderTabla(usuarioActual = null) {
  const objetivo = usuarioActual ? normalizar(usuarioActual) : null;

  let html = '<thead><tr><th class="col-dia">DÍA</th>';
  for (let i = 1; i <= 8; i++) html += `<th>${TAREAS[i]}</th>`;
  html += '</tr></thead><tbody>';

  for (const dia of DIAS) {
    html += `<tr><th class="col-dia" scope="row">${dia}</th>`;

    for (const celda of ASIGNACION[dia]) {
      if (celda === 'X') {
        html += '<td class="celda-vacia">—</td>';
        continue;
      }

      const esMia = objetivo && celda.split('/').map(normalizar).includes(objetivo);
      html += `<td class="${esMia ? 'celda-mia' : ''}">${celda}</td>`;
    }

    html += '</tr>';
  }

  html += '</tbody>';
  tabla.innerHTML = html;
}

function renderHoy(usuario) {
  hoyLista.innerHTML = '';

  if (!usuario) {
    hoyTitulo.textContent = 'Hoy te toca';
    hoyLista.innerHTML = '<p class="vacio">Iniciá sesión para ver tus tareas de hoy.</p>';
    return;
  }

  const tareas = tareasDeUsuario(usuario);

  if (tareas.length === 0) {
    hoyTitulo.textContent = `Hoy, ${usuario}, no tenés tareas`;
    hoyLista.innerHTML = '<p class="vacio">Disfrutá el día libre.</p>';
    return;
  }

  hoyTitulo.textContent = `Hoy te toca, ${usuario}`;
  tareas.forEach(t => {
    const li = document.createElement('li');
    li.textContent = t;
    hoyLista.appendChild(li);
  });
}

/* ------------------------------------------------------------
   8. LOGIN / LOGOUT
   ------------------------------------------------------------ */

function mostrarError(mensaje) {
  errorLogin.textContent = mensaje;
  errorLogin.classList.add('show');
  inputUsuario.classList.add('input-error');
}

function ocultarError() {
  errorLogin.textContent = '';
  errorLogin.classList.remove('show');
  inputUsuario.classList.remove('input-error');
}

function iniciarSesion(usuario) {
  userChip.textContent = usuario;

  renderTabla(usuario);
  renderHoy(usuario);

  // Habilitar "Inicio" y bloquear "Login"
  botonesTab.find(b => b.dataset.tab === 'inicio').disabled = false;
  botonesTab.find(b => b.dataset.tab === 'login').disabled  = true;

  activarTab('inicio');

  // Pedir permiso de notificaciones (aprovechando el gesto del usuario)
  pedirPermisoNotificaciones();

  // Revisar si quedó alguna notificación pendiente de hoy
  revisarNotificaciones();
}

function cerrarSesion() {
  borrarSesion();

  userChip.textContent = '—';
  renderTabla(null);
  renderHoy(null);

  botonesTab.find(b => b.dataset.tab === 'inicio').disabled = true;
  botonesTab.find(b => b.dataset.tab === 'login').disabled  = false;

  inputUsuario.value = '';
  ocultarError();

  activarTab('login');
  inputUsuario.focus();
}

function manejarLogin(evento) {
  evento.preventDefault();

  const valor = inputUsuario.value.trim();

  /* 2.1 — Campo vacío */
  if (!valor) {
    mostrarError('Escribí tu nombre de usuario para continuar.');
    inputUsuario.focus();
    return;
  }

  /* 2.2 — Buscar en la tabla de usuarios (sin tildes ni mayúsculas) */
  const usuario = buscarUsuario(valor);

  /* 3 — No se encontró */
  if (!usuario) {
    mostrarError(`No encontramos a "${valor}". Probá con Mía, Pedro, Ayelen o Lucía.`);
    return;
  }

  /* 4 — Se encontró: guardar y entrar */
  ocultarError();
  guardarSesion(usuario);
  iniciarSesion(usuario);
}

/* ------------------------------------------------------------
   9. NOTIFICACIONES DIARIAS
   ------------------------------------------------------------ */

let reintentarDesde = 0;

function permisoConcedido() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

async function pedirPermisoNotificaciones() {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'default') return;

  try {
    await Notification.requestPermission();
  } catch (e) {
    console.warn('No se pudo pedir permiso de notificaciones:', e);
  }
}

/** Clave única por día + usuario (para no repetir la notificación). */
function claveNotificacion(fecha = new Date()) {
  const sesion = leerSesion();
  const usuario = sesion ? normalizar(sesion.usuario) : 'anonimo';
  return `${claveFecha(fecha)}|${usuario}`;
}

async function enviarNotificacion(clave) {
  const sesion = leerSesion();
  if (!sesion) return false;

  const tareas = tareasDeUsuario(sesion.usuario);

  const cuerpo = tareas.length
    ? `Buenos dias ${sesion.usuario}, hoy te tocan estas tareas: ${tareas.join(', ')}.`
    : `Buenos dias ${sesion.usuario}, hoy no te toca ninguna tarea.`;

  const opciones = {
    body: cuerpo,
    icon: 'icon.svg',
    badge: 'icon.svg',
    tag: `tustareas-${clave}`,
    renotify: false
  };

  try {
    if ('serviceWorker' in navigator) {
      const registro = await navigator.serviceWorker.getRegistration();
      if (registro) {
        await registro.showNotification('TusTareas', opciones);
      } else {
        new Notification('TusTareas', opciones);
      }
    } else {
      new Notification('TusTareas', opciones);
    }

    localStorage.setItem(STORAGE_NOTIF, clave);
    return true;

  } catch (e) {
    console.warn('No se pudo mostrar la notificación:', e);
    return false;
  }
}

function revisarNotificaciones() {
  if (!permisoConcedido()) return;
  if (!leerSesion()) return;

  const ahora = new Date();
  const diaSemana = ahora.getDay();

  // Solo de lunes (1) a viernes (5)
  if (diaSemana === 0 || diaSemana === 6) return;

  // Todavía no llegó la hora
  if (ahora.getHours() < HORA_NOTIFICACION) return;

  const clave = claveNotificacion(ahora);

  // Ya se envió hoy para este usuario
  if (localStorage.getItem(STORAGE_NOTIF) === clave) return;

  // Estamos esperando el próximo reintento
  if (Date.now() < reintentarDesde) return;

  enviarNotificacion(clave).then(ok => {
    if (!ok) {
      reintentarDesde = Date.now() + REINTENTO_MS;
      console.info('No se pudo enviar la notificación. Reintentando en 2 minutos...');
    }
  });
}

function iniciarSistemaNotificaciones() {
  revisarNotificaciones();
  setInterval(revisarNotificaciones, CHEQUEO_MS);

  // Al volver a la app, revisar de nuevo
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revisarNotificaciones();
  });
}

/* ------------------------------------------------------------
   10. SERVICE WORKER (para poder instalar la app)
   ------------------------------------------------------------ */

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('No se pudo registrar el Service Worker:', err);
    });
  });
}

/* ------------------------------------------------------------
   11. INICIALIZACIÓN
   ------------------------------------------------------------ */

function init() {
  renderTabla(null);
  renderHoy(null);

  formLogin.addEventListener('submit', manejarLogin);
  btnLogout.addEventListener('click', cerrarSesion);

  // Al escribir, sacar el estado de error
  inputUsuario.addEventListener('input', () => {
    if (errorLogin.classList.contains('show')) ocultarError();
  });

  // Permitir click en las pestañas
  botonesTab.forEach(boton => {
    boton.addEventListener('click', () => {
      if (boton.disabled) return;
      activarTab(boton.dataset.tab);
    });
  });

  // Reposicionar el indicador
  window.addEventListener('resize', () => posicionarIndicador(false));
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => posicionarIndicador(false));
  }

  /* ---- AUTO-LOGIN ---- */
  const sesion = leerSesion();

  if (sesion) {
    // 1.2 — Hay datos guardados: ir directo a "inicio"
    iniciarSesion(sesion.usuario);
  } else {
    // 1.1 — No hay datos: dejar que el usuario se loguee
    activarTab('login', false);
    setTimeout(() => inputUsuario.focus(), 250);
  }

  registrarServiceWorker();
  iniciarSistemaNotificaciones();
}

document.addEventListener('DOMContentLoaded', init);