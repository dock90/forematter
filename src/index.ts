import { parseYaml, YamlError } from './parse-yaml.ts';
import { stringifyYaml } from './stringify-yaml.ts';

declare const TextDecoder: { new (): { decode(input: Uint8Array): string } };

export interface Engine {
	parse(input: string): unknown;
	stringify?(data: unknown): string;
}

export interface Options {
	/** Front matter language when the opening delimiter does not name one. Defaults to "yaml". */
	language?: string;
	/** One delimiter for both ends, or an [open, close] pair. Defaults to "---". */
	delimiters?: string | [string, string];
	/**
	 * Extract an excerpt from the content: true uses the delimiter as the
	 * separator, a string is used as the separator, a function sets
	 * file.excerpt itself.
	 */
	excerpt?: boolean | string | ((file: MatterFile<any>, options: Options) => void);
	excerpt_separator?: string;
	/** Extra languages, or replacements for the built in "yaml" and "json". */
	engines?: Record<string, Engine | ((input: string) => unknown)>;
}

export interface MatterFile<T = Record<string, any>> {
	/** The parsed front matter. An empty object when there is none. */
	data: T;
	/** The input with the front matter block removed. */
	content: string;
	excerpt: string;
	/** The front matter language, for example "yaml". */
	language: string;
	/** The raw, unparsed front matter block. */
	matter: string;
	/** True when a front matter block is present but has no content. */
	isEmpty: boolean;
}

const hasOwn = Object.prototype.hasOwnProperty;

const yamlEngine: Engine = { parse: parseYaml, stringify: stringifyYaml };
const jsonEngine: Engine = {
	parse: (input) => JSON.parse(input),
	stringify: (data) => JSON.stringify(data, null, 2),
};

function getEngine(language: string, options: Options | undefined): Engine {
	const name = language === 'yml' ? 'yaml' : language;
	const custom = options?.engines;
	if (custom !== undefined) {
		const engine = hasOwn.call(custom, name) ? custom[name] : hasOwn.call(custom, language) ? custom[language] : undefined;
		if (typeof engine === 'function') return { parse: engine };
		if (engine !== undefined) return engine;
	}
	if (name === 'yaml') return yamlEngine;
	if (name === 'json') return jsonEngine;
	if (name === 'js' || name === 'javascript') {
		throw new Error('forematter does not evaluate JavaScript front matter. Pass your own engine in options.engines if you need it.');
	}
	throw new Error(`forematter: no engine is registered for "${language}" front matter`);
}

function getDelimiters(options: Options | undefined): [string, string] {
	const d = options?.delimiters;
	if (d === undefined) return ['---', '---'];
	if (typeof d === 'string') return [d, d];
	return [d[0], d[1] ?? d[0]];
}

/** True when a front matter block holds only white space and comments. */
function isBlank(block: string): boolean {
	const n = block.length;
	let p = 0;
	for (;;) {
		let c = block.charCodeAt(p);
		while (c === 32 || c === 10 || c === 13 || c === 9) c = block.charCodeAt(++p);
		if (p >= n) return true;
		if (c !== 35) return false;
		const nl = block.indexOf('\n', p);
		if (nl === -1) return true;
		p = nl + 1;
	}
}

function isLanguageName(s: string): boolean {
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (!((c >= 97 && c <= 122) || (c >= 65 && c <= 90) || (c >= 48 && c <= 57) || c === 45 || c === 95 || c === 43)) return false;
	}
	return true;
}

function applyExcerpt(file: MatterFile<any>, options: Options | undefined, open: string): void {
	const excerpt = options?.excerpt;
	if (typeof excerpt === 'function') {
		excerpt(file, options!);
		return;
	}
	const data = file.data;
	const fromData = data !== null && typeof data === 'object' ? data.excerpt_separator : undefined;
	const separator = typeof fromData === 'string' && fromData !== '' ? fromData : options?.excerpt_separator;
	if (separator == null && (excerpt === undefined || excerpt === false)) return;
	const delimiter = typeof excerpt === 'string' ? excerpt : separator || open;
	const at = file.content.indexOf(delimiter);
	if (at !== -1) file.excerpt = file.content.slice(0, at);
}

let decoder: { decode(input: Uint8Array): string } | undefined;

/**
 * Split a document into its front matter and its content.
 *
 * ```js
 * const file = matter('---\ntitle: Home\n---\nHello');
 * file.data;    // { title: 'Home' }
 * file.content; // 'Hello'
 * ```
 */
