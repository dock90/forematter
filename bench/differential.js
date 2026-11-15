// Differential test: forematter against gray-matter 4 (which uses js-yaml 3).
//
//   npm run build && cd bench && npm install && node differential.js
//
// Exits with a non-zero status when the two disagree somewhere they should not.
import assert from 'node:assert/strict';
import grayMatter from 'gray-matter';
import matter, { parseYaml, stringifyYaml } from '../dist/index.js';

const jsYaml = grayMatter.engines.yaml;
let failures = 0;

function same(a, b) {
	try {
		assert.deepStrictEqual(a, b);
		return true;
	} catch {
		return false;
	}
}

function attempt(fn) {
	try {
		return { value: fn() };
	} catch (error) {
		return { error };
	}
}

function report(section, input, ours, theirs) {
	failures++;
	if (failures > 25) return;
	const show = (r) => (r.error ? `throws ${r.error.message.split('\n')[0]}` : JSON.stringify(r.value));
	console.log(`MISMATCH [${section}] ${JSON.stringify(input)}\n  forematter:  ${show(ours)}\n  gray-matter: ${show(theirs)}`);
}

// ---------------------------------------------------------------------------
// 1. Hand-written YAML: both parsers must agree.
// ---------------------------------------------------------------------------
const yamlCorpus = [
	'title: Hello',
	'title: Hello world\ndate: 2026-11-14\ndraft: false\ntags: [a, b]\n',
	'a: 1\nb: -2\nc: 3.5\nd: 1e3\ne: .5\nf: -.inf\ng: .nan\nh: 0x1F\ni: +7',
	'a: null\nb: ~\nc:\nd: Null\ne: NULL',
	'a: true\nb: False\nc: TRUE\nd: yes\ne: no\nf: on\ng: off',
	'a: "double \\"quoted\\" \\n \\t \\u00e9 \\x41"\nb: \'single \'\'quoted\'\'\'\nc: ""\nd: \'\'',
	'a: 2026-11-14\nb: 2026-11-14T10:30:00Z\nc: 2026-11-14 10:30:00 +02:00\nd: 2026-11-14t10:30:00.5-05:30\ne: "2026-11-14"',
	'list:\n  - a\n  - b\nother:\n- c\n- d\n',
	'- name: one\n  tags:\n    - x\n    - y\n- name: two\n  nested:\n    deep: [1, 2, {k: v}]\n',
	'- - a\n  - b\n- - c\n',
	'a:\n  b:\n    c:\n      d: 1\n  e: 2\nf: 3',
	'a: |\n  literal\n  text\n\n  more\nb: >\n  folded\n  text\n\n  more\nc: |-\n  strip\nd: >+\n  keep\n\ne: 1',
	'a: >\n  one\n    indented\n  two\n\n\n  three\n',
	'a: |2\n    x\n  y\n',
	'a: one\n  two\n  three\n\n  four\nb: 2',
	'a: "one\n  two\n\n  three"\nb: \'x\n  y\'',
	'url: http://example.com/path?x=1#frag\ntime: at 5:30 pm\npath: C:\\dir\\file',
	'# comment\na: 1 # trailing\nb: c#d\n# end',
	'a: [1, 2, [3, 4], {x: 1, y: [5]}]\nb: {k: v, "q": \'r\', n: }\nc: []\nd: {}',
	'a: [\n  1,\n  2,\n]\n',
	'{"json": [1, 2.5, "x", null, true, {"a": {}}]}',
	'"quoted key": 1\n\'single\': 2\nkey with spaces: 3\na:b: 4',
	'base: &b\n  x: 1\n  y: 2\nuse: *b\nmerged:\n  <<: *b\n  y: 3\n',
	'a: &x 5\nb: *x\nc: [&y 1, *y]',
	'a: !!str 123\nb: !!str true',
	'just a string',
	'42',
	'- 1\n- two\n-\n- ~\n',
	'a: -x\nb: ?y\nc: :z\nd: a, b\ne: x [y] {z}',
	'emoji: \u{1F600}\naccent: caf\u00e9\ncjk: \u65e5\u672c\u8a9e',
	'a:\r\n  - b\r\n  - c\r\nd: |\r\n  text\r\n',
	'title: "Colons: inside quotes"\nsubtitle: \'and # hashes\'',
	'description: >-\n  A long description that\n  spans several lines.\nkeywords:\n  - one\n  - two\nimage:\n  src: /a.png\n  alt: An image\n',
	'  indented: root\n  second: key',
	'a: 1.\nb: 0\nc: -0\nd: 1.0\ne: 1e-3\nf: 12345678901234567890',
	'empty_block: |\nnext: 1',
	'k: "a\\\n   b"',
	'x: 1\n\n\ny: 2\n\n',
];

