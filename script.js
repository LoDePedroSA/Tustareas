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

const PERSONAS = ['Mía', 'Pedro', 'Ayelen', 'Lucía'];

const ASIGNACION_DEFAULT = {
  LUNES:     ['Mía',       'Pedro',     'Pedro', 'Mía',   'Ayelen', 'Ayelen', 'Mía',   'Pedro'],
  MARTES:    ['Lucía',     'Lucía',     'Lucía', 'Lucía', 'Ayelen', 'Pedro',  'Ayelen','Mía'],
  MIERCOLES: ['Pedro',     'Mía',       'Mía',   'Pedro', 'Pedro',  'Mía',    'Ayelen','Pedro'],
  JUEVES:    ['Pedro',     'Pedro',     'Pedro', 'Pedro', 'X',      'Mía',    'Pedro', 'Ayelen'],
  VIERNES:   ['Mía/Pedro', 'Pedro/Mía', 'Mía',   'Pedro', 'X',      'X',      'X',     'X']
};

let ASIGNACION = JSON.parse(JSON.stringify(ASIGNACION_DEFAULT));
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
  PERSONAS.forEach(p => set.add(p));
  USUARIOS = [...set].sort((a, b) => a.localeCompare(b, 'es'));
}
recalcularUsuarios();

const USUARIO_ADMIN = 'Pedro';

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

async function cargarAsignacionDesdeFirestore() {
  const db = obtenerDb();
  if (!db) return false;

  try {
    const snap = await db.collection('dias').get();
    if (snap.empty) return false;

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
    return encontrados > 0;
  } catch (e) {
    console.warn('[dias] Error al cargar desde Firestore:', e);
    return false;
  }
}

const STORAGE_SESION = 'tustareas.sesion';
const STORAGE_NOTIF  = 'tustareas.ultimaNotificacion';

const HORA_NOTIF_DEFAULT = '20:00';
const REINTENTO_MS       = 2 * 60 * 1000;
const CHEQUEO_MS         = 30 * 1000;

const COLECCION  = 'tustareas';
const DOC_ULTIMA = 'ultima_revision';

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

function construirMensajeTareas(usuario, fecha = new Date()) {
  const tareas = tareasDeUsuario(usuario, fecha);
  if (tareas.length === 0) {
    return `Buenos dias ${usuario}, hoy no te toca ninguna tarea`;
  }
  return `Buenos dias ${usuario}, hoy te tocan estas tareas: ${tareas.join(', ')}`;
}

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

function claveHora(usuario) {
  return `tustareas.horaNotificacion.${normalizar(usuario)}`;
}

function obtenerHoraNotificacion(usuario) {
  if (!usuario) {
    const [h, m] = HORA_NOTIF_DEFAULT.split(':').map(Number);
    return { hora: h, minuto: m, texto: HORA_NOTIF_DEFAULT };
  }
  const guardada = localStorage.getItem(claveHora(usuario));
  const valor = guardada || HORA_NOTIF_DEFAULT;
  const [h, m] = valor.split(':').map(Number);
  return { hora: h, minuto: m, texto: valor };
}

function guardarHoraNotificacion(usuario, textoHHMM) {
  try {
    localStorage.setItem(claveHora(usuario), textoHHMM);
  } catch (e) { console.warn('No se pudo guardar la hora:', e); }
}

const tabsEl        = document.getElementById('tabs');
const botonesTab    = tabsEl ? [...tabsEl.querySelectorAll('.tab-btn')] : [];
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

const btnRecordarTareas  = document.getElementById('btn-recordar-tareas');
const btnReprogNotif     = document.getElementById('btn-reprogramar-notif');

const btnAdminRev  = document.getElementById('btn-solicitar-revision');
const adminEstado  = document.getElementById('admin-estado');

const editorTbody      = document.getElementById('editor-tbody');
const btnGuardarAsig   = document.getElementById('btn-guardar-asignacion');
const editorEstado     = document.getElementById('editor-estado');

