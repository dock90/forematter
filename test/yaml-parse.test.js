import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYaml, YamlError } from '../src/index.ts';

const eq = (yaml, expected) => assert.deepStrictEqual(parseYaml(yaml), expected);
const throws = (yaml, pattern) =>
	assert.throws(
		() => parseYaml(yaml),
		(e) => e instanceof YamlError && (pattern === undefined || pattern.test(e.message)),
		`expected a YamlError${pattern ? ' matching ' + pattern : ''} for ${JSON.stringify(yaml)}`,
	);

test('empty documents', () => {
	eq('', undefined);
	eq('\n\n', undefined);
	eq('# only a comment\n', undefined);
	eq('  \n\t\n# c', undefined);
});

test('null, booleans and strings', () => {
	eq('a: null\nb: Null\nc: NULL\nd: ~\ne:\nf: nil', { a: null, b: null, c: null, d: null, e: null, f: 'nil' });
	eq('a: true\nb: True\nc: TRUE\nd: false\ne: False\nf: FALSE', { a: true, b: true, c: true, d: false, e: false, f: false });
	eq('a: yes\nb: No\nc: on\nd: off\ne: y\nf: tRUE', { a: 'yes', b: 'No', c: 'on', d: 'off', e: 'y', f: 'tRUE' });
	eq('title: Hello world', { title: 'Hello world' });
});

test('integers', () => {
	eq('a: 0\nb: -5\nc: +7\nd: 0x1F\ne: 0o17\nf: 0123\ng: 12345678901234567890', {
		a: 0,
		b: -5,
		c: 7,
		d: 31,
		e: 15,
		f: 123,
		g: 12345678901234567890,
	});
});

test('floats', () => {
	eq('a: 1.5\nb: -0.5\nc: .5\nd: 1.\ne: 1e3\nf: 1.5e-3\ng: +.5E+2', { a: 1.5, b: -0.5, c: 0.5, d: 1, e: 1000, f: 0.0015, g: 50 });
	eq('a: .inf\nb: -.inf\nc: +.Inf\nd: .nan\ne: .NaN', { a: Infinity, b: -Infinity, c: Infinity, d: NaN, e: NaN });
});

test('text that only looks numeric stays a string', () => {
	const cases = ['1.2.3', '1_000', '12:30', '0x', '0xZZ', '0o8', '0b11', '1e', '1e+', '+', '.', '..5', '-.nan', '1,000', '555-1234', '2026-11', 'Infinity', 'NaN', '1 2'];
	for (const text of cases) eq(`a: ${text}`, { a: text });
});

test('timestamps', () => {
	eq('d: 2026-11-14', { d: new Date('2026-11-14T00:00:00.000Z') });
	eq('d: 2026-11-14T10:30:00Z', { d: new Date('2026-11-14T10:30:00.000Z') });
	eq('d: 2026-11-14t10:30:00.5Z', { d: new Date('2026-11-14T10:30:00.500Z') });
	eq('d: 2026-11-14 10:30:00', { d: new Date('2026-11-14T10:30:00.000Z') });
	eq('d: 2026-11-14 10:30:00 +02:00', { d: new Date('2026-11-14T08:30:00.000Z') });
	eq('d: 2026-11-14T10:30:00-0530', { d: '2026-11-14T10:30:00-0530' });
	eq('d: 2026-11-14T10:30:00-05:30', { d: new Date('2026-11-14T16:00:00.000Z') });
	eq('d: 2026-11-14T10:30:00.123456+01', { d: new Date('2026-11-14T09:30:00.123Z') });
	eq('d: 2026-13-01', { d: '2026-13-01' });
	eq('d: 2026-11-14T25:00:00Z', { d: '2026-11-14T25:00:00Z' });
	eq('d: "2026-11-14"', { d: '2026-11-14' });
});

test('quoted scalars', () => {
	eq(`a: 'it''s'\nb: "say \\"hi\\""\nc: ''\nd: ""`, { a: "it's", b: 'say "hi"', c: '', d: '' });
	eq('a: "tab\\there\\nline \\u00e9 \\x41 \\U0001F600 \\\\ \\/ \\0 \\e \\_"', { a: 'tab\there\nline \u00e9 A \u{1F600} \\ / \0 \x1b \xa0' });
	eq(`a: '123'\nb: "true"\nc: 'null'`, { a: '123', b: 'true', c: 'null' });
	eq(`a: 'c: d # not a comment'`, { a: 'c: d # not a comment' });
	eq('a: "x" # comment', { a: 'x' });
});

test('multi-line quoted scalars fold', () => {
	eq('a: "one\n  two\n\n  three"', { a: 'one two\nthree' });
	eq("a: 'one  \n  two'", { a: 'one two' });
	eq('a: "one\\\n  two"', { a: 'onetwo' });
});

