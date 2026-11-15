import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseYaml, stringifyYaml } from '../src/index.ts';

const roundTrip = (value) => assert.deepStrictEqual(parseYaml(stringifyYaml(value)), value, `via ${JSON.stringify(stringifyYaml(value))}`);

function rng(seed) {
	let s = seed >>> 0;
	return () => {
		s = (s + 0x6d2b79f5) >>> 0;
		let t = s;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

test('a typical document', () => {
	const data = {
		title: 'Hello world',
		date: new Date('2026-11-14T00:00:00.000Z'),
		draft: false,
		weight: 3,
		tags: ['news', 'launch'],
		author: { name: 'Ada', links: [] },
		summary: 'First line\nSecond line\n',
		empty: {},
		nothing: null,
	};
	assert.equal(
		stringifyYaml(data),
		[
			'title: Hello world',
			'date: 2026-11-14T00:00:00.000Z',
			'draft: false',
			'weight: 3',
			'tags:',
			'  - news',
			'  - launch',
			'author:',
			'  name: Ada',
			'  links: []',
			'summary: |',
			'  First line',
			'  Second line',
			'empty: {}',
			'nothing: null',
			'',
		].join('\n'),
	);
	roundTrip(data);
});

test('nested collections', () => {
	assert.equal(stringifyYaml([{ a: 1, b: [2, 3] }, ['x', ['y']], 'z']), '- a: 1\n  b:\n    - 2\n    - 3\n- - x\n  - - y\n- z\n');
	assert.equal(stringifyYaml({ a: { b: { c: [{ d: 1 }] } } }), 'a:\n  b:\n    c:\n      - d: 1\n');
	assert.equal(stringifyYaml({}), '{}\n');
	assert.equal(stringifyYaml([]), '[]\n');
	assert.equal(stringifyYaml([[], {}, [[]]]), '- []\n- {}\n- - []\n');
});

test('strings are quoted when a bare value would change meaning', () => {
	const quoted = {
		'': "''",
		true: "'true'",
		False: "'False'",
		null: "'null'",
		'~': "'~'",
		123: "'123'",
		'1.5': "'1.5'",
		'0x1F': "'0x1F'",
		'1e3': "'1e3'",
		'.inf': "'.inf'",
		'2026-11-14': "'2026-11-14'",
		yes: "'yes'",
		No: "'No'",
		on: "'on'",
		'12:30': "'12:30'",
		'1_000': "'1_000'",
		' lead': "' lead'",
		'trail ': "'trail '",
		'a: b': "'a: b'",
		'a #b': "'a #b'",
		'ends:': "'ends:'",
		'- item': "'- item'",
		'#tag': "'#tag'",
		'[x]': "'[x]'",
		'{x}': "'{x}'",
		'*star': "'*star'",
		'&and': "'&and'",
		'!bang': "'!bang'",
		'|pipe': "'|pipe'",
		'>gt': "'>gt'",
		'@at': "'@at'",
		'`tick': "'`tick'",
		'%pct': "'%pct'",
		"it's": "it's",
		"'quoted'": "'''quoted'''",
		'"dq"': "'\"dq\"'",
		'<<': "'<<'",
		'...': "'...'",
		'---': "'---'",
		'tab\there': '"tab\\there"',
		'bell\x07': '"bell\\u0007"',
		'ls\u2028': '"ls\\u2028"',
	};
	for (const [input, expected] of Object.entries(quoted)) {
		assert.equal(stringifyYaml({ k: input }), `k: ${expected}\n`, JSON.stringify(input));
		roundTrip({ k: input });
		roundTrip([input]);
		roundTrip(input);
	}
});

test('strings that are safe stay bare', () => {
	for (const s of ['plain', 'two words', 'a:b', 'a#b', 'http://example.com/x?y=1#z', 'caf\u00e9', 'x, y', 'a [b] {c}', '2nd place', 'v1.2.3', 'truth', 'nullable', "it's"]) {
		assert.equal(stringifyYaml({ k: s }), `k: ${s}\n`);
		roundTrip({ k: s });
	}
});

test('multi-line strings', () => {
	assert.equal(stringifyYaml({ k: 'a\nb' }), 'k: |-\n  a\n  b\n');
	assert.equal(stringifyYaml({ k: 'a\nb\n' }), 'k: |\n  a\n  b\n');
	assert.equal(stringifyYaml({ k: 'a\n\nb\n\n\n' }), 'k: |+\n  a\n\n  b\n\n\n');
	assert.equal(stringifyYaml({ k: ' lead\nb' }), 'k: " lead\\nb"\n');
	assert.equal(stringifyYaml({ k: '\n' }), 'k: "\\n"\n');
	assert.equal(stringifyYaml(['a\nb']), '- |-\n  a\n  b\n');
	for (const s of ['a\nb', 'a\nb\n', 'a\n\nb\n\n\n', ' lead\nb', '\n', '\n\n', '\na', 'a\n  b\n c', 'a\n \nb', 'a\n\t\nb\n', 'a\r\nb', 'x\n# not a comment\nk: v\n', 'a\n---\nb', 'trailing \nspace \n', '\n\nlate start\n']) {
		roundTrip({ k: s });
		roundTrip([s, { n: [s] }]);
		roundTrip(s);
	}
});

test('numbers, dates and other values', () => {
	assert.equal(stringifyYaml({ a: 1, b: -2.5, c: 1e21, d: 1e-7, e: NaN, f: Infinity, g: -Infinity, h: -0 }), 'a: 1\nb: -2.5\nc: 1e+21\nd: 1e-7\ne: .nan\nf: .inf\ng: -.inf\nh: -0\n');
	roundTrip({ a: 1, b: -2.5, c: 1e21, d: 1e-7, e: NaN, f: Infinity, g: -Infinity, h: -0, i: Number.MAX_SAFE_INTEGER, j: 5e-324 });
	roundTrip({ d: new Date('1999-12-31T23:59:59.999Z'), e: [new Date(0)] });
	assert.equal(stringifyYaml({ d: new Date(NaN) }), 'd: null\n');
	assert.equal(stringifyYaml({ a: undefined, b: () => 1, c: Symbol('x'), d: 1 }), 'd: 1\n');
	assert.equal(stringifyYaml([undefined, () => 1]), '- null\n- null\n');
	assert.equal(stringifyYaml({ n: 10n }), 'n: 10\n');
	assert.equal(stringifyYaml(null), 'null\n');
	assert.equal(stringifyYaml('text'), 'text\n');
	assert.equal(stringifyYaml(5), '5\n');
});

test('keys are quoted like values', () => {
	assert.equal(stringifyYaml({ 'a b': 1, 'a: b': 2, 1: 3, true: 4, '': 5, 'line\nbreak': 6, '<<': 7 }), "'1': 3\na b: 1\n'a: b': 2\n'true': 4\n'': 5\n\"line\\nbreak\": 6\n'<<': 7\n");
	roundTrip({ 'a b': 1, 'a: b': 2, 1: 3, true: 4, '': 5, 'line\nbreak': 6, '<<': 7, '- x': 8, '#': 9, constructor: 10 });
	const withProto = Object.defineProperty({}, '__proto__', { value: { x: 1 }, enumerable: true, writable: true, configurable: true });
	assert.equal(stringifyYaml(withProto), '__proto__:\n  x: 1\n');
	roundTrip(withProto);
});

test('circular and very deep data throws instead of overflowing', () => {
	const loop = { a: {} };
	loop.a.self = loop;
	assert.throws(() => stringifyYaml(loop), /nested too deeply or is circular/);
	let deep = [];
	for (let i = 0; i < 200; i++) deep = [deep];
	assert.throws(() => stringifyYaml(deep), /nested too deeply or is circular/);
});

test('fuzz: random data survives a round trip', () => {
	const random = rng(424242);
	const pick = (list) => list[Math.floor(random() * list.length)];
	const pieces = ['a', 'B', 'z', '0', '7', ' ', ' ', ':', '-', '#', ',', '.', "'", '"', '\\', '\n', '\n', '\t', '[', ']', '{', '}', '&', '*', '!', '|', '>', '%', '@', '`', '?', '~', '+', '_', '<', 'e', 'x', 'null', 'true', 'no', '\u00e9', '\u2028', '\u{1F600}', '\r', '\x00', '\x7f', '\ufeff'];
	const words = ['', 'title', 'yes', 'No', 'NULL', '~', '1', '-1', '1.0', '0x10', '0o7', '1e5', '.5', '.nan', '-.inf', '2026-11-14', '2026-11-14T10:00:00Z', '12:30:45', '1_000', '<<', '---', '...', '- a', 'a: b', 'a #b', '#', ' ', '  x  ', 'key:', '? x', '[a]', '{a: 1}', '*a', '&a x', '!!str x', '| x', '> x', 'multi\nline', 'trailing\n', '\nleading', 'two\n\nparas\n\n', ' indented\nfirst', 'tab\tbed', '__proto__x', 'constructor'];
	const string = () => {
		if (random() < 0.5) return pick(words);
		let s = '';
		const length = Math.floor(random() * 12);
		for (let i = 0; i < length; i++) s += pick(pieces);
		return s;
	};
	const number = () => {
		const r = random();
		if (r < 0.3) return Math.floor(random() * 2000) - 1000;
		if (r < 0.6) return (random() - 0.5) * 10 ** Math.floor(random() * 40 - 20);
		return pick([0, -0, NaN, Infinity, -Infinity, 1e21, 1e-7, 0.1, Number.MAX_SAFE_INTEGER, Number.MIN_VALUE]);
	};
	const value = (depth) => {
		const r = random();
		if (depth < 4 && r < 0.2) {
			const out = [];
			const length = Math.floor(random() * 4);
			for (let i = 0; i < length; i++) out.push(value(depth + 1));
			return out;
		}
		if (depth < 4 && r < 0.45) {
			const out = {};
			const length = Math.floor(random() * 4);
			for (let i = 0; i < length; i++) {
				const key = string();
				if (key !== '__proto__') out[key] = value(depth + 1);
			}
			return out;
		}
		if (r < 0.7) return string();
		if (r < 0.85) return number();
		if (r < 0.9) return random() < 0.5;
		if (r < 0.95) return null;
		return new Date(Math.floor((random() - 0.3) * 4e12));
	};
	for (let i = 0; i < 20_000; i++) roundTrip(value(0));
});