const modalHora        = document.getElementById('modal-hora');
const modalHoraInput   = document.getElementById('hora-input');
const modalCancelar    = document.getElementById('modal-cancelar');
const modalGuardar     = document.getElementById('modal-guardar');

const toastContainer   = document.getElementById('toast-container');

const modoInstalar     = document.getElementById('modo-instalar');
const appContenido     = document.getElementById('app-contenido');
const btnInstalar      = document.getElementById('btn-instalar');
const instalarEstado   = document.getElementById('instalar-estado');

let eventoInstalacion = null;

function estaEnModoInstalar() {
  try {
    const search = window.location.search || '';
    const hash   = window.location.hash   || '';
    return /[?&]=?instalar\b/i.test(search) || /instalar\b/i.test(hash);
  } catch (e) {
    return false;
  }
}

function activarModoInstalar() {
  if (appContenido) appContenido.style.display = 'none';
  if (modoInstalar) modoInstalar.hidden = false;
  document.body.classList.add('modo-instalar-activo');
}

function actualizarBotonInstalar() {
  if (!btnInstalar || !instalarEstado) return;
  if (eventoInstalacion) {
    btnInstalar.disabled = false;
    btnInstalar.textContent = 'Instalar app';
    instalarEstado.textContent = '';
  } else {
    btnInstalar.disabled = false;
    btnInstalar.textContent = 'Instalar app';
    instalarEstado.textContent = 'Si no aparece el aviso, tocá el botón nuevamente o usá el menú del navegador.';
  }
}

async function intentarInstalar() {
  if (!instalarEstado) return;
  if (eventoInstalacion) {
    try {
      eventoInstalacion.prompt();
      const eleccion = await eventoInstalacion.userChoice;
      if (eleccion && eleccion.outcome === 'accepted') {
        instalarEstado.textContent = '¡Gracias! La app se está instalando.';
      } else {
        instalarEstado.textContent = 'Instalación cancelada.';
      }
    } catch (e) {
      instalarEstado.textContent = 'No se pudo iniciar la instalación.';
    } finally {
      eventoInstalacion = null;
      actualizarBotonInstalar();
    }
    return;
  }

  instalarEstado.textContent = 'Tu navegador no ofreció el aviso todavía. Esperá un momento y volvé a intentar.';
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  eventoInstalacion = e;
  actualizarBotonInstalar();
});

window.addEventListener('appinstalled', () => {
  eventoInstalacion = null;
  if (instalarEstado) instalarEstado.textContent = 'App instalada correctamente.';
});

