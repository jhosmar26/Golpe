import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    claveNombre,
    nombreYaUsadoEnSala,
    sugerirNombresAlternativos,
    normalizarNombreJugador
} from '../../lobby-names.js';

describe('nombres únicos en lobby', () => {
    it('detecta duplicado sin importar mayúsculas ni espacios', () => {
        const players = [{ nombre: 'Jugador' }, { nombre: 'Ana' }];
        assert.equal(nombreYaUsadoEnSala(players, 'jugador'), true);
        assert.equal(nombreYaUsadoEnSala(players, '  JUGADOR  '), true);
        assert.equal(nombreYaUsadoEnSala(players, 'Carlos'), false);
    });

    it('sugiere nombres libres basados en el elegido', () => {
        const players = [{ nombre: 'Jugador' }, { nombre: 'Jugador2' }];
        const tips = sugerirNombresAlternativos(players, 'Jugador', 3);
        assert.equal(tips.length, 3);
        assert.ok(!tips.some(n => claveNombre(n) === 'jugador'));
        assert.ok(!tips.some(n => claveNombre(n) === 'jugador2'));
        assert.ok(tips.includes('Jugador3'));
    });

    it('normaliza nombre vacío al fallback', () => {
        assert.equal(normalizarNombreJugador('  ', 'Jugador 2'), 'Jugador 2');
        assert.equal(normalizarNombreJugador('  Ana  ', 'X'), 'Ana');
    });
});
