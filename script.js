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

/* [NUEVO] Valores por defecto: se usan si Firestore no responde o está vacío */
const ASIGNACION_DEFAULT = {
  LUNES:     ['Mía',       'Pedro',     'Pedro', 'Mía',   'Ayelen', 'Ayelen', 'Mía',   'Pedro'],
  MARTES:    ['Lucía',     'Lucía',     'Lucía', 'Lucía', 'Ayelen', 'Pedro',  'Ayelen','Mía'],
  MIERCOLES: ['Pedro',     'Mía',       'Mía',   'Pedro', 'Pedro',  'Mía',    'Ayelen','Pedro'],
  JUEVES:    ['Pedro',     'Pedro',     'Pedro', 'Pedro', 'X',      'Mía',    'Pedro', 'Ayelen'],
  VIERNES:   ['Mía/Pedro', 'Pedro/Mía', 'Mía',   'Pedro', 'X',      'X',      'X',     'X']
};

/* [NUEVO] Ahora es mutable: se reemplaza con lo que venga de Firestore */
let ASIGNACION = JSON.parse(JSON.stringify(ASIGNACION_DEFAULT));

/* [NUEVO] Lista de usuarios válidos (se recalcula al cargar la asignación) */
let USUARIOS = [];

function recalcularUsuarios() {
  const set = new Set();
  DIAS.forEach(dia => {
    (ASIGNACION[dia] || []).forEach(celda => {
      if (celda && celda !== 'X') {
        celda.split('/').forEach(n => set.add(n.trim()));
      }
    });
  });
  USUARIOS = [...set].sort((a, b) => a.localeCompare(b, 'es'));
}
recalcularUsuarios();

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
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    if (!_db) _db = firebase.firestore();
    return _db;
  } catch (e) {
    console.error('No se pudo inicializar Firebase:', e);
    return null;
  }
}

/* [NUEVO] Carga la asignación desde Firestore. Devuelve true si encontró datos. */
async function cargarAsignacionDesdeFirestore() {
  const db = obtenerDb();
  if (!db) return false;

  try {
    const snap = await db.collection('dias').get();
    if (snap.empty) {
      console.info('[dias] La colección está vacía, usando valores por defecto.');
      return false;
    }

    const nueva = {};
    snap.forEach(doc => {
      const data = doc.data();
      if (Array.isArray(data.tareas) && data.tareas.length === 8) {
        nueva[doc.id.toUpperCase()] = data.tareas;
      }
    });

    let encontrados = 0;
    DIAS.forEach(dia => {
      if (nueva[dia]) { ASIGNACION[dia] = nueva[dia]; encontrados++; }
    });

    recalcularUsuarios();
    console.info(`[dias] Cargados ${encontrados}/5 días desde Firestore.`);
    return encontrados > 0;

  } catch (e) {
    console.warn('[dias] Error al cargar desde Firestore:', e);
    return false;
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

const editorTbody      = document.getElementById('editor-tbody');
const btnGuardarAsig   = document.getElementById('btn-guardar-asignacion');
const editorEstado     = document.getElementById('editor-estado');

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
  botonesTab.forEach(b => b.classList.toggle('active', b.dataset.tab === nombre));
  Object.entries(paneles).forEach(([clave, el]) => {
    if (el) el.classList.toggle('active', clave === nombre);
  });
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
   9. EDITOR DE ASIGNACIÓN
   ------------------------------------------------------------ */

function renderEditorAsignacion() {
  if (!editorTbody) return;

  editorTbody.innerHTML = '';

  DIAS.forEach(dia => {
    const tr = document.createElement('tr');

    const th = document.createElement('th');
    th.className = 'col-dia';
    th.scope = 'row';
    th.textContent = dia;
    tr.appendChild(th);

    for (let i = 0; i < 8; i++) {
      const td = document.createElement('td');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = ASIGNACION[dia][i] || '';
      input.dataset.dia = dia;
      input.dataset.idx = i;
      input.setAttribute('list', 'personas-datalist');
      input.spellcheck = false;
      input.autocomplete = 'off';

      const pintar = () => {
        input.classList.remove('input-x', 'input-combo');
        const v = input.value.trim();
        if (v === 'X' || v === '') input.classList.add('input-x');
        else if (v.includes('/')) input.classList.add('input-combo');
      };
      pintar();
      input.addEventListener('input', pintar);

      td.appendChild(input);
      tr.appendChild(td);
    }

    editorTbody.appendChild(tr);
  });
}

async function guardarAsignacion() {
  if (!btnGuardarAsig || !editorEstado) return;

  const inputs = editorTbody.querySelectorAll('input');
  const nueva = { LUNES: [], MARTES: [], MIERCOLES: [], JUEVES: [], VIERNES: [] };

  let valido = true;
  inputs.forEach(inp => {
    const dia = inp.dataset.dia;
    const idx = Number(inp.dataset.idx);
    const v = inp.value.trim();
    if (!v) valido = false;
    nueva[dia][idx] = v || 'X';
  });

  if (!valido) {
    editorEstado.textContent = 'Hay celdas vacías. Completalas con un nombre o "X".';
    editorEstado.className = 'admin-estado error';
    return;
  }

  const db = obtenerDb();
  if (!db) {
    editorEstado.textContent = 'No se pudo conectar con el servidor.';
    editorEstado.className = 'admin-estado error';
    return;
  }

  editorEstado.textContent = 'Guardando cambios...';
  editorEstado.className = 'admin-estado';
  btnGuardarAsig.disabled = true;

  try {
    const batch = db.batch();
    DIAS.forEach(dia => {
      const ref = db.collection('dias').doc(dia);
      batch.set(ref, { tareas: nueva[dia] });
    });
    await batch.commit();

    // Actualizar el estado local
    DIAS.forEach(dia => { ASIGNACION[dia] = nueva[dia]; });
    recalcularUsuarios();

    // Volver a renderizar la tabla con los datos nuevos
    const sesion = leerSesion();
    renderTabla(sesion ? sesion.usuario : null);
    renderHoy(sesion ? sesion.usuario : null);

    editorEstado.textContent = 'Cambios guardados correctamente.';
    editorEstado.className = 'admin-estado ok';

    // Sincronizar los inputs (por si se normalizó algún valor)
    renderEditorAsignacion();

  } catch (e) {
    console.error('Error al guardar asignación:', e);
    editorEstado.textContent = 'Error: ' + (e.message || e);
    editorEstado.className = 'admin-estado error';
  } finally {
    btnGuardarAsig.disabled = false;
  }
}

/* ------------------------------------------------------------
   10. PESTAÑA PANEL ADMIN
   ------------------------------------------------------------ */

function actualizarTabAdmin(usuario) {
  const btnAdmin = botonesTab.find(b => b.dataset.tab === 'panel-admin');
  if (!btnAdmin) return;

  const mostrar = usuario && esAdmin(usuario);

  if (mostrar) {
    btnAdmin.classList.remove('hidden');
    btnAdmin.disabled = false;
  } else {
    if (btnAdmin.classList.contains('active')) activarTab('inicio');
    btnAdmin.classList.add('hidden');
    btnAdmin.disabled = true;
  }

  setTimeout(() => posicionarIndicador(), 60);
}

/* ------------------------------------------------------------
   11. TOASTS
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
   12. AUDIO
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
   13. PERMISO DE NOTIFICACIONES
   ------------------------------------------------------------ */

function permisoConcedido() {
  return typeof Notification !== 'undefined' && Notification.permission === 'granted';
}

async function pedirPermisoNotificaciones() {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    const resultado = await Notification.requestPermission();
    return resultado === 'granted';
  } catch (e) {
    return false;
  }
}

/* ------------------------------------------------------------
   14. SERVICE WORKER READY
   ------------------------------------------------------------ */

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
   15. REVISIÓN PENDIENTE
   ------------------------------------------------------------ */

async function revisionpendiente() {
  const sesion = leerSesion();
  if (!sesion) return;

  const db = obtenerDb();
  if (!db) return;

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

    if (valor === false) await mostrarNotificacionRevision(numeroRev);
  } catch (e) {
    console.error('Error en revisionpendiente:', e);
  }
}

