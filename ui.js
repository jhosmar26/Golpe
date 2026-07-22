/**
 * UI de Golpeado (cliente).
 * No posee el Game State: solo renderiza vistas del servidor y emite acciones.
 */

import { esGrupoValido } from './game.js';

const socket = window.io();
const appEl = document.getElementById('app');

/** @type {'home'|'room'|'game'|'victory'} */
let screen = 'home';
/** @type {object|null} */
let roomState = null;
/** @type {object|null} */
let gameState = null;

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
    gameState = state;
    if (!state) {
        if (roomState && roomState.status === 'lobby') {
            screen = 'room';
        }
        render();
        return;
    }

    // Limpiar selección de cartas que ya no existen en la mano
    const idsMano = new Set(miMano().map(c => c.id));
    cartasSeleccionadasIds = cartasSeleccionadasIds.filter(id => idsMano.has(id));

    if (state.juegoTerminado) {
        screen = 'victory';
    } else {
        screen = 'game';
    }
    render();
});

socket.on('actionError', ({ message }) => {
    lastError = message || 'Acción inválida';
    const toast = document.getElementById('actionToast');
    if (toast) {
        toast.textContent = lastError;
        toast.classList.add('visible');
        window.setTimeout(() => toast.classList.remove('visible'), 2500);
    } else {
        console.warn(lastError);
    }
});

// ==========================================
// RENDER ROUTER
// ==========================================

function render() {
    if (screen === 'home') return renderHome();
    if (screen === 'room') return renderRoom();
    if (screen === 'victory') return renderVictoryScreen();
    if (screen === 'game') return renderBoard();
    renderHome();
}

