import assert from 'node:assert/strict';
import { test } from 'node:test';
import matter, { matter as named, stringify, YamlError } from '../src/index.ts';

test('splits front matter from content', () => {
	const file = matter('---\ntitle: Home\ntags: [a, b]\n---\n# Hello\n');
	assert.deepStrictEqual(file, {
		data: { title: 'Home', tags: ['a', 'b'] },
		content: '# Hello\n',
		excerpt: '',
		language: 'yaml',
		matter: '\ntitle: Home\ntags: [a, b]',
		isEmpty: false,
	});
	assert.equal(named, matter);
});

test('documents without front matter', () => {
	for (const input of ['', 'just text', '# Title\n\n---\n\nrule above', '----\nnot front matter\n----\n', ' ---\nindented\n---\n', '--- not a language name\ntext']) {
		const file = matter(input);
		assert.deepStrictEqual(file.data, {});
		assert.equal(file.content, input);
		assert.equal(file.isEmpty, false);
		assert.equal(file.matter, '');
	}
});

test('empty front matter', () => {
	for (const input of ['---\n---\nbody', '---\n\n---\nbody', '---\n# just a comment\n---\nbody', '---\n   \n  # c\n---\nbody']) {
		const file = matter(input);
		assert.deepStrictEqual(file.data, {});
		assert.equal(file.content, 'body');
		assert.equal(file.isEmpty, true);
	}
	assert.deepStrictEqual(matter('---').data, {});
	assert.equal(matter('---').isEmpty, true);
	assert.deepStrictEqual(matter('---\nnull\n---\nx').data, {});
});

test('content keeps everything after the closing line', () => {
	assert.equal(matter('---\na: 1\n---\n\nbody\n').content, '\nbody\n');
	assert.equal(matter('---\na: 1\n---').content, '');
	assert.equal(matter('---\na: 1\n---\n').content, '');
	assert.equal(matter('---\na: 1\n---  \nbody').content, 'body');
	assert.equal(matter('---\na: 1\n---\nbody\n---\nmore').content, 'body\n---\nmore');
});

test('a missing closing delimiter makes the whole document front matter', () => {
	const file = matter('---\ntitle: x\nn: 2');
	assert.deepStrictEqual(file.data, { title: 'x', n: 2 });
	assert.equal(file.content, '');
});

test('the closing delimiter must be on its own line', () => {
	const file = matter('---\ntext: |\n  a\n  ---\n  b\n---\nbody');
	assert.deepStrictEqual(file.data, { text: 'a\n---\nb\n' });
	assert.equal(file.content, 'body');
	assert.throws(() => matter('---\na: 1\n---not closed\nbody'), YamlError);
});

test('CRLF line endings and a byte order mark', () => {
	const file = matter('\ufeff---\r\ntitle: Home\r\nlist:\r\n  - a\r\n---\r\nbody\r\n');
	assert.deepStrictEqual(file.data, { title: 'Home', list: ['a'] });
	assert.equal(file.content, 'body\r\n');
	assert.equal(file.matter, '\r\ntitle: Home\r\nlist:\r\n  - a\r');
});

test('binary input', () => {
	const bytes = new TextEncoder().encode('---\ntitle: caf\u00e9\n---\nbody');
	assert.deepStrictEqual(matter(bytes).data, { title: 'caf\u00e9' });
	assert.deepStrictEqual(matter(Buffer.from(bytes)).data, { title: 'caf\u00e9' });
	assert.throws(() => matter(null), TypeError);
	assert.throws(() => matter({ content: 'x' }), TypeError);
});

test('front matter that is not a mapping', () => {
	assert.deepStrictEqual(matter('---\n- a\n- b\n---\n').data, ['a', 'b']);
	assert.equal(matter('---\njust text\n---\n').data, 'just text');
});

test('JSON front matter', () => {
	const file = matter('---json\n{"title": "Home", "n": [1, 2]}\n---\nbody');
	assert.deepStrictEqual(file.data, { title: 'Home', n: [1, 2] });
	assert.equal(file.language, 'json');
	assert.equal(file.content, 'body');
	assert.deepStrictEqual(matter('--- JSON \n{"a": 1}\n---\n').data, { a: 1 });
	assert.deepStrictEqual(matter('---\n{"a": 1}\n---\n', { language: 'json' }).data, { a: 1 });
	assert.throws(() => matter('---json\n{bad}\n---\n'), SyntaxError);
});

test('languages and engines', () => {
	assert.deepStrictEqual(matter('---yaml\na: 1\n---\n').data, { a: 1 });
	assert.deepStrictEqual(matter('---yml\na: 1\n---\n').data, { a: 1 });
	assert.throws(() => matter('---toml\na = 1\n---\n'), /no engine is registered for "toml"/);
	const toml = { parse: (input) => ({ raw: input.trim() }), stringify: (data) => `raw = ${JSON.stringify(data)}` };
	const file = matter('---toml\na = 1\n---\nbody', { engines: { toml } });
	assert.deepStrictEqual(file.data, { raw: 'a = 1' });
	assert.equal(file.language, 'toml');
	assert.deepStrictEqual(matter('---toml\na = 1\n---\n', { engines: { toml: (input) => input.trim() } }).data, 'a = 1');
	assert.deepStrictEqual(matter('---\na: 1\n---\n', { engines: { yaml: () => ({ replaced: true }) } }).data, { replaced: true });
	assert.equal(stringify({ content: 'body', data: { a: 1 }, language: 'toml' }, undefined, { engines: { toml } }), '---\nraw = {"a":1}\n---\nbody\n');
});

test('custom delimiters', () => {
	const file = matter('~~~\na: 1\n~~~\nbody', { delimiters: '~~~' });
	assert.deepStrictEqual(file.data, { a: 1 });
	assert.equal(file.content, 'body');
	const pair = matter('<!--\na: 1\n-->\nbody', { delimiters: ['<!--', '-->'] });
	assert.deepStrictEqual(pair.data, { a: 1 });
	assert.equal(pair.content, 'body');
	assert.deepStrictEqual(matter('---\na: 1\n---\nbody', { delimiters: '~~~' }).data, {});
});

test('excerpts', () => {
	assert.equal(matter('---\na: 1\n---\nintro\n---\nrest').excerpt, '');
	assert.equal(matter('---\na: 1\n---\nintro\n---\nrest', { excerpt: true }).excerpt, 'intro\n');
	assert.equal(matter('---\na: 1\n---\nintro\n<!-- more -->\nrest', { excerpt: '<!-- more -->' }).excerpt, 'intro\n');
	assert.equal(matter('---\na: 1\n---\nintro\n<!-- more -->\nrest', { excerpt_separator: '<!-- more -->' }).excerpt, 'intro\n');
	assert.equal(matter('---\nexcerpt_separator: "<!-- more -->"\n---\nintro\n<!-- more -->\nrest').excerpt, 'intro\n');
	assert.equal(matter('---\na: 1\n---\nno separator here', { excerpt: true }).excerpt, '');
	assert.equal(matter('intro\n---\nrest', { excerpt: true }).excerpt, 'intro\n');
	const custom = matter('---\na: 1\n---\nfirst line\nsecond', {
		excerpt: (file) => {
			file.excerpt = file.content.split('\n')[0];
		},
	});
	assert.equal(custom.excerpt, 'first line');
});

test('results are never shared between calls', () => {
	const input = '---\ntags: [a]\n---\nbody';
	const first = matter(input);
	first.data.tags.push('changed');
	first.data.extra = true;
	assert.deepStrictEqual(matter(input).data, { tags: ['a'] });
});

test('YAML errors carry the line within the document', () => {
	try {
		matter('---\ntitle: ok\nbad: [1, 2\n---\nbody');
		assert.fail('expected an error');
	} catch (e) {
		assert.ok(e instanceof YamlError);
		assert.equal(e.line, 3);
	}
});

test('stringify', () => {
	assert.equal(stringify('body', { title: 'Home' }), '---\ntitle: Home\n---\nbody\n');
	assert.equal(matter.stringify('body\n', { title: 'Home', tags: ['a'] }), '---\ntitle: Home\ntags:\n  - a\n---\nbody\n');
	assert.equal(stringify('body', {}), 'body\n');
	assert.equal(stringify('body'), 'body\n');
	// existing front matter is kept and merged
	assert.equal(stringify('---\na: 1\nb: 2\n---\nbody', { b: 3, c: 4 }), '---\na: 1\nb: 3\nc: 4\n---\nbody\n');
	assert.equal(stringify({ content: 'body', data: { a: 1 } }), '---\na: 1\n---\nbody\n');
	assert.equal(stringify({ content: 'body', data: { a: 1 }, language: 'json' }), '---\n{\n  "a": 1\n}\n---\nbody\n');
	assert.equal(stringify('body', { a: 1 }, { delimiters: ['<!--', '-->'] }), '<!--\na: 1\n-->\nbody\n');
	assert.equal(stringify({ content: 'body', data: { a: 1 }, excerpt: 'summary' }), '---\na: 1\n---\nsummary\n---\nbody\n');
	assert.equal(stringify({ content: 'summary\nbody', data: { a: 1 }, excerpt: 'summary' }), '---\na: 1\n---\nsummary\nbody\n');
});

test('parse and stringify round trip', () => {
	const data = { title: 'A: tricky "title"', date: new Date('2026-11-14T08:00:00.000Z'), tags: ['x', 'yes', '1'], nested: { text: 'two\nlines\n', n: 1.5, none: null } };
	const file = matter(stringify('# Body\n\ntext\n', data));
	assert.deepStrictEqual(file.data, data);
	assert.equal(file.content, '# Body\n\ntext\n');
});

test('test() and language()', () => {
	assert.equal(matter.test('---\na: 1\n---'), true);
	assert.equal(matter.test('text'), false);
	assert.equal(matter.test('~~~\na: 1\n~~~', { delimiters: '~~~' }), true);
	assert.deepStrictEqual(matter.language('---json\n{}\n---'), { raw: 'json', name: 'json' });
	assert.deepStrictEqual(matter.language('--- yaml \r\na: 1\n---'), { raw: ' yaml ', name: 'yaml' });
	assert.deepStrictEqual(matter.language('---\na: 1\n---'), { raw: '', name: '' });
});
