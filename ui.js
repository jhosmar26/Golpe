/**
 * UI de Golpeado (cliente).
 * No posee el Game State: solo renderiza vistas del servidor y emite acciones.
 */

import { esGrupoValido } from './game.js';
import { playSound, bindAudioUnlock } from './sounds.js';
import { DEBUG_SCENARIOS, detectarGruposEnSlots, claveGrupoSlots } from './debug-scenarios.js';

const socket = window.io();
const appEl = document.getElementById('app');

bindAudioUnlock();

/** @type {'home'|'room'|'game'|'victory'|'customDebug'} */
let screen = 'home';
/** Nombre capturado al abrir el formulario custom */
let customDebugPlayerName = 'Jugador';
/** @type {object|null} */
let roomState = null;
/** @type {object|null} */
let gameState = null;
/** @type {object|null} Snapshot previo para detectar eventos de sonido */
let prevGameSnapshot = null;
let victoriaTransitionPending = false;
/** Evita re-render completo a mitad de un drag (deja el fantasma “pegado”). */
let renderDiferidoPorDrag = false;

let cartasSeleccionadasIds = [];
let ignorarClickTrasDrag = false;
let lastError = '';

// DnD
let cartaArrastradaId = null;
let indiceOrigenDrag = null;
let indiceDestinoPreview = null;
let animandoFlip = false;
let reordenYaAplicado = false;
const FLIP_DURATION_MS = 280;

function escapeAttr(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
}

function miMano() {
    if (!gameState) return [];
    const yo = gameState.jugadores.find(j => j.esYo);
    return yo?.mano || [];
}

/** Puede iniciar robo del mazo (click o drag). */
function puedeRobarDeMazo() {
    if (!gameState || gameState.juegoTerminado) return false;
    if (!gameState.esMiTurno || gameState.faseActual !== 'ROBO') return false;
    // Robo directo o reciclaje (descarte con más de 1 carta)
    return gameState.mazoRoboCount > 0 || (gameState.descarteCount || 0) > 1;
}

function enviarAccion(type, payload = {}) {
    return new Promise((resolve) => {
        socket.emit('gameAction', { type, ...payload }, (res) => {
            if (res && !res.ok && res.error) {
                lastError = res.error;
            }
            resolve(res);
        });
    });
}

// ==========================================
// SOCKET
// ==========================================

socket.on('connect', () => {
    console.log('[Socket] conectado', socket.id);
});

socket.on('roomState', (state) => {
    roomState = state;
    if (!state) {
        if (screen !== 'home') {
            screen = 'home';
            gameState = null;
            render();
        }
        return;
    }
    if (state.status === 'lobby') {
        screen = 'room';
        gameState = null;
        cartasSeleccionadasIds = [];
        render();
    } else if (state.status === 'playing' || state.status === 'finished') {
        // gameState llega por evento aparte
        if (screen === 'home' || screen === 'room') {
            screen = 'game';
        }
        render();
    }
});

socket.on('gameState', (state) => {
    const prev = gameState;

    // Si llegamos a mitad de un reorden, conservar el orden local (mismas cartas)
    if (state && (pointerDrag || animandoFlip) && prev) {
        preservarOrdenManoLocal(prev, state);
    }

    gameState = state;
    if (!state) {
        prevGameSnapshot = null;
        cancelarInteraccionPointer();
        renderDiferidoPorDrag = false;
        if (roomState && roomState.status === 'lobby') {
            screen = 'room';
        }
        render();
        return;
    }

    // Limpiar selección de cartas que ya no existen en la mano
    const idsMano = new Set(miMano().map(c => c.id));
    cartasSeleccionadasIds = cartasSeleccionadasIds.filter(id => idsMano.has(id));

    processGameSounds(prev, state);

    if (state.juegoTerminado) {
        cancelarInteraccionPointer();
        renderDiferidoPorDrag = false;
        if (screen !== 'victory' && !victoriaTransitionPending) {
            startVictoryTransition();
            return;
        }
        screen = 'victory';
        render();
        return;
    }

    victoriaTransitionPending = false;
    screen = 'game';

    // No destruir el DOM de la mano mientras se arrastra / anima FLIP
    if (pointerDrag || animandoFlip) {
        renderDiferidoPorDrag = true;
        actualizarTableroSinMano();
        return;
    }

    render();
});

socket.on('actionError', ({ message }) => {
    lastError = message || 'Acción inválida';
    playSound('error');
    const toast = document.getElementById('actionToast');
    if (toast) {
        toast.textContent = lastError;
        toast.classList.add('visible');
        window.setTimeout(() => toast.classList.remove('visible'), 2500);
    } else {
        console.warn(lastError);
    }
});

function snapshotFromState(state) {
    if (!state) return null;
    const histLen = Array.isArray(state.historial) ? state.historial.length : 0;
    const lastMsg = histLen ? state.historial[histLen - 1]?.mensaje : '';
    const gruposCount = (state.jugadores || []).reduce(
        (n, j) => n + ((j.gruposExpuestos && j.gruposExpuestos.length) || 0),
        0
    );
    return {
        turnoActual: state.turnoActual,
        faseActual: state.faseActual,
        mazoRoboCount: state.mazoRoboCount,
        descarteCount: state.descarteCount,
        juegoTerminado: state.juegoTerminado,
        ganadorId: state.ganadorId,
        histLen,
        lastMsg: String(lastMsg || ''),
        gruposCount,
        esMiTurno: !!state.esMiTurno
    };
}

function processGameSounds(prevState, nextState) {
    const next = snapshotFromState(nextState);
    const prev = prevGameSnapshot || snapshotFromState(prevState);
    const prevHistLen = prev?.histLen || 0;
    prevGameSnapshot = next;
    if (!prev || !next) {
        if (next && !next.juegoTerminado) playSound('start');
        return;
    }

    // Primera recepción de partida activa
    if (prevState == null && nextState && !next.juegoTerminado) {
        playSound('start');
        return;
    }

    if (!prev.juegoTerminado && next.juegoTerminado) {
        playHistorialSounds(nextState.historial || [], prevHistLen, { skipTurn: true });
        const yo = nextState.jugadores?.find(j => j.esYo);
        const gane = yo && yo.id === next.ganadorId;
        window.setTimeout(() => playSound(gane ? 'win' : 'lose'), 220);
        return;
    }

    playHistorialSounds(nextState.historial || [], prevHistLen, { skipTurn: false });

    // Fallback si no llegó historial nuevo pero cambió el turno
    if (next.histLen <= prevHistLen && next.turnoActual !== prev.turnoActual && !next.juegoTerminado) {
        playSound('turn');
    } else if (next.histLen <= prevHistLen && next.gruposCount > prev.gruposCount) {
        playSound('meld');
    }
}

function playHistorialSounds(historial, fromIndex, { skipTurn }) {
    const nuevos = historial.slice(fromIndex);
    let playedAction = false;
    for (const h of nuevos) {
        const msg = String(h?.mensaje || '');
        if (!msg || msg.startsWith('[Secreto]')) continue;

        if (msg.includes('robó una carta del mazo')) {
            playSound('draw');
            playedAction = true;
        } else if (msg.includes('robó') && msg.includes('del descarte')) {
            playSound('drawDiscard');
            playedAction = true;
        } else if (msg.includes('descartó')) {
            playSound('discard');
            playedAction = true;
        } else if (msg.includes('expuso el grupo')) {
            playSound('meld');
            playedAction = true;
        } else if (msg.includes('recicló') || msg.includes('Mazo agotado')) {
            playSound('recycle');
            playedAction = true;
        } else if (msg.includes('cantado "STOP"') || msg.includes('ha cantado')) {
            playSound('stop');
            playedAction = true;
        } else if (msg.startsWith('Partida iniciada')) {
            playSound('start');
            playedAction = true;
        } else if (!skipTurn && msg.startsWith('Turno de ')) {
            // Solo turno “puro” si no hubo otra acción en el mismo batch… o siempre avisar
            playSound('turn');
        }
    }
    return playedAction;
}

function startVictoryTransition() {
    victoriaTransitionPending = true;
    const current = appEl.querySelector('.game-container, .overlay-screen') || appEl.firstElementChild;
    if (!current) {
        screen = 'victory';
        victoriaTransitionPending = false;
        render();
        return;
    }

    appEl.classList.add('page-transitioning');
    current.classList.add('page-exit');
    window.setTimeout(() => {
        screen = 'victory';
        render();
        const box = appEl.querySelector('.overlay-screen');
        if (box) box.classList.add('page-enter');
        appEl.classList.remove('page-transitioning');
        victoriaTransitionPending = false;
        window.setTimeout(() => box?.classList.remove('page-enter'), 700);
    }, 380);
}

// ==========================================
// RENDER ROUTER
// ==========================================

function render() {
    // Siempre: evita fantasmas de drag pegados tras re-render / victoria
    limpiarFantasmaDragHuerfano();
    if (screen === 'home') return renderHome();
    if (screen === 'room') return renderRoom();
    if (screen === 'customDebug') return renderCustomDebugForm();
    if (screen === 'victory') return renderVictoryScreen();
    if (screen === 'game') return renderBoard();
    renderHome();
}

/**
 * Conserva el orden de la mano local al recibir un state remoto
 * (misma composición de ids) para no romper un reorden en curso.
 */
function preservarOrdenManoLocal(prevState, nextState) {
    const yoPrev = prevState.jugadores?.find(j => j.esYo);
    const yoNext = nextState.jugadores?.find(j => j.esYo);
    if (!yoPrev?.mano?.length || !yoNext?.mano?.length) return;
    if (yoPrev.mano.length !== yoNext.mano.length) return;

    const byId = new Map(yoNext.mano.map(c => [String(c.id), c]));
    const idsNext = new Set(byId.keys());
    if (!yoPrev.mano.every(c => idsNext.has(String(c.id)))) return;

    yoNext.mano = yoPrev.mano.map(c => byId.get(String(c.id)));
}

