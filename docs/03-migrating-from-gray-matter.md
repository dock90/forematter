# Migrating from gray-matter

For most projects the migration is one line.

```diff
- import matter from 'gray-matter';
+ import matter from 'forematter';
```

In CommonJS (Node 20.19 or newer):

```diff
- const matter = require('gray-matter');
+ const { matter } = require('forematter');
```

## What is the same

- `matter(source, options)` returns `data`, `content`, `excerpt`, `language`, `matter` and `isEmpty`.
- `matter.stringify(content, data, options)`, `matter.test(source)` and `matter.language(source)`.
- The `language`, `delimiters`, `excerpt`, `excerpt_separator` and `engines` options.
- YAML by default, JSON with `---json`.
- A document with an opening delimiter and no closing one is all front matter.
- `Date` values for YAML timestamps.

`bench/differential.js` runs forematter and gray-matter side by side on the same inputs and fails on any difference that is not listed below.

## What is different

### Removed

| gray-matter | forematter |
| --- | --- |
| `---js` and `---javascript` front matter, run through `eval` | Throws. Pass your own engine in `options.engines` if you need it and trust the input. |
| `matter.read(path)` | Read the file yourself: `matter(fs.readFileSync(path, 'utf8'))`. |
| `options.sections` | Not available. |
| `matter.cache` and `matter.clearCache()` | There is no cache. Every call returns a fresh result. |
| `file.orig`, `file.path`, `file.empty`, `file.stringify()` | Not set. Use `matter.stringify(file)`. |
| An object with a `content` property as input | Pass a string or a `Uint8Array`. |
| The option aliases `lang`, `delims` and `parsers` | Use `language`, `delimiters` and `engines`. |
| Options passed through to js-yaml | Ignored. The YAML parser and serializer have no options. |

### Changed

- **The closing delimiter must be on its own line.** gray-matter accepts any line that starts with `---`, so `---more text` closes the block. forematter needs `---` followed by nothing but spaces.
- **The opening line can only name a language.** `---json` and `--- yaml` work. A first line such as `--- some text` is treated as content, not front matter.
- **YAML numbers follow YAML 1.2, not 1.1.** gray-matter uses js-yaml 3.

  | Front matter | gray-matter | forematter |
  | --- | --- | --- |
  | `zip: 01234` | `668` (octal) | `1234` |
  | `time: 12:30:00` | `45000` (base 60) | `'12:30:00'` |
  | `count: 1_000` | `1000` | `'1_000'` |
  | `flags: 0b101` | `5` | `'0b101'` |
  | `mode: 0o17` | `'0o17'` | `15` |

- **Mapping keys keep their text.** With `1.0: x`, gray-matter's key is `'1'` and forematter's is `'1.0'`.
- **Impossible dates stay strings.** `2026-13-45` is a string, not a `Date` that has rolled over into another month.
- **Unsupported YAML throws.** Complex keys, tags other than `!!str`, and multi-document input are rejected. See [YAML support](01-yaml-support.md).
- **Errors are `YamlError`**, not js-yaml's `YAMLException`. They have `line` and `column` properties.
- **`language` and `matter` are ordinary properties** on the result. In gray-matter they are non-enumerable.
- **Custom engines receive the front matter text only.** gray-matter also passes its options object as a second argument.
- **Stringified YAML can differ in style**, for example which strings are quoted and how long lines are wrapped. It reads back as the same data, in both libraries.
- **ES modules only.** `require` works on Node versions that can load ES modules that way (20.19 and newer).

## Checking your own content

Before switching a real site, run both libraries over your content and compare:

```js
import fs from 'node:fs';
import assert from 'node:assert/strict';
import grayMatter from 'gray-matter';
import matter from 'forematter';

for (const path of fs.globSync('content/**/*.md')) {
	const source = fs.readFileSync(path, 'utf8');
	const a = grayMatter(source);
	const b = matter(source);
	try {
		assert.deepStrictEqual(b.data, a.data);
		assert.equal(b.content, a.content);
	} catch (error) {
		console.log(path, error.message);
	}
}
```
