import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { GolpeadoGame } from '../../game.js';
import {
    aplicarEscenarioCustom,
    parseListaCartas,
    parseGrupos,
    detectarGruposEnSlots,
    separarGruposMesaDeMano
} from '../../debug-scenarios.js';

describe('custom debug', () => {
    it('parsea listas y grupos', () => {
        const mano = parseListaCartas('H1, D12 S3');
        assert.equal(mano.length, 3);
        assert.equal(mano[1].id, 'D12');
        const grupos = parseGrupos('C5,S5,H5 ; D7 D8 D9');
        assert.equal(grupos.length, 2);
        assert.equal(grupos[0].length, 3);
    });

    it('vacío completa 8+7 y mazo al máximo', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const res = aplicarEscenarioCustom(game, {});
        assert.equal(res.ok, true, res.error);
        assert.equal(game.jugadores[0].mano.length, 8);
        assert.equal(game.jugadores[1].mano.length, 7);
        assert.equal(game.mazoDescarte.length, 1);
        // 52 - 8 - 7 - 1 descarte = 36
        assert.equal(game.mazoRobo.length, 36);
        assert.equal(game.faseActual, 'DESCARTE');
        assert.equal(game.turnoActual, 0);
    });

    it('respeta próximas del mazo y flags Color/Póker', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const res = aplicarEscenarioCustom(game, {
            miMano: 'H1 H2 H3 H4 H5 H6 H7 S2',
            rivalMano: 'C2 D4 S6 H8 C9 D10 S11',
            descarteTop: 'C13',
            mazoProximas: 'S1 D3',
            mazoRestante: 5,
            permitirVictoriaColor: false,
            permitirVictoriaPoker: true
        });
        assert.equal(res.ok, true, res.error);
        assert.equal(game.permitirVictoriaColor, false);
        assert.equal(game.permitirVictoriaPoker, true);
        assert.equal(game.mazoRobo.length, 5);
        // Primera a robar = S1 (último del array)
        assert.equal(game.mazoRobo[game.mazoRobo.length - 1].id, 'S1');
        assert.equal(game.mazoRobo[game.mazoRobo.length - 2].id, 'D3');
    });

    it('completa manos parciales respetando quién tiene 8', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const res = aplicarEscenarioCustom(game, {
            miMano: 'H1 H2 H3',
            rivalMano: 'C2 D4',
            descarteTop: 'S13'
        });
        assert.equal(res.ok, true, res.error);
        assert.equal(game.jugadores[0].mano.length, 8);
        assert.equal(game.jugadores[1].mano.length, 7);
    });

    it('permite rival con 8 si vos tenés 7 o menos', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const res = aplicarEscenarioCustom(game, {
            miMano: 'H1 H2 H3',
            rivalMano: 'C1 C2 C3 C4 C5 C6 C7 C8',
            descarteTop: 'S13'
        });
        assert.equal(res.ok, true, res.error);
        assert.equal(game.jugadores[1].mano.length, 8);
        assert.equal(game.jugadores[0].mano.length, 7);
        assert.equal(game.turnoActual, 1);
    });

    it('respeta palo aunque el valor sea aleatorio (8 corazones)', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const res = aplicarEscenarioCustom(game, {
            miManoSlots: Array.from({ length: 8 }, () => ({ suit: 'H', value: null })),
            rivalManoSlots: [],
            descarteTop: 'S13'
        });
        assert.equal(res.ok, true, res.error);
        assert.equal(game.jugadores[0].mano.length, 8);
        assert.ok(game.jugadores[0].mano.every(c => c.suit === 'H'));
    });

    it('con 5 corazones (número libre) conserva al menos 5♥ en tu mano', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const res = aplicarEscenarioCustom(game, {
            miMano: 'H? H? H? H? H?',
            descarteTop: 'S13'
        });
        assert.equal(res.ok, true, res.error);
        assert.equal(game.jugadores[0].mano.length, 8);
        const hearts = game.jugadores[0].mano.filter(c => c.suit === 'H').length;
        assert.ok(hearts >= 5, `esperaba ≥5♥, hay ${hearts}: ${game.jugadores[0].mano.map(c => c.id).join(' ')}`);
    });

    it('rechaza dos manos de 8', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const res = aplicarEscenarioCustom(game, {
            miMano: 'H1 H2 H3 H4 H5 H6 H7 H8',
            rivalMano: 'C1 C2 C3 C4 C5 C6 C7 C8'
        });
        assert.equal(res.ok, false);
    });

    it('detecta trío por mismo número (palo libre)', () => {
        const g = detectarGruposEnSlots([
            { suit: null, value: 5 },
            { suit: null, value: 5 },
            { suit: null, value: 5 },
            { suit: 'S', value: 2 }
        ]);
        assert.equal(g.length, 1);
        assert.deepEqual(g[0].indices, [0, 1, 2]);
    });

    it('grupo detectado en mesa sale de la mano a gruposExpuestos', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const slots = [
            { suit: 'H', value: 5 },
            { suit: 'D', value: 5 },
            { suit: 'C', value: 5 },
            { suit: 'S', value: 2 }
        ];
        const detected = detectarGruposEnSlots(slots).map(g => ({ ...g, lugar: 'mesa' }));
        const res = aplicarEscenarioCustom(game, {
            miManoSlots: slots,
            miGruposDetectados: detected,
            descarteTop: 'S13'
        });
        assert.equal(res.ok, true, res.error);
        const yo = game.jugadores[0];
        assert.equal(yo.gruposExpuestos.length, 1);
        assert.equal(yo.gruposExpuestos[0].length, 3);
        assert.ok(yo.gruposExpuestos[0].every(c => c.value === 5));
        assert.equal(yo.tuvoRoboDescarte, true);
        // Mitad de partida: 3 en mesa + 4 en mano = 7
        assert.equal(yo.mano.length, 4);
        assert.equal(yo.mano.length + yo.gruposExpuestos.flat().length, 7);
        assert.equal(game.jugadores[1].mano.length, 7);
        assert.equal(game.faseActual, 'ROBO');
        assert.equal(game.turnoActual, 0);
    });

    it('rival con trío en mesa queda con 4 en mano (total 7)', () => {
        const game = new GolpeadoGame();
        game.inicializarJuego(['Yo', 'Bot']);
        const rivalSlots = [
            { suit: 'H', value: 9 },
            { suit: 'D', value: 9 },
            { suit: 'C', value: 9 }
        ];
        const detected = detectarGruposEnSlots(rivalSlots).map(g => ({ ...g, lugar: 'mesa' }));
        const res = aplicarEscenarioCustom(game, {
            miManoSlots: [{ suit: 'S', value: 2 }],
            rivalManoSlots: rivalSlots,
            rivalGruposDetectados: detected,
            descarteTop: 'S13'
        });
        assert.equal(res.ok, true, res.error);
        const rival = game.jugadores[1];
        assert.equal(rival.gruposExpuestos.flat().length, 3);
        assert.equal(rival.mano.length, 4);
        assert.equal(rival.mano.length + rival.gruposExpuestos.flat().length, 7);
        assert.equal(game.jugadores[0].mano.length, 7);
        assert.equal(game.faseActual, 'ROBO');
    });

    it('no agrupa tres cartas del mismo valor con el mismo palo', () => {
        const g = detectarGruposEnSlots([
            { suit: 'H', value: 5 },
            { suit: 'H', value: 5 },
            { suit: 'H', value: 5 }
        ]);
        assert.equal(g.length, 0);
    });

    it('separarGruposMesaDeMano deja en mano si lugar=mano', () => {
        const mano = [
            { id: 'H5' }, { id: 'D5' }, { id: 'C5' }, { id: 'S2' }
        ];
        const { mano: left, gruposMesa } = separarGruposMesaDeMano(mano, [
            { indices: [0, 1, 2], lugar: 'mano' }
        ]);
        assert.equal(gruposMesa.length, 0);
        assert.equal(left.length, 4);
    });
});