/** Actualiza bandeja / historial / pilas sin tocar #handCards. */
function actualizarTableroSinMano() {
    if (!gameState || screen !== 'game') return;
    if (!document.getElementById('handCards')) {
        // No hay tablero montado: hace falta render completo cuando se pueda
        return;
    }

    const fase = gameState.faseActual;
    const esMiTurno = gameState.esMiTurno;
    const jugadorTurno = gameState.jugadores.find(j => j.id === gameState.turnoActual);
    const puedeInteractuar = esMiTurno && !gameState.juegoTerminado;

    const badge = document.querySelector('.turn-badge');
    const nameEl = document.querySelector('.turn-player-name');
    const phaseEl = document.querySelector('.turn-phase');
    if (badge) badge.textContent = esMiTurno ? 'Tu turno' : 'Turno';
    if (nameEl) nameEl.textContent = jugadorTurno?.nombre || '';
    if (phaseEl) {
        phaseEl.innerHTML = esMiTurno
            ? `Fase: <strong>${fase === 'ROBO' ? 'ROBAR CARTA' : 'DESCARTAR CARTA'}</strong>`
            : `<strong>Esperando a ${escapeHtml(jugadorTurno?.nombre || 'otro jugador')}…</strong>`;
    }

    const actions = document.querySelector('.player-actions');
    if (actions) actions.classList.toggle('actions-locked', !puedeInteractuar);

    const playersList = document.querySelector('.players-list');
    if (playersList) {
        playersList.innerHTML = gameState.jugadores.map(jugador => `
            <div class="player-item ${jugador.id === gameState.turnoActual ? 'active' : ''}">
                <div class="player-name-wrapper">
                    <span class="player-item-name">${escapeHtml(jugador.nombre)}${jugador.esYo ? ' (tú)' : ''}</span>
                </div>
                <span class="player-cards-count">${jugador.cartasCount} cartas</span>
            </div>
        `).join('');
    }

    const historyList = document.querySelector('.history-list');
    if (historyList) {
        historyList.innerHTML = gameState.historial.map(item => `
            <div class="history-item">${escapeHtml(item.mensaje)}</div>
        `).reverse().join('');
    }

    const deckPileEl = document.getElementById('deckPile');
    if (deckPileEl) {
        const parent = deckPileEl.parentElement;
        const countLabel = parent?.querySelector('.text-muted');
        if (countLabel) countLabel.textContent = `Quedan: ${gameState.mazoRoboCount}`;
    }

    const discardPileEl = document.getElementById('discardPile');
    if (discardPileEl) {
        if (gameState.descarteTop) {
            discardPileEl.innerHTML = renderCardHtml(gameState.descarteTop);
        } else {
            discardPileEl.innerHTML = `<div class="pile-empty">Vacío</div>`;
        }
    }

    const meldsContainerEl = document.getElementById('meldsContainer');
    if (meldsContainerEl) {
        const todosGrupos = gameState.jugadores.reduce((all, player) => {
            return all.concat((player.gruposExpuestos || []).map(g => ({ cartas: g, owner: player.nombre })));
        }, []);
        if (todosGrupos.length > 0) {
            meldsContainerEl.innerHTML = todosGrupos.map(group => `
                <div class="meld-group">
                    <span class="meld-owner">${escapeHtml(group.owner)}</span>
                    <div class="meld-cards">
                        ${group.cartas.map(card => renderCardHtml(card, false)).join('')}
                    </div>
                </div>
            `).join('');
        } else {
            meldsContainerEl.innerHTML = `<span class="text-muted" style="font-size: 0.9rem;">No hay grupos expuestos en la mesa aún.</span>`;
        }
    }

    actualizarEstadoBotones(puedeInteractuar);
}

function flushRenderDiferido() {
    if (!renderDiferidoPorDrag) return;
    if (pointerDrag || animandoFlip) return;
    renderDiferidoPorDrag = false;
    if (screen === 'game' && gameState && !gameState.juegoTerminado) {
        render();
    } else if (gameState?.juegoTerminado) {
        screen = 'victory';
        render();
    }
}

/** Quita fantasma huérfano si un re-render antiguo lo dejó en el body. */
function limpiarFantasmaDragHuerfano() {
    document.querySelectorAll('.card-drag-ghost').forEach(el => el.remove());
    document.body.classList.remove('is-reordering-cards', 'is-drawing-from-deck');
    document.getElementById('handCards')?.classList.remove('hand-drop-hover');
}

/** Cancela drag de mano o mazo y limpia el DOM asociado. */
function cancelarInteraccionPointer() {
    if (pointerDrag?.type === 'deck') {
        cancelarDragDeck();
    } else if (pointerDrag?.type === 'hand') {
        cancelarDragMano();
    }
    limpiarFantasmaDragHuerfano();
    cartaArrastradaId = null;
    indiceOrigenDrag = null;
    indiceDestinoPreview = null;
    reordenYaAplicado = false;
}

function renderHome() {
    appEl.innerHTML = `
        <div class="home-shell">
            <button type="button" id="btnLobbySettings" class="lobby-settings-btn" aria-label="Configuración" title="Configuración" aria-expanded="false" aria-controls="lobbySettingsPanel">
                <svg class="lobby-settings-icon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
                    <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.1 7.1 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.8a.5.5 0 0 0-.49.42l-.36 2.54c-.58.23-1.13.54-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.48a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.83 14.58a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.68.22l2.39-.96c.5.4 1.05.71 1.63.94l.36 2.54c.05.24.25.42.49.42h3.8c.24 0 .44-.18.49-.42l.36-2.54c.58-.23 1.13-.54 1.63-.94l2.39.96c.25.12.54.02.68-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z"/>
                </svg>
            </button>

            <div id="lobbySettingsPanel" class="lobby-settings-panel" hidden>
                <h3 class="lobby-settings-title">Partidas de prueba</h3>
                <p class="lobby-settings-desc">Partidas resueltas para mirar la tabla, o Custom para armar una a mano.</p>
                <div class="debug-scenarios">
                    ${DEBUG_SCENARIOS.map(s => `
                        <button type="button" class="btn-secondary btn-debug-scenario" data-scenario="${escapeAttr(s.id)}" title="${escapeAttr(s.hint)}">
                            ${escapeHtml(s.label)}
                        </button>
                    `).join('')}
                </div>
            </div>

            <div class="lobby-container">
                <h1 class="lobby-logo">Golpeado</h1>
                <p class="lobby-subtitle">Multijugador en tiempo real</p>

                <div class="form-group">
                    <label for="playerName">Tu nombre</label>
                    <input type="text" id="playerName" value="Jugador" placeholder="Ej. Carlos" maxlength="24">
                </div>

                <button id="btnPlayVsBots" class="btn-primary">Jugar contra bots</button>
                <p class="text-muted room-hint">Partida rápida sola: tú + 1 bot</p>

                <div class="lobby-divider"><span>o juega con personas</span></div>

                <button id="btnCreateRoom" class="btn-secondary btn-add-player">Crear sala</button>

                <div class="form-group" style="margin-top: 1rem;">
                    <label for="roomCode">Código de sala (4 dígitos)</label>
                    <input type="text" id="roomCode" inputmode="numeric" maxlength="4" placeholder="1234" class="room-code-input">
                </div>

                <button id="btnJoinRoom" class="btn-secondary btn-add-player">Unirse a sala</button>

                <p id="homeError" class="lobby-error" hidden></p>
            </div>
        </div>
    `;

    const showError = (msg) => {
        const el = document.getElementById('homeError');
        el.hidden = !msg;
        el.textContent = msg || '';
    };

    const settingsBtn = document.getElementById('btnLobbySettings');
    const settingsPanel = document.getElementById('lobbySettingsPanel');
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        playSound('click');
        const open = settingsPanel.hidden;
        settingsPanel.hidden = !open;
        settingsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
        settingsBtn.classList.toggle('is-open', open);
    });

    document.getElementById('btnPlayVsBots').addEventListener('click', () => {
        playSound('click');
        const nombre = document.getElementById('playerName').value.trim() || 'Jugador';
        showError('');
        socket.emit('playVsBots', { nombre, numBots: 1 }, (res) => {
            if (!res?.ok) showError(res?.error || 'No se pudo iniciar vs bots');
        });
    });

    document.querySelectorAll('.btn-debug-scenario').forEach(btn => {
        btn.addEventListener('click', () => {
            playSound('click');
            const scenarioId = btn.dataset.scenario;
            const meta = DEBUG_SCENARIOS.find(s => s.id === scenarioId);
            const nombre = document.getElementById('playerName').value.trim() || 'Jugador';
            showError('');

            if (meta?.opensForm) {
                customDebugPlayerName = nombre;
                screen = 'customDebug';
                render();
                return;
            }

            socket.emit('playDebugScenario', { nombre, scenarioId }, (res) => {
                if (!res?.ok) showError(res?.error || 'No se pudo cargar el escenario');
            });
        });
    });

    document.getElementById('btnCreateRoom').addEventListener('click', () => {
        playSound('click');
        const nombre = document.getElementById('playerName').value.trim() || 'Anfitrión';
        showError('');
        socket.emit('createRoom', { nombre }, (res) => {
            if (!res?.ok) showError(res?.error || 'No se pudo crear la sala');
        });
    });

    document.getElementById('btnJoinRoom').addEventListener('click', () => {
        playSound('click');
        const nombre = document.getElementById('playerName').value.trim() || 'Jugador';
        const code = document.getElementById('roomCode').value.trim();
        if (!/^\d{4}$/.test(code)) {
            showError('Ingresa un código de 4 dígitos');
            return;
        }
        showError('');
        socket.emit('joinRoom', { code, nombre }, (res) => {
            if (!res?.ok) showError(res?.error || 'No se pudo unir');
        });
    });

    document.getElementById('roomCode').addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    });
}

