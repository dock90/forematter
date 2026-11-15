# Benchmarks

## Results

Measured on 2026-11-14 with Node 25.9.0 on an Apple M4 Pro, against gray-matter 4.0.3. Figures are documents per second, the median of 25 rounds.

| Parse | gray-matter | forematter | Faster |
| --- | ---: | ---: | ---: |
| Blog post, 19 lines of front matter | 108,998 | 453,914 | 4.2x |
| Minimal, 3 fields | 459,198 | 2,958,580 | 6.4x |
| Large, 205 lines of front matter | 12,195 | 41,376 | 3.4x |
| No front matter | 1,367,716 | 60,606,061 | 44x |

| Stringify | gray-matter | forematter | Faster |
| --- | ---: | ---: | ---: |
| Blog post | 109,792 | 302,862 | 2.8x |

These are from one machine and one Node version. Expect the ratios to move on other hardware.

## Method

- Every document in a scenario is unique, as the files of a real site are. The blog post, minimal and no front matter scenarios have 2,000 documents each. The large scenario has 300.
- Each document has about 1.5 KB of markdown content after the front matter.
- gray-matter caches results by input when called without options. The cache is cleared before each round, outside the timed section, so gray-matter parses every document, as it does the first time a build reads a file.
- Five warm-up rounds run before the 25 measured ones. The two libraries alternate within each round.
- forematter is measured from its built output in `dist/`, which is what a user installs.

## Running it

```sh
npm install
npm run build
cd bench
npm install
node bench.js
```

## Differential test

`bench/differential.js` checks behavior, not speed. It fails if forematter and gray-matter disagree anywhere they are not meant to.

```sh
node differential.js
```

It covers:

- 38 hand-written YAML documents that both libraries must parse to the same value
- 7 inputs where forematter differs on purpose, listed in [migrating from gray-matter](03-migrating-from-gray-matter.md)
- 19 whole documents under 6 option sets each, comparing `data`, `content`, `excerpt`, `isEmpty`, `language` and `matter`
- 20,000 random values written by each library and read back by the other
