import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { crearCarta, esGrupoValido } from '../../game.js';

describe('staging robar descarte (3 cartas)', () => {
    it('acepta trío con descarte + 2 de mano', () => {
        const descarte = crearCarta('H', 5);
        const a = crearCarta('S', 5);
        const b = crearCarta('D', 5);
        assert.equal(esGrupoValido([descarte, a, b]), true);
    });

    it('acepta escalera de 3', () => {
        const descarte = crearCarta('H', 7);
        const a = crearCarta('H', 8);
        const b = crearCarta('H', 9);
        assert.equal(esGrupoValido([descarte, a, b]), true);
    });

    it('rechaza 3 cartas que no forman grupo', () => {
        const descarte = crearCarta('H', 2);
        const a = crearCarta('S', 5);
        const b = crearCarta('D', 9);
        assert.equal(esGrupoValido([descarte, a, b]), false);
    });
});