function renderCustomDebugForm() {
    const suitCycle = [
        { key: 'H', label: '♥', cls: 'suit-red' },
        { key: 'S', label: '♠', cls: 'suit-black' },
        { key: 'D', label: '♦', cls: 'suit-red' },
        { key: 'C', label: '♣', cls: 'suit-black' },
        { key: '?', label: '?', cls: 'suit-random' }
    ];
    const rankOptions = [
        ['?', '?'],
        ['1', 'A'], ['2', '2'], ['3', '3'], ['4', '4'], ['5', '5'], ['6', '6'],
        ['7', '7'], ['8', '8'], ['9', '9'], ['10', '10'], ['11', 'J'], ['12', 'Q'], ['13', 'K']
    ];

    const rankSelectHtml = () => rankOptions.map(([v, lab]) =>
        `<option value="${v}">${lab}</option>`
    ).join('');

    const pickerHtml = (group, index) => `
        <div class="card-picker" data-group="${escapeAttr(group)}" data-index="${index}">
            <select class="card-picker-rank" aria-label="Valor de carta">${rankSelectHtml()}</select>
            <button type="button" class="card-picker-suit suit-random" data-suit="?" title="Clic para cambiar palo" aria-label="Palo">?</button>
        </div>
    `;

    appEl.innerHTML = `
        <div class="custom-debug-page">
            <div class="custom-debug-box">
                <div class="custom-debug-header">
                    <h1 class="custom-debug-title">Partida custom</h1>
                    <button type="button" id="btnCustomBack" class="btn-secondary btn-custom-back">Volver</button>
                </div>
                <p class="custom-debug-lead">
                    Al elegir valor <strong>o</strong> palo aparece el siguiente selector.
                    Máximo 8; si uno llega a 8, el otro solo puede llegar a 7.
                    Con más de 2 selectores: deslizá o clic derecho para borrarlos.
                    Si hay 1–2: el vacío no se borra; uno con valor/palo se limpia.
                    Si formás un grupo (mismo número ×3/4 o escalera), las cartas se resaltan
                    y aparece un botón junto al contador para marcarlo como <strong>en mano</strong> o <strong>en mesa</strong>.
                    No se puede repetir la misma carta (palo+valor): el ciclo de palo salta duplicados
                    y el select deshabilita valores ya usados con ese palo.
                </p>

                <div class="custom-debug-grid">
                    <section class="custom-debug-section">
                        <h2 class="custom-hand-heading">
                            Tus cartas
                            <span class="custom-hand-count" id="countMi">0/8</span>
                            <span class="custom-group-toggles" id="groupTogglesMi"></span>
                        </h2>
                        <div class="card-picker-grid" id="pickersMiMano"></div>
                    </section>

                    <section class="custom-debug-section">
                        <h2 class="custom-hand-heading">
                            Rival
                            <span class="custom-hand-count" id="countRival">0/8</span>
                            <span class="custom-group-toggles" id="groupTogglesRival"></span>
                        </h2>
                        <div class="card-picker-grid" id="pickersRivalMano"></div>
                    </section>

                    <section class="custom-debug-section custom-debug-section-full">
                        <h2>Mazo y reglas</h2>
                        <div class="custom-debug-row">
                            <div>
                                <label class="custom-label">Última carta del descarte</label>
                                <div class="card-picker-grid card-picker-grid-single" id="pickersDescarte">${pickerHtml('descarte', 0)}</div>
                            </div>
                            <div>
                                <label class="custom-label" for="cfgMazoRestante">Cartas restantes en mazo de robo</label>
                                <input type="number" id="cfgMazoRestante" min="0" max="52" placeholder="Vacío = máximo disponible">
                            </div>
                        </div>
                        <label class="custom-label">Próximas del mazo <span class="custom-hand-count" id="countProxima">0</span></label>
                        <div class="card-picker-grid" id="pickersProximas"></div>
                        <div class="custom-debug-checks">
                            <label class="custom-check">
                                <input type="checkbox" id="cfgColor" checked>
                                Habilitar victoria por Color
                            </label>
                            <label class="custom-check">
                                <input type="checkbox" id="cfgPoker" checked>
                                Habilitar victoria por Póker
                            </label>
                        </div>
                    </section>
                </div>

                <p id="customDebugError" class="lobby-error" hidden></p>
                <button type="button" id="btnCustomStart" class="btn-primary custom-debug-start">Iniciar partida</button>
            </div>
        </div>
    `;

    const showError = (msg) => {
        const el = document.getElementById('customDebugError');
        el.hidden = !msg;
        el.textContent = msg || '';
    };

    /** lugar por clave de grupo detectado: 'mano' | 'mesa' */
    const groupLugar = {
        mi: new Map(),
        rival: new Map()
    };

    const GROUP_COLORS = ['#22d3ee', '#34d399', '#fbbf24', '#fb7185'];

    const tipoLabel = (tipo) => {
        if (tipo === 'poker') return 'Póker';
        if (tipo === 'trio') return 'Trío';
        if (tipo === 'escalera') return 'Escalera';
        return 'Grupo';
    };

    const applySuitVisual = (btn, suitKey) => {
        const next = suitCycle.find(s => s.key === suitKey) || suitCycle[suitCycle.length - 1];
        btn.dataset.suit = next.key;
        btn.textContent = next.label;
        btn.className = `card-picker-suit ${next.cls}`;
    };

    /** Códigos completos ya usados (palo+valor), excluyendo un picker. */
    const getTakenCodes = (exceptEl = null) => {
        const taken = new Set();
        appEl.querySelectorAll('.card-picker').forEach(p => {
            if (exceptEl && p === exceptEl) return;
            if (!isComplete(p)) return;
            const rank = p.querySelector('.card-picker-rank')?.value;
            const suit = p.querySelector('.card-picker-suit')?.dataset.suit;
            if (rank && suit) taken.add(`${suit}${rank}`);
        });
        return taken;
    };

    /**
     * Caso 1: ciclar palo saltando combinaciones ya existentes
     * (solo aplica si el valor ya está elegido).
     */
    const cycleSuitSkippingDupes = (pickerEl, btn) => {
        const rank = pickerEl.querySelector('.card-picker-rank')?.value;
        const taken = getTakenCodes(pickerEl);
        const start = suitCycle.findIndex(s => s.key === btn.dataset.suit);
        const from = start >= 0 ? start : suitCycle.length - 1;

        for (let step = 1; step <= suitCycle.length; step++) {
            const next = suitCycle[(from + step) % suitCycle.length];
            if (rank && rank !== '?' && next.key !== '?') {
                if (taken.has(`${next.key}${rank}`)) continue;
            }
            applySuitVisual(btn, next.key);
            return;
        }
        applySuitVisual(btn, '?');
    };

    /**
     * Caso 2: con palo fijado, deshabilitar valores que formen carta duplicada.
     */
    const refreshRankOptions = (pickerEl) => {
        const select = pickerEl.querySelector('.card-picker-rank');
        const suitBtn = pickerEl.querySelector('.card-picker-suit');
        if (!select || !suitBtn) return;

        const suit = suitBtn.dataset.suit;
        const taken = getTakenCodes(pickerEl);
        const prev = select.value;

        [...select.options].forEach(opt => {
            if (opt.value === '?') {
                opt.disabled = false;
                return;
            }
            if (suit && suit !== '?') {
                opt.disabled = taken.has(`${suit}${opt.value}`);
            } else {
                opt.disabled = false;
            }
        });

        // Si el valor actual quedó bloqueado, volver a ?
        const currentOpt = [...select.options].find(o => o.value === select.value);
        if (currentOpt?.disabled) {
            select.value = '?';
        } else if (prev && prev !== select.value) {
            // noop
        }
    };

    const refreshAllDuplicateGuards = () => {
        appEl.querySelectorAll('.card-picker').forEach(refreshRankOptions);
    };

    const isComplete = (el) => {
        const rank = el.querySelector('.card-picker-rank')?.value;
        const suit = el.querySelector('.card-picker-suit')?.dataset.suit;
        return rank && rank !== '?' && suit && suit !== '?';
    };

    /** Empezó a elegirse: valor o palo (cualquiera de los dos). */
    const isStarted = (el) => {
        const rank = el.querySelector('.card-picker-rank')?.value;
        const suit = el.querySelector('.card-picker-suit')?.dataset.suit;
        return (rank && rank !== '?') || (suit && suit !== '?');
    };

    const countStarted = (group) =>
        [...appEl.querySelectorAll(`.card-picker[data-group="${group}"]`)].filter(isStarted).length;

    const countComplete = (group) =>
        [...appEl.querySelectorAll(`.card-picker[data-group="${group}"]`)].filter(isComplete).length;

    const maxFor = (group) => {
        if (group === 'proxima') return 12;
        if (group === 'mi') return countStarted('rival') >= 8 ? 7 : 8;
        if (group === 'rival') return countStarted('mi') >= 8 ? 7 : 8;
        return 1;
    };

    const bindPicker = (el) => {
        const rank = el.querySelector('.card-picker-rank');
        const suitBtn = el.querySelector('.card-picker-suit');
        let ignoreSuitClick = false;

        const clearPicker = (pickerEl) => {
            const r = pickerEl.querySelector('.card-picker-rank');
            const s = pickerEl.querySelector('.card-picker-suit');
            if (r) r.value = '?';
            if (s) {
                s.dataset.suit = '?';
                s.textContent = '?';
                s.className = 'card-picker-suit suit-random';
            }
            refreshRankOptions(pickerEl);
        };

        /**
         * Swipe / clic derecho:
         * - descarte: siempre limpia
         * - >2 selectores: elimina cualquiera
         * - ≤2: vacío → no hace nada; con valor/palo → limpia (no elimina)
         * @returns {boolean} true si hubo acción
         */
        const removeOrClearPicker = (pickerEl) => {
            const group = pickerEl.dataset.group;

            if (group === 'descarte') {
                if (!isStarted(pickerEl)) return false;
                clearPicker(pickerEl);
                refreshAllDuplicateGuards();
                return true;
            }

            const container = pickerEl.parentElement;
            if (!container) return false;
            const count = container.querySelectorAll('.card-picker').length;

            if (count > 2) {
                pickerEl.remove();
                syncHandGroup(group);
                return true;
            }

            // 1 o 2 selectores: no eliminar; solo limpiar si tiene datos
            if (!isStarted(pickerEl)) return false;
            clearPicker(pickerEl);
            syncHandGroup(group);
            return true;
        };

        rank.addEventListener('change', () => {
            playSound('select');
            // Si el palo actual + nuevo valor es duplicado, saltar el palo
            const suit = suitBtn.dataset.suit;
            const val = rank.value;
            if (suit && suit !== '?' && val && val !== '?') {
                const taken = getTakenCodes(el);
                if (taken.has(`${suit}${val}`)) {
                    applySuitVisual(suitBtn, '?');
                }
            }
            syncHandGroup(el.dataset.group);
            refreshAllDuplicateGuards();
        });
        // Al abrir el select, refrescar opciones deshabilitadas (caso 2)
        rank.addEventListener('focus', () => refreshRankOptions(el));
        rank.addEventListener('mousedown', () => refreshRankOptions(el));

        suitBtn.addEventListener('click', (e) => {
            if (ignoreSuitClick) {
                ignoreSuitClick = false;
                e.preventDefault();
                e.stopPropagation();
                return;
            }
            playSound('click');
            cycleSuitSkippingDupes(el, suitBtn);
            syncHandGroup(el.dataset.group);
            refreshAllDuplicateGuards();
        });

        // Clic derecho → misma acción que swipe, sin efecto visual
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (removeOrClearPicker(el)) {
                playSound('discard');
            }
        });

        // Swipe en cualquier dirección → borrar / limpiar (con aviso rojo)
        const SWIPE_ARM_PX = 14;
        const SWIPE_DELETE_PX = 42;
        let swipe = null; // { pointerId, x0, y0, active, fromControl }

        const resetSwipeVisual = () => {
            el.classList.remove('card-picker-swipe-warn');
            el.style.transform = '';
            el.style.opacity = '';
        };

        el.addEventListener('pointerdown', (e) => {
            if (e.pointerType === 'mouse' && e.button !== 0) return;
            const fromControl = !!e.target.closest('.card-picker-suit, .card-picker-rank');
            swipe = {
                pointerId: e.pointerId,
                x0: e.clientX,
                y0: e.clientY,
                active: false,
                fromControl
            };
            // No capturar aquí: en Chrome cancela el click del palo/select.
        });

        el.addEventListener('pointermove', (e) => {
            if (!swipe || e.pointerId !== swipe.pointerId) return;
            const dx = e.clientX - swipe.x0;
            const dy = e.clientY - swipe.y0;
            const dist = Math.hypot(dx, dy);
            if (dist < SWIPE_ARM_PX) return;

            // Clic de mouse en palo/valor: no convertir micro-movimientos en swipe
            if (swipe.fromControl && e.pointerType === 'mouse') return;

            if (!swipe.active) {
                swipe.active = true;
                try { el.setPointerCapture(e.pointerId); } catch (_) {}
                if (document.activeElement === rank) rank.blur();
            }

            e.preventDefault();
            const warn = dist >= SWIPE_DELETE_PX;
            el.classList.toggle('card-picker-swipe-warn', warn);
            const k = 0.4;
            el.style.transform = `translate(${dx * k}px, ${dy * k}px) scale(${warn ? 0.96 : 1})`;
            el.style.opacity = warn ? '0.85' : '1';
        });

        const endSwipe = (e) => {
            if (!swipe || e.pointerId !== swipe.pointerId) return;
            const dx = e.clientX - swipe.x0;
            const dy = e.clientY - swipe.y0;
            const dist = Math.hypot(dx, dy);
            const wasActive = swipe.active;
            const shouldAct = wasActive && dist >= SWIPE_DELETE_PX;
            swipe = null;
            try { el.releasePointerCapture(e.pointerId); } catch (_) {}

            resetSwipeVisual();

            if (!shouldAct) return;

            ignoreSuitClick = true;
            window.setTimeout(() => { ignoreSuitClick = false; }, 80);

            if (removeOrClearPicker(el)) {
                playSound('discard');
            }
        };

        el.addEventListener('pointerup', endSwipe);
        el.addEventListener('pointercancel', endSwipe);
    };

    const addPicker = (group, container) => {
        const index = container.querySelectorAll('.card-picker').length;
        container.insertAdjacentHTML('beforeend', pickerHtml(group, index));
        const el = container.lastElementChild;
        bindPicker(el);
        return el;
    };

    const enforceMaxAndEmptySlot = (group, container) => {
        const max = maxFor(group);
        let pickers = [...container.querySelectorAll('.card-picker')];

        // Si pasamos el tope de “empezados”, quitar el último empezado
        while (countStarted(group) > max) {
            const started = [...container.querySelectorAll('.card-picker')].filter(isStarted);
            const last = started[started.length - 1];
            if (!last) break;
            last.remove();
        }

        pickers = [...container.querySelectorAll('.card-picker')];
        const idle = pickers.filter(p => !isStarted(p));
        // Un solo vacío al final
        idle.slice(0, -1).forEach(p => p.remove());

        pickers = [...container.querySelectorAll('.card-picker')];
        const started = countStarted(group);
        const hasIdle = pickers.some(p => !isStarted(p));

        if (started < max && !hasIdle) {
            addPicker(group, container);
        }
        if (pickers.length === 0) {
            addPicker(group, container);
        }
    };

    const collectSlots = (group) => {
        const slots = [];
        appEl.querySelectorAll(`.card-picker[data-group="${group}"]`).forEach(el => {
            if (!isStarted(el)) return;
            const rank = el.querySelector('.card-picker-rank').value;
            const suit = el.querySelector('.card-picker-suit').dataset.suit;
            slots.push({
                suit: suit && suit !== '?' ? suit : null,
                value: rank && rank !== '?' ? Number(rank) : null
            });
        });
        return slots;
    };

    /** Texto de respaldo: H5, H?, ?10 (el servidor también lo entiende). */
    const collectCodes = (group) => {
        return collectSlots(group)
            .map(s => `${s.suit || '?'}${s.value != null ? s.value : '?'}`)
            .join(' ');
    };

    const collectGruposDetectados = (handKey) => {
        const slots = collectSlots(handKey);
        const detected = detectarGruposEnSlots(slots);
        const lugarMap = groupLugar[handKey];
        return detected.map(g => {
            const key = claveGrupoSlots(slots, g.indices, g.tipo);
            return {
                indices: g.indices,
                key,
                tipo: g.tipo,
                lugar: lugarMap.get(key) || 'mano'
            };
        });
    };

    const refreshDetectedGroups = (handKey) => {
        if (handKey !== 'mi' && handKey !== 'rival') return;

        const container = document.getElementById(handKey === 'mi' ? 'pickersMiMano' : 'pickersRivalMano');
        const togglesEl = document.getElementById(handKey === 'mi' ? 'groupTogglesMi' : 'groupTogglesRival');
        if (!container || !togglesEl) return;

        const pickers = [...container.querySelectorAll('.card-picker')].filter(isStarted);
        pickers.forEach(p => {
            p.classList.remove('card-picker-in-group', 'card-picker-group-mesa', 'card-picker-group-mano');
            p.style.removeProperty('--group-glow');
            delete p.dataset.groupKey;
        });

        const slots = collectSlots(handKey);
        const detected = detectarGruposEnSlots(slots);
        const lugarMap = groupLugar[handKey];
        const keyed = detected.map(g => ({
            ...g,
            key: claveGrupoSlots(slots, g.indices, g.tipo)
        }));
        const alive = new Set(keyed.map(g => g.key));
        for (const k of [...lugarMap.keys()]) {
            if (!alive.has(k)) lugarMap.delete(k);
        }

        togglesEl.innerHTML = keyed.map((g, gi) => {
            const color = GROUP_COLORS[gi % GROUP_COLORS.length];
            const lugar = lugarMap.get(g.key) || 'mano';
            if (!lugarMap.has(g.key)) lugarMap.set(g.key, 'mano');
            for (const idx of g.indices) {
                const el = pickers[idx];
                if (!el) continue;
                el.classList.add('card-picker-in-group');
                el.classList.add(lugar === 'mesa' ? 'card-picker-group-mesa' : 'card-picker-group-mano');
                el.style.setProperty('--group-glow', color);
                el.dataset.groupKey = g.key;
            }
            const label = `${tipoLabel(g.tipo)} · ${lugar === 'mesa' ? 'en mesa' : 'en mano'}`;
            return `<button type="button" class="custom-group-toggle" data-hand="${handKey}" data-gkey="${escapeAttr(g.key)}" style="--group-glow:${color}" title="Clic para alternar mano/mesa">${escapeHtml(label)}</button>`;
        }).join('');

        togglesEl.querySelectorAll('.custom-group-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                playSound('click');
                const key = btn.dataset.gkey;
                const cur = lugarMap.get(key) || 'mano';
                const next = cur === 'mano' ? 'mesa' : 'mano';
                lugarMap.set(key, next);
                refreshDetectedGroups(handKey);
            });
        });
    };

    const syncHandGroup = (group) => {
        if (group === 'descarte') return;

        const containerId = group === 'mi'
            ? 'pickersMiMano'
            : group === 'rival'
                ? 'pickersRivalMano'
                : 'pickersProximas';
        const container = document.getElementById(containerId);
        if (!container) return;

        enforceMaxAndEmptySlot(group, container);

        if (group === 'mi') {
            document.getElementById('countMi').textContent =
                `${countStarted('mi')}/${maxFor('mi')}`;
            enforceMaxAndEmptySlot('rival', document.getElementById('pickersRivalMano'));
            document.getElementById('countRival').textContent =
                `${countStarted('rival')}/${maxFor('rival')}`;
            document.getElementById('countMi').textContent =
                `${countStarted('mi')}/${maxFor('mi')}`;
            refreshDetectedGroups('mi');
            refreshDetectedGroups('rival');
            refreshAllDuplicateGuards();
            return;
        }
        if (group === 'rival') {
            document.getElementById('countRival').textContent =
                `${countStarted('rival')}/${maxFor('rival')}`;
            enforceMaxAndEmptySlot('mi', document.getElementById('pickersMiMano'));
            document.getElementById('countMi').textContent =
                `${countStarted('mi')}/${maxFor('mi')}`;
            document.getElementById('countRival').textContent =
                `${countStarted('rival')}/${maxFor('rival')}`;
            refreshDetectedGroups('mi');
            refreshDetectedGroups('rival');
            refreshAllDuplicateGuards();
            return;
        }
        if (group === 'proxima') {
            document.getElementById('countProxima').textContent = String(countStarted('proxima'));
            refreshAllDuplicateGuards();
        }
    };

    // Estado inicial: un selector vacío por mano + próximas
    addPicker('mi', document.getElementById('pickersMiMano'));
    addPicker('rival', document.getElementById('pickersRivalMano'));
    addPicker('proxima', document.getElementById('pickersProximas'));
    bindPicker(document.querySelector('#pickersDescarte .card-picker'));
    document.getElementById('countMi').textContent = `0/${maxFor('mi')}`;
    document.getElementById('countRival').textContent = `0/${maxFor('rival')}`;

    document.getElementById('btnCustomBack').addEventListener('click', () => {
        playSound('click');
        screen = 'home';
        render();
    });

    document.getElementById('btnCustomStart').addEventListener('click', () => {
        playSound('click');
        showError('');
        const mazoRaw = document.getElementById('cfgMazoRestante').value.trim();
        const descarteSlots = collectSlots('descarte');
        const config = {
            miManoSlots: collectSlots('mi'),
            rivalManoSlots: collectSlots('rival'),
            mazoProximasSlots: collectSlots('proxima'),
            descarteSlot: descarteSlots[0] || null,
            miMano: collectCodes('mi'),
            rivalMano: collectCodes('rival'),
            mazoProximas: collectCodes('proxima'),
            descarteTop: collectCodes('descarte'),
            miGruposDetectados: collectGruposDetectados('mi'),
            rivalGruposDetectados: collectGruposDetectados('rival'),
            mazoRestante: mazoRaw === '' ? null : Number(mazoRaw),
            permitirVictoriaColor: document.getElementById('cfgColor').checked,
            permitirVictoriaPoker: document.getElementById('cfgPoker').checked
        };

        if (countStarted('mi') === 8 && countStarted('rival') === 8) {
            showError('Solo uno puede tener 8 cartas.');
            return;
        }

        socket.emit('playCustomDebug', { nombre: customDebugPlayerName, config }, (res) => {
            if (!res?.ok) {
                showError(res?.error || 'No se pudo iniciar el custom');
            }
        });
    });
}

