import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GolpeadoGame } from '../../game.js';
import { aplicarEscenarioDebug, DEBUG_SCENARIOS } from '../../debug-scenarios.js';

describe('escenarios debug (lobby)', () => {
    for (const meta of DEBUG_SCENARIOS.filter(s => !s.opensForm)) {
        it(`carga «${meta.id}» y deja partida terminada`, () => {
            const game = new GolpeadoGame();
            game.inicializarJuego(['Jugador', 'Bot Ana']);
            game.juegoTerminado = false;
            game.ganadorId = null;
            game.tipoVictoria = null;

            const res = aplicarEscenarioDebug(game, meta.id);
            assert.equal(res.ok, true, res.error);
            assert.equal(game.juegoTerminado, true);
            assert.ok(game.tipoVictoria);
            assert.ok(game.obtenerResultadosVictoria().length >= 2);
        });
    }

    it('enchufes: Ana gana y la tabla incluye Enchufe', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Jugador', 'Bot Ana']);
        aplicarEscenarioDebug(game, 'enchufes');
        const ana = game.obtenerResultadosVictoria().find(r => r.esGanador);
        assert.equal(game.tipoVictoria, 'CERO_EXPUESTO');
        assert.ok(ana.gruposArmados.some(g => g.origen === 'enchufe'));
    });
});
