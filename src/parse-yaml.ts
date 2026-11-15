/**
 * A YAML parser for front matter.
 *
 * It is a single pass, hand-written scanner with no regular expressions on the
 * hot path, so parse time is linear in the input size. It covers the YAML that
 * front matter actually uses (see the README) and throws a
 * YamlError for anything it does not support. It never guesses.
 */

export class YamlError extends Error {
	line: number;
	column: number;

	constructor(reason: string, line: number, column: number) {
		super(`${reason} (line ${line}, column ${column})`);
		this.name = 'YamlError';
		this.line = line;
		this.column = column;
	}
}

/** Maximum nesting of collections. Guards against stack exhaustion. */
const MAX_DEPTH = 100;
/** Maximum number of nodes that aliases may expand to. Guards against "billion laughs" documents. */
const MAX_ALIAS_NODES = 100_000;

// Typed as number so that comparisons do not narrow `stop` across calls that change it.
const STOP_END: number = 0;
const STOP_KEY: number = 1;
const STOP_COMMENT: number = 2;

interface Anchor {
	value: unknown;
	size: number;
}

// Parser state. Parsing is synchronous and never re-entered, so module level
// state is safe and is faster than threading a context object through calls.
let src = '';
let end = 0;
let pos = 0;
/** Indentation of the current content line, or -1 at the end of input. */
let ind = -1;
let depth = 0;
let nodes = 0;
let aliasCost = 0;
let anchors: Map<string, Anchor> | undefined;
/** Why the last plain scalar scan stopped. */
let stop = STOP_END;
/** Whether the last quoted scalar spanned more than one line. */
let multiline = false;
/** Whether the last mapping key was quoted. */
let keyQuoted = false;
/** Set by the !!str tag: the next plain scalar is kept as a string. */
let rawScalar = false;
let allowMarker = true;
// Search caches for scanPlain: the result is valid for any start in [from, at].
let colonFrom = 0;
let colonAt = -1;
let hashFrom = 0;
let hashAt = -1;
let breakFrom = 0;
let breakAt = -1;

const hasOwn = Object.prototype.hasOwnProperty;

/**
 * Parse a YAML document. Returns undefined for a document with no content.
 */
export function parseYaml(input: string): unknown {
	if (typeof input !== 'string') throw new TypeError('expected a string');
	if (input.indexOf('\r') !== -1) input = input.replace(/\r\n?/g, '\n');
	src = input;
	end = input.length;
	pos = 0;
	depth = 0;
	nodes = 0;
	aliasCost = 0;
	anchors = undefined;
	rawScalar = false;
	allowMarker = true;
	colonAt = hashAt = breakAt = -1;
	colonFrom = hashFrom = breakFrom = 0;
	try {
		skipBlank();
		if (ind === -1) return undefined;
		const value = parseNode(ind, -1);
		if (ind !== -1) fail('bad indentation', pos);
		return value;
	} finally {
		src = '';
		anchors = undefined;
	}
}

function fail(reason: string, at: number): never {
	const limit = at < end ? at : end;
	let line = 1;
	let lineStart = 0;
	for (let p = src.indexOf('\n'); p !== -1 && p < limit; p = src.indexOf('\n', p + 1)) {
		line++;
		lineStart = p + 1;
	}
	throw new YamlError(reason, line, limit - lineStart + 1);
}

/** True for a space, tab, line break, or the end of input. */
function isSep(c: number): boolean {
	return c === 32 || c === 10 || c === 9 || c !== c;
}

/** True for characters that cannot start a plain scalar. */
function isIndicator(c: number): boolean {
	switch (c) {
		case 33: // !
		case 34: // "
		case 35: // #
		case 37: // %
		case 38: // &
		case 39: // '
		case 42: // *
		case 44: // ,
		case 62: // >
		case 64: // @
		case 91: // [
		case 93: // ]
		case 96: // `
		case 123: // {
		case 124: // |
		case 125: // }
			return true;
	}
	return false;
}

function isMarker(p: number): boolean {
	const c = src.charCodeAt(p);
	return (c === 45 || c === 46) && src.charCodeAt(p + 1) === c && src.charCodeAt(p + 2) === c && isSep(src.charCodeAt(p + 3));
}

function trimEnd(start: number, e: number): number {
	while (e > start) {
		const c = src.charCodeAt(e - 1);
		if (c !== 32 && c !== 9) break;
		e--;
	}
	return e;
}

/**
 * From the start of a line, skip blank and comment lines. Leaves pos on the
 * first content character and ind at its column.
 */
function skipBlank(): void {
	let p = pos;
	for (;;) {
		let q = p;
		let c = src.charCodeAt(q);
		while (c === 32) c = src.charCodeAt(++q);
		if (c === 10) {
			p = q + 1;
			continue;
		}
		if (c === 9) {
			// A tab is fine on a blank or comment line, but not as indentation.
			let r = q;
			while (c === 32 || c === 9) c = src.charCodeAt(++r);
			if (c !== 10 && c !== 35 && r < end) fail('tabs are not allowed for indentation', q);
			q = r;
			if (c === 10) {
				p = q + 1;
				continue;
			}
		}
		if (c === 35) {
			const nl = src.indexOf('\n', q);
			if (nl === -1) break;
			p = nl + 1;
			continue;
		}
		if (q >= end) break;
		if (q === p && isMarker(q)) {
			if (allowMarker && c === 45) {
				// A single leading "---" line is accepted and skipped.
				allowMarker = false;
				let r = q + 3;
				c = src.charCodeAt(r);
				while (c === 32 || c === 9) c = src.charCodeAt(++r);
				if (c === 10) {
					p = r + 1;
					continue;
				}
				if (r >= end) break;
				if (c === 35) {
					const nl = src.indexOf('\n', r);
					if (nl === -1) break;
					p = nl + 1;
					continue;
				}
				fail('content on the "---" line is not supported', r);
			}
			fail('document markers and multiple documents are not supported', q);
		}
		allowMarker = false;
		pos = q;
		ind = q - p;
		return;
	}
	pos = end;
	ind = -1;
}

/**
 * After an inline value: allow trailing spaces and a comment, then move to the
 * next content line.
 */
function endLine(): void {
	let p = pos;
	let c = src.charCodeAt(p);
	while (c === 32 || c === 9) c = src.charCodeAt(++p);
	if (c === 10) {
		pos = p + 1;
	} else if (p >= end) {
		pos = end;
	} else if (c === 35 && (p > pos || isSep(src.charCodeAt(p - 1)))) {
		const nl = src.indexOf('\n', p);
		pos = nl === -1 ? end : nl + 1;
	} else {
		fail(c === 58 ? 'mapping values are not allowed here' : 'unexpected content after a value', p);
	}
	skipBlank();
}

/** Parse the node that starts at pos, which is at column col. */
function parseNode(col: number, parent: number): unknown {
	const c = src.charCodeAt(pos);
	switch (c) {
		case 45: // -
			if (isSep(src.charCodeAt(pos + 1))) return parseSeq(col);
			break;
		case 34: // "
		case 39: {
			// '
			const start = pos;
			const text = c === 34 ? parseDouble() : parseSingle();
			let p = pos;
			let d = src.charCodeAt(p);
			while (d === 32 || d === 9) d = src.charCodeAt(++p);
			if (d === 58 && isSep(src.charCodeAt(p + 1))) {
				if (multiline) fail('multi-line mapping keys are not supported', start);
				pos = p + 1;
				return parseMap(col, text, true, start);
			}
			nodes++;
			endLine();
			return text;
		}
		case 63: // ?
			if (isSep(src.charCodeAt(pos + 1))) fail('complex mapping keys ("? key") are not supported', pos);
			break;
		case 91: // [
		case 123: // {
		case 124: // |
		case 62: // >
		case 38: // &
		case 42: // *
		case 33: // !
			return parseInline(parent);
		case 37: // %
		case 44: // ,
		case 64: // @
		case 93: // ]
		case 96: // `
		case 125: // }
			fail('unexpected character', pos);
	}
	return parsePlain(col, parent, true);
}

/** Parse a value that cannot be a block mapping or block sequence. */
function parseInline(parent: number): unknown {
	const c = src.charCodeAt(pos);
	switch (c) {
		case 34: {
			const text = parseDouble();
			nodes++;
			endLine();
			return text;
		}
		case 39: {
			const text = parseSingle();
			nodes++;
			endLine();
			return text;
		}
		case 91: {
			const value = parseFlowSeq();
			endLine();
			return value;
		}
		case 123: {
			const value = parseFlowMap();
			endLine();
			return value;
		}
		case 124:
			return parseBlockScalar(parent, false);
		case 62:
			return parseBlockScalar(parent, true);
		case 38:
			return parseAnchored(parent);
		case 42: {
			const value = parseAlias();
			endLine();
			return value;
		}
		case 33:
			return parseTagged(parent);
		case 45:
			if (isSep(src.charCodeAt(pos + 1))) fail('a sequence entry is not allowed here', pos);
			break;
		case 63:
			if (isSep(src.charCodeAt(pos + 1))) fail('complex mapping keys ("? key") are not supported', pos);
			break;
		case 37:
		case 44:
		case 64:
		case 93:
		case 96:
		case 125:
			fail('unexpected character', pos);
	}
	return parsePlain(-1, parent, false);
}

function parseSeq(col: number): unknown[] {
	if (++depth > MAX_DEPTH) fail('nesting is too deep', pos);
	const out: unknown[] = [];
	nodes++;
	for (;;) {
		// pos is on the "-" of an entry.
		const dash = pos;
		let p = dash + 1;
		let c = src.charCodeAt(p);
		let tab = false;
		while (c === 32 || c === 9) {
			if (c === 9) tab = true;
			c = src.charCodeAt(++p);
		}
		pos = p;
		if (c === 10 || c === 35 || p >= end) {
			endLine();
			if (ind > col) {
				out.push(parseNode(ind, col));
			} else {
				out.push(null);
				nodes++;
			}
		} else if (tab) {
			// The column is ambiguous after a tab, so no nested block collection.
			out.push(parseInline(col));
		} else {
			out.push(parseNode(col + (p - dash), col));
		}
		if (ind !== col) {
			if (ind > col) fail('bad indentation of a sequence entry', pos);
			break;
		}
		if (src.charCodeAt(pos) !== 45 || !isSep(src.charCodeAt(pos + 1))) break;
	}
	depth--;
	return out;
}

function parseMap(col: number, key: string, quoted: boolean, keyAt: number): Record<string, unknown> {
	if (++depth > MAX_DEPTH) fail('nesting is too deep', pos);
	const out: Record<string, unknown> = {};
	let merged: Set<string> | undefined;
	nodes++;
	for (;;) {
		// pos is just after the ":" of a key.
		let value: unknown;
		let p = pos;
		let c = src.charCodeAt(p);
		while (c === 32 || c === 9) c = src.charCodeAt(++p);
		pos = p;
		if (c === 10 || c === 35 || p >= end) {
			endLine();
			if (ind > col) {
				value = parseNode(ind, col);
			} else if (ind === col && src.charCodeAt(pos) === 45 && isSep(src.charCodeAt(pos + 1))) {
				// A sequence may sit at the same indentation as its key.
				value = parseSeq(col);
			} else {
				value = null;
				nodes++;
			}
		} else {
			value = parseInline(col);
		}
		if (key === '<<' && !quoted) {
			merged = merge(out, value, merged, keyAt);
		} else {
			if (hasOwn.call(out, key) && !(merged !== undefined && merged.delete(key))) {
				fail(`duplicate mapping key "${key}"`, keyAt);
			}
			setKey(out, key, value);
		}
		if (ind !== col) {
			if (ind > col) fail('bad indentation of a mapping entry', pos);
			break;
		}
		keyAt = pos;
		key = parseKey();
		quoted = keyQuoted;
	}
	depth--;
	return out;
}

function setKey(out: Record<string, unknown>, key: string, value: unknown): void {
	if (key === '__proto__') {
		// Assigning would change the prototype. Define an own property instead.
		Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
	} else {
		out[key] = value;
	}
}

/** Apply a "<<" merge key. Keys already present are kept. */
function merge(out: Record<string, unknown>, value: unknown, merged: Set<string> | undefined, at: number): Set<string> {
	const sources = Array.isArray(value) ? value : [value];
	merged ??= new Set();
	for (const source of sources) {
		if (source === null || typeof source !== 'object' || Array.isArray(source) || source instanceof Date) {
			fail('a merge key ("<<") needs a mapping or a list of mappings', at);
		}
		for (const k of Object.keys(source)) {
			if (hasOwn.call(out, k)) continue;
			setKey(out, k, (source as Record<string, unknown>)[k]);
			merged.add(k);
		}
	}
	return merged;
}

/** Parse a mapping key at pos and leave pos just after its ":". */
function parseKey(): string {
	const start = pos;
	const c = src.charCodeAt(start);
	if (c === 34 || c === 39) {
		const key = c === 34 ? parseDouble() : parseSingle();
		let p = pos;
		let d = src.charCodeAt(p);
		while (d === 32 || d === 9) d = src.charCodeAt(++p);
		if (d !== 58 || !isSep(src.charCodeAt(p + 1))) fail('expected ":" after a mapping key', p);
		if (multiline) fail('multi-line mapping keys are not supported', start);
		pos = p + 1;
		keyQuoted = true;
		return key;
	}
	if (c === 45 && isSep(src.charCodeAt(start + 1))) fail('a sequence entry is not allowed here', start);
	if (c === 63 && isSep(src.charCodeAt(start + 1))) fail('complex mapping keys ("? key") are not supported', start);
	if (isIndicator(c)) fail('unsupported mapping key', start);
	const p = scanPlain(start);
	if (stop !== STOP_KEY) fail('expected a mapping entry ("key: value")', start);
	if (p === start) fail('missing mapping key', start);
	pos = p + 1;
	keyQuoted = false;
	return src.slice(start, trimEnd(start, p));
}

/**
 * The next position of a character at or after p, or `end` when there is none.
 * Each search result is cached, so that scanning many short lines never walks
 * the same stretch of input twice and total work stays linear.
 */
function nextColon(p: number): number {
	if (p < colonFrom || p > colonAt) {
		const at = src.indexOf(':', p);
		colonFrom = p;
		colonAt = at === -1 ? end : at;
	}
	return colonAt;
}

function nextHash(p: number): number {
	if (p < hashFrom || p > hashAt) {
		const at = src.indexOf('#', p);
		hashFrom = p;
		hashAt = at === -1 ? end : at;
	}
	return hashAt;
}

function nextBreak(p: number): number {
	if (p < breakFrom || p > breakAt) {
		const at = src.indexOf('\n', p);
		breakFrom = p;
		breakAt = at === -1 ? end : at;
	}
	return breakAt;
}

/**
 * Scan one line of a plain scalar starting at p. Returns where it ends and
 * records why in `stop`: a ":" that starts a mapping value, a " #" comment,
 * or the end of the line.
 */
function scanPlain(p: number): number {
	const eol = nextBreak(p);
	let k = nextColon(p);
	while (k < eol && !isSep(src.charCodeAt(k + 1))) k = nextColon(k + 1);
	let h = nextHash(p);
	while (h < eol) {
		const b = src.charCodeAt(h - 1);
		if (b === 32 || b === 9) break;
		h = nextHash(h + 1);
	}
	if (k < eol && k < h) {
		stop = STOP_KEY;
		return k;
	}
	if (h < eol) {
		stop = STOP_COMMENT;
		return h;
	}
	stop = STOP_END;
	return eol;
}

/**
 * Parse a plain (unquoted) scalar, which may continue on more indented lines.
 * With allowKey, a "key: " turns it into the first key of a block mapping.
 */
function parsePlain(col: number, parent: number, allowKey: boolean): unknown {
	const start = pos;
	let p = scanPlain(start);
	if (stop === STOP_KEY) {
		if (!allowKey) fail('mapping values are not allowed here', p);
		if (p === start) fail('missing mapping key', start);
		pos = p + 1;
		return parseMap(col, src.slice(start, trimEnd(start, p)), false, start);
	}
	let text = src.slice(start, trimEnd(start, p));
	let folded = false;
	while (stop === STOP_END && p < end) {
		// p is on a line break. Look for a continuation line.
		let q = p + 1;
		let lineStart = q;
		let breaks = 1;
		let c = src.charCodeAt(q);
		for (;;) {
			while (c === 32) c = src.charCodeAt(++q);
			if (c !== 10) break;
			breaks++;
			lineStart = ++q;
			c = src.charCodeAt(q);
		}
		if (q >= end || c === 35 || c === 9 || q - lineStart <= parent) break;
		if (q === lineStart && isMarker(q)) break;
		const e = scanPlain(q);
		if (stop === STOP_KEY) fail('mapping values are not allowed here', e);
		text += (breaks === 1 ? ' ' : '\n'.repeat(breaks - 1)) + src.slice(q, trimEnd(q, e));
		folded = true;
		p = e;
	}
	if (stop === STOP_COMMENT) {
		const nl = src.indexOf('\n', p);
		pos = nl === -1 ? end : nl + 1;
	} else {
		pos = p < end ? p + 1 : end;
	}
	skipBlank();
	nodes++;
	if (rawScalar) {
		rawScalar = false;
		return text;
	}
	return folded ? text : resolvePlain(text);
}

/** Resolve a plain scalar to null, a boolean, a number, a Date, or a string (YAML 1.2 core schema plus timestamps). */
export function resolvePlain(s: string): unknown {
	switch (s.charCodeAt(0)) {
		case 126: // ~
			return s.length === 1 ? null : s;
		case 110: // n
			return s === 'null' ? null : s;
		case 78: // N
			return s === 'Null' || s === 'NULL' ? null : s;
		case 116: // t
			return s === 'true' ? true : s;
		case 84: // T
			return s === 'True' || s === 'TRUE' ? true : s;
		case 102: // f
			return s === 'false' ? false : s;
		case 70: // F
			return s === 'False' || s === 'FALSE' ? false : s;
		case 43: // +
		case 45: // -
		case 46: // .
		case 48:
		case 49:
		case 50:
		case 51:
		case 52:
		case 53:
		case 54:
		case 55:
		case 56:
		case 57:
			return resolveNumber(s);
	}
	return s;
}

function resolveNumber(s: string): unknown {
	const n = s.length;
	let i = 0;
	let c = s.charCodeAt(0);
	if (c === 43 || c === 45) c = s.charCodeAt(++i);
	if (c === 46) {
		if (n - i === 4) {
			const word = s.slice(i + 1);
			if (word === 'inf' || word === 'Inf' || word === 'INF') return s.charCodeAt(0) === 45 ? -Infinity : Infinity;
			if (i === 0 && (word === 'nan' || word === 'NaN' || word === 'NAN')) return NaN;
		}
		c = s.charCodeAt(++i);
		if (!(c >= 48 && c <= 57)) return s;
		while (c >= 48 && c <= 57) c = s.charCodeAt(++i);
	} else {
		if (!(c >= 48 && c <= 57)) return s;
		if (c === 48 && i === 0 && n > 2) {
			const x = s.charCodeAt(1);
			if (x === 120 || x === 111) {
				// 0x hexadecimal or 0o octal
				for (let j = 2; j < n; j++) {
					const d = s.charCodeAt(j);
					const ok = x === 111 ? d >= 48 && d <= 55 : (d >= 48 && d <= 57) || (d >= 97 && d <= 102) || (d >= 65 && d <= 70);
					if (!ok) return s;
				}
				return Number(s);
			}
		}
		while (c >= 48 && c <= 57) c = s.charCodeAt(++i);
		// "|| 0" because an integer has no negative zero
		if (i === n) return Number(s) || 0;
		if (c === 45 && i === 4 && n >= 10) return resolveTimestamp(s);
		if (c === 46) {
			c = s.charCodeAt(++i);
			while (c >= 48 && c <= 57) c = s.charCodeAt(++i);
		}
	}
	if (c === 101 || c === 69) {
		c = s.charCodeAt(++i);
		if (c === 43 || c === 45) c = s.charCodeAt(++i);
		if (!(c >= 48 && c <= 57)) return s;
		while (c >= 48 && c <= 57) c = s.charCodeAt(++i);
	}
	return i === n ? Number(s) : s;
}

// Both patterns are anchored and have no nested or overlapping quantifiers,
// so they match in linear time. They only run on text that starts "NNNN-".
const DATE = /^(\d{4})-(\d\d)-(\d\d)$/;
const DATE_TIME = /^(\d{4})-(\d\d?)-(\d\d?)(?:[Tt]|[ \t]+)(\d\d?):(\d\d):(\d\d)(?:\.(\d*))?(?:[ \t]*(?:Z|([-+])(\d\d?)(?::(\d\d))?))?$/;

/** Two digits at i as a number, or NaN. */
function twoDigits(s: string, i: number): number {
	const a = s.charCodeAt(i) - 48;
	const b = s.charCodeAt(i + 1) - 48;
	return a >= 0 && a <= 9 && b >= 0 && b <= 9 ? a * 10 + b : NaN;
}

function resolveTimestamp(s: string): unknown {
	// Fast paths for YYYY-MM-DD and YYYY-MM-DDTHH:MM:SS[.mmm]Z, with no regular
	// expression. The caller has checked the four year digits and the first "-".
	const n = s.length;
	if (s.charCodeAt(7) === 45) {
		const year = twoDigits(s, 0) * 100 + twoDigits(s, 2);
		const month = twoDigits(s, 5);
		const day = twoDigits(s, 8);
		if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
			if (n === 10) return new Date(Date.UTC(year, month - 1, day));
			if ((n === 20 || n === 24) && s.charCodeAt(10) === 84 && s.charCodeAt(13) === 58 && s.charCodeAt(16) === 58 && s.charCodeAt(n - 1) === 90) {
				const hour = twoDigits(s, 11);
				const minute = twoDigits(s, 14);
				const second = twoDigits(s, 17);
				let ms = 0;
				let ok = hour <= 23 && minute <= 59 && second <= 60;
				if (n === 24) {
					const unit = s.charCodeAt(22) - 48;
					ms = twoDigits(s, 20) * 10 + unit;
					ok = ok && s.charCodeAt(19) === 46 && unit >= 0 && unit <= 9 && ms === ms;
				}
				if (ok) return new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
			}
		}
	}
	let m = DATE.exec(s);
	if (m !== null) {
		const month = +m[2]!;
		const day = +m[3]!;
		if (month < 1 || month > 12 || day < 1 || day > 31) return s;
		return new Date(Date.UTC(+m[1]!, month - 1, day));
	}
	m = DATE_TIME.exec(s);
	if (m === null) return s;
	const month = +m[2]!;
	const day = +m[3]!;
	const hour = +m[4]!;
	const minute = +m[5]!;
	const second = +m[6]!;
	if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) return s;
	const ms = m[7] ? +(m[7] + '00').slice(0, 3) : 0;
	let time = Date.UTC(+m[1]!, month - 1, day, hour, minute, second, ms);
	if (m[8] !== undefined) {
		const offset = (+m[9]! * 60 + (m[10] !== undefined ? +m[10] : 0)) * 60000;
		time -= m[8] === '-' ? -offset : offset;
	}
	return new Date(time);
}

function parseSingle(): string {
	const start = pos + 1;
	let p = start;
	multiline = false;
	// Fast path: no escaped quote and no line break.
	for (;;) {
		const c = src.charCodeAt(p);
		if (c === 39) {
			if (src.charCodeAt(p + 1) !== 39) {
				pos = p + 1;
				return src.slice(start, p);
			}
			break;
		}
		if (c === 10 || c !== c) break;
		p++;
	}
	let out = '';
	let chunk = start;
	for (;;) {
		let c = src.charCodeAt(p);
		if (c !== c) fail('unterminated single-quoted string', start - 1);
		if (c === 39) {
			if (src.charCodeAt(p + 1) === 39) {
				out += src.slice(chunk, p + 1);
				p += 2;
				chunk = p;
				continue;
			}
			out += src.slice(chunk, p);
			pos = p + 1;
			return out;
		}
		if (c === 10) {
			out += src.slice(chunk, trimEnd(chunk, p));
			let breaks = 0;
			while (c === 10 || c === 32 || c === 9) {
				if (c === 10) breaks++;
				c = src.charCodeAt(++p);
			}
			out += breaks === 1 ? ' ' : '\n'.repeat(breaks - 1);
			chunk = p;
			multiline = true;
			continue;
		}
		p++;
	}
}

function parseDouble(): string {
	const start = pos + 1;
	let p = start;
	multiline = false;
	// Fast path: no escape and no line break.
	for (;;) {
		const c = src.charCodeAt(p);
		if (c === 34) {
			pos = p + 1;
			return src.slice(start, p);
		}
		if (c === 92 || c === 10 || c !== c) break;
		p++;
	}
	let out = '';
	let chunk = start;
	for (;;) {
		let c = src.charCodeAt(p);
		if (c !== c) fail('unterminated double-quoted string', start - 1);
		if (c === 34) {
			out += src.slice(chunk, p);
			pos = p + 1;
			return out;
		}
		if (c === 92) {
			out += src.slice(chunk, p);
			const e = src.charCodeAt(++p);
			p++;
			switch (e) {
				case 48:
					out += '\0';
					break;
				case 97:
					out += '\x07';
					break;
				case 98:
					out += '\b';
					break;
				case 116:
				case 9:
					out += '\t';
					break;
				case 110:
					out += '\n';
					break;
				case 118:
					out += '\v';
					break;
				case 102:
					out += '\f';
					break;
				case 114:
					out += '\r';
					break;
				case 101:
					out += '\x1b';
					break;
				case 32:
					out += ' ';
					break;
				case 34:
					out += '"';
					break;
				case 47:
					out += '/';
					break;
				case 92:
					out += '\\';
					break;
				case 78:
					out += '\x85';
					break;
				case 95:
					out += '\xa0';
					break;
				case 76:
					out += '\u2028';
					break;
				case 80:
					out += '\u2029';
					break;
				case 120:
					out += String.fromCharCode(readHex(p, 2));
					p += 2;
					break;
				case 117:
					out += String.fromCharCode(readHex(p, 4));
					p += 4;
					break;
				case 85: {
					const code = readHex(p, 8);
					if (code > 0x10ffff) fail('invalid escape sequence', p - 2);
					out += String.fromCodePoint(code);
					p += 8;
					break;
				}
				case 10:
					// An escaped line break joins the lines with nothing in between.
					c = src.charCodeAt(p);
					while (c === 32 || c === 9) c = src.charCodeAt(++p);
					multiline = true;
					break;
				default:
					fail('unknown escape sequence', p - 2);
			}
			chunk = p;
			continue;
		}
		if (c === 10) {
			out += src.slice(chunk, trimEnd(chunk, p));
			let breaks = 0;
			while (c === 10 || c === 32 || c === 9) {
				if (c === 10) breaks++;
				c = src.charCodeAt(++p);
			}
			out += breaks === 1 ? ' ' : '\n'.repeat(breaks - 1);
			chunk = p;
			multiline = true;
			continue;
		}
		p++;
	}
}

function readHex(p: number, count: number): number {
	let value = 0;
	for (let k = 0; k < count; k++) {
		const c = src.charCodeAt(p + k);
		let digit: number;
		if (c >= 48 && c <= 57) digit = c - 48;
		else if (c >= 97 && c <= 102) digit = c - 87;
		else if (c >= 65 && c <= 70) digit = c - 55;
		else fail('invalid escape sequence', p - 2);
		value = value * 16 + digit;
	}
	return value;
}

/** Parse a literal ("|") or folded (">") block scalar. */
function parseBlockScalar(parent: number, folded: boolean): string {
	let p = pos + 1;
	let chomp = 0; // 0 clip, 1 strip, 2 keep
	let explicit = 0;
	let c = src.charCodeAt(p);
	for (;;) {
		if (c === 43 || c === 45) {
			if (chomp !== 0) fail('repeated chomping indicator', p);
			chomp = c === 45 ? 1 : 2;
		} else if (c >= 49 && c <= 57) {
			if (explicit !== 0) fail('repeated indentation indicator', p);
			explicit = c - 48;
		} else if (c === 48) {
			fail('the indentation indicator cannot be 0', p);
		} else {
			break;
		}
		c = src.charCodeAt(++p);
	}
	const headerEnd = p;
	while (c === 32 || c === 9) c = src.charCodeAt(++p);
	if (c === 35 && p > headerEnd) {
		const nl = src.indexOf('\n', p);
		p = nl === -1 ? end : nl;
		c = src.charCodeAt(p);
	}
	if (c !== 10 && p < end) fail('unexpected content after a block scalar header', p);
	nodes++;
	if (p >= end) {
		pos = end;
		ind = -1;
		return '';
	}
	p++;
	let blockInd = explicit !== 0 ? parent + explicit : -1;
	let out = '';
	let empty = 0;
	let content = false;
	let more = false;
	for (;;) {
		// p is at the start of a line.
		let q = p;
		c = src.charCodeAt(q);
		if (blockInd < 0) {
			while (c === 32) c = src.charCodeAt(++q);
			if (c === 10) {
				empty++;
				p = q + 1;
				continue;
			}
			if (q >= end) {
				p = end;
				break;
			}
			if (q - p <= parent) break;
			blockInd = q - p;
		} else {
			const limit = p + blockInd;
			while (c === 32 && q < limit) c = src.charCodeAt(++q);
			if (c === 10) {
				empty++;
				p = q + 1;
				continue;
			}
			if (q >= end) {
				p = end;
				break;
			}
			if (q < limit) break;
		}
		let nl = src.indexOf('\n', q);
		if (nl === -1) nl = end;
		if (folded) {
			if (c === 32 || c === 9) {
				more = true;
				out += '\n'.repeat(content ? 1 + empty : empty);
			} else if (more) {
				more = false;
				out += '\n'.repeat(empty + 1);
			} else if (empty === 0) {
				if (content) out += ' ';
			} else {
				out += '\n'.repeat(empty);
			}
		} else if (content) {
			out += empty === 0 ? '\n' : '\n'.repeat(1 + empty);
		} else if (empty !== 0) {
			out += '\n'.repeat(empty);
		}
		out += src.slice(q, nl);
		content = true;
		empty = 0;
		if (nl === end) {
			p = end;
			break;
		}
		p = nl + 1;
	}
	if (chomp === 2) out += '\n'.repeat(content ? 1 + empty : empty);
	else if (chomp === 0 && content) out += '\n';
	pos = p;
	skipBlank();
	return out;
}

function readName(what: string): string {
	const start = pos + 1;
	let p = start;
	for (;;) {
		const c = src.charCodeAt(p);
		if (c !== c || c <= 32 || c === 44 || c === 91 || c === 93 || c === 123 || c === 125) break;
		p++;
	}
	if (p === start) fail(`missing ${what} name`, pos);
	pos = p;
	return src.slice(start, p);
}

function parseAnchored(parent: number): unknown {
	const name = readName('anchor');
	const before = nodes;
	let p = pos;
	let c = src.charCodeAt(p);
	while (c === 32 || c === 9) c = src.charCodeAt(++p);
	pos = p;
	let value: unknown;
	if (c === 10 || c === 35 || p >= end) {
		endLine();
		if (ind > parent) {
			value = parseNode(ind, parent);
		} else {
			value = null;
			nodes++;
		}
	} else {
		value = parseInline(parent);
	}
	// Registered after its value is complete, so an anchor can never refer to
	// itself and the result is always free of cycles.
	(anchors ??= new Map()).set(name, { value, size: nodes - before });
	return value;
}

function parseAlias(): unknown {
	const at = pos;
	const name = readName('alias');
	const anchor = anchors?.get(name);
	if (anchor === undefined) fail(`unknown alias "${name}"`, at);
	nodes += anchor.size;
	aliasCost += anchor.size;
	if (aliasCost > MAX_ALIAS_NODES) fail('aliases expand to too many nodes', at);
	return anchor.value;
}

/** Consume a tag. Only !!str is supported. */
function readTag(): void {
	const start = pos;
	let p = start;
	for (;;) {
		const c = src.charCodeAt(p);
		if (c !== c || c <= 32 || c === 44 || c === 91 || c === 93 || c === 123 || c === 125) break;
		p++;
	}
	const tag = src.slice(start, p);
	if (tag !== '!!str') fail(`unsupported tag "${tag}"`, start);
	pos = p;
}

function parseTagged(parent: number): unknown {
	readTag();
	let p = pos;
	let c = src.charCodeAt(p);
	while (c === 32 || c === 9) c = src.charCodeAt(++p);
	pos = p;
	if (c === 10 || c === 35 || p >= end) {
		endLine();
		nodes++;
		return '';
	}
	if (c === 34 || c === 39 || c === 124 || c === 62) return parseInline(parent);
	if (isIndicator(c) || ((c === 45 || c === 63) && isSep(src.charCodeAt(p + 1)))) {
		fail('!!str can only be applied to a scalar', p);
	}
	rawScalar = true;
	return parsePlain(-1, parent, false);
}

/** Skip spaces, line breaks and comments inside a flow collection. */
function skipFlowSpace(): number {
	let p = pos;
	for (;;) {
		const c = src.charCodeAt(p);
		if (c === 32 || c === 10 || c === 9) {
			p++;
			continue;
		}
		if (c === 35) {
			const b = src.charCodeAt(p - 1);
			if (b === 32 || b === 10 || b === 9) {
				const nl = src.indexOf('\n', p);
				p = nl === -1 ? end : nl;
				continue;
			}
		}
		pos = p;
		return c;
	}
}

function parseFlowSeq(): unknown[] {
	const open = pos;
	if (++depth > MAX_DEPTH) fail('nesting is too deep', pos);
	const out: unknown[] = [];
	nodes++;
	pos++;
	for (;;) {
		let c = skipFlowSpace();
		if (c === 93) break;
		if (c !== c) fail('unterminated flow sequence', open);
		out.push(parseFlowValue());
		c = skipFlowSpace();
		if (c === 44) {
			pos++;
			continue;
		}
		if (c === 93) break;
		if (c !== c) fail('unterminated flow sequence', open);
		fail('expected "," or "]" in a flow sequence', pos);
	}
	pos++;
	depth--;
	return out;
}

function parseFlowMap(): Record<string, unknown> {
	const open = pos;
	if (++depth > MAX_DEPTH) fail('nesting is too deep', pos);
	const out: Record<string, unknown> = {};
	let merged: Set<string> | undefined;
	nodes++;
	pos++;
	for (;;) {
		let c = skipFlowSpace();
		if (c === 125) break;
		if (c !== c) fail('unterminated flow mapping', open);
		const keyAt = pos;
		let key: string;
		let quoted = false;
		if (c === 34 || c === 39) {
			key = c === 34 ? parseDouble() : parseSingle();
			quoted = true;
		} else {
			if (isIndicator(c) || ((c === 45 || c === 63 || c === 58) && isSep(src.charCodeAt(pos + 1)))) {
				fail('unsupported flow mapping key', pos);
			}
			key = scanFlowPlain();
		}
		let value: unknown = null;
		c = skipFlowSpace();
		if (c === 58) {
			pos++;
			c = skipFlowSpace();
			if (c !== 44 && c !== 125) value = parseFlowValue();
			else nodes++;
		} else {
			nodes++;
		}
		if (key === '<<' && !quoted) {
			merged = merge(out, value, merged, keyAt);
		} else {
			if (hasOwn.call(out, key) && !(merged !== undefined && merged.delete(key))) {
				fail(`duplicate mapping key "${key}"`, keyAt);
			}
			setKey(out, key, value);
		}
		c = skipFlowSpace();
		if (c === 44) {
			pos++;
			continue;
		}
		if (c === 125) break;
		if (c !== c) fail('unterminated flow mapping', open);
		fail('expected "," or "}" in a flow mapping', pos);
	}
	pos++;
	depth--;
	return out;
}

function parseFlowValue(): unknown {
	const c = src.charCodeAt(pos);
	switch (c) {
		case 91:
			return parseFlowSeq();
		case 123:
			return parseFlowMap();
		case 34:
			nodes++;
			return parseDouble();
		case 39:
			nodes++;
			return parseSingle();
		case 42:
			return parseAlias();
		case 38: {
			const name = readName('anchor');
			const before = nodes;
			skipFlowSpace();
			const value = parseFlowValue();
			(anchors ??= new Map()).set(name, { value, size: nodes - before });
			return value;
		}
		case 33: {
			readTag();
			const d = skipFlowSpace();
			nodes++;
			if (d === 34) return parseDouble();
			if (d === 39) return parseSingle();
			if (d === 44 || d === 93 || d === 125) return '';
			if (isIndicator(d)) fail('!!str can only be applied to a scalar', pos);
			return scanFlowPlain();
		}
	}
	if (isIndicator(c) || ((c === 45 || c === 63 || c === 58) && isSep(src.charCodeAt(pos + 1)))) {
		fail('unexpected character', pos);
	}
	nodes++;
	return resolvePlain(scanFlowPlain());
}

/** Scan a single-line plain scalar inside a flow collection. */
function scanFlowPlain(): string {
	const start = pos;
	let p = start;
	for (;;) {
		const c = src.charCodeAt(p);
		if (c === 44 || c === 93 || c === 125 || c === 91 || c === 123 || c === 10 || c !== c) break;
		if (c === 58) {
			const n = src.charCodeAt(p + 1);
			if (isSep(n) || n === 44 || n === 93 || n === 125 || n === 91 || n === 123) break;
		} else if (c === 35) {
			const b = src.charCodeAt(p - 1);
			if (b === 32 || b === 9) break;
		}
		p++;
	}
	const e = trimEnd(start, p);
	if (e === start) fail('expected a value', start);
	pos = p;
	return src.slice(start, e);
}