function renderRoom() {
    if (!roomState) return renderHome();

    const playersHtml = roomState.players.map(p => `
        <div class="player-item ${p.esYo ? 'active' : ''}">
            <div class="player-name-wrapper">
                <span class="player-item-name">${escapeHtml(p.nombre)}</span>
                ${p.esHost ? '<span class="host-badge">Anfitrión</span>' : ''}
                ${p.esYo ? '<span class="you-badge">Tú</span>' : ''}
                ${p.esBot ? '<span class="bot-badge">Bot</span>' : ''}
            </div>
            <span class="player-cards-count">${p.esBot ? 'Bot' : (p.conectado ? 'Listo' : 'Ausente')}</span>
        </div>
    `).join('');

    appEl.innerHTML = `
        <div class="lobby-container lobby-room">
            <h1 class="lobby-logo">Golpeado</h1>
            <p class="lobby-subtitle">Sala de espera</p>

            <div class="room-code-display">
                <span class="room-code-label">Código</span>
                <span class="room-code-value">${escapeHtml(roomState.code)}</span>
                <p class="room-code-hint">Compártelo para personas, o agrega bots para practicar</p>
            </div>

            <div class="panel room-players-panel">
                <h3 class="panel-title">Jugadores (${roomState.players.length}/${roomState.maxPlayers})</h3>
                <div class="players-list">${playersHtml}</div>
            </div>

            ${roomState.yoSoyHost ? `
                <button id="btnAddBot" class="btn-secondary btn-add-player" ${roomState.puedeAgregarBot ? '' : 'disabled'}>
                    + Agregar bot
                </button>
                <button id="btnStartGame" class="btn-primary" ${roomState.puedeEmpezar ? '' : 'disabled'}>
                    Comenzar partida
                </button>
                <p class="text-muted room-hint">${roomState.puedeEmpezar ? 'Listo para empezar' : `Mínimo ${roomState.minPlayers} (personas o bots)`}</p>
            ` : `
                <p class="text-muted room-hint">Esperando a que el anfitrión inicie la partida…</p>
            `}

            <button id="btnLeaveRoom" class="btn-secondary btn-add-player">Salir de la sala</button>
            <p id="roomError" class="lobby-error" hidden></p>
        </div>
    `;

    document.getElementById('btnLeaveRoom').addEventListener('click', () => {
        socket.emit('leaveRoom');
        roomState = null;
        gameState = null;
        screen = 'home';
        render();
    });

    const btnAddBot = document.getElementById('btnAddBot');
    if (btnAddBot) {
        btnAddBot.addEventListener('click', () => {
            const errEl = document.getElementById('roomError');
            socket.emit('addBot', (res) => {
                if (!res?.ok) {
                    errEl.hidden = false;
                    errEl.textContent = res?.error || 'No se pudo agregar bot';
                }
            });
        });
    }

    const btnStart = document.getElementById('btnStartGame');
    if (btnStart) {
        btnStart.addEventListener('click', () => {
            const errEl = document.getElementById('roomError');
            socket.emit('startGame', (res) => {
                if (!res?.ok) {
                    errEl.hidden = false;
                    errEl.textContent = res?.error || 'No se pudo iniciar';
                }
            });
        });
    }
}

