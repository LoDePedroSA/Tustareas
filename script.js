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

/* Usuario con acceso al panel admin */
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

/**
 * Inicializa Firebase (una sola vez) y devuelve la instancia de Firestore.
 * Devuelve null si no se pudo inicializar.
 */
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

const COLECCION     = 'tustareas';
const DOC_ULTIMA    = 'ultima_revision';

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
  if (!activo || activo.offsetParent === null) return; // si está oculto, no hacer nada

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
  botonesTab.forEach(b => b.classList.toggle('active', b.dataset.tab === nombre));

  Object.entries(paneles).forEach(([clave, el]) => {
    if (el) el.classList.toggle('active', clave === nombre);
  });

  // Esperar al reflow por si cambió la visibilidad de algún botón
  requestAnimationFrame(() => posicionarIndicador(animar));
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
   9. PESTAÑA PANEL ADMIN
   ------------------------------------------------------------ */

function actualizarTabAdmin(usuario) {
  const btnAdmin = botonesTab.find(b => b.dataset.tab === 'panel-admin');
  if (!btnAdmin) return;

  const mostrar = usuario && esAdmin(usuario);

  if (mostrar) {
    btnAdmin.classList.remove('hidden');
    btnAdmin.disabled = false;
  } else {
    // Si estaba activa esta pestaña, volver a inicio antes de ocultarla
    if (btnAdmin.classList.contains('active')) {
      activarTab('inicio');
    }
    btnAdmin.classList.add('hidden');
    btnAdmin.disabled = true;
  }

  // Reposicionar el indicador porque cambió el layout
  requestAnimationFrame(() => posicionarIndicador());
}

/* ------------------------------------------------------------
   10. TOASTS (notificaciones internas)
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

  // Click para cerrar
  toast.addEventListener('click', () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  });

  // Auto cierre
  setTimeout(() => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 300);
  }, duracion);
}

/* ------------------------------------------------------------
   11. SONIDO
   ------------------------------------------------------------ */

let _audioPendiente = null;

