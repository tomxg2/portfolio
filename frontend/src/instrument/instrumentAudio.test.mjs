import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeScale, normalized, noteAtPosition } from './instrumentAudio.js';

test('instrument builds a two-octave minor pentatonic scale with a closing tonic', () => {
  const notes = makeScale('D', 'pentatonic');
  assert.deepEqual(notes.map((note) => note.midi), [50, 53, 55, 57, 60, 62, 65, 67, 69, 72, 74]);
  assert.equal(notes[0].label, 'D3');
  assert.equal(notes.at(-1).label, 'D5');
});

test('instrument builds major and dorian modes in the selected key', () => {
  assert.deepEqual(makeScale('C', 'major').slice(0, 7).map((note) => note.label), ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3']);
  assert.equal(makeScale('A', 'dorian')[5].label, 'F#4');
  assert.throws(() => makeScale('invalid', 'major'), RangeError);
  assert.throws(() => makeScale('D', 'invalid'), RangeError);
});

test('instrument maps edge positions to playable notes without exceeding the scale', () => {
  const notes = makeScale();
  assert.equal(noteAtPosition(notes, -1), notes[0]);
  assert.equal(noteAtPosition(notes, 1), notes.at(-1));
  assert.equal(noteAtPosition(notes, 2), notes.at(-1));
  assert.equal(noteAtPosition(notes, NaN), notes[5]);
  assert.equal(noteAtPosition([], 0), null);
});

test('instrument normalizes continuous controls', () => {
  assert.equal(normalized(-10), 0);
  assert.equal(normalized(10), 1);
  assert.equal(normalized(0.25), 0.25);
  assert.equal(normalized(undefined), 0.5);
});