function renderBoard() {
    if (!gameState) {
        if (roomState?.status === 'lobby') return renderRoom();
        return renderHome();
    }

    const fase = gameState.faseActual;
    const esMiTurno = gameState.esMiTurno;
    const jugadorTurno = gameState.jugadores.find(j => j.id === gameState.turnoActual);
    const yo = gameState.jugadores.find(j => j.esYo);
    const mano = yo?.mano || [];

    const puedeInteractuar = esMiTurno && !gameState.juegoTerminado;

    appEl.innerHTML = `
        <div class="game-container">
            <div id="actionToast" class="action-toast"></div>
            <div class="board-area">
                <div class="turn-banner">
                    <div class="turn-player-info">
                        <span class="turn-badge">${esMiTurno ? 'Tu turno' : 'Turno'}</span>
                        <span class="turn-player-name">${escapeHtml(jugadorTurno?.nombre || '')}</span>
                    </div>
                    <div class="turn-phase">
                        ${esMiTurno
                            ? `Fase: <strong>${fase === 'ROBO' ? 'ROBAR CARTA' : 'DESCARTAR CARTA'}</strong>`
                            : `<strong>Esperando a ${escapeHtml(jugadorTurno?.nombre || 'otro jugador')}…</strong>`
                        }
                    </div>
                    <button type="button" id="btnDownloadReportLive" class="btn-report-live" title="Descargar estado actual de la partida">
                        Descargar estado
                    </button>
                </div>
                <p id="reportStatus" class="report-status-live text-muted" hidden></p>

                ${roomState ? `<div class="room-chip">Sala <strong>${escapeHtml(roomState.code)}</strong></div>` : ''}

                <div class="pile-zone">
                    <div class="pile-container">
                        <span class="pile-label">Mazo de Robo</span>
                        <div id="deckPile" class="card card-back ${puedeRobarDeMazo() ? 'interactive-card deck-draggable' : ''}"></div>
                        <span class="text-muted" style="font-size: 0.8rem;">Quedan: ${gameState.mazoRoboCount}</span>
                    </div>
                    <div class="pile-container">
                        <span class="pile-label">Mazo de Descarte</span>
                        <div id="discardPile"></div>
                    </div>
                </div>

                <div class="table-melds-section">
                    <h3 class="section-title">Grupos Expuestos en Mesa</h3>
                    <div id="meldsContainer" class="melds-container"></div>
                </div>

                <div class="player-dashboard">
                    <div class="dashboard-header">
                        <h2 class="dashboard-title">Tus Cartas (${escapeHtml(yo?.nombre || '')})</h2>
                        <div class="player-actions ${puedeInteractuar ? '' : 'actions-locked'}">
                            <button id="btnRobarDescarte" class="btn-success" style="display: none;">Robar Descarte</button>
                            <button id="btnDescartar" class="btn-primary" disabled>Descartar Selección</button>
                            <button id="btnCantarPuntos" class="btn-secondary">Cantar por Puntos</button>
                        </div>
                    </div>
                    <div id="handCards" class="hand-cards-container"></div>
                </div>
            </div>

            <div class="sidebar-area">
                <div class="panel">
                    <h3 class="panel-title">Jugadores</h3>
                    <div class="players-list">
                        ${gameState.jugadores.map(jugador => `
                            <div class="player-item ${jugador.id === gameState.turnoActual ? 'active' : ''}">
                                <div class="player-name-wrapper">
                                    <span class="player-item-name">${escapeHtml(jugador.nombre)}${jugador.esYo ? ' (tú)' : ''}</span>
                                </div>
                                <span class="player-cards-count">${jugador.cartasCount} cartas</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="panel">
                    <h3 class="panel-title">Historial</h3>
                    <div class="history-list">
                        ${gameState.historial.map(item => `
                            <div class="history-item">${escapeHtml(item.mensaje)}</div>
                        `).reverse().join('')}
                    </div>
                </div>
            </div>
        </div>
    `;

    // Mazo: click y drag-to-draw (solo si se puede robar)
    const deckPileEl = document.getElementById('deckPile');
    if (puedeRobarDeMazo()) {
        deckPileEl.addEventListener('click', () => {
            if (ignorarClickTrasDrag) return;
            cartasSeleccionadasIds = [];
            enviarAccion('ROBAR_MAZO');
        });
        inicializarDragRoboMazo(deckPileEl);
    }

    // Mano: drop target para carta robada del mazo
    const handCardsEl = document.getElementById('handCards');
    if (handCardsEl) {
        handCardsEl.classList.toggle('hand-drop-ready', puedeRobarDeMazo());
    }

    // Descarte
    const discardPileEl = document.getElementById('discardPile');
    if (gameState.descarteTop) {
        discardPileEl.innerHTML = renderCardHtml(gameState.descarteTop);
        if (puedeInteractuar && fase === 'ROBO') {
            const cardEl = discardPileEl.querySelector('.card');
            cardEl.classList.add('interactive-card');
            cardEl.addEventListener('click', () => {
                solicitarRoboDescarte(gameState.descarteTop);
            });
        }
    } else {
        discardPileEl.innerHTML = `<div class="pile-empty">Vacío</div>`;
    }

    // Melds
    const meldsContainerEl = document.getElementById('meldsContainer');
    const todosGrupos = gameState.jugadores.reduce((all, player) => {
        return all.concat((player.gruposExpuestos || []).map(g => ({ cartas: g, owner: player.nombre })));
    }, []);

    if (todosGrupos.length > 0) {
        meldsContainerEl.innerHTML = todosGrupos.map(group => `
            <div class="meld-group">
                <span class="meld-owner">${escapeHtml(group.owner)}</span>
                <div class="meld-cards">
                    ${group.cartas.map(card => renderCardHtml(card, false)).join('')}
                </div>
            </div>
        `).join('');
    } else {
        meldsContainerEl.innerHTML = `<span class="text-muted" style="font-size: 0.9rem;">No hay grupos expuestos en la mesa aún.</span>`;
    }

    // Mano: siempre se puede reordenar; acciones de juego solo en tu turno
    renderManoLocal({
        puedeSeleccionar: puedeInteractuar,
        puedeReordenar: !gameState.juegoTerminado
    });

    document.getElementById('btnDescartar').addEventListener('click', () => {
        if (!puedeInteractuar || fase !== 'DESCARTE') return;
        if (cartasSeleccionadasIds.length === 1) {
            const cardId = cartasSeleccionadasIds[0];
            cartasSeleccionadasIds = [];
            enviarAccion('DESCARTAR', { cartaId: cardId });
        }
    });

    document.getElementById('btnCantarPuntos').addEventListener('click', () => {
        if (!puedeInteractuar) return;
        const confirmacion = confirm('¿Cantar victoria por puntos y detener el juego?');
        if (confirmacion) enviarAccion('CANTAR_PUNTOS');
    });

    const btnLiveReport = document.getElementById('btnDownloadReportLive');
    if (btnLiveReport) {
        btnLiveReport.addEventListener('click', () => {
            playSound('click');
            descargarInformePartida();
        });
    }

    actualizarEstadoBotones(puedeInteractuar);
}

function renderManoLocal(opts = {}) {
    const puedeSeleccionar = opts.puedeSeleccionar ?? gameState?.esMiTurno;
    const puedeReordenar = opts.puedeReordenar ?? !gameState?.juegoTerminado;
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl || !gameState) return;

    const mano = miMano();
    handCardsEl.dataset.dndBound = '';
    handCardsEl.innerHTML = mano.map(card => {
        const isSelected = cartasSeleccionadasIds.includes(card.id);
        // Interactivas si se puede seleccionar O reordenar (feedback visual)
        const interactive = !!(puedeSeleccionar || puedeReordenar);
        return renderCardHtml(card, interactive, isSelected && !!puedeSeleccionar);
    }).join('');

    if (puedeSeleccionar) {
        handCardsEl.querySelectorAll('.card').forEach(cardEl => {
            cardEl.addEventListener('click', () => {
                if (ignorarClickTrasDrag) return;
                const cardId = cardEl.dataset.id;
                const index = cartasSeleccionadasIds.indexOf(cardId);
                if (index === -1) cartasSeleccionadasIds.push(cardId);
                else cartasSeleccionadasIds.splice(index, 1);
                playSound('select');
                actualizarEstadoBotones(true);
                renderManoLocal({ puedeSeleccionar: true, puedeReordenar });
            });
        });
    }

    if (puedeReordenar) {
        inicializarDragAndDrop();
    }
}

function actualizarEstadoBotones(puedeInteractuar) {
    const btnDescartar = document.getElementById('btnDescartar');
    const btnRobarDescarte = document.getElementById('btnRobarDescarte');
    const btnCantarPuntos = document.getElementById('btnCantarPuntos');
    if (!btnDescartar || !gameState) return;

    const fase = gameState.faseActual;

    if (!puedeInteractuar) {
        btnDescartar.disabled = true;
        btnDescartar.innerText = 'Esperando tu turno';
        if (btnCantarPuntos) {
            btnCantarPuntos.disabled = true;
            btnCantarPuntos.innerText = 'Cantar por Puntos';
        }
        if (btnRobarDescarte) btnRobarDescarte.style.display = 'none';
        return;
    }

    if (fase !== 'DESCARTE') {
        btnDescartar.disabled = true;
        btnDescartar.innerText = 'Descartar (Primero roba)';
    } else if (cartasSeleccionadasIds.length === 1) {
        btnDescartar.disabled = false;
        btnDescartar.innerText = 'Descartar Selección';
    } else {
        btnDescartar.disabled = true;
        btnDescartar.innerText = 'Descartar (Elige 1 carta)';
    }

    if (btnCantarPuntos) {
        if (fase === 'ROBO') {
            btnCantarPuntos.disabled = false;
            btnCantarPuntos.innerText = 'Cantar por Puntos';
        } else {
            btnCantarPuntos.disabled = true;
            btnCantarPuntos.innerText = 'Cantar por Puntos (Bloqueado)';
        }
    }

    if (fase === 'ROBO' && cartasSeleccionadasIds.length >= 2 && gameState.descarteTop) {
        const cartasAsociadas = miMano().filter(c => cartasSeleccionadasIds.includes(c.id));
        const grupo = [gameState.descarteTop, ...cartasAsociadas];
        if (esGrupoValido(grupo)) {
            btnRobarDescarte.style.display = 'inline-block';
            btnRobarDescarte.innerText = 'Robar descarte y bajar grupo';
            btnRobarDescarte.onclick = () => {
                const ids = [...cartasSeleccionadasIds];
                cartasSeleccionadasIds = [];
                enviarAccion('ROBAR_DESCARTE', { cartasIds: ids });
            };
        } else {
            btnRobarDescarte.style.display = 'none';
        }
    } else {
        btnRobarDescarte.style.display = 'none';
    }
}

function solicitarRoboDescarte(topCard) {
    alert(`Para robar ${topCard.label}${topCard.suitLabel}, selecciona ≥2 cartas de tu mano que formen un grupo válido con ella. Luego usa el botón verde.`);
}

function renderCardHtml(card, interactive = false, selected = false) {
    const classInteractive = interactive ? 'interactive-card' : '';
    const classSelected = selected ? 'selected' : '';
    return `
        <div class="card ${card.color} ${classInteractive} ${classSelected}" data-id="${card.id}">
            <div class="card-top">
                <span class="card-value">${card.label}</span>
                <span class="card-suit-mini">${card.suitLabel}</span>
            </div>
            <div class="card-center">${card.suitLabel}</div>
            <div class="card-bottom">
                <span class="card-value">${card.label}</span>
                <span class="card-suit-mini">${card.suitLabel}</span>
            </div>
        </div>
    `;
}

function renderMiniCardHtml(card) {
    return `
        <span class="result-mini-card ${card.color || ''}" title="${escapeAttr((card.label || '') + (card.suitLabel || ''))}">
            <span class="result-mini-value">${escapeHtml(card.label || '')}</span>
            <span class="result-mini-suit">${escapeHtml(card.suitLabel || '')}</span>
        </span>
    `;
}

function renderGruposArmadosHtml(gruposArmados = []) {
    if (!gruposArmados.length) {
        return `<span class="result-empty">Sin grupos</span>`;
    }
    return `
        <div class="result-groups">
            ${gruposArmados.map((g) => {
                const tag = g.etiqueta
                    || (g.origen === 'mesa' ? 'Mesa'
                        : g.origen === 'color' ? 'Color'
                        : g.origen === 'poker' ? 'Póker'
                        : g.origen === 'enchufe' ? 'Enchufe'
                        : 'Mano');
                const title = g.origen === 'color'
                    ? 'Victoria por Color (≥7 mismo palo)'
                    : g.origen === 'poker'
                        ? 'Victoria por Póker (4 iguales)'
                        : g.origen === 'mesa'
                            ? 'Expuesto en mesa'
                            : g.origen === 'enchufe'
                                ? (g.sobreGrupo
                                    ? `Enchufe sobre ${g.sobreGrupo}`
                                    : 'Carta enchufada a un grupo de mesa')
                                : 'Armado en mano';
                const sub = (g.origen === 'enchufe' && g.sobreGrupo)
                    ? `<span class="result-group-sub">sobre ${escapeHtml(g.sobreGrupo)}</span>`
                    : '';
                return `
                <div class="result-group result-group-${escapeAttr(g.origen || 'mano')}" title="${escapeAttr(title)}">
                    <span class="result-group-tag">${escapeHtml(tag)}</span>
                    ${sub}
                    <div class="result-group-cards">
                        ${(g.cartas || []).map(c => renderMiniCardHtml(c)).join('')}
                    </div>
                </div>`;
            }).join('')}
        </div>
    `;
}

function renderVictoryScreen() {
    if (!gameState?.juegoTerminado) return renderBoard();

    const ganador = gameState.jugadores.find(j => j.id === gameState.ganadorId);
    let sub = '¡Final del juego por conteo de puntos!';
    if (gameState.tipoVictoria === 'CERO_MANO') sub = '¡Victoria inmediata con Cero en Mano!';
    if (gameState.tipoVictoria === 'CERO_EXPUESTO') sub = '¡Victoria tras una ronda de espera con Cero en Mesa!';
    if (gameState.tipoVictoria === 'POKER') sub = '¡Victoria inmediata con Póker (4 cartas iguales)!';
    if (gameState.tipoVictoria === 'COLOR') sub = '¡Victoria inmediata con Color (7 del mismo palo)!';

    const resultados = gameState.resultadosVictoria || [];

    let avisoApuestasHtml = '';
    if (gameState.tipoVictoria === 'PUNTOS') {
        const cantor = gameState.jugadores[gameState.turnoActual];
        const cantorGano = gameState.ganadorId === gameState.turnoActual;
        if (cantor && !cantorGano && ganador) {
            avisoApuestasHtml = `
                <div class="victory-warning">
                    El cantor (${escapeHtml(cantor.nombre)}) perdió. Debe pagar el TRIPLE a ${escapeHtml(ganador.nombre)}.
                </div>
            `;
        }
    }

    appEl.innerHTML = `
        <div class="overlay-screen victory-overlay">
            <div class="victory-box">
                <h1 class="victory-title">¡Partida Finalizada!</h1>
                <p class="victory-subtitle">${sub}</p>
                <h2 class="victory-winner">
                    Ganador: <span>${escapeHtml(ganador?.nombre || '')}</span>
                </h2>
                <div class="results-scroll">
                    <table class="results-table results-table-detailed">
                        <thead>
                            <tr>
                                <th>Jugador</th>
                                <th>Grupos armados</th>
                                <th>Cartas sueltas</th>
                                <th>Puntos</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${resultados.map(res => `
                                <tr class="${res.esGanador ? 'winner-row' : 'loser-row'}">
                                    <td class="result-player">
                                        <strong>${escapeHtml(res.nombre)}</strong>
                                        ${res.esGanador ? '<span class="result-badge win">Ganó</span>' : '<span class="result-badge lose">Perdió</span>'}
                                    </td>
                                    <td>${renderGruposArmadosHtml(res.gruposArmados)}</td>
                                    <td>
                                        <span class="result-sueltas">${escapeHtml(res.cartasSueltasText)}</span>
                                    </td>
                                    <td class="result-points"><strong>${res.puntosSueltas}</strong></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
                <div class="victory-actions">
                    <button id="btnDownloadReport" class="btn-secondary victory-report" type="button">
                        Descargar informe de partida
                    </button>
                    ${roomState?.yoSoyHost
                        ? `<button id="btnRestart" class="btn-primary victory-restart" type="button">Volver al lobby</button>`
                        : `<p class="text-muted victory-wait">Esperando al anfitrión…</p>`
                    }
                </div>
                <p id="reportStatus" class="victory-report-status text-muted" hidden></p>
                ${avisoApuestasHtml}
            </div>
        </div>
    `;

    const btnReport = document.getElementById('btnDownloadReport');
    if (btnReport) {
        btnReport.addEventListener('click', () => {
            playSound('click');
            descargarInformePartida();
        });
    }

    const btn = document.getElementById('btnRestart');
    if (btn) {
        btn.addEventListener('click', () => {
            playSound('click');
            socket.emit('returnToLobby', () => {});
        });
    }
}

/**
 * Construye y descarga un JSON del estado (en curso o terminada) para análisis.
 * Prefiere el snapshot del servidor (manos completas); si falla, usa el estado local.
 */
function enriquecerInformeMeta(informe) {
    informe.metaCliente = {
        exportadoEn: new Date().toISOString(),
        sala: roomState ? {
            code: roomState.code,
            status: roomState.status,
            yoSoyHost: !!roomState.yoSoyHost,
            jugadoresLobby: (roomState.players || []).map(p => ({
                nombre: p.nombre,
                esBot: !!p.esBot,
                esHost: !!p.esHost
            }))
        } : null,
        viewer: {
            miIndice: gameState?.miIndice ?? null,
            miNombre: gameState?.jugadores?.find(j => j.esYo)?.nombre ?? null
        },
        uiTablaFinal: gameState?.resultadosVictoria ?? null
    };
    return informe;
}

function construirInformeClienteLocal() {
    return enriquecerInformeMeta({
        version: 1,
        app: 'golpeado-game',
        generadoEn: new Date().toISOString(),
        nota: 'Informe reconstruido en cliente (fallback)',
        enCurso: !gameState?.juegoTerminado,
        resumen: {
            juegoTerminado: !!gameState?.juegoTerminado,
            tipoVictoria: gameState?.tipoVictoria ?? null,
            ganadorId: gameState?.ganadorId ?? null,
            ganadorNombre: gameState?.jugadores?.find(j => j.id === gameState.ganadorId)?.nombre ?? null,
            turnoActual: gameState?.turnoActual ?? null,
            faseActual: gameState?.faseActual ?? null,
            mazoRoboRestante: gameState?.mazoRoboCount ?? null,
            descarteCount: gameState?.descarteCount ?? null,
            descarteTop: gameState?.descarteTop
                ? `${gameState.descarteTop.label}${gameState.descarteTop.suitLabel}`
                : null
        },
        jugadores: (gameState?.jugadores || []).map(j => ({
            id: j.id,
            nombre: j.nombre,
            esGanador: j.id === gameState.ganadorId,
            esYo: !!j.esYo,
            cartasCount: j.cartasCount,
            mano: j.mano,
            manoTexto: (j.mano || []).map(c => `${c.label}${c.suitLabel}`),
            gruposExpuestos: j.gruposExpuestos
        })),
        resultadosVictoria: gameState?.resultadosVictoria ?? null,
        historial: gameState?.historial ?? []
    });
}

function guardarInformeJson(informe) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const tipo = informe.enCurso
        ? 'en-curso'
        : (informe.resumen?.tipoVictoria || 'partida').toLowerCase();
    const filename = `golpeado-informe-${tipo}-${stamp}.json`;
    const blob = new Blob([JSON.stringify(informe, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return filename;
}

function descargarInformePartida() {
    const status = document.getElementById('reportStatus');
    const setStatus = (msg) => {
        if (!status) return;
        status.hidden = !msg;
        status.textContent = msg || '';
    };

    if (!gameState) {
        setStatus('No hay partida para exportar.');
        return;
    }

    socket.emit('exportGameReport', (res) => {
        try {
            const informe = (res?.ok && res.informe)
                ? enriquecerInformeMeta(res.informe)
                : construirInformeClienteLocal();
            if (!res?.ok) {
                informe.nota = (informe.nota ? `${informe.nota} · ` : '') + (res?.error || 'Servidor no entregó snapshot');
            }
            const filename = guardarInformeJson(informe);
            const tip = informe.enCurso ? 'estado en curso' : 'partida finalizada';
            setStatus(`Descargado (${tip}): ${filename}`);
        } catch (err) {
            console.error(err);
            setStatus(err?.message || 'No se pudo descargar el informe.');
        }
    });
}

// ==========================================
// DRAG AND DROP (Pointer Events: desktop + móvil)
// ==========================================

let pointerDrag = null; // { type:'hand'|'deck', pointerId, card, id, startX, startY, dragging, ghost }
let deckDropSobreMano = false;

function inicializarDragAndDrop() {
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl || gameState?.juegoTerminado) return;

    handCardsEl.querySelectorAll('.card').forEach(card => {
        card.setAttribute('draggable', 'false');
        card.style.touchAction = 'none';
        card.addEventListener('pointerdown', onCardPointerDown);
    });
}

function inicializarDragRoboMazo(deckPileEl) {
    if (!deckPileEl || !puedeRobarDeMazo()) return;
    deckPileEl.style.touchAction = 'none';
    deckPileEl.addEventListener('pointerdown', onDeckPointerDown);
}

function onDeckPointerDown(e) {
    if (!puedeRobarDeMazo()) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (pointerDrag) return;

    const card = e.currentTarget;
    pointerDrag = {
        type: 'deck',
        pointerId: e.pointerId,
        card,
        id: 'deck',
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        ghost: null
    };
    deckDropSobreMano = false;

    try { card.setPointerCapture(e.pointerId); } catch (_) {}
    card.addEventListener('pointermove', onDeckPointerMove);
    card.addEventListener('pointerup', onDeckPointerUp);
    card.addEventListener('pointercancel', onDeckPointerUp);
}

function onDeckPointerMove(e) {
    if (!pointerDrag || pointerDrag.type !== 'deck' || e.pointerId !== pointerDrag.pointerId) return;

    const dist = Math.hypot(e.clientX - pointerDrag.startX, e.clientY - pointerDrag.startY);
    if (!pointerDrag.dragging && dist > 12) {
        if (!puedeRobarDeMazo()) {
            cancelarDragDeck();
            return;
        }
        iniciarArrastreDeck(e);
    }
    if (!pointerDrag?.dragging) return;

    e.preventDefault();
    if (pointerDrag.ghost) {
        pointerDrag.ghost.style.left = `${e.clientX}px`;
        pointerDrag.ghost.style.top = `${e.clientY}px`;
    }

    const hand = document.getElementById('handCards');
    const overHand = hand && (() => {
        const r = hand.getBoundingClientRect();
        return e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    })();
    deckDropSobreMano = !!overHand;
    hand?.classList.toggle('hand-drop-hover', deckDropSobreMano);
}

function iniciarArrastreDeck(e) {
    if (!pointerDrag || pointerDrag.dragging) return;
    pointerDrag.dragging = true;
    pointerDrag.card.classList.add('is-dragging');

    const ghost = pointerDrag.card.cloneNode(true);
    ghost.classList.add('card-drag-ghost', 'card-back');
    ghost.classList.remove('is-dragging', 'interactive-card');
    const rect = pointerDrag.card.getBoundingClientRect();
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    document.body.appendChild(ghost);
    pointerDrag.ghost = ghost;
    document.body.classList.add('is-drawing-from-deck');
}

function onDeckPointerUp(e) {
    if (!pointerDrag || pointerDrag.type !== 'deck' || e.pointerId !== pointerDrag.pointerId) return;

    const card = pointerDrag.card;
    const wasDragging = pointerDrag.dragging;
    const dropOk = deckDropSobreMano && puedeRobarDeMazo();

    card.removeEventListener('pointermove', onDeckPointerMove);
    card.removeEventListener('pointerup', onDeckPointerUp);
    card.removeEventListener('pointercancel', onDeckPointerUp);
    try { card.releasePointerCapture(e.pointerId); } catch (_) {}

    if (pointerDrag.ghost) {
        pointerDrag.ghost.remove();
        pointerDrag.ghost = null;
    }
    card.classList.remove('is-dragging');
    document.body.classList.remove('is-drawing-from-deck');
    document.getElementById('handCards')?.classList.remove('hand-drop-hover');

    pointerDrag = null;
    deckDropSobreMano = false;

    if (wasDragging) {
        ignorarClickTrasDrag = true;
        window.setTimeout(() => { ignorarClickTrasDrag = false; }, 80);
        if (dropOk) {
            cartasSeleccionadasIds = [];
            enviarAccion('ROBAR_MAZO');
        }
    }

    flushRenderDiferido();
}

function cancelarDragDeck() {
    if (!pointerDrag || pointerDrag.type !== 'deck') return;
    const card = pointerDrag.card;
    card.removeEventListener('pointermove', onDeckPointerMove);
    card.removeEventListener('pointerup', onDeckPointerUp);
    card.removeEventListener('pointercancel', onDeckPointerUp);
    try {
        if (pointerDrag.pointerId != null) card.releasePointerCapture(pointerDrag.pointerId);
    } catch (_) {}
    if (pointerDrag.ghost) pointerDrag.ghost.remove();
    card.classList.remove('is-dragging');
    document.body.classList.remove('is-drawing-from-deck');
    document.getElementById('handCards')?.classList.remove('hand-drop-hover');
    pointerDrag = null;
    deckDropSobreMano = false;
}

function cancelarDragMano() {
    if (!pointerDrag || pointerDrag.type !== 'hand') return;
    const card = pointerDrag.card;
    card.removeEventListener('pointermove', onCardPointerMove);
    card.removeEventListener('pointerup', onCardPointerUp);
    card.removeEventListener('pointercancel', onCardPointerUp);
    try {
        if (pointerDrag.pointerId != null) card.releasePointerCapture(pointerDrag.pointerId);
    } catch (_) {}
    if (pointerDrag.ghost) pointerDrag.ghost.remove();
    document.body.classList.remove('is-reordering-cards');
    limpiarPreviewReorden();
    pointerDrag = null;
    cartaArrastradaId = null;
    indiceOrigenDrag = null;
    indiceDestinoPreview = null;
}

function onCardPointerDown(e) {
    if (gameState?.juegoTerminado) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (animandoFlip || pointerDrag) return;

    const card = e.currentTarget;
    pointerDrag = {
        type: 'hand',
        pointerId: e.pointerId,
        card,
        id: card.dataset.id,
        startX: e.clientX,
        startY: e.clientY,
        dragging: false,
        ghost: null
    };

    try { card.setPointerCapture(e.pointerId); } catch (_) {}

    card.addEventListener('pointermove', onCardPointerMove);
    card.addEventListener('pointerup', onCardPointerUp);
    card.addEventListener('pointercancel', onCardPointerUp);
}

function onCardPointerMove(e) {
    if (!pointerDrag || pointerDrag.type !== 'hand' || e.pointerId !== pointerDrag.pointerId) return;

    const dx = e.clientX - pointerDrag.startX;
    const dy = e.clientY - pointerDrag.startY;
    const dist = Math.hypot(dx, dy);

    if (!pointerDrag.dragging && dist > 12) {
        iniciarArrastrePointer(e);
    }

    if (!pointerDrag?.dragging) return;

    e.preventDefault();
    if (pointerDrag.ghost) {
        pointerDrag.ghost.style.left = `${e.clientX}px`;
        pointerDrag.ghost.style.top = `${e.clientY}px`;
    }

    const destIdx = indiceDestinoDesdePunto(e.clientX, e.clientY);
    if (destIdx == null) return;

    if (destIdx === indiceOrigenDrag) {
        // Volvió a su sitio: cancelar preview de vecinos
        if (indiceDestinoPreview !== indiceOrigenDrag) {
            indiceDestinoPreview = indiceOrigenDrag;
            limpiarSoloPreviewShift();
        }
        return;
    }

    const handCardsEl = document.getElementById('handCards');
    const cards = [...handCardsEl.querySelectorAll('.card')];
    const target = cards[destIdx];
    if (target && target.dataset.id !== cartaArrastradaId) {
        actualizarPreviewReorden(target.dataset.id);
    }
}

/**
 * Índice destino: si el puntero está sobre el hueco original, se queda en origen.
 * Así soltar "en el mismo sitio" no salta al vecino.
 */
function indiceDestinoDesdePunto(clientX, clientY) {
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl || !cartaArrastradaId || indiceOrigenDrag == null) return null;

    const cards = [...handCardsEl.querySelectorAll('.card')];
    const fromIdx = cards.findIndex(c => c.dataset.id === cartaArrastradaId);
    if (fromIdx === -1) return null;

    const dragged = cards[fromIdx];
    const originRect = dragged.getBoundingClientRect();
    const pad = 12;
    if (
        clientX >= originRect.left - pad &&
        clientX <= originRect.right + pad &&
        clientY >= originRect.top - pad &&
        clientY <= originRect.bottom + pad
    ) {
        return fromIdx;
    }

    const prevPE = dragged.style.pointerEvents;
    dragged.style.pointerEvents = 'none';
    if (pointerDrag?.ghost) pointerDrag.ghost.style.pointerEvents = 'none';
    const under = document.elementFromPoint(clientX, clientY);
    dragged.style.pointerEvents = prevPE;

    const target = under?.closest?.('#handCards .card');
    if (target && target.dataset.id !== cartaArrastradaId) {
        return cards.findIndex(c => c.dataset.id === target.dataset.id);
    }

    // Más cercano por centro, pero si el origen sigue siendo el más cercano → no mover
    let bestIdx = fromIdx;
    let bestDist = Infinity;
    const ox = originRect.left + originRect.width / 2;
    const oy = originRect.top + originRect.height / 2;
    const distOrigin = Math.hypot(clientX - ox, clientY - oy);

    cards.forEach((c, i) => {
        if (c.dataset.id === cartaArrastradaId) return;
        const r = c.getBoundingClientRect();
        const d = Math.hypot(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2));
        if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
        }
    });

    if (distOrigin <= bestDist + 4) return fromIdx;
    return bestIdx;
}