// Inputs where forematter differs from js-yaml 3 on purpose.
// See docs/03-migrating-from-gray-matter.md.
const intentional = [
	['a: 0123', { a: 123 }], // YAML 1.2: a leading zero is not octal
	['a: 0o17', { a: 15 }], // YAML 1.2 octal
	['a: 1_000', { a: '1_000' }], // no digit separators in YAML 1.2
	['a: 12:30:00', { a: '12:30:00' }], // no base 60 numbers in YAML 1.2
	['a: 0b101', { a: '0b101' }], // no binary integers in YAML 1.2
	['1: a\ntrue: b\nnull: c', { 1: 'a', true: 'b', null: 'c' }], // keys keep their text
	['a: 2026-13-45', { a: '2026-13-45' }], // not a real date, so not a Date
];

for (const input of yamlCorpus) {
	const ours = attempt(() => parseYaml(input));
	const theirs = attempt(() => jsYaml.parse(input));
	if (ours.error || theirs.error || !same(ours.value, theirs.value)) report('yaml', input, ours, theirs);
}
for (const [input, expected] of intentional) {
	const ours = attempt(() => parseYaml(input));
	if (ours.error || !same(ours.value, expected)) report('intentional', input, ours, { value: expected });
}
console.log(`yaml corpus: ${yamlCorpus.length} documents, ${intentional.length} intentional differences checked`);

// ---------------------------------------------------------------------------
// 2. Whole documents: forematter() against gray-matter().
// ---------------------------------------------------------------------------
const documents = [
	'',
	'no front matter',
	'---\ntitle: Home\n---\nbody',
	'---\ntitle: Home\n---\n\nbody\n\nmore\n',
	'---\ntitle: Home\n---',
	'---\ntitle: Home',
	'---\n---\nbody',
	'---\n\n---\nbody',
	'---\n# comment only\n---\nbody',
	'----\nnot front matter\n----\n',
	'---\r\ntitle: Home\r\ntags:\r\n  - a\r\n---\r\nbody\r\n',
	'\ufeff---\ntitle: Home\n---\nbody',
	'---json\n{"title": "Home", "n": [1, 2]}\n---\nbody',
	'--- yaml\ntitle: Home\n---\nbody',
	'---\n- a\n- b\n---\nbody',
	'---\ntitle: Home\n---\nbody\n---\nmore\n---\n',
	'text first\n---\ntitle: not front matter\n---\n',
	'---\ntext: |\n  a\n  b\n---\nbody',
	'---\nexcerpt_separator: <!-- more -->\n---\nintro\n<!-- more -->\nrest',
];
const optionSets = [undefined, { excerpt: true }, { excerpt: '<!-- more -->' }, { excerpt_separator: '<!-- more -->' }, { delimiters: '~~~' }, { language: 'yaml' }];
const pickFields = (file) => ({ data: file.data, content: file.content, excerpt: file.excerpt, isEmpty: file.isEmpty, language: file.language, matter: file.matter });

for (const input of documents) {
	for (const options of optionSets) {
		grayMatter.clearCache();
		const ours = attempt(() => pickFields(matter(input, options)));
		const theirs = attempt(() => pickFields(grayMatter(input, options)));
		// gray-matter returns early for an empty string and leaves these unset.
		if (!theirs.error && input === '') Object.assign(theirs.value, { isEmpty: false, language: 'yaml', matter: '' });
		if (Boolean(ours.error) !== Boolean(theirs.error) || (!ours.error && !same(ours.value, theirs.value))) {
			report(`document ${JSON.stringify(options)}`, input, ours, theirs);
		}
	}
}
for (const input of ['Body', '---\na: 1\nb: [x]\n---\nBody\n', '---\na: 1\n---\nBody']) {
	for (const data of [{ title: 'Home' }, { b: 2, list: ['x', 'y'], nested: { k: 'v' } }, {}]) {
		grayMatter.clearCache();
		const ours = attempt(() => pickFields(matter(matter.stringify(input, data))));
		const theirs = attempt(() => pickFields(grayMatter(grayMatter.stringify(input, data))));
		// The serialized text may differ in style, so compare what reads back.
		if (ours.error || theirs.error || !same({ data: ours.value.data, content: ours.value.content }, { data: theirs.value.data, content: theirs.value.content })) {
			report('stringify', input, ours, theirs);
		}
	}
}
console.log(`documents: ${documents.length} inputs x ${optionSets.length} option sets, plus stringify`);

// ---------------------------------------------------------------------------
// 3. Random data: each library must read what the other writes.
// ---------------------------------------------------------------------------
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
const random = rng(987654321);
const pick = (list) => list[Math.floor(random() * list.length)];
const pieces = ['a', 'B', 'z', '0', '7', ' ', ' ', ':', '-', '#', ',', '.', "'", '"', '\\', '\n', '\n', '\t', '[', ']', '{', '}', '&', '*', '!', '|', '>', '%', '@', '`', '?', '~', '+', '_', '<', 'e', 'x', 'null', 'true', 'no', '\u00e9', '\u{1F600}'];
const words = ['', 'title', 'yes', 'No', 'NULL', '~', '1', '-1', '1.0', '0x10', '0b11', '017', '1e5', '.5', '.nan', '-.inf', '2026-11-14', '2026-11-14T10:00:00Z', '12:30:45', '1_000', '<<', '---', '...', '- a', 'a: b', 'a #b', '#', ' ', '  x  ', 'key:', '? x', '[a]', '{a: 1}', '*a', '&a x', '!!str x', '| x', '> x', 'multi\nline', 'trailing\n', '\nleading', 'two\n\nparas\n\n', ' indented\nfirst', 'tab\tbed', 'y', 'n', '=', 'a long sentence of plain words that goes on for quite a while so that a serializer may decide to fold it across several lines of output text', 'constructor'];
const string = () => {
	if (random() < 0.5) return pick(words);
	let s = '';
	const length = Math.floor(random() * 12);
	for (let i = 0; i < length; i++) s += pick(pieces);
	return s;
};
const number = () => {
	const r = random();
	if (r < 0.4) return Math.floor(random() * 2000) - 1000;
	if (r < 0.7) return (random() - 0.5) * 10 ** Math.floor(random() * 40 - 20);
	return pick([0, NaN, Infinity, -Infinity, 1e21, 1e-7, 0.1, Number.MAX_SAFE_INTEGER]);
};
const value = (depth) => {
	const r = random();
	if (depth < 4 && r < 0.2) return Array.from({ length: Math.floor(random() * 4) }, () => value(depth + 1));
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
	return new Date(Math.floor(random() * 4e12));
};

const ROUNDS = 20_000;
for (let i = 0; i < ROUNDS; i++) {
	const data = { root: value(0) };
	// forematter reads what js-yaml writes
	const theirText = jsYaml.stringify(data);
	const oursRead = attempt(() => parseYaml(theirText));
	if (oursRead.error || !same(oursRead.value, data)) report('read js-yaml output', theirText, oursRead, { value: data });
	// js-yaml reads what forematter writes
	const ourText = stringifyYaml(data);
	const theirsRead = attempt(() => jsYaml.parse(ourText));
	if (theirsRead.error || !same(theirsRead.value, data)) report('js-yaml reads our output', ourText, { value: data }, theirsRead);
}
console.log(`random data: ${ROUNDS} values written by each library and read by the other`);

console.log(failures === 0 ? '\nOK: no unexpected differences' : `\nFAILED: ${failures} unexpected differences`);
process.exit(failures === 0 ? 0 : 1);
