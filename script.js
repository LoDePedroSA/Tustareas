/* ============================================================
   TusTareas — Lógica de la aplicación
   ============================================================ */

/* ------------------------------------------------------------
   1. DATOS
   ------------------------------------------------------------ */

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

const ASIGNACION = {
  LUNES:     ['Mía',       'Pedro',     'Pedro', 'Mía',   'Ayelen', 'Ayelen', 'Mía',   'Pedro'],
  MARTES:    ['Lucía',     'Lucía',     'Lucía', 'Lucía', 'Ayelen', 'Pedro',  'Ayelen','Mía'],
  MIERCOLES: ['Pedro',     'Mía',       'Mía',   'Pedro', 'Pedro',  'Mía',    'Ayelen','Pedro'],
  JUEVES:    ['Pedro',     'Pedro',     'Pedro', 'Pedro', 'X',      'Mía',    'Pedro', 'Ayelen'],
  VIERNES:   ['Mía/Pedro', 'Pedro/Mía', 'Mía',   'Pedro', 'X',      'X',      'X',     'X']
};

const USUARIOS = [...new Set(
  DIAS
    .flatMap(dia => ASIGNACION[dia])
    .filter(celda => celda !== 'X')
    .flatMap(celda => celda.split('/'))
)].sort((a, b) => a.localeCompare(b, 'es'));

const USUARIO_ADMIN = 'Pedro';

/* ------------------------------------------------------------
   2. FIREBASE
   ------------------------------------------------------------ */

const firebaseConfig = {
  apiKey: "AIzaSyC8jSaP8e1UvLDn2sDdIyo2Z9o_KNhSEro",
  authDomain: "tuesa-oficial.firebaseapp.com",
  projectId: "tuesa-oficial",
  storageBucket: "tuesa-oficial.firebasestorage.app",
  messagingSenderId: "447951557213",
  appId: "1:447951557213:web:293e062ae3fe474c1cb3b4"
};

let _db = null;

function obtenerDb() {
  try {
    if (typeof firebase === 'undefined') {
      console.error('Firebase SDK no está cargado.');
      return null;
    }
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }
    if (!_db) _db = firebase.firestore();
    return _db;
  } catch (e) {
    console.error('No se pudo inicializar Firebase:', e);
    return null;
  }
}

/* ------------------------------------------------------------
   3. CONFIGURACIÓN
   ------------------------------------------------------------ */

const STORAGE_SESION = 'tustareas.sesion';
const STORAGE_NOTIF  = 'tustareas.ultimaNotificacion';

const HORA_NOTIFICACION = 20;
const REINTENTO_MS      = 2 * 60 * 1000;
const CHEQUEO_MS        = 30 * 1000;

const COLECCION  = 'tustareas';
const DOC_ULTIMA = 'ultima_revision';

/* ------------------------------------------------------------
   4. UTILIDADES
   ------------------------------------------------------------ */