function iniciarArrastrePointer(e) {
    if (!pointerDrag || pointerDrag.dragging) return;

    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl) return;

    const cardsNow = [...handCardsEl.querySelectorAll('.card')];
    cartaArrastradaId = pointerDrag.id;
    indiceOrigenDrag = cardsNow.findIndex(c => c.dataset.id === cartaArrastradaId);
    indiceDestinoPreview = indiceOrigenDrag;
    reordenYaAplicado = false;
    ignorarClickTrasDrag = false;

    pointerDrag.dragging = true;
    pointerDrag.card.classList.add('is-dragging');

    const ghost = pointerDrag.card.cloneNode(true);
    ghost.classList.remove('is-dragging', 'selected', 'card-shifting');
    ghost.classList.add('card-drag-ghost');
    ghost.removeAttribute('data-id');
    const rect = pointerDrag.card.getBoundingClientRect();
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY}px`;
    document.body.appendChild(ghost);
    pointerDrag.ghost = ghost;

    document.body.classList.add('is-reordering-cards');
}

function onCardPointerUp(e) {
    if (!pointerDrag || pointerDrag.type !== 'hand' || e.pointerId !== pointerDrag.pointerId) return;

    const card = pointerDrag.card;
    const wasDragging = pointerDrag.dragging;

    card.removeEventListener('pointermove', onCardPointerMove);
    card.removeEventListener('pointerup', onCardPointerUp);
    card.removeEventListener('pointercancel', onCardPointerUp);
    try { card.releasePointerCapture(e.pointerId); } catch (_) {}

    if (pointerDrag.ghost) {
        pointerDrag.ghost.remove();
        pointerDrag.ghost = null;
    }
    document.body.classList.remove('is-reordering-cards');

    if (wasDragging) {
        // Recalcular destino en el punto final (evita quedar con el vecino si volviste al sitio)
        const finalIdx = indiceDestinoDesdePunto(e.clientX, e.clientY);
        if (finalIdx != null) indiceDestinoPreview = finalIdx;

        if (indiceDestinoPreview === indiceOrigenDrag) {
            limpiarPreviewReorden();
        } else if (!reordenYaAplicado) {
            confirmarReordenMano();
        }
        if (!reordenYaAplicado) limpiarPreviewReorden();

        ignorarClickTrasDrag = true;
        window.setTimeout(() => { ignorarClickTrasDrag = false; }, 80);
        cartaArrastradaId = null;
        indiceOrigenDrag = null;
        indiceDestinoPreview = null;
    }

    pointerDrag = null;
    flushRenderDiferido();
}

function actualizarPreviewReorden(targetId) {
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl || !cartaArrastradaId) return;

    const cards = [...handCardsEl.querySelectorAll('.card')];
    const fromIdx = cards.findIndex(c => c.dataset.id === cartaArrastradaId);
    const toIdx = cards.findIndex(c => c.dataset.id === targetId);
    if (fromIdx === -1 || toIdx === -1) return;
    if (indiceDestinoPreview === toIdx) return;

    indiceDestinoPreview = toIdx;
    if (fromIdx === toIdx) {
        limpiarSoloPreviewShift();
        return;
    }

    const tops = cards.map(c => c.getBoundingClientRect().top);
    const multilinea = tops.some(t => Math.abs(t - tops[0]) > 8);

    cards.forEach((c) => {
        c.classList.remove('drag-over');
        if (c.dataset.id === cartaArrastradaId) {
            c.style.transform = '';
            return;
        }
        c.classList.remove('card-shifting');
        c.style.transform = '';
    });

    if (multilinea) {
        const target = cards[toIdx];
        if (target) target.classList.add('drag-over');
        return;
    }

    const sample = cards.find(c => c.dataset.id !== cartaArrastradaId) || cards[0];
    const gap = parseFloat(getComputedStyle(handCardsEl).gap) || 16;
    const step = sample.getBoundingClientRect().width + gap;

    cards.forEach((c, i) => {
        if (c.dataset.id === cartaArrastradaId) return;
        c.classList.add('card-shifting');
        let shift = 0;
        if (fromIdx < toIdx && i > fromIdx && i <= toIdx) shift = -step;
        else if (fromIdx > toIdx && i >= toIdx && i < fromIdx) shift = step;
        c.style.transform = shift ? `translateX(${shift}px)` : '';
    });
}

function limpiarSoloPreviewShift() {
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl) return;
    handCardsEl.querySelectorAll('.card').forEach(c => {
        if (c.dataset.id === cartaArrastradaId) return;
        c.classList.remove('card-shifting', 'drag-over');
        c.style.transform = '';
    });
}

function limpiarPreviewReorden() {
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl) return;
    handCardsEl.querySelectorAll('.card').forEach(c => {
        c.classList.remove('card-shifting', 'drag-over', 'is-dragging');
        c.style.transform = '';
        c.style.transition = '';
        c.style.pointerEvents = '';
    });
}

function confirmarReordenMano() {
    if (reordenYaAplicado || animandoFlip) return;
    const draggedId = cartaArrastradaId;
    const fromIdx = indiceOrigenDrag;
    const toIdx = indiceDestinoPreview;

    if (!draggedId || fromIdx == null || toIdx == null || fromIdx === toIdx) {
        limpiarPreviewReorden();
        return;
    }

    reordenYaAplicado = true;
    cartaArrastradaId = null;
    indiceOrigenDrag = null;
    indiceDestinoPreview = null;

    const mano = [...miMano()];
    const origen = (fromIdx >= 0 && fromIdx < mano.length && String(mano[fromIdx].id) === String(draggedId))
        ? fromIdx
        : mano.findIndex(c => String(c.id) === String(draggedId));
    const destino = Math.max(0, Math.min(toIdx, mano.length - 1));

    if (origen === -1 || origen === destino) {
        limpiarPreviewReorden();
        reordenYaAplicado = false;
        return;
    }

    animarFlipMano(() => {
        const [draggedCard] = mano.splice(origen, 1);
        mano.splice(destino, 0, draggedCard);

        const yo = gameState.jugadores.find(j => j.esYo);
        if (yo) yo.mano = mano;

        playSound('reorder');
        renderManoLocal({
            puedeSeleccionar: !!gameState.esMiTurno,
            puedeReordenar: !gameState.juegoTerminado
        });
        enviarAccion('REORDENAR_MANO', { ordenIds: mano.map(c => c.id) });
    });
}

function animarFlipMano(aplicarCambio) {
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl) {
        aplicarCambio();
        return;
    }

    const firstRects = new Map();
    handCardsEl.querySelectorAll('.card').forEach(card => {
        firstRects.set(card.dataset.id, card.getBoundingClientRect());
    });

    animandoFlip = true;
    aplicarCambio();

    const newCards = [...handCardsEl.querySelectorAll('.card')];
    newCards.forEach(card => {
        const first = firstRects.get(card.dataset.id);
        if (!first) return;
        const last = card.getBoundingClientRect();
        const dx = first.left - last.left;
        const dy = first.top - last.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;
        card.style.transition = 'none';
        card.style.transform = `translate(${dx}px, ${dy}px)`;
        void card.offsetWidth;
        card.style.transition = `transform ${FLIP_DURATION_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
        card.style.transform = '';
    });

    window.setTimeout(() => {
        newCards.forEach(card => {
            card.style.transition = '';
            card.style.transform = '';
        });
        animandoFlip = false;
        reordenYaAplicado = false;
        flushRenderDiferido();
    }, FLIP_DURATION_MS + 40);
}

render();
