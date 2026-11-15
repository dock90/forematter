# Security

Front matter often comes from places the site owner does not fully control: pull requests, a CMS, user submissions, files fetched at build time. forematter treats the whole document as untrusted input.

## What it protects against

| Risk | How forematter handles it |
| --- | --- |
| Code execution | There is no JavaScript engine. gray-matter runs `---js` front matter through `eval`. forematter throws instead. No YAML tag can construct a function, a regular expression or any other object. The only tag accepted is `!!str`. |
| Prototype pollution | A `__proto__` key becomes an ordinary own property and never changes a prototype. This holds for block mappings, flow mappings, merge keys and JSON front matter. Keys such as `constructor` and `toString` are plain data. |
| Regular expression denial of service | The parser is a hand-written, single pass scanner. No regular expression runs over attacker-shaped text, apart from two anchored patterns with no nested quantifiers that only see a single short value starting with `NNNN-`. |
| Stack exhaustion | Collections can nest at most 100 levels deep, in block and flow style. Deeper input throws a `YamlError` and never overflows the stack. |
| Alias bombs ("billion laughs") | Aliases refer to the anchored value and are never copied, so parsing cannot multiply memory. On top of that, the total number of nodes aliases expand to is capped at 100,000, so the result is also safe to walk or serialize. An anchor cannot refer to itself, so results never contain cycles. |
| Ambiguous input | Duplicate keys throw. The closing delimiter must be on a line of its own. Unsupported YAML throws and is never read as something else. Two tools reading the same file should not come to different conclusions about it. |
| Supply chain | There are no runtime dependencies. The only development dependency is TypeScript. |
| Shared state | Results are never cached or shared between calls, so changing one result cannot leak into another. |

forematter does not read files, make network requests or load modules at run time.

## How this is tested

`test/security.test.js` covers each row above, including:

- prototype pollution attempts through every syntax that can set a key
- 21 pathological inputs of about 200,000 characters each, every one of which must finish in under 1.5 seconds
- 30,000 random and mutated documents, each of which must either parse or throw a `YamlError`, and nothing else

## What it does not do

- It does not sanitize the values it returns. A title that contains HTML is returned as is. Escape front matter values when you render them.
- It does not limit input size. If you accept documents from the public, cap their size before parsing.
- Custom engines passed in `options.engines` are your code and run with your privileges.
- It has not had an independent security audit.

## Reporting a vulnerability

Please report security problems privately through the repository's security advisories page, not in a public issue.
