# forematter

Fast, safe front matter parsing with zero dependencies. A modern replacement for [gray-matter](https://github.com/jonschlinkert/gray-matter).

```js
import matter from 'forematter';

const file = matter('---\ntitle: Hello world\ntags: [news, launch]\n---\n# Hello\n');

file.data; // { title: 'Hello world', tags: ['news', 'launch'] }
file.content; // '# Hello\n'
```

## Why

gray-matter is on most markdown-based sites and has not had a release since 2021. forematter does the same job with:

- **No dependencies.** gray-matter installs 9 other packages. forematter installs none, including its own YAML parser and serializer.
- **Speed.** 3 to 6 times faster than gray-matter at parsing, 2.8 times faster at writing. See [benchmarks](docs/04-benchmarks.md).
- **Safety by default.** It never evaluates code, cannot be used for prototype pollution, parses in linear time, and caps nesting depth and alias expansion. See [security](docs/02-security.md).
- **TypeScript types** built in, ES modules, and no result caching between calls.

It keeps gray-matter's API for the common paths, so most projects only change the import. See [migrating from gray-matter](docs/03-migrating-from-gray-matter.md).

## Install

```sh
npm install forematter
```

Requires Node 18 or newer. It also runs in browsers, Deno, Bun and edge runtimes, since it uses nothing but standard JavaScript.

## Usage

### Parse

```js
import matter from 'forematter';

const file = matter(source);
```

`source` is a string or a `Uint8Array` (a Node `Buffer` works). The result:

| Property | Description |
| --- | --- |
| `data` | The parsed front matter. `{}` when there is none. |
| `content` | The input with the front matter block removed. |
| `excerpt` | The excerpt, when the `excerpt` option is used. Otherwise `''`. |
| `language` | The front matter language, for example `'yaml'`. |
| `matter` | The raw, unparsed front matter block. |
| `isEmpty` | `true` when a front matter block is present but has no content. |

Front matter is YAML by default. JSON works by naming it after the opening delimiter:

```
---json
{ "title": "Hello world" }
---
```

With TypeScript, pass the shape of your front matter:

```ts
const file = matter<{ title: string; tags?: string[] }>(source);
file.data.title; // string
```

### Stringify

```js
import matter from 'forematter';

matter.stringify('# Hello\n', { title: 'Hello world' });
// ---
// title: Hello world
// ---
// # Hello
```

If the first argument already has front matter, the new data is merged over it.

### Options

```js
matter(source, options);
```

| Option | Description |
| --- | --- |
| `language` | The language when the opening delimiter does not name one. Default `'yaml'`. |
| `delimiters` | A string for both ends, or an `[open, close]` pair. Default `'---'`. |
| `excerpt` | `true` to take the content up to the first delimiter as the excerpt, a string to use as the separator, or a function `(file, options) => void` that sets `file.excerpt`. |
| `excerpt_separator` | A separator for the excerpt. Can also be set in the front matter itself. |
| `engines` | Parsers for other languages, or replacements for the built in ones. |

Adding a language, for example TOML with a parser of your choice:

```js
import { parse, stringify } from 'your-toml-library';

matter(source, { engines: { toml: { parse, stringify } } });
```

### Other exports

```js
import { matter, stringify, test, language, parseYaml, stringifyYaml, YamlError } from 'forematter';
```

- `test(source)` is `true` when the source starts with a front matter delimiter.
- `language(source)` returns the language named after the opening delimiter.
- `parseYaml(text)` and `stringifyYaml(data)` are the YAML parser and serializer on their own.
- `YamlError` is thrown for invalid or unsupported YAML, with `line` and `column` properties.

In CommonJS, on Node 20.19 or newer: `const { matter } = require('forematter')`.

## Principles

- **Zero dependencies, always.** Nothing to audit but this package.
- **Never guess.** YAML that is invalid or outside the [supported subset](docs/01-yaml-support.md) throws a `YamlError` with a line and column. It is never silently read as something else.
- **Never run code.** There is no JavaScript front matter engine and no tag that constructs objects.
- **Stay linear.** The parser is a single pass scanner. Input size, not input shape, decides how long it takes.

## Docs

| Doc | Contents |
| --- | --- |
| [01 YAML support](docs/01-yaml-support.md) | What the YAML parser and serializer handle, and what they reject |
| [02 Security](docs/02-security.md) | The threat model and how each risk is handled |
| [03 Migrating from gray-matter](docs/03-migrating-from-gray-matter.md) | What is the same and what is different |
| [04 Benchmarks](docs/04-benchmarks.md) | Speed results and how to reproduce them |

## Development

```sh
npm install        # TypeScript is the only development dependency
npm test           # node --test, run against the TypeScript source
npm run typecheck
npm run build      # emits dist/
```

Tests need Node 22.18 or newer, which runs TypeScript directly. The comparison benchmark and the differential test against gray-matter live in `bench/` with their own `package.json`, so the library itself stays free of dependencies.

## License

MIT
