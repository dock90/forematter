/**
 * A YAML serializer for front matter data.
 *
 * Output is plain block style YAML. Strings are quoted whenever leaving them
 * bare could change their meaning, including under older YAML 1.1 parsers
 * (yes/no booleans, base 60 numbers), so the result reads back the same way.
 */

import { resolvePlain } from './parse-yaml.ts';

const MAX_DEPTH = 100;

/** Characters that need a double-quoted string with escapes. */
function hasSpecial(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 32 || c === 0x7f || c === 0x85 || c === 0x2028 || c === 0x2029 || c === 0xfeff) return true;
	}
	return false;
}

// Text an older YAML 1.1 parser would read as a boolean or a number.
const LEGACY_BOOL = /^(?:yes|no|on|off)$/i;
const NUMBER_LIKE = /^[-+]?(?:\.[0-9]|[0-9])[0-9a-fA-FxXoO_.,:+-]*$/;

/** Whether a single-line string can be written without quotes. */
function isPlainSafe(s: string): boolean {
	const n = s.length;
	const first = s.charCodeAt(0);
	const last = s.charCodeAt(n - 1);
	if (first === 32 || last === 32) return false;
	switch (first) {
		case 33: // !
		case 34: // "
		case 35: // #
		case 37: // %
		case 38: // &
		case 39: // '
		case 42: // *
		case 44: // ,
		case 45: // -
		case 58: // :
		case 62: // >
		case 63: // ?
		case 64: // @
		case 91: // [
		case 93: // ]
		case 96: // `
		case 123: // {
		case 124: // |
		case 125: // }
			return false;
	}
	for (let i = 0; i < n; i++) {
		const c = s.charCodeAt(i);
		if (c === 58) {
			// ": " and a trailing ":" would start a mapping
			if (i === n - 1 || s.charCodeAt(i + 1) === 32) return false;
		} else if (c === 35) {
			// " #" would start a comment
			if (s.charCodeAt(i - 1) === 32) return false;
		}
	}
	if (s === '<<' || s.startsWith('...')) return false;
	if (typeof resolvePlain(s) !== 'string') return false;
	return !LEGACY_BOOL.test(s) && !NUMBER_LIKE.test(s);
}

function doubleQuote(s: string): string {
	return JSON.stringify(s).replace(/[\x7f\x85\u2028\u2029\ufeff]/g, (ch) => '\\u' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
}

/** A single-line scalar or mapping key. */
function scalar(s: string): string {
	if (s === '') return "''";
	if (hasSpecial(s)) return doubleQuote(s);
	if (isPlainSafe(s)) return s;
	return "'" + s.replaceAll("'", "''") + "'";
}

/** Whether a multi-line string can be written as a literal block. */
function isBlockSafe(s: string): boolean {
	let seenContent = false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c === 10) continue;
		if (!seenContent) {
			// The first content line sets the block's indentation, so it cannot
			// start with white space.
			if (c === 32 || c === 9) return false;
			seenContent = true;
		}
		if ((c < 32 && c !== 9) || c === 0x7f || c === 0x85 || c === 0x2028 || c === 0x2029 || c === 0xfeff) return false;
	}
	return seenContent;
}

/** The text that follows "key:" or "-" for a string value. */
function stringValue(s: string, indent: string): string {
	if (s.indexOf('\n') === -1) return ' ' + scalar(s) + '\n';
	if (!isBlockSafe(s)) return ' ' + doubleQuote(s) + '\n';
	let header = '|';
	let body = s;
	if (!s.endsWith('\n')) header = '|-';
	else if (s.endsWith('\n\n')) header = '|+';
	if (header !== '|-') body = s.slice(0, -1);
	const pad = indent + '  ';
	let out = ' ' + header + '\n';
	for (const line of body.split('\n')) out += line === '' ? '\n' : pad + line + '\n';
	return out;
}

/** The text that follows "key:" or "-" for any value. */
function value(v: unknown, indent: string, depth: number, inSeq: boolean): string {
	switch (typeof v) {
		case 'string':
			return stringValue(v, indent);
		case 'number':
			if (v !== v) return ' .nan\n';
			if (v === Infinity) return ' .inf\n';
			if (v === -Infinity) return ' -.inf\n';
			return ' ' + (Object.is(v, -0) ? '-0' : String(v)) + '\n';
		case 'boolean':
			return v ? ' true\n' : ' false\n';
		case 'bigint':
			return ' ' + String(v) + '\n';
		case 'object': {
			if (v === null) return ' null\n';
			if (v instanceof Date) return ' ' + (Number.isNaN(v.getTime()) ? 'null' : v.toISOString()) + '\n';
			if (depth >= MAX_DEPTH) throw new TypeError('cannot stringify: data is nested too deeply or is circular');
			const nested = Array.isArray(v) ? seq(v, indent + '  ', depth + 1) : map(v, indent + '  ', depth + 1);
			if (nested === '') return Array.isArray(v) ? ' []\n' : ' {}\n';
			// Inside a sequence the first line of a nested collection shares the "- " line.
			return inSeq ? ' ' + nested.slice(indent.length + 2) : '\n' + nested;
		}
	}
	// undefined, functions and symbols have no YAML form
	return ' null\n';
}

function seq(items: readonly unknown[], indent: string, depth: number): string {
	let out = '';
	for (let i = 0; i < items.length; i++) out += indent + '-' + value(items[i], indent, depth, true);
	return out;
}

function map(obj: object, indent: string, depth: number): string {
	let out = '';
	for (const key of Object.keys(obj)) {
		const v = (obj as Record<string, unknown>)[key];
		if (v === undefined || typeof v === 'function' || typeof v === 'symbol') continue;
		const k = key.indexOf('\n') === -1 ? scalar(key) : doubleQuote(key);
		out += indent + k + ':' + value(v, indent, depth, false);
	}
	return out;
}

/**
 * Serialize a value to YAML. Object properties that are undefined, functions
 * or symbols are skipped, as JSON.stringify does.
 */
export function stringifyYaml(data: unknown): string {
	if (data !== null && typeof data === 'object' && !(data instanceof Date)) {
		const out = Array.isArray(data) ? seq(data, '', 1) : map(data, '', 1);
		if (out !== '') return out;
		return Array.isArray(data) ? '[]\n' : '{}\n';
	}
	return value(data, '', 0, false).slice(1);
}
