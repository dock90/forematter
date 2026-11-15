import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter, { parseYaml, YamlError } from '../src/index.ts';

const throws = (yaml, pattern) => assert.throws(() => parseYaml(yaml), (e) => e instanceof YamlError && pattern.test(e.message));

/** Small deterministic random number generator, so failures reproduce. */
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

test('__proto__ keys cannot change a prototype', () => {
	for (const yaml of ['__proto__:\n  polluted: true\na: 1', '{__proto__: {polluted: true}, a: 1}', 'x:\n  __proto__: {polluted: true}']) {
		const r = parseYaml(yaml);
		const target = 'x' in r ? r.x : r;
		assert.equal(Object.getPrototypeOf(target), Object.prototype);
		assert.ok(Object.hasOwn(target, '__proto__'));
		assert.equal(target.polluted, undefined);
		assert.equal({}.polluted, undefined);
	}
	const merged = parseYaml('a: &a {__proto__: {polluted: true}}\nb: {<<: *a}');
	assert.equal(Object.getPrototypeOf(merged.b), Object.prototype);
	assert.equal(merged.b.polluted, undefined);
	const json = matter('---json\n{"__proto__": {"polluted": true}}\n---\n');
	assert.equal(json.data.polluted, undefined);
	assert.equal({}.polluted, undefined);
});

test('keys named like Object.prototype members are plain data', () => {
	const r = parseYaml('constructor: 1\ntoString: 2\nhasOwnProperty: 3\nvalueOf: 4');
	assert.deepStrictEqual(r, { constructor: 1, toString: 2, hasOwnProperty: 3, valueOf: 4 });
});

test('JavaScript front matter is never evaluated', () => {
	globalThis.__forematterPwned = false;
	for (const lang of ['js', 'javascript', 'JS']) {
		assert.throws(() => matter(`---${lang}\nglobalThis.__forematterPwned = true\n---\n`), /does not evaluate JavaScript/);
	}
	assert.equal(globalThis.__forematterPwned, false);
	delete globalThis.__forematterPwned;
});

test('tags that construct objects are rejected', () => {
	throws('a: !!js/function "function () { return 1 }"', /unsupported tag/);
	throws('a: !!js/regexp /x/', /unsupported tag/);
	throws('a: !!python/object:os.system x', /unsupported tag/);
});

test('nesting depth is capped', () => {
	assert.deepStrictEqual(parseYaml('['.repeat(100) + ']'.repeat(100)).flat(Infinity), []);
	throws('['.repeat(101) + ']'.repeat(101), /nesting is too deep/);
	throws('{a: '.repeat(101) + '1' + '}'.repeat(101), /nesting is too deep/);
	throws('['.repeat(100_000), /nesting is too deep/);
	let block = '';
	for (let i = 0; i < 150; i++) block += ' '.repeat(i) + 'a:\n';
	throws(block, /nesting is too deep/);
	let seq = '';
	for (let i = 0; i < 150; i++) seq += '- ';
	throws(seq + 'x', /nesting is too deep/);
});

test('alias expansion is capped (billion laughs)', () => {
	const row = (name, ref) => `${name}: &${name} [${Array(10).fill(ref).join(',')}]\n`;
	const bomb = row('a', 'x') + row('b', '*a') + row('c', '*b') + row('d', '*c') + row('e', '*d') + row('f', '*e') + row('g', '*f');
	const started = performance.now();
	throws(bomb, /aliases expand to too many nodes/);
	assert.ok(performance.now() - started < 1000);
	// A modest, legitimate use of aliases is fine.
	const ok = parseYaml(row('a', 'x') + row('b', '*a') + row('c', '*b'));
	assert.equal(ok.c.length, 10);
});