function posicionarIndicador(animar = true) {
  if (!tabsEl || !indicador) return;
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

function renderTabla(usuarioActual = null) {
  if (!tabla) return;
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
  if (!hoyLista || !hoyTitulo) return;
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

function generarOpcionesEditor() {
  const opciones = ['X', ...PERSONAS];
  for (let i = 0; i < PERSONAS.length; i++) {
    for (let j = 0; j < PERSONAS.length; j++) {
      if (i !== j) opciones.push(`${PERSONAS[i]}/${PERSONAS[j]}`);
    }
  }
  return opciones;
}

function renderEditorAsignacion() {
  if (!editorTbody) return;
  editorTbody.innerHTML = '';

  const opciones = generarOpcionesEditor();

  DIAS.forEach(dia => {
    const tr = document.createElement('tr');

    const th = document.createElement('th');
    th.className = 'col-dia';
    th.scope = 'row';
    th.textContent = dia;
    tr.appendChild(th);

    for (let i = 0; i < 8; i++) {
      const td = document.createElement('td');
      const sel = document.createElement('select');
      sel.className = 'editor-select';
      sel.dataset.dia = dia;
      sel.dataset.idx = i;

      const valorActual = ASIGNACION[dia][i] || 'X';
      const listaFinal = opciones.includes(valorActual)
        ? opciones
        : [...opciones, valorActual];

      listaFinal.forEach(opt => {
        const o = document.createElement('option');
        o.value = opt;
        o.textContent = opt === 'X' ? '—' : opt;
        sel.appendChild(o);
      });

      sel.value = valorActual;

      const pintar = () => {
        sel.classList.remove('opcion-x', 'opcion-combo');
        if (sel.value === 'X') sel.classList.add('opcion-x');
        else if (sel.value.includes('/')) sel.classList.add('opcion-combo');
      };
      pintar();
      sel.addEventListener('change', pintar);

      td.appendChild(sel);
      tr.appendChild(td);
    }

    editorTbody.appendChild(tr);
  });
}

async function guardarAsignacion() {
  if (!btnGuardarAsig || !editorEstado) return;

  const selects = editorTbody.querySelectorAll('select.editor-select');
  const nueva = { LUNES: [], MARTES: [], MIERCOLES: [], JUEVES: [], VIERNES: [] };

  selects.forEach(sel => {
    const dia = sel.dataset.dia;
    const idx = Number(sel.dataset.idx);
    nueva[dia][idx] = sel.value || 'X';
  });

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

    DIAS.forEach(dia => { ASIGNACION[dia] = nueva[dia]; });
    recalcularUsuarios();

    const sesion = leerSesion();
    renderTabla(sesion ? sesion.usuario : null);
    renderHoy(sesion ? sesion.usuario : null);

    editorEstado.textContent = 'Cambios guardados correctamente.';
    editorEstado.className = 'admin-estado ok';

    renderEditorAsignacion();
  } catch (e) {
    console.error('Error al guardar asignación:', e);
    editorEstado.textContent = 'Error: ' + (e.message || e);
    editorEstado.className = 'admin-estado error';
  } finally {
    btnGuardarAsig.disabled = false;
  }
}

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

async function mostrarNotificacionNativa(titulo, cuerpo, tag) {
  if (!permisoConcedido()) {
    const concedido = await pedirPermisoNotificaciones();
    if (!concedido) return false;
  }

  const reg = await esperarServiceWorker();
  const opciones = {
    body: cuerpo,
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    tag: tag || 'tustareas-generico'
  };

  try {
    if (reg) await reg.showNotification(titulo, opciones);
    else new Notification(titulo, opciones);
    return true;
  } catch (e) {
    console.warn('No se pudo mostrar la notificación nativa:', e);
    return false;
  }
}

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
  await mostrarNotificacionNativa(titulo, cuerpo, 'tustareas-revision-' + numeroRev);
}

async function notificarMisTareas() {
  const sesion = leerSesion();
  if (!sesion) return;

  const usuario = sesion.usuario;
  const cuerpo = construirMensajeTareas(usuario);

  reproducirSonidoNotificacion();
  mostrarToast('TusTareas', cuerpo, 10000);
  await mostrarNotificacionNativa('TusTareas', cuerpo, 'tustareas-manual-' + Date.now());
}

function abrirModalHora() {
  const sesion = leerSesion();
  if (!sesion || !modalHora) return;

  const { texto } = obtenerHoraNotificacion(sesion.usuario);
  modalHoraInput.value = texto;
  modalHora.hidden = false;
  setTimeout(() => modalHoraInput.focus(), 100);
}

function cerrarModalHora() {
  if (!modalHora) return;
  modalHora.hidden = true;
}

function guardarHoraSeleccionada() {
  const sesion = leerSesion();
  if (!sesion) { cerrarModalHora(); return; }

  const valor = (modalHoraInput.value || '').trim();
  if (!/^\d{2}:\d{2}$/.test(valor)) {
    alert('Elegí una hora válida.');
    return;
  }

  guardarHoraNotificacion(sesion.usuario, valor);
  cerrarModalHora();
  mostrarToast('TusTareas', `Listo. Vas a recibir tu recordatorio diario a las ${valor}.`);

  revisarNotificaciones();
}

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

function mostrarError(mensaje) {
  if (!errorLogin || !inputUsuario) return;
  errorLogin.textContent = mensaje;
  errorLogin.classList.add('show');
  inputUsuario.classList.add('input-error');
}

function ocultarError() {
  if (!errorLogin || !inputUsuario) return;
  errorLogin.textContent = '';
  errorLogin.classList.remove('show');
  inputUsuario.classList.remove('input-error');
}