test('plain scalars', () => {
	eq('url: http://example.com/a?b=c#d', { url: 'http://example.com/a?b=c#d' });
	eq('a: b:c\nd: -x\ne: ?y\nf: :z', { a: 'b:c', d: '-x', e: '?y', f: ':z' });
	eq('a: one, [two] {three}', { a: 'one, [two] {three}' });
	eq('a:   spaced out   ', { a: 'spaced out' });
	eq('a: caf\u00e9 \u2603 \u{1F600}', { a: 'caf\u00e9 \u2603 \u{1F600}' });
});

test('multi-line plain scalars fold', () => {
	eq('a: one\n  two\n\n  three\nb: 2', { a: 'one two\nthree', b: 2 });
	eq('a:\n  one\n  two\nb: 2', { a: 'one two', b: 2 });
	eq('- one\n  two\n- three', ['one two', 'three']);
	eq('a: 1\n  2', { a: '1 2' });
});

test('comments', () => {
	eq('# top\na: 1 # trailing\n# middle\nb: c#d\nc: # nothing\n', { a: 1, b: 'c#d', c: null });
	eq('a:\n  # indented comment\n  b: 1\n', { a: { b: 1 } });
});

test('literal block scalars', () => {
	eq('a: |\n  one\n  two\nb: 1', { a: 'one\ntwo\n', b: 1 });
	eq('a: |-\n  one\n  two\n', { a: 'one\ntwo' });
	eq('a: |+\n  one\n\n\nb: 1', { a: 'one\n\n\n', b: 1 });
	eq('a: |\n  x\n\n    y\n  z\n', { a: 'x\n\n  y\nz\n' });
	eq('a: |\n  x', { a: 'x\n' });
	eq('a: | # note\n  x\n', { a: 'x\n' });
	eq('a: |\nb: 1', { a: '', b: 1 });
	eq('a: |2\n    x\n  y\n', { a: '  x\ny\n' });
	eq('a: |-2\n    x\n', { a: '  x' });
	eq('- |\n  a\n- b', ['a\n', 'b']);
	eq('a: |\n  # not a comment\n  key: value\n', { a: '# not a comment\nkey: value\n' });
	eq('|\n  root\n', 'root\n');
});

test('folded block scalars', () => {
	eq('a: >\n  one\n  two\n\n  three\n', { a: 'one two\nthree\n' });
	eq('a: >-\n  one\n  two\n', { a: 'one two' });
	eq('a: >\n  one\n    indented\n  two\n', { a: 'one\n  indented\ntwo\n' });
	eq('a: >+\n  one\n\n', { a: 'one\n\n' });
});

test('block mappings and sequences', () => {
	eq('a:\n  b:\n    c: 1\n  d: 2\ne: 3', { a: { b: { c: 1 }, d: 2 }, e: 3 });
	eq('- a\n- 2\n- true\n-\n- ~', ['a', 2, true, null, null]);
	eq('list:\n  - a\n  - b\nnext: 1', { list: ['a', 'b'], next: 1 });
	eq('list:\n- a\n- b\nnext: 1', { list: ['a', 'b'], next: 1 });
	eq('- name: one\n  tags:\n    - x\n    - y\n- name: two', [{ name: 'one', tags: ['x', 'y'] }, { name: 'two' }]);
	eq('- - a\n  - b\n- c', [['a', 'b'], 'c']);
	eq('-\n  a: 1\n-\n  - x', [{ a: 1 }, ['x']]);
	eq('a:\nb:\n', { a: null, b: null });
	eq('  a: 1\n  b: 2', { a: 1, b: 2 });
	eq('- a:\n  - x\n- b', [{ a: ['x'] }, 'b']);
	eq('just text', 'just text');
	eq('42', 42);
});

test('mapping keys', () => {
	eq('"a b": 1\n\'c\': 2\nd e: 3\nf:g: 4\n"": 5', { 'a b': 1, c: 2, 'd e': 3, 'f:g': 4, '': 5 });
	eq('1: a\ntrue: b\nnull: c\n2026-11-14: d', { 1: 'a', true: 'b', null: 'c', '2026-11-14': 'd' });
	eq('key : value', { key: 'value' });
	eq('a:\tb', { a: 'b' });
});

test('flow collections', () => {
	eq('a: [1, two, "three", [4], {k: v}]', { a: [1, 'two', 'three', [4], { k: 'v' }] });
	eq('a: {x: 1, "y": [2], z: , w}', { a: { x: 1, y: [2], z: null, w: null } });
	eq('a: []\nb: {}\nc: [ ]\nd: [a, b, ]', { a: [], b: {}, c: [], d: ['a', 'b'] });
	eq('a: [\n  1, # one\n  2\n]\nb: 3', { a: [1, 2], b: 3 });
	eq('{"a": [1, 2.5, "x", null, true], "b": {"c": "d"}}', { a: [1, 2.5, 'x', null, true], b: { c: 'd' } });
	eq('{"a":1,"b":"c"}', { a: 1, b: 'c' });
});