function reproducirSonidoNotificacion() {
  try {
    const audio = new Audio('notificacion.mp3');
    audio.volume = 1;

    const promesa = audio.play();
    if (promesa && typeof promesa.catch === 'function') {
      promesa.catch(() => {
        // El navegador bloqueó el audio (autoplay). Lo guardamos y lo
        // reintentamos al primer toque del usuario.
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
  } catch (e) {
    console.warn('No se pudo reproducir el sonido:', e);
  }
}

/* ------------------------------------------------------------
   12. NOTIFICACIONES DEL NAVEGADOR
   ------------------------------------------------------------ */

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

/* ------------------------------------------------------------
   13. REVISIÓN PENDIENTE (se ejecuta al iniciar sesión)
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
    // 1. Leer número de última revisión
    const ultimaSnap = await db.collection(COLECCION).doc(DOC_ULTIMA).get();
    if (!ultimaSnap.exists) return;

    const numeroRev = ultimaSnap.data().revision;
    if (numeroRev == null) return;

    // 2. Buscar documento con ese número de revisión
    const querySnap = await db.collection(COLECCION)
      .where('revision', '==', numeroRev)
      .get();

    if (querySnap.empty) return;

    // Excluir el documento "ultima_revision" por si tiene el mismo número
    const docRev = querySnap.docs.find(d => d.id !== DOC_ULTIMA);
    if (!docRev) return;

    const data = docRev.data();

    // 3. Buscar el campo que corresponda al usuario (sin tildes ni mayúsculas)
    const usuarioNorm = normalizar(sesion.usuario);
    let valor = undefined;

    for (const [clave, val] of Object.entries(data)) {
      if (normalizar(clave) === usuarioNorm) {
        valor = val;
        break;
      }
    }

    // 4. Si está en false, notificar
    if (valor === false) {
      mostrarNotificacionRevision(numeroRev);
    }
    // Si está en true o no existe el campo, no pasa nada.

  } catch (e) {
    console.error('Error en revisionpendiente:', e);
  }
}

function mostrarNotificacionRevision(numeroRev) {
  const titulo = 'Prueba de Notificacion - Tus Tareas';
  const cuerpo = `Esta es una prueba para comprobar que el sistema ande bien (revision "${numeroRev}")`;

  // Sonido
  reproducirSonidoNotificacion();

  // Notificación del navegador
  if (permisoConcedido()) {
    navigator.serviceWorker.getRegistration()
      .then(reg => {
        const opciones = {
          body: cuerpo,
          icon: 'icon-192.png',
          badge: 'icon-192.png',
          tag: 'tustareas-revision-' + numeroRev,
          requireInteraction: true
        };
        if (reg) return reg.showNotification(titulo, opciones);
        return new Notification(titulo, opciones);
      })
      .catch(e => console.warn('No se pudo mostrar la notificación nativa:', e));
  }

  // Toast interno (siempre aparece, para asegurar visibilidad)
  mostrarToast(titulo, cuerpo, 12000);
}

/* ------------------------------------------------------------
   14. SOLICITAR REVISIÓN (panel admin)
   ------------------------------------------------------------ */

async function solicitarRevision() {
  if (adminEstado) {
    adminEstado.textContent = 'Contactando con el servidor...';
    adminEstado.className = 'admin-estado';
  }

  const db = obtenerDb();
  if (!db) {
    if (adminEstado) {
      adminEstado.textContent = 'No se pudo conectar con el servidor. Revisá tu conexión.';
      adminEstado.className = 'admin-estado error';
    }
    alert('No se pudo conectar con el servidor. Revisá tu conexión.');
    return;
  }

  try {
    // 1. Leer última revisión
    const ultimaSnap = await db.collection(COLECCION).doc(DOC_ULTIMA).get();
    const revActual = ultimaSnap.exists ? (ultimaSnap.data().revision || 0) : 0;
    const nuevaRev  = Number(revActual) + 1;

    // 2. Crear nuevo documento de revisión
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

    // 3. Actualizar el puntero de última revisión.
    // NOTA: esto no estaba explícito en las instrucciones, pero sin esta línea
    // la app seguiría leyendo la revisión anterior y la nueva nunca se detectaría.
    await db.collection(COLECCION).doc(DOC_ULTIMA).set(
      { revision: nuevaRev },
      { merge: true }
    );

    if (adminEstado) {
      adminEstado.textContent = `Revisión ${nuevaRev} creada correctamente.`;
      adminEstado.className = 'admin-estado ok';
    }

    // 4. Avisos
    alert(`Se solicito una revision exitosamente, el numero de revision es: ${nuevaRev}`);
    alert('En breve se le reiniciara la aplicacion...');

    // 5. Recargar a los 5 segundos
    setTimeout(() => location.reload(), 5000);

  } catch (e) {
    console.error('Error al solicitar revisión:', e);
    if (adminEstado) {
      adminEstado.textContent = 'Error al solicitar la revisión: ' + (e.message || e);
      adminEstado.className = 'admin-estado error';
    }
    alert('Hubo un error al solicitar la revisión. Revisá la consola para más detalles.');
  }
}

/* ------------------------------------------------------------
   15. LOGIN / LOGOUT
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

  // Pestaña inicio habilitada, login bloqueado
  const btnInicio = botonesTab.find(b => b.dataset.tab === 'inicio');
  const btnLogin  = botonesTab.find(b => b.dataset.tab === 'login');
  if (btnInicio) btnInicio.disabled = false;
  if (btnLogin)  btnLogin.disabled  = true;

  // Mostrar/ocultar panel admin
  actualizarTabAdmin(usuario);

  // Ir a inicio
  activarTab('inicio');

  // Pedir permiso de notificaciones
  pedirPermisoNotificaciones();

  // Revisar notificación diaria pendiente
  revisarNotificaciones();

  // Revisar si hay una revisión pendiente para este usuario
  revisionpendiente();
}

function cerrarSesion() {
  borrarSesion();

  userChip.textContent = '—';
  renderTabla(null);
  renderHoy(null);

  // Ocultar panel admin
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
   16. NOTIFICACIONES DIARIAS (tareas)
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
    tag: `tustareas-${clave}`,
    renotify: false
  };

  try {
    if ('serviceWorker' in navigator) {
      const registro = await navigator.serviceWorker.getRegistration();
      if (registro) await registro.showNotification('TusTareas', opciones);
      else new Notification('TusTareas', opciones);
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
      console.info('No se pudo enviar la notificación. Reintentando en 2 minutos...');
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
   17. SERVICE WORKER
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
   18. INICIALIZACIÓN
   ------------------------------------------------------------ */

function init() {
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
    boton.addEventListener('click', () => {
      if (boton.disabled) return;
      activarTab(boton.dataset.tab);
    });
  });

  window.addEventListener('resize', () => posicionarIndicador(false));
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