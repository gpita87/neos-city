/**
 * Unit tests for the group-membership input rules
 * (backend/src/routes/groups.js — the pure normalizeGroupIds helper; the
 * transactional replace is exercised by the live verification pass).
 *
 * Run:  node --test backend/tests/groups.test.js
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const { normalizeGroupIds, normalizeIngameId, MAX_GROUPS } = require('../src/routes/groups');

describe('normalizeGroupIds', () => {
  it('accepts an empty list (leaving all groups)', () => {
    assert.deepEqual(normalizeGroupIds([]), { ids: [] });
  });

  it('accepts up to the in-game cap', () => {
    const six = [1, 2, 3, 4, 5, 6];
    assert.deepEqual(normalizeGroupIds(six), { ids: six });
    assert.equal(MAX_GROUPS, 6);
  });

  it('rejects a 7th group', () => {
    const { error } = normalizeGroupIds([1, 2, 3, 4, 5, 6, 7]);
    assert.match(error, /at most 6/);
  });

  it('dedupes before applying the cap (6 uniques sent twice is fine)', () => {
    const { ids, error } = normalizeGroupIds([1, 1, 2, 2, 3, 3, 4, 5, 6]);
    assert.equal(error, undefined);
    assert.deepEqual(ids, [1, 2, 3, 4, 5, 6]);
  });

  it('coerces numeric strings (JSON clients that stringify ids)', () => {
    assert.deepEqual(normalizeGroupIds(['3', 4]), { ids: [3, 4] });
  });

  it('rejects non-arrays', () => {
    for (const bad of [undefined, null, 'x', 5, { group_ids: [1] }]) {
      assert.match(normalizeGroupIds(bad).error, /must be an array/);
    }
  });

  it('rejects non-positive-integer entries', () => {
    for (const bad of [[0], [-1], [1.5], ['abc'], [NaN], [null], [{}]]) {
      assert.match(normalizeGroupIds(bad).error, /positive integers/);
    }
  });
});

describe('normalizeIngameId', () => {
  it('strips readability spacing down to digits', () => {
    assert.deepEqual(normalizeIngameId('391 572 457 905 58'), { id: '39157245790558' });
    assert.deepEqual(normalizeIngameId('3116 4301 4319 13'), { id: '31164301431913' });
  });

  it('passes through an already-clean id', () => {
    assert.deepEqual(normalizeIngameId('14718881876377'), { id: '14718881876377' });
  });

  it('treats absent/blank as no id (null), not an error', () => {
    for (const empty of [undefined, null, '', '   ']) {
      assert.deepEqual(normalizeIngameId(empty), { id: null });
    }
  });

  it('rejects letters and symbols instead of silently stripping them', () => {
    for (const bad of ['abc12345678901', '3915724579055x', '39157245.90558']) {
      assert.match(normalizeIngameId(bad).error, /digits only/);
    }
  });

  it('rejects implausible lengths', () => {
    assert.match(normalizeIngameId('1234567').error, /8–20 digits/);
    assert.match(normalizeIngameId('123456789012345678901').error, /8–20 digits/);
  });

  it('accepts the 13-digit uncertain case (Neos City 3)', () => {
    assert.deepEqual(normalizeIngameId('139 589 332 4178'), { id: '1395893324178' });
  });
});