test('flow collections reject what is not supported', () => {
	throws('a: [1, 2', /unterminated flow sequence/);
	throws('a: {x: 1', /unterminated flow mapping/);
	throws('b: [x\n y]', /expected "," or "\]"/);
	throws('[a, c: d]', /expected "," or "\]"/);
	throws('a: [, 1]', /unexpected character/);
	throws('a: {[x]: 1}', /unsupported flow mapping key/);
	throws('a: [1, 2] extra', /unexpected content/);
});

test('a leading document marker and CRLF line endings', () => {
	eq('---\na: 1', { a: 1 });
	eq('--- # comment\na: 1', { a: 1 });
	eq('a: 1\r\nb:\r\n  - x\r\n  - "y"\r\nc: |\r\n  text\r\n', { a: 1, b: ['x', 'y'], c: 'text\n' });
});

test('anchors, aliases and merge keys', () => {
	const r = parseYaml('base: &b\n  x: 1\nother: *b\nn: &n 5\nm: *n');
	assert.deepStrictEqual(r, { base: { x: 1 }, other: { x: 1 }, n: 5, m: 5 });
	assert.equal(r.other, r.base);
	eq('base: &b {x: 1, y: 2}\nc:\n  <<: *b\n  y: 3\n  z: 4', { base: { x: 1, y: 2 }, c: { x: 1, y: 3, z: 4 } });
	eq('base: &b {x: 1, y: 2}\nc:\n  y: 3\n  <<: *b', { base: { x: 1, y: 2 }, c: { y: 3, x: 1 } });
	eq('a: &a {x: 1}\nb: &b {x: 2, y: 2}\nc: {<<: [*a, *b]}', { a: { x: 1 }, b: { x: 2, y: 2 }, c: { x: 1, y: 2 } });
	eq('"<<": 1', { '<<': 1 });
	eq('a: [&x 1, *x]', { a: [1, 1] });
	throws('a: *missing', /unknown alias/);
	throws('a: &a [*a]', /unknown alias/);
	throws('a: 1\n<<: 2', /merge key/);
});

test('the !!str tag', () => {
	eq('a: !!str 123\nb: !!str true\nc: !!str\nd: !!str "x"', { a: '123', b: 'true', c: '', d: 'x' });
	eq('a: [!!str 1, 2]', { a: ['1', 2] });
	throws('a: !!js/function "x"', /unsupported tag/);
	throws('a: !custom x', /unsupported tag/);
	throws('a: !!binary |\n  aGVsbG8=', /unsupported tag/);
});

test('syntax errors', () => {
	throws('a:\n\tb: 1', /tabs are not allowed/);
	throws('a: 1\n  b: 2', /mapping values are not allowed/);
	throws('a:\n  b: 1\n c: 2', /bad indentation/);
	throws('a: b: c', /mapping values are not allowed/);
	throws('a: 1\n- b', /sequence entry is not allowed/);
	throws('- a\nb: 1', /bad indentation/);
	throws('a: - b', /sequence entry is not allowed/);
	throws('? a\n: b', /complex mapping keys/);
	throws('a: 1\n---\nb: 2', /document markers/);
	throws('a: 1\n...\n', /document markers/);
	throws('a: @x', /unexpected character/);
	throws('a: `x`', /unexpected character/);
	throws("a: 'x' y", /unexpected content/);
	throws('a: "x', /unterminated double-quoted/);
	throws("a: 'x", /unterminated single-quoted/);
	throws('a: "\\q"', /unknown escape/);
	throws('a: "\\u12G4"', /invalid escape/);
	throws('a: 1\nb', /expected a mapping entry/);
	throws('a: text # comment\n  more', /bad indentation/);
	throws(': x', /missing mapping key/);
	throws('a: |x\n  y', /unexpected content after a block scalar header/);
	throws('%YAML 1.2\n---\na: 1', /unexpected character/);
});

test('errors report a line and a column', () => {
	try {
		parseYaml('a: 1\nb: [1, 2');
		assert.fail('expected an error');
	} catch (e) {
		assert.ok(e instanceof YamlError);
		assert.equal(e.name, 'YamlError');
		assert.equal(e.line, 2);
		assert.equal(e.column, 4);
		assert.match(e.message, /\(line 2, column 4\)$/);
	}
});

test('duplicate keys are rejected', () => {
	throws('a: 1\na: 2', /duplicate mapping key "a"/);
	throws('a: {x: 1, x: 2}', /duplicate mapping key "x"/);
	throws('a: 1\n"a": 2', /duplicate mapping key/);
});

test('rejects non-string input', () => {
	assert.throws(() => parseYaml(null), TypeError);
	assert.throws(() => parseYaml({}), TypeError);
});
