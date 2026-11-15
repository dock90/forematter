// Speed comparison: forematter against gray-matter 4.
//
//   npm run build && cd bench && npm install && node bench.js
//
// Every document in a scenario is unique, as files in a real site are, and
// gray-matter's result cache is cleared before each round so that it parses
// every document, as it does the first time a build reads a file.
import grayMatter from 'gray-matter';
import matter from '../dist/index.js';

const ROUNDS = 25;
const WARMUP = 5;

const paragraph = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.\n\n';
const body = (i) => `# Post ${i}\n\n${paragraph.repeat(6)}## Section\n\n- one\n- two\n- three\n\n${paragraph.repeat(2)}`;
const pad = (n) => String(n).padStart(2, '0');

const blogPost = (i) => `---
title: "Post number ${i}: notes on building things"
description: A short summary of post ${i} that runs to about one line of text.
date: 2026-${pad((i % 12) + 1)}-${pad((i % 28) + 1)}
updated: 2026-${pad((i % 12) + 1)}-${pad((i % 28) + 1)}T10:30:00Z
draft: ${i % 7 === 0}
weight: ${i}
slug: post-number-${i}
author:
  name: Ada Lovelace
  url: https://example.com/authors/ada
tags:
  - javascript
  - performance
  - tag-${i % 50}
categories: [engineering, notes]
image:
  src: /images/posts/${i}/cover.png
  alt: Cover image for post ${i}
  width: 1200
  height: 630
---

${body(i)}`;

const minimal = (i) => `---\ntitle: Page ${i}\nlayout: default\norder: ${i}\n---\n\n${body(i)}`;

const large = (i) => {
	let fm = `title: Product catalog ${i}\nsummary: >-\n  A longer description that is folded\n  across several lines of text.\nitems:\n`;
	for (let k = 0; k < 40; k++) {
		fm += `  - id: ${i * 100 + k}\n    name: "Item ${k}"\n    price: ${(k * 1.25 + 0.99).toFixed(2)}\n    in_stock: ${k % 3 !== 0}\n    tags: [a${k}, b${k}]\n`;
	}
	return `---\n${fm}---\n\n${body(i)}`;
};

const plain = (i) => body(i);

const scenarios = [
	{ name: 'blog post (19 lines of front matter)', docs: Array.from({ length: 2000 }, (_, i) => blogPost(i)) },
	{ name: 'minimal (3 fields)', docs: Array.from({ length: 2000 }, (_, i) => minimal(i)) },
	{ name: 'large (205 lines of front matter)', docs: Array.from({ length: 300 }, (_, i) => large(i)) },
	{ name: 'no front matter', docs: Array.from({ length: 2000 }, (_, i) => plain(i)) },
];

function time(fn, docs) {
	const started = performance.now();
	let sink = 0;
	for (let i = 0; i < docs.length; i++) sink += fn(docs[i]).content.length;
	const ms = performance.now() - started;
	if (sink === 0) throw new Error('no content was read');
	return docs.length / (ms / 1000);
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const fmt = (n) => Math.round(n).toLocaleString('en-US').padStart(11);

console.log(`node ${process.version}, ${process.platform} ${process.arch}, median of ${ROUNDS} rounds\n`);
console.log(`${'parse'.padEnd(40)}${'gray-matter'.padStart(11)}${'forematter'.padStart(12)}   faster`);
for (const { name, docs } of scenarios) {
	const results = { gray: [], fore: [] };
	for (let round = 0; round < WARMUP + ROUNDS; round++) {
		grayMatter.clearCache();
		const gray = time(grayMatter, docs);
		const fore = time(matter, docs);
		if (round >= WARMUP) {
			results.gray.push(gray);
			results.fore.push(fore);
		}
	}
	const g = median(results.gray);
	const f = median(results.fore);
	console.log(`${name.padEnd(40)}${fmt(g)}${fmt(f).padStart(12)}   ${(f / g).toFixed(1)}x   (documents per second)`);
}

// Stringify: put data back on top of content.
const parsed = scenarios[0].docs.map((doc) => matter(doc));
const stringifyResults = { gray: [], fore: [] };
for (let round = 0; round < WARMUP + ROUNDS; round++) {
	let started = performance.now();
	let sink = 0;
	for (const file of parsed) sink += grayMatter.stringify(file.content, file.data).length;
	const gray = parsed.length / ((performance.now() - started) / 1000);
	started = performance.now();
	for (const file of parsed) sink += matter.stringify({ content: file.content, data: file.data }).length;
	const fore = parsed.length / ((performance.now() - started) / 1000);
	if (sink === 0) throw new Error('nothing was written');
	if (round >= WARMUP) {
		stringifyResults.gray.push(gray);
		stringifyResults.fore.push(fore);
	}
}
const g = median(stringifyResults.gray);
const f = median(stringifyResults.fore);
console.log(`\n${'stringify'.padEnd(40)}${'gray-matter'.padStart(11)}${'forematter'.padStart(12)}   faster`);
console.log(`${'blog post'.padEnd(40)}${fmt(g)}${fmt(f).padStart(12)}   ${(f / g).toFixed(1)}x   (documents per second)`);
