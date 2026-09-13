/* ============================================================
   TusTareas — Lógica de la aplicación
   ============================================================ */

/* ------------------------------------------------------------
   1. DATOS POR DEFECTO
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

const ASIGNACION_DEFAULT = {
  LUNES:     ['Mía',       'Pedro',     'Pedro', 'Mía',   'Ayelen', 'Ayelen', 'Mía',   'Pedro'],
  MARTES:    ['Lucía',     'Lucía',     'Lucía', 'Lucía', 'Ayelen', 'Pedro',  'Ayelen','Mía'],
  MIERCOLES: ['Pedro',     'Mía',       'Mía',   'Pedro', 'Pedro',  'Mía',    'Ayelen','Pedro'],
  JUEVES:    ['Pedro',     'Pedro',     'Pedro', 'Pedro', 'X',      'Mía',    'Pedro', 'Ayelen'],
  VIERNES:   ['Mía/Pedro', 'Pedro/Mía', 'Mía',   'Pedro', 'X',      'X',      'X',     'X']
};

/* Asignación vigente en memoria. Empieza con los defaults y se reemplaza
   cuando se carga el documento "dias" desde Firestore. */
let asignacionActual = clonarAsignacion(ASIGNACION_DEFAULT);

function clonarAsignacion(obj) {
  const copia = {};
  for (const dia of DIAS) copia[dia] = [...(obj[dia] || ASIGNACION_DEFAULT[dia])];
  return copia;
}

/* Lista de usuarios válidos (se calcula desde los defaults + la actual) */
function calcularUsuarios() {
  const set = new Set();
  for (const dia of DIAS) {
    const fila = asignacionActual[dia] || [];
    fila.forEach(celda => {
      if (!celda || String(celda).toUpperCase() === 'X') return;
      String(celda).split('/').forEach(n => set.add(n.trim()));
    });
  }
  return [...set].sort((a, b) => a.localeCompare(b, 'es'));
}

let USUARIOS = calcularUsuarios();

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
const DOC_DIAS   = 'dias';

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
  // Recalcular por si cambiaron los usuarios desde el editor
  USUARIOS = calcularUsuarios();
  return USUARIOS.find(u => normalizar(u) === buscado) || null;
}

function esCeldaVacia(celda) {
  return !celda || String(celda).toUpperCase() === 'X';
}