function normalizar(texto) {
  return String(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function claveFecha(fecha = new Date()) {
  const y = fecha.getFullYear();
  const m = String(fecha.getMonth() + 1).padStart(2, '0');
  const d = String(fecha.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function nombreDia(fecha = new Date()) {
  return ['DOMINGO','LUNES','MARTES','MIERCOLES','JUEVES','VIERNES','SABADO'][fecha.getDay()];
}

function buscarUsuario(entrada) {
  const buscado = normalizar(entrada);
  if (!buscado) return null;
  return USUARIOS.find(u => normalizar(u) === buscado) || null;
}

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

function esAdmin(usuario) {
  return normalizar(usuario) === normalizar(USUARIO_ADMIN);
}

/* ------------------------------------------------------------
   5. SESIÓN
   ------------------------------------------------------------ */

function guardarSesion(usuario) {
  try {
    localStorage.setItem(STORAGE_SESION, JSON.stringify({
      usuario,
      fecha: new Date().toISOString()
    }));
  } catch (e) { console.warn('No se pudo guardar la sesión:', e); }
}

function leerSesion() {
  try {
    const bruto = localStorage.getItem(STORAGE_SESION);
    if (!bruto) return null;
    const datos = JSON.parse(bruto);
    if (!datos || !datos.usuario) return null;
    if (!USUARIOS.includes(datos.usuario)) return null;
    return datos;
  } catch (e) { return null; }
}

function borrarSesion() {
  try { localStorage.removeItem(STORAGE_SESION); } catch (e) {}
}

/* ------------------------------------------------------------
   6. DOM
   ------------------------------------------------------------ */

const tabsEl        = document.getElementById('tabs');
const botonesTab    = [...tabsEl.querySelectorAll('.tab-btn')];
const indicador     = document.getElementById('tab-indicator');

const paneles = {
  login:         document.getElementById('panel-login'),
  inicio:        document.getElementById('panel-inicio'),
  'panel-admin': document.getElementById('panel-panel-admin')
};

const formLogin    = document.getElementById('login-form');
const inputUsuario = document.getElementById('username');
const errorLogin   = document.getElementById('login-error');

const btnLogout    = document.getElementById('logout-btn');
const userChip     = document.getElementById('user-chip');
const tabla        = document.getElementById('tareas-table');

const hoyTitulo    = document.getElementById('hoy-titulo');
const hoyLista     = document.getElementById('hoy-lista');

const btnAdminRev  = document.getElementById('btn-solicitar-revision');
const adminEstado  = document.getElementById('admin-estado');

const toastContainer = document.getElementById('toast-container');

/* ------------------------------------------------------------
   7. PESTAÑAS
   ------------------------------------------------------------ */

function posicionarIndicador(animar = true) {
  const activo = tabsEl.querySelector('.tab-btn.active');
  if (!activo || activo.offsetParent === null) return;

  const r = activo.getBoundingClientRect();
  const c = tabsEl.getBoundingClientRect();

  if (!animar) indicador.style.transition = 'none';

  indicador.style.width  = r.width  + 'px';
  indicador.style.height = r.height + 'px';
  indicador.style.transform = `translate(${r.left - c.left}px, ${r.top - c.top}px)`;

  if (!animar) {
    void indicador.offsetWidth;
    requestAnimationFrame(() => { indicador.style.transition = ''; });
  }
}

function activarTab(nombre, animar = true) {
  console.log('[activarTab]', nombre);

  botonesTab.forEach(b => b.classList.toggle('active', b.dataset.tab === nombre));

  Object.entries(paneles).forEach(([clave, el]) => {
    if (el) el.classList.toggle('active', clave === nombre);
  });

  // [FIX] Doble rAF: en móviles el layout a veces necesita más de un frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => posicionarIndicador(animar));
  });
}

/* ------------------------------------------------------------
   8. RENDERIZADO
   ------------------------------------------------------------ */

function renderTabla(usuarioActual = null) {
  const objetivo = usuarioActual ? normalizar(usuarioActual) : null;

  let html = '<thead><tr><th class="col-dia">DÍA</th>';
  for (let i = 1; i <= 8; i++) html += `<th>${TAREAS[i]}</th>`;
  html += '</tr></thead><tbody>';

  for (const dia of DIAS) {
    html += `<tr><th class="col-dia" scope="row">${dia}</th>`;
    for (const celda of ASIGNACION[dia]) {
      if (celda === 'X') { html += '<td class="celda-vacia">—</td>'; continue; }
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
   9. PESTAÑA PANEL ADMIN
   ------------------------------------------------------------ */

function actualizarTabAdmin(usuario) {
  const btnAdmin = botonesTab.find(b => b.dataset.tab === 'panel-admin');
  if (!btnAdmin) return;

  const mostrar = usuario && esAdmin(usuario);
  console.log('[actualizarTabAdmin]', usuario, 'mostrar=', mostrar);

  if (mostrar) {
    btnAdmin.classList.remove('hidden');
    btnAdmin.disabled = false;
  } else {
    if (btnAdmin.classList.contains('active')) activarTab('inicio');
    btnAdmin.classList.add('hidden');
    btnAdmin.disabled = true;
  }

  // [FIX] Reposicionar tras el reflow, no antes
  setTimeout(() => posicionarIndicador(), 60);
}

/* ------------------------------------------------------------
   10. TOASTS
   ------------------------------------------------------------ */

function mostrarToast(titulo, cuerpo, duracion = 8000) {
  if (!toastContainer) return;
  const toast = document.createElement('div');
  toast.className = 'toast';

  const h = document.createElement('p');
  h.className = 'toast-title';
  h.textContent = titulo;

  const p = document.createElement('p');
  p.className = 'toast-body';
  p.textContent = cuerpo;

  toast.appendChild(h);
  toast.appendChild(p);
  toastContainer.appendChild(toast);

  toast.addEventListener('click', () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  });

  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duracion);
}

/* ------------------------------------------------------------
   11. AUDIO
   ------------------------------------------------------------ */

let _audioPendiente = null;

function reproducirSonidoNotificacion() {
  try {
    const audio = new Audio('notificacion.mp3');
    audio.volume = 1;
    const promesa = audio.play();
    if (promesa && typeof promesa.catch === 'function') {
      promesa.catch(() => {
        _audioPendiente = audio;
        const reintentar = () => {
          if (_audioPendiente) {
            _audioPendiente.play().catch(() => {});
            _audioPendiente = null;
          }
        };
        document.addEventListener('click', reintentar, { once: true });
        document.addEventListener('touchstart', reintentar, { once: true });
      });
    }
  } catch (e) { console.warn('No se pudo reproducir el sonido:', e); }
}

// [FIX] Desbloquear audio en el primer toque (iOS/Safari y algunos Android)
function desbloquearAudio() {
  try {
    const audio = new Audio('notificacion.mp3');
    audio.volume = 0;
    const p = audio.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {});
    }
  } catch (e) {}
}

/* ------------------------------------------------------------
   12. PERMISO DE NOTIFICACIONES
   ------------------------------------------------------------ */

function permisoConcedido() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

async function pedirPermisoNotificaciones() {
  if (typeof Notification === 'undefined') {
    console.warn('Este navegador no soporta Notification API.');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    console.warn('El permiso de notificaciones fue denegado previamente.');
    return false;
  }
  try {
    const resultado = await Notification.requestPermission();
    console.log('[permiso notificaciones]', resultado);
    return resultado === 'granted';
  } catch (e) {
    console.warn('No se pudo pedir permiso de notificaciones:', e);
    return false;
  }
}

/* ------------------------------------------------------------
   13. SERVICE WORKER READY
   ------------------------------------------------------------ */

// [FIX] Esperar a que el SW esté activo antes de usarlo para notificar
async function esperarServiceWorker(timeoutMs = 6000) {
  if (!('serviceWorker' in navigator)) return null;

  const yaListo = await navigator.serviceWorker.getRegistration();
  if (yaListo && yaListo.active) return yaListo;

  return new Promise(resolve => {
    const timeout = setTimeout(() => resolve(null), timeoutMs);

    navigator.serviceWorker.ready.then(reg => {
      clearTimeout(timeout);
      resolve(reg);
    }).catch(() => {
      clearTimeout(timeout);
      resolve(null);
    });
  });
}

/* ------------------------------------------------------------
   14. REVISIÓN PENDIENTE
   ------------------------------------------------------------ */

async function revisionpendiente() {
  const sesion = leerSesion();
  if (!sesion) return;

  const db = obtenerDb();
  if (!db) {
    console.warn('revisionpendiente: sin acceso a Firebase.');
    return;
  }

  try {
    const ultimaSnap = await db.collection(COLECCION).doc(DOC_ULTIMA).get();
    if (!ultimaSnap.exists) return;

    const numeroRev = ultimaSnap.data().revision;
    if (numeroRev == null) return;

    const querySnap = await db.collection(COLECCION)
      .where('revision', '==', numeroRev)
      .get();
    if (querySnap.empty) return;

    const docRev = querySnap.docs.find(d => d.id !== DOC_ULTIMA);
    if (!docRev) return;

    const data = docRev.data();
    const usuarioNorm = normalizar(sesion.usuario);
    let valor;
    for (const [clave, val] of Object.entries(data)) {
      if (normalizar(clave) === usuarioNorm) { valor = val; break; }
    }

    console.log('[revisionpendiente] rev=', numeroRev, 'valor usuario=', valor);

    if (valor === false) {
      await mostrarNotificacionRevision(numeroRev);
    }
  } catch (e) {
    console.error('Error en revisionpendiente:', e);
  }
}

async function mostrarNotificacionRevision(numeroRev) {
  const titulo = 'Prueba de Notificacion - Tus Tareas';
  const cuerpo = `Esta es una prueba para comprobar que el sistema ande bien (revision "${numeroRev}")`;

  // Sonido
  reproducirSonidoNotificacion();

  // Toast interno (siempre aparece)
  mostrarToast(titulo, cuerpo, 12000);

  // Notificación nativa
  if (!permisoConcedido()) {
    console.warn('Sin permiso de notificaciones. Solo se muestra el toast interno.');
    return;
  }

  // [FIX] Esperar al SW antes de notificar
  const reg = await esperarServiceWorker();

  try {
    const opciones = {
      body: cuerpo,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'tustareas-revision-' + numeroRev,
      requireInteraction: true
    };

    if (reg) {
      await reg.showNotification(titulo, opciones);
      console.log('[notificación] mostrada vía SW');
    } else {
      // Fallback: algunos navegadores móviles permiten new Notification directo
      new Notification(titulo, opciones);
      console.log('[notificación] mostrada vía new Notification (fallback)');
    }
  } catch (e) {
    console.error('No se pudo mostrar la notificación nativa:', e);
  }
}

/* ------------------------------------------------------------
   15. SOLICITAR REVISIÓN
   ------------------------------------------------------------ */

async function solicitarRevision() {
  if (adminEstado) {
    adminEstado.textContent = 'Contactando con el servidor...';
    adminEstado.className = 'admin-estado';
  }

  const db = obtenerDb();
  if (!db) {
    if (adminEstado) {
      adminEstado.textContent = 'No se pudo conectar con el servidor.';
      adminEstado.className = 'admin-estado error';
    }
    alert('No se pudo conectar con el servidor. Revisá tu conexión.');
    return;
  }

  try {
    const ultimaSnap = await db.collection(COLECCION).doc(DOC_ULTIMA).get();
    const revActual = ultimaSnap.exists ? (ultimaSnap.data().revision || 0) : 0;
    const nuevaRev  = Number(revActual) + 1;

    const nuevoDoc = {
      fecha: firebase.firestore.FieldValue.serverTimestamp(),
      revision: nuevaRev,
      Mia: false,
      Pedro: false,
      Ayelen: false,
      Lucia: false,
      Alejandro: false
    };

    await db.collection(COLECCION).add(nuevoDoc);
    await db.collection(COLECCION).doc(DOC_ULTIMA).set(
      { revision: nuevaRev },
      { merge: true }
    );

    if (adminEstado) {
      adminEstado.textContent = `Revisión ${nuevaRev} creada correctamente.`;
      adminEstado.className = 'admin-estado ok';
    }

    alert(`Se solicito una revision exitosamente, el numero de revision es: ${nuevaRev}`);
    alert('En breve se le reiniciara la aplicacion...');

    setTimeout(() => location.reload(), 5000);
  } catch (e) {
    console.error('Error al solicitar revisión:', e);
    if (adminEstado) {
      adminEstado.textContent = 'Error: ' + (e.message || e);
      adminEstado.className = 'admin-estado error';
    }
    alert('Hubo un error al solicitar la revisión.');
  }
}

/* ------------------------------------------------------------
   16. LOGIN / LOGOUT
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
  console.log('[iniciarSesion]', usuario);
  userChip.textContent = usuario;

  renderTabla(usuario);
  renderHoy(usuario);

  const btnInicio = botonesTab.find(b => b.dataset.tab === 'inicio');
  const btnLogin  = botonesTab.find(b => b.dataset.tab === 'login');
  if (btnInicio) btnInicio.disabled = false;
  if (btnLogin)  btnLogin.disabled  = true;

  actualizarTabAdmin(usuario);
  activarTab('inicio');

  pedirPermisoNotificaciones();
  revisarNotificaciones();
  revisionpendiente();
}

function cerrarSesion() {
  borrarSesion();
  userChip.textContent = '—';
  renderTabla(null);
  renderHoy(null);
  actualizarTabAdmin(null);

  const btnInicio = botonesTab.find(b => b.dataset.tab === 'inicio');
  const btnLogin  = botonesTab.find(b => b.dataset.tab === 'login');
  if (btnInicio) btnInicio.disabled = true;
  if (btnLogin)  btnLogin.disabled  = false;

  inputUsuario.value = '';
  ocultarError();
  activarTab('login');
  inputUsuario.focus();
}

function manejarLogin(evento) {
  evento.preventDefault();
  const valor = inputUsuario.value.trim();

  if (!valor) {
    mostrarError('Escribí tu nombre de usuario para continuar.');
    inputUsuario.focus();
    return;
  }

  const usuario = buscarUsuario(valor);
  if (!usuario) {
    mostrarError(`No encontramos a "${valor}". Probá con Mía, Pedro, Ayelen o Lucía.`);
    return;
  }

  ocultarError();
  guardarSesion(usuario);
  iniciarSesion(usuario);
}

/* ------------------------------------------------------------
   17. NOTIFICACIONES DIARIAS (tareas)
   ------------------------------------------------------------ */

let reintentarDesde = 0;

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
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: `tustareas-${clave}`
  };

  try {
    const reg = await esperarServiceWorker();
    if (reg) {
      await reg.showNotification('TusTareas', opciones);
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
  if (diaSemana === 0 || diaSemana === 6) return;
  if (ahora.getHours() < HORA_NOTIFICACION) return;

  const clave = claveNotificacion(ahora);
  if (localStorage.getItem(STORAGE_NOTIF) === clave) return;
  if (Date.now() < reintentarDesde) return;

  enviarNotificacion(clave).then(ok => {
    if (!ok) {
      reintentarDesde = Date.now() + REINTENTO_MS;
      console.info('Reintentando notificación en 2 minutos...');
    }
  });
}

function iniciarSistemaNotificaciones() {
  revisarNotificaciones();
  setInterval(revisarNotificaciones, CHEQUEO_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) revisarNotificaciones();
  });
}

/* ------------------------------------------------------------
   18. SERVICE WORKER
   ------------------------------------------------------------ */

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').then(() => {
      console.log('[SW] registrado');
    }).catch(err => {
      console.warn('No se pudo registrar el Service Worker:', err);
    });
  });
}

/* ------------------------------------------------------------
   19. INICIALIZACIÓN
   ------------------------------------------------------------ */

function init() {
  console.log('[init] TusTareas');
  console.log('[init] Notification:', typeof Notification !== 'undefined' ? Notification.permission : 'no soportado');
  console.log('[init] SW:', 'serviceWorker' in navigator);

  renderTabla(null);
  renderHoy(null);

  formLogin.addEventListener('submit', manejarLogin);
  btnLogout.addEventListener('click', cerrarSesion);

  if (btnAdminRev) {
    btnAdminRev.addEventListener('click', solicitarRevision);
  }

  inputUsuario.addEventListener('input', () => {
    if (errorLogin.classList.contains('show')) ocultarError();
  });

  botonesTab.forEach(boton => {
    // [FIX] pointerup + click para máxima compatibilidad en táctil
    boton.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (boton.disabled) return;
      activarTab(boton.dataset.tab);
    });
  });

  // [FIX] Pedir permiso de notificaciones y desbloquear audio en el primer toque
  const primerToque = async () => {
    desbloquearAudio();
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await pedirPermisoNotificaciones();
    }
    revisarNotificaciones();
  };
  document.addEventListener('pointerdown', primerToque, { once: true, passive: true });

  window.addEventListener('resize', () => posicionarIndicador(false));
  window.addEventListener('orientationchange', () => setTimeout(() => posicionarIndicador(false), 250));

  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => posicionarIndicador(false));
  }

  /* ---- AUTO-LOGIN ---- */
  const sesion = leerSesion();
  if (sesion) {
    iniciarSesion(sesion.usuario);
  } else {
    activarTab('login', false);
    setTimeout(() => inputUsuario.focus(), 250);
  }

  registrarServiceWorker();
  iniciarSistemaNotificaciones();
}

document.addEventListener('DOMContentLoaded', init);