function iniciarSesion(usuario) {
  if (userChip) userChip.textContent = usuario;
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
  if (userChip) userChip.textContent = '—';
  renderTabla(null);
  renderHoy(null);
  actualizarTabAdmin(null);

  const btnInicio = botonesTab.find(b => b.dataset.tab === 'inicio');
  const btnLogin  = botonesTab.find(b => b.dataset.tab === 'login');
  if (btnInicio) btnInicio.disabled = true;
  if (btnLogin)  btnLogin.disabled  = false;

  if (inputUsuario) inputUsuario.value = '';
  ocultarError();
  activarTab('login');
  if (inputUsuario) inputUsuario.focus();
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

let reintentarDesde = 0;

function claveNotificacion(fecha = new Date()) {
  const sesion = leerSesion();
  const usuario = sesion ? normalizar(sesion.usuario) : 'anonimo';
  return `${claveFecha(fecha)}|${usuario}`;
}

async function enviarNotificacionDiaria(clave) {
  const sesion = leerSesion();
  if (!sesion) return false;

  const cuerpo = construirMensajeTareas(sesion.usuario);
  const ok = await mostrarNotificacionNativa('TusTareas', cuerpo, `tustareas-${clave}`);

  if (ok) localStorage.setItem(STORAGE_NOTIF, clave);
  return ok;
}

function revisarNotificaciones() {
  if (!permisoConcedido()) return;

  const sesion = leerSesion();
  if (!sesion) return;

  const ahora = new Date();
  const diaSemana = ahora.getDay();
  if (diaSemana === 0 || diaSemana === 6) return;

  const { hora, minuto } = obtenerHoraNotificacion(sesion.usuario);
  const ahoraMin   = ahora.getHours() * 60 + ahora.getMinutes();
  const objetivoMin = hora * 60 + minuto;

  if (ahoraMin < objetivoMin) return;

  const clave = claveNotificacion(ahora);
  if (localStorage.getItem(STORAGE_NOTIF) === clave) return;
  if (Date.now() < reintentarDesde) return;

  enviarNotificacionDiaria(clave).then(ok => {
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

function registrarServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => {
      console.warn('No se pudo registrar el Service Worker:', err);
    });
  });
}

async function init() {
  if (estaEnModoInstalar()) {
    activarModoInstalar();
    if (btnInstalar) btnInstalar.addEventListener('click', intentarInstalar);
    actualizarBotonInstalar();
    registrarServiceWorker();
    return;
  }

  await cargarAsignacionDesdeFirestore();

  renderTabla(null);
  renderHoy(null);
  renderEditorAsignacion();

  if (formLogin)  formLogin.addEventListener('submit', manejarLogin);
  if (btnLogout)  btnLogout.addEventListener('click', cerrarSesion);

  if (btnAdminRev)       btnAdminRev.addEventListener('click', solicitarRevision);
  if (btnGuardarAsig)    btnGuardarAsig.addEventListener('click', guardarAsignacion);
  if (btnRecordarTareas) btnRecordarTareas.addEventListener('click', notificarMisTareas);
  if (btnReprogNotif)    btnReprogNotif.addEventListener('click', abrirModalHora);

  if (modalCancelar) modalCancelar.addEventListener('click', cerrarModalHora);
  if (modalGuardar)  modalGuardar.addEventListener('click', guardarHoraSeleccionada);
  if (modalHora) {
    modalHora.addEventListener('click', (e) => {
      if (e.target === modalHora) cerrarModalHora();
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalHora && !modalHora.hidden) cerrarModalHora();
  });

  if (inputUsuario) {
    inputUsuario.addEventListener('input', () => {
      if (errorLogin && errorLogin.classList.contains('show')) ocultarError();
    });
  }

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

  const sesion = leerSesion();
  if (sesion) {
    iniciarSesion(sesion.usuario);
  } else {
    activarTab('login', false);
    if (inputUsuario) setTimeout(() => inputUsuario.focus(), 250);
  }

  registrarServiceWorker();
  iniciarSistemaNotificaciones();
}

document.addEventListener('DOMContentLoaded', init);