function renderHome() {
    appEl.innerHTML = `
        <div class="lobby-container">
            <h1 class="lobby-logo">Golpeado</h1>
            <p class="lobby-subtitle">Multijugador en tiempo real</p>

            <div class="form-group">
                <label for="playerName">Tu nombre</label>
                <input type="text" id="playerName" value="Jugador" placeholder="Ej. Carlos" maxlength="24">
            </div>

            <button id="btnCreateRoom" class="btn-primary">Crear sala</button>

            <div class="lobby-divider"><span>o únete con un código</span></div>

            <div class="form-group">
                <label for="roomCode">Código de sala (4 dígitos)</label>
                <input type="text" id="roomCode" inputmode="numeric" maxlength="4" placeholder="1234" class="room-code-input">
            </div>

            <button id="btnJoinRoom" class="btn-secondary btn-add-player">Unirse a sala</button>

            <p id="homeError" class="lobby-error" hidden></p>
        </div>
    `;

    const showError = (msg) => {
        const el = document.getElementById('homeError');
        el.hidden = !msg;
        el.textContent = msg || '';
    };

    document.getElementById('btnCreateRoom').addEventListener('click', () => {
        const nombre = document.getElementById('playerName').value.trim() || 'Anfitrión';
        showError('');
        socket.emit('createRoom', { nombre }, (res) => {
            if (!res?.ok) showError(res?.error || 'No se pudo crear la sala');
        });
    });

    document.getElementById('btnJoinRoom').addEventListener('click', () => {
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

function renderRoom() {
    if (!roomState) return renderHome();

    const playersHtml = roomState.players.map(p => `
        <div class="player-item ${p.esYo ? 'active' : ''}">
            <div class="player-name-wrapper">
                <span class="player-item-name">${escapeHtml(p.nombre)}</span>
                ${p.esHost ? '<span class="host-badge">Anfitrión</span>' : ''}
                ${p.esYo ? '<span class="you-badge">Tú</span>' : ''}
            </div>
            <span class="player-cards-count">${p.conectado ? 'Listo' : 'Ausente'}</span>
        </div>
    `).join('');

    appEl.innerHTML = `
        <div class="lobby-container lobby-room">
            <h1 class="lobby-logo">Golpeado</h1>
            <p class="lobby-subtitle">Sala de espera</p>

            <div class="room-code-display">
                <span class="room-code-label">Código</span>
                <span class="room-code-value">${escapeHtml(roomState.code)}</span>
                <p class="room-code-hint">Compártelo para que se unan desde otros dispositivos</p>
            </div>

            <div class="panel room-players-panel">
                <h3 class="panel-title">Jugadores (${roomState.players.length}/${roomState.maxPlayers})</h3>
                <div class="players-list">${playersHtml}</div>
            </div>

            ${roomState.yoSoyHost ? `
                <button id="btnStartGame" class="btn-primary" ${roomState.puedeEmpezar ? '' : 'disabled'}>
                    Comenzar partida
                </button>
                <p class="text-muted room-hint">${roomState.puedeEmpezar ? 'Todos listos' : `Mínimo ${roomState.minPlayers} jugadores`}</p>
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
                </div>

                ${roomState ? `<div class="room-chip">Sala <strong>${escapeHtml(roomState.code)}</strong></div>` : ''}

                <div class="pile-zone">
                    <div class="pile-container">
                        <span class="pile-label">Mazo de Robo</span>
                        <div id="deckPile" class="card card-back ${puedeInteractuar && fase === 'ROBO' ? 'interactive-card' : ''}"></div>
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

    // Mazo
    const deckPileEl = document.getElementById('deckPile');
    if (puedeInteractuar && fase === 'ROBO') {
        deckPileEl.addEventListener('click', () => {
            cartasSeleccionadasIds = [];
            enviarAccion('ROBAR_MAZO');
        });
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

function renderVictoryScreen() {
    if (!gameState?.juegoTerminado) return renderBoard();

    const ganador = gameState.jugadores.find(j => j.id === gameState.ganadorId);
    let sub = '¡Final del juego por conteo de puntos!';
    if (gameState.tipoVictoria === 'CERO_MANO') sub = '¡Victoria inmediata con Cero en Mano!';
    if (gameState.tipoVictoria === 'CERO_EXPUESTO') sub = '¡Victoria tras una ronda de espera con Cero en Mesa!';

    const resultados = gameState.resultadosVictoria || [];

    let avisoApuestasHtml = '';
    if (gameState.tipoVictoria === 'PUNTOS') {
        const cantor = gameState.jugadores[gameState.turnoActual];
        const cantorGano = gameState.ganadorId === gameState.turnoActual;
        if (cantor && !cantorGano && ganador) {
            avisoApuestasHtml = `
                <div style="background: rgba(239, 68, 68, 0.15); border: 1px solid var(--color-danger); border-radius: 12px; padding: 1rem; margin-top: 1.5rem; text-align: center; color: var(--color-danger); font-weight: 600;">
                    El cantor (${escapeHtml(cantor.nombre)}) perdió. Debe pagar el TRIPLE a ${escapeHtml(ganador.nombre)}.
                </div>
            `;
        }
    }

    appEl.innerHTML = `
        <div class="overlay-screen">
            <div class="victory-box">
                <h1 class="victory-title">¡Partida Finalizada!</h1>
                <p class="victory-subtitle">${sub}</p>
                <h2 style="font-size: 1.5rem; margin-bottom: 1.5rem; color: var(--text-primary);">
                    Ganador: <span style="color: var(--color-accent-hover); font-weight: 700;">${escapeHtml(ganador?.nombre || '')}</span>
                </h2>
                <table class="results-table">
                    <thead>
                        <tr>
                            <th>Jugador</th>
                            <th>Grupos</th>
                            <th>Cartas Sueltas</th>
                            <th>Puntos Restantes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${resultados.map(res => `
                            <tr class="${res.esGanador ? 'winner-row' : ''}">
                                <td><strong>${escapeHtml(res.nombre)}</strong> ${res.esGanador ? '👑' : ''}</td>
                                <td>${res.grupos}</td>
                                <td><span style="font-size: 0.9rem; color: var(--text-secondary);">${escapeHtml(res.cartasSueltasText)}</span></td>
                                <td><strong>${res.puntosSueltas} pts</strong></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
                ${roomState?.yoSoyHost
                    ? `<button id="btnRestart" class="btn-primary" style="max-width: 250px; margin: 0 auto;">Volver al lobby</button>`
                    : `<p class="text-muted" style="margin-top: 1rem; text-align: center;">Esperando al anfitrión…</p>`
                }
                ${avisoApuestasHtml}
            </div>
        </div>
    `;

    const btn = document.getElementById('btnRestart');
    if (btn) {
        btn.addEventListener('click', () => {
            socket.emit('returnToLobby', () => {});
        });
    }
}

// ==========================================
// DRAG AND DROP (Pointer Events: desktop + móvil)
// ==========================================

let pointerDrag = null; // { pointerId, card, id, startX, startY, dragging, ghost }

function inicializarDragAndDrop() {
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl || gameState?.juegoTerminado) return;

    handCardsEl.querySelectorAll('.card').forEach(card => {
        // HTML5 DnD falla en iOS/Safari; usamos Pointer Events en todos lados
        card.setAttribute('draggable', 'false');
        card.style.touchAction = 'none';

        card.addEventListener('pointerdown', onCardPointerDown);
    });
}

function onCardPointerDown(e) {
    if (gameState?.juegoTerminado) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (animandoFlip || pointerDrag) return;

    const card = e.currentTarget;
    pointerDrag = {
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
    if (!pointerDrag || e.pointerId !== pointerDrag.pointerId) return;

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

    // Buscar carta destino bajo el dedo/cursor (la arrastrada ignora hits)
    const prevPE = pointerDrag.card.style.pointerEvents;
    pointerDrag.card.style.pointerEvents = 'none';
    if (pointerDrag.ghost) pointerDrag.ghost.style.pointerEvents = 'none';
    // Preferir índice vertical+horizontal en móvil (cartas en wrap)
    const under = document.elementFromPoint(e.clientX, e.clientY);
    pointerDrag.card.style.pointerEvents = prevPE;

    let target = under?.closest?.('#handCards .card');
    if (!target) {
        target = cartaMasCercana(e.clientX, e.clientY);
    }
    if (target && target.dataset.id !== cartaArrastradaId) {
        actualizarPreviewReorden(target.dataset.id);
    }
}

function cartaMasCercana(clientX, clientY) {
    const handCardsEl = document.getElementById('handCards');
    if (!handCardsEl || !cartaArrastradaId) return null;
    let best = null;
    let bestDist = Infinity;
    handCardsEl.querySelectorAll('.card').forEach(c => {
        if (c.dataset.id === cartaArrastradaId) return;
        const r = c.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const d = Math.hypot(clientX - cx, clientY - cy);
        if (d < bestDist) {
            bestDist = d;
            best = c;
        }
    });
    return best;
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

    // Fantasma que sigue el dedo (mejor UX en móvil)
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
    if (!pointerDrag || e.pointerId !== pointerDrag.pointerId) return;

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
        if (!reordenYaAplicado) confirmarReordenMano();
        if (!reordenYaAplicado) limpiarPreviewReorden();
        ignorarClickTrasDrag = true;
        window.setTimeout(() => { ignorarClickTrasDrag = false; }, 80);
        cartaArrastradaId = null;
        indiceOrigenDrag = null;
        indiceDestinoPreview = null;
    }

    pointerDrag = null;
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
    if (fromIdx === toIdx) return;

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
    }, FLIP_DURATION_MS + 40);
}

render();