test('pathological inputs finish in linear time', () => {
	const n = 200_000;
	const inputs = {
		'long plain scalar': 'a: ' + 'x'.repeat(n),
		'many colons': 'a: ' + ':'.repeat(n),
		'many spaces': 'a:' + ' '.repeat(n) + 'b',
		'many blank lines': 'a: b\n' + '\n'.repeat(n) + 'c: d',
		'spaces then nothing': 'a: b' + ' '.repeat(n),
		'long comment': 'a: b #' + '#'.repeat(n),
		'many comment lines': '#\n'.repeat(n) + 'a: b',
		'long quoted': 'a: "' + '\\\\'.repeat(n) + '"',
		'quoted line breaks': 'a: "' + '\n'.repeat(n) + '"',
		'single quote escapes': "a: '" + "''".repeat(n) + "'",
		'many keys': Array.from({ length: n / 4 }, (_, i) => `k${i}: ${i}`).join('\n'),
		'many items': '- 1\n'.repeat(n / 4),
		'long flow': 'a: [' + '1,'.repeat(n / 2) + ']',
		'digits': 'a: ' + '1'.repeat(n),
		'date like': 'a: 2026-11-14 ' + ' '.repeat(n) + 'x',
		'date tail': 'a: 2026-11-14T10:30:00.' + '1'.repeat(n) + 'x',
		'plain continuation lines': 'a: b\n' + ' c\n'.repeat(n / 4),
		'block scalar': 'a: |\n' + '  line\n'.repeat(n / 8),
		'folded blank lines': 'a: >\n  x\n' + '\n'.repeat(n) + '  y',
		'unterminated flow': 'a: [' + '['.repeat(50) + 'x,'.repeat(n / 2),
		'tabs': 'a:' + '\t'.repeat(n) + 'b',
	};
	for (const [name, input] of Object.entries(inputs)) {
		const started = performance.now();
		try {
			parseYaml(input);
		} catch (e) {
			assert.ok(e instanceof YamlError, `${name}: ${e}`);
		}
		const ms = performance.now() - started;
		assert.ok(ms < 1500, `${name} took ${ms.toFixed(0)} ms`);
	}
	// The front matter splitter itself: many almost-closing delimiters.
	const started = performance.now();
	const file = matter('---\n|\n' + 'x\n---x\n'.repeat(n / 8) + '---\nbody');
	assert.equal(file.data.length, (n / 8) * 7);
	assert.equal(file.content, 'body');
	assert.ok(performance.now() - started < 1500);
});

test('fuzz: random input either parses or throws a YamlError', () => {
	const random = rng(20261114);
	const alphabet = ['a', 'b', '1', '0', ' ', ' ', '  ', '\n', '\n', '\t', ':', ': ', '- ', '-', '#', ' #', '"', "'", '[', ']', '{', '}', ',', '|', '>', '&', '*', '!', '!!str ', '?', '%', '@', '`', '\\', '<<', '~', '.', '+', 'e', 'null', 'true', '2026-11-14', '\r\n', '\u00e9', '\u{1F600}', '---', '...', 'x: y', '&a ', '*a', '|-\n', '\\n', '\\u00'];
	const seeds = [
		'title: Hello\ntags:\n  - a\n  - b\nmeta:\n  x: 1\n  y: [1, 2, {z: "q"}]\ntext: |\n  line one\n  line two\n',
		'a: &a {x: 1}\nb:\n  <<: *a\n  y: "two\\n"\nc: \'it\'\'s\'\n',
		'- name: one\n  when: 2026-11-14T10:30:00Z\n- name: two\n  body: >-\n    folded\n    text\n',
	];
	let parsed = 0;
	let rejected = 0;
	for (let i = 0; i < 30_000; i++) {
		let input;
		if (i % 2 === 0) {
			const length = 1 + Math.floor(random() * 40);
			input = '';
			for (let j = 0; j < length; j++) input += alphabet[Math.floor(random() * alphabet.length)];
		} else {
			// Mutate a valid document: delete, duplicate or insert at random places.
			input = seeds[i % seeds.length];
			const edits = 1 + Math.floor(random() * 4);
			for (let j = 0; j < edits; j++) {
				const at = Math.floor(random() * input.length);
				const kind = random();
				if (kind < 0.35) input = input.slice(0, at) + input.slice(at + 1 + Math.floor(random() * 5));
				else if (kind < 0.7) input = input.slice(0, at) + alphabet[Math.floor(random() * alphabet.length)] + input.slice(at);
				else input = input.slice(0, at) + input.slice(at, at + 8) + input.slice(at);
			}
		}
		try {
			parseYaml(input);
			matter('---\n' + input + '\n---\nbody');
			parsed++;
		} catch (e) {
			if (!(e instanceof YamlError)) {
				assert.fail(`input ${JSON.stringify(input)} threw ${e && e.stack}`);
			}
			rejected++;
		}
	}
	assert.ok(parsed > 1000, `only ${parsed} inputs parsed`);
	assert.ok(rejected > 1000, `only ${rejected} inputs were rejected`);
});
