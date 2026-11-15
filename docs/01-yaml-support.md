# YAML support

forematter has its own YAML parser and serializer. They cover the YAML that front matter uses in practice. Anything outside that throws a `YamlError` with a line and a column. Nothing is silently read as something else.

## What is supported

| Feature | Example |
| --- | --- |
| Block mappings | `title: Hello` |
| Nested mappings and sequences | `author:` followed by indented keys, `- item` lists |
| Sequences at the same indentation as their key | `tags:` then `- a` on the next line with no extra indent |
| Compact nesting | `- name: one` with further keys aligned under `name`, `- - a` |
| Flow collections, including across lines | `[a, b]`, `{k: v}`, `[]`, `{}` |
| JSON as a flow document | `{"title": "Hello", "tags": ["a"]}` |
| Plain, single quoted and double quoted scalars | `a`, `'it''s'`, `"line\nbreak"` |
| All YAML double quote escapes | `\n`, `\t`, `\"`, `\xNN`, `\uNNNN`, `\UNNNNNNNN` and the rest |
| Multi-line plain and quoted scalars, folded | a value continued on more indented lines |
| Literal and folded block scalars | `\|`, `>`, with `-` and `+` chomping and an indentation digit |
| Comments | `# whole line` and `value # trailing` |
| Anchors and aliases | `&name`, `*name` |
| Merge keys | `<<: *defaults` and `<<: [*a, *b]` |
| The `!!str` tag | `version: !!str 1.0` |
| A single leading `---` line | for YAML that is parsed on its own with `parseYaml` |
| LF and CRLF line endings | |

## How values are typed

Plain (unquoted) scalars follow the YAML 1.2 core schema, plus timestamps.

| YAML | JavaScript |
| --- | --- |
| `null`, `Null`, `NULL`, `~`, or nothing | `null` |
| `true`, `True`, `TRUE`, `false`, `False`, `FALSE` | boolean |
| `42`, `-7`, `+7`, `0x1F`, `0o17` | number |
| `1.5`, `.5`, `1e3`, `.inf`, `-.inf`, `.nan` | number |
| `2026-11-14` | `Date` at midnight UTC |
| `2026-11-14T10:30:00Z`, `2026-11-14 10:30:00 +02:00` | `Date` |
| anything else, and anything quoted | string |

Points worth knowing:

- `yes`, `no`, `on` and `off` are strings, not booleans.
- A leading zero is not octal: `0123` is the number 123. Quote values such as postal codes to keep the zero.
- `12:30` and `1_000` are strings. There are no base 60 numbers or digit separators.
- A date that cannot exist, such as `2026-13-45`, stays a string.
- Mapping keys are always strings and keep their text exactly: the key in `1.0: x` is `'1.0'`.
- An alias refers to the same object as its anchor. It is not a copy.

## What is rejected

Each of these throws a `YamlError`:

- Complex keys (`? key`), flow collections as keys, anchors or aliases on keys, and keys that span lines
- Tags other than `!!str`, including every tag that constructs an object
- Several documents in one input, `...` end markers, and `%` directives
- A plain scalar that continues on a new line inside a flow collection (quote it instead)
- A single `key: value` pair inside a flow sequence, as in `[a: 1]` (write `[{a: 1}]`)
- Tabs used for indentation
- Duplicate keys in one mapping
- Nesting deeper than 100 levels
- Aliases that expand to more than 100,000 nodes in total

## Writing YAML

`stringifyYaml` and `matter.stringify` write block style YAML with two space indentation.

- Strings are left bare when that is safe and quoted when it is not. A string is quoted if it could be read back as another type (`'true'`, `'123'`, `'2026-11-14'`), if it has YAML syntax in it (`'a: b'`, `'- item'`, `'#tag'`), or if an older YAML 1.1 parser would read it differently (`'yes'`, `'12:30'`, `'1_000'`).
- Strings with line breaks are written as literal blocks (`|`, `|-`, `|+`). Strings with control characters are double quoted with escapes.
- `Date` values are written as ISO 8601 timestamps and read back as `Date`.
- `NaN` and the infinities are written as `.nan`, `.inf` and `-.inf`.
- Properties that are `undefined`, functions or symbols are left out, as `JSON.stringify` does.
- Circular data, or data nested more than 100 levels deep, throws a `TypeError`.

Whatever is written reads back as the same value. The test suite checks this with 20,000 random values, and `bench/differential.js` checks that js-yaml reads the output the same way.
