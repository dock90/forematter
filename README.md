# forematter

A fast, safe front matter parser with zero dependencies. A modern replacement for [gray-matter](https://github.com/jonschlinkert/gray-matter).

```sh
npm install forematter
```

```js
import matter from 'forematter';

const file = matter('---\ntitle: Hello world\ntags: [news, launch]\n---\n# Hello\n');

file.data; // { title: 'Hello world', tags: ['news', 'launch'] }
file.content; // '# Hello\n'
```

## Why use it

- **Zero dependencies.** gray-matter installs 9 other packages. forematter installs none: it has its own YAML parser.
- **Fast.** 3 to 12 times faster than gray-matter at reading (see below).
- **Safe.** It never runs code from a file, and it is built to withstand input designed to hang a parser or tamper with your objects.
- **Compatible.** On 17,436 real pages from the Astro docs and MDN, it returns exactly what gray-matter returns for every one.
- **Modern.** TypeScript types included, ES modules, Node 18 and newer.

## Usage

### Read

```js
const file = matter(source); // a string, Buffer or Uint8Array
```

| Property | What it is |
| --- | --- |
| `data` | The parsed front matter. `{}` if there is none. |
| `content` | Everything after the front matter. |
| `excerpt` | The excerpt, if you asked for one. |
| `language` | `'yaml'`, `'json'`, or the name of your own engine. |
| `matter` | The raw front matter text. |
| `isEmpty` | `true` if the front matter block is there but empty. |

Front matter is YAML. For JSON, name it on the first line: `---json`.

With TypeScript, describe your front matter and `data` is typed:

```ts
const file = matter<{ title: string; tags?: string[] }>(source);
```

### Write

```js
matter.stringify('# Hello\n', { title: 'Hello world' });
// ---
// title: Hello world
// ---
// # Hello
```

### Options

```js
matter(source, options);
```

| Option | What it does |
| --- | --- |
| `excerpt` | `true` takes the content up to the first `---` as the excerpt. A string sets the separator. A function sets `file.excerpt` itself. |
| `excerpt_separator` | The excerpt separator. Can also be set in the front matter. |
| `delimiters` | A different delimiter, or an `[open, close]` pair. Default `'---'`. |
| `language` | The language when the first line does not name one. Default `'yaml'`. |
| `engines` | Other languages: `{ toml: { parse, stringify } }`. |

Also exported: `stringify`, `test`, `language`, `parseYaml`, `stringifyYaml` and `YamlError`.

## Speed

Documents per second on an Apple M4 Pro with Node 25, against gray-matter 4.0.3:

| | gray-matter | forematter | |
| --- | ---: | ---: | ---: |
| Typical blog post | 108,998 | 453,914 | 4.2x |
| Three fields | 459,198 | 2,958,580 | 6.4x |
| 205 lines of front matter | 12,195 | 41,376 | 3.4x |
| Writing a blog post | 109,792 | 302,862 | 2.8x |

On real sites the gap is wider: all 14,768 MDN pages parse in 10 ms against 80 ms, and all 2,668 Astro docs pages in 2 ms against 23 ms.

## Safety

Front matter often comes from pull requests, a CMS or user uploads, so forematter treats it as untrusted.

- **No code execution.** There is no `---js` engine and no YAML tag that builds objects. gray-matter runs `---js` front matter through `eval`.
- **No prototype pollution.** A `__proto__` key is stored as plain data.
- **Predictable speed.** The parser reads the input once, front to back, with no backtracking.
- **Hard limits.** Nesting stops at 100 levels and alias expansion at 100,000 nodes, so "billion laughs" files are rejected.
- **No guessing.** Duplicate keys and unsupported YAML throw a `YamlError` with a line and column.

It does not escape the values it returns, and it has not had an independent security audit.

## Switching from gray-matter

Change the import. In CommonJS, on Node 20.19 or newer, use `const { matter } = require('forematter')`.

What is different:

- **Numbers follow YAML 1.2.** `12:30:00` and `1_000` are strings, and `01234` is 1234. gray-matter reads these as 45000, 1000 and 668.
- **The closing `---` must be on its own line.**
- **`---js` front matter throws** unless you pass your own engine.
- **Removed:** `matter.read()`, the `sections` option, the result cache, and `file.orig`.
- **Keys keep their text.** The key in `1.0: x` is `'1.0'`, not `'1'`.

## YAML support

Everything front matter normally uses: nested maps and lists, `[a, b]` and `{k: v}`, quoted and multi-line strings, `|` and `>` blocks, comments, dates, anchors, aliases and `<<` merges.

Rare YAML features throw an error and are never misread: `? ` complex keys, tags other than `!!str`, several documents in one file, and tabs as indentation.

## Development

```sh
npm install   # TypeScript is the only dev dependency
npm test      # needs Node 22.18 or newer
npm run build
```

## License

MIT