function tareasDeUsuario(usuario, fecha = new Date()) {
  const fila = asignacionActual[nombreDia(fecha)];
  if (!fila) return [];

  const objetivo = normalizar(usuario);
  const resultado = [];

  fila.forEach((celda, indice) => {
    if (esCeldaVacia(celda)) return;
    const asignados = String(celda).split('/').map(normalizar);
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
    // Verificar contra la lista dinámica
    const lista = calcularUsuarios();
    if (!lista.includes(datos.usuario)) return null;
    return datos;
  } catch (e) { return null; }
}

function borrarSesion() {
  try { localStorage.removeItem(STORAGE_SESION); } catch (e) {}
}

/* ------------------------------------------------------------
   6. CARGA Y GUARDADO DE ASIGNACIONES EN FIRESTORE
   ------------------------------------------------------------ */

/**
 * Carga el documento "dias" desde Firestore y actualiza asignacionActual.
 * Devuelve true si se cargó, false si no existe o hubo error.
 */
async function cargarAsignaciones() {
  const db = obtenerDb();
  if (!db) {
    console.warn('[dias] Sin conexión a Firestore, usando valores por defecto.');
    return false;
  }

  try {
    const snap = await db.collection(COLECCION).doc(DOC_DIAS).get();
    if (!snap.exists) {
      console.info('[dias] El documento no existe, usando defaults.');
      return false;
    }

    const data = snap.data();
    const nueva = {};

    for (const dia of DIAS) {
      const fila = data[dia];
      if (Array.isArray(fila) && fila.length === 8) {
        nueva[dia] = fila.map(v => v == null ? 'X' : String(v));
      } else {
        console.warn(`[dias] El día ${dia} es inválido, usando default.`);
        nueva[dia] = [...ASIGNACION_DEFAULT[dia]];
      }
    }

    asignacionActual = nueva;
    USUARIOS = calcularUsuarios();
    console.info('[dias] Asignaciones cargadas desde Firestore.');
    return true;

  } catch (e) {
    console.error('[dias] Error al cargar:', e);
    return false;
  }
}

/** Guarda asignacionActual (o el objeto pasado) en Firestore. */
async function guardarAsignaciones(data) {
  const db = obtenerDb();
  if (!db) throw new Error('Sin conexión a Firestore.');
  await db.collection(COLECCION).doc(DOC_DIAS).set(data);
}

/* ------------------------------------------------------------
   7. DOM
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

const btnAdminRev    = document.getElementById('btn-solicitar-revision');
const adminEstado    = document.getElementById('admin-estado');
const adminEditor    = document.getElementById('admin-editor');
const btnGuardarEd   = document.getElementById('btn-guardar-editor');
const btnRevertirEd  = document.getElementById('btn-revertir-editor');
const editorEstado   = document.getElementById('editor-estado');

const toastContainer = document.getElementById('toast-container');

/* ------------------------------------------------------------
   8. PESTAÑAS
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
   9. RENDERIZADO DE LA TABLA Y DE "HOY"
   ------------------------------------------------------------ */

function renderTabla(usuarioActual = null) {
  const objetivo = usuarioActual ? normalizar(usuarioActual) : null;

  let html = '<thead><tr><th class="col-dia">DÍA</th>';
  for (let i = 1; i <= 8; i++) html += `<th>${TAREAS[i]}</th>`;
  html += '</tr></thead><tbody>';

  for (const dia of DIAS) {
    html += `<tr><th class="col-dia" scope="row">${dia}</th>`;
    const fila = asignacionActual[dia] || ASIGNACION_DEFAULT[dia];

    for (const celda of fila) {
      if (esCeldaVacia(celda)) {
        html += '<td class="celda-vacia">—</td>';
        continue;
      }
      const esMia = objetivo && String(celda).split('/').map(normalizar).includes(objetivo);
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
   10. PANEL ADMIN — visibilidad
   ------------------------------------------------------------ */

function actualizarTabAdmin(usuario) {
  const btnAdmin = botonesTab.find(b => b.dataset.tab === 'panel-admin');
  if (!btnAdmin) return;

  const mostrar = usuario && esAdmin(usuario);

  if (mostrar) {
    btnAdmin.classList.remove('hidden');
    btnAdmin.disabled = false;
    renderEditorAdmin();
  } else {
    if (btnAdmin.classList.contains('active')) activarTab('inicio');
    btnAdmin.classList.add('hidden');
    btnAdmin.disabled = true;
  }

  setTimeout(() => posicionarIndicador(), 60);
}

/* ------------------------------------------------------------
   11. EDITOR DE ASIGNACIONES
   ------------------------------------------------------------ */

function renderEditorAdmin() {
  if (!adminEditor) return;

  let html = '<table class="editor-tabla"><thead><tr><th>DÍA</th>';
  for (let i = 1; i <= 8; i++) html += `<th>T${i}</th>`;
  html += '</tr></thead><tbody>';

  for (const dia of DIAS) {
    const fila = asignacionActual[dia] || ASIGNACION_DEFAULT[dia];
    html += `<tr><th scope="row">${dia}</th>`;

    for (let i = 0; i < 8; i++) {
      const valor = fila[i] != null ? String(fila[i]) : 'X';
      const claseX = esCeldaVacia(valor) ? 'celda-x' : '';
      const escape = valor.replace(/"/g, '&quot;');
      html += `<td>
        <input type="text"
               list="usuarios-datalist"
               value="${escape}"
               data-dia="${dia}"
               data-idx="${i}"
               class="${claseX}"
               spellcheck="false"
               autocomplete="off">
      </td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  adminEditor.innerHTML = html;

  // Marcar visualmente las celdas X y actualizar la clase al escribir
  adminEditor.querySelectorAll('input[data-dia]').forEach(inp => {
    inp.addEventListener('input', () => {
      const v = inp.value.trim();
      inp.classList.toggle('celda-x', esCeldaVacia(v));
    });
  });
}

/** Recolecta los valores del editor y devuelve un objeto { DIA: [8 valores] }. */
function recolectarEditor() {
  const inputs = adminEditor.querySelectorAll('input[data-dia]');
  const nueva = clonarAsignacion(asignacionActual);

  inputs.forEach(inp => {
    const dia = inp.dataset.dia;
    const idx = parseInt(inp.dataset.idx, 10);
    let valor = inp.value.trim();
    if (!valor || valor.toUpperCase() === 'X') valor = 'X';
    if (nueva[dia]) nueva[dia][idx] = valor;
  });

  return nueva;
}

async function guardarCambiosEditor() {
  if (editorEstado) {
    editorEstado.textContent = 'Guardando cambios...';
    editorEstado.className = 'admin-estado';
  }

  const nueva = recolectarEditor();

  try {
    await guardarAsignaciones(nueva);
    asignacionActual = nueva;
    USUARIOS = calcularUsuarios();

    // Re-renderizar la tabla y "hoy" con los datos nuevos
    const sesion = leerSesion();
    if (sesion) {
      renderTabla(sesion.usuario);
      renderHoy(sesion.usuario);
    }

    if (editorEstado) {
      editorEstado.textContent = 'Cambios guardados correctamente.';
      editorEstado.className = 'admin-estado ok';
      setTimeout(() => {
        editorEstado.textContent = '';
        editorEstado.className = 'admin-estado';
      }, 4000);
    }
  } catch (e) {
    console.error('Error guardando asignaciones:', e);
    if (editorEstado) {
      editorEstado.textContent = 'Error: ' + (e.message || e);
      editorEstado.className = 'admin-estado error';
    }
  }
}

function revertirEditor() {
  renderEditorAdmin();
  if (editorEstado) {
    editorEstado.textContent = 'Cambios locales descartados.';
    editorEstado.className = 'admin-estado';
    setTimeout(() => {
      editorEstado.textContent = '';
      editorEstado.className = 'admin-estado';
    }, 3000);
  }
}

/* ------------------------------------------------------------
   12. TOASTS
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
   13. AUDIO
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
   14. PERMISO DE NOTIFICACIONES
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
  } catch (e) { return false; }
}

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
  if (!db) { console.warn('revisionpendiente: sin acceso a Firebase.'); return; }

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
    mostrarError(`No encontramos a "${valor}". Probá con otro nombre.`);
    return;
  }

  ocultarError();
  guardarSesion(usuario);
  iniciarSesion(usuario);
}

/* ------------------------------------------------------------
   18. NOTIFICACIONES DIARIAS
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

function init() {
  renderTabla(null);
  renderHoy(null);

  formLogin.addEventListener('submit', manejarLogin);
  btnLogout.addEventListener('click', cerrarSesion);

  if (btnAdminRev)   btnAdminRev.addEventListener('click', solicitarRevision);
  if (btnGuardarEd)  btnGuardarEd.addEventListener('click', guardarCambiosEditor);
  if (btnRevertirEd) btnRevertirEd.addEventListener('click', revertirEditor);

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

  /* ---- Cargar asignaciones desde Firestore en background ---- */
  cargarAsignaciones().then(() => {
    // Cuando termina la carga (con éxito o no), re-renderizamos con los
    // datos definitivos y refrescamos el editor si Pedro está logueado.
    const sesion = leerSesion();
    if (sesion) {
      renderTabla(sesion.usuario);
      renderHoy(sesion.usuario);
      if (esAdmin(sesion.usuario)) renderEditorAdmin();
    }
  });

  /* ---- Auto-login con los datos disponibles (defaults) ---- */
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