function matter<T = Record<string, any>>(input: string | Uint8Array, options?: Options): MatterFile<T> {
	let str: string;
	if (typeof input === 'string') str = input;
	else if (input instanceof Uint8Array) str = (decoder ??= new TextDecoder()).decode(input);
	else throw new TypeError('expected input to be a string or a Uint8Array');
	if (str.charCodeAt(0) === 0xfeff) str = str.slice(1);

	let open = '---';
	let close = '---';
	let needle = '\n---';
	if (options !== undefined && options.delimiters !== undefined) {
		[open, close] = getDelimiters(options);
		needle = '\n' + close;
	}
	const file: MatterFile<any> = {
		data: {},
		content: str,
		excerpt: '',
		language: (options?.language ?? 'yaml').toLowerCase(),
		matter: '',
		isEmpty: false,
	};

	// A document has front matter when it starts with the delimiter and the
	// delimiter is not just the start of a longer run, such as "----".
	const openLen = open.length;
	if (openLen === 0 || !str.startsWith(open) || str.charCodeAt(openLen) === open.charCodeAt(openLen - 1)) {
		applyExcerpt(file, options, open);
		return file;
	}

	// The rest of the opening line may name the language: "---json".
	const len = str.length;
	let eol = str.indexOf('\n', openLen);
	if (eol === -1) eol = len;
	if (eol !== openLen) {
		const language = str.slice(openLen, eol).trim();
		if (language !== '') {
			if (!isLanguageName(language)) {
				applyExcerpt(file, options, open);
				return file;
			}
			file.language = language.toLowerCase();
		}
	}

	// The closing delimiter must be on a line of its own.
	let at = str.indexOf(needle, eol);
	let after = len;
	while (at !== -1) {
		let p = at + needle.length;
		let c = str.charCodeAt(p);
		while (c === 32 || c === 9) c = str.charCodeAt(++p);
		if (c === 13 && str.charCodeAt(p + 1) === 10) p++;
		if (p >= len) {
			after = len;
			break;
		}
		if (str.charCodeAt(p) === 10) {
			after = p + 1;
			break;
		}
		at = str.indexOf(needle, at + 1);
	}

	const start = str.charCodeAt(eol - 1) === 13 ? eol - 1 : eol;
	const block = at === -1 ? str.slice(start) : str.slice(start, at);
	file.matter = block;
	file.content = at === -1 ? '' : str.slice(after);
	if (isBlank(block)) {
		file.isEmpty = true;
	} else {
		const data = getEngine(file.language, options).parse(block);
		if (data != null) file.data = data;
	}
	applyExcerpt(file, options, open);
	return file;
}

/**
 * Put data back on top of content as front matter.
 *
 * ```js
 * stringify('Hello', { title: 'Home' }); // '---\ntitle: Home\n---\nHello\n'
 * ```
 */
function stringify(
	file: string | { content: string; data?: unknown; language?: string; excerpt?: string },
	data?: object,
	options?: Options,
): string {
	if (typeof file === 'string') file = matter(file, options);
	const language = (file.language || options?.language || 'yaml').toLowerCase();
	const engine = getEngine(language, options);
	if (typeof engine.stringify !== 'function') {
		throw new TypeError(`forematter: the "${language}" engine cannot stringify`);
	}
	const [open, close] = getDelimiters(options);
	const merged = { ...(file.data as object | undefined), ...data };
	const block = engine.stringify(merged).trim();
	let out = '';
	if (block !== '{}') out = open + '\n' + block + '\n' + close + '\n';
	const content = file.content;
	const excerpt = file.excerpt;
	if (typeof excerpt === 'string' && excerpt !== '' && content.indexOf(excerpt.trim()) === -1) {
		out += newline(excerpt) + close + '\n';
	}
	return out + newline(content);
}

function newline(s: string): string {
	return s.endsWith('\n') ? s : s + '\n';
}

/** True when the string starts with a front matter delimiter. */
function test(input: string, options?: Options): boolean {
	return input.startsWith(getDelimiters(options)[0]);
}

/** The language named after the opening delimiter, if any. */
function language(input: string, options?: Options): { raw: string; name: string } {
	const open = getDelimiters(options)[0];
	if (input.startsWith(open)) input = input.slice(open.length);
	const eol = input.indexOf('\n');
	const raw = eol === -1 ? input : input.slice(0, input.charCodeAt(eol - 1) === 13 ? eol - 1 : eol);
	return { raw, name: raw.trim() };
}

matter.stringify = stringify;
matter.test = test;
matter.language = language;

export default matter;
export { matter, stringify, test, language, parseYaml, stringifyYaml, YamlError };