async function mostrarNotificacionRevision(numeroRev) {
  const titulo = 'Prueba de Notificacion - Tus Tareas';
  const cuerpo = `Esta es una prueba para comprobar que el sistema ande bien (revision "${numeroRev}")`;

  reproducirSonidoNotificacion();
  mostrarToast(titulo, cuerpo, 12000);

  if (!permisoConcedido()) return;

  const reg = await esperarServiceWorker();
  try {
    const opciones = {
      body: cuerpo,
      icon: 'icon-192.png',
      badge: 'icon-192.png',
      tag: 'tustareas-revision-' + numeroRev,
      requireInteraction: true
    };
    if (reg) await reg.showNotification(titulo, opciones);
    else new Notification(titulo, opciones);
  } catch (e) {
    console.error('No se pudo mostrar la notificación nativa:', e);
  }
}

/* ------------------------------------------------------------
   16. SOLICITAR REVISIÓN
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

    await db.collection(COLECCION).add({
      fecha: firebase.firestore.FieldValue.serverTimestamp(),
      revision: nuevaRev,
      Mia: false,
      Pedro: false,
      Ayelen: false,
      Lucia: false,
      Alejandro: false
    });

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
   17. LOGIN / LOGOUT
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
   18. NOTIFICACIONES DIARIAS (tareas)
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
    if (reg) await reg.showNotification('TusTareas', opciones);
    else new Notification('TusTareas', opciones);
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
    if (!ok) reintentarDesde = Date.now() + REINTENTO_MS;
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
   19. SERVICE WORKER
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
   20. INICIALIZACIÓN
   ------------------------------------------------------------ */

async function init() {
  // [NUEVO] Primero intentar cargar la asignación real desde Firestore
  await cargarAsignacionDesdeFirestore();

  renderTabla(null);
  renderHoy(null);
  renderEditorAsignacion();

  formLogin.addEventListener('submit', manejarLogin);
  btnLogout.addEventListener('click', cerrarSesion);

  if (btnAdminRev) btnAdminRev.addEventListener('click', solicitarRevision);
  if (btnGuardarAsig) btnGuardarAsig.addEventListener('click', guardarAsignacion);

  inputUsuario.addEventListener('input', () => {
    if (errorLogin.classList.contains('show')) ocultarError();
  });

  botonesTab.forEach(boton => {
    boton.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (boton.disabled) return;
      activarTab(boton.dataset.tab);
    });
  });

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