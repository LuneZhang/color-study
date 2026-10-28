import Parser from 'rss-parser';
import { writeFileSync } from 'node:fs';

// Source list for the public GitHub Pages build. Only titles, links and dates are published.
const sources = [
  { url: 'https://www.slrlounge.com/feed/', name: 'SLR Lounge', author: 'SLR Lounge', kind: 'practice' },
  { url: 'https://www.photoshopessentials.com/feed/', name: 'Photoshop Essentials', author: 'Steve Patterson', kind: 'practice' },
  { url: 'https://www.lightstalking.com/feed/', name: 'Light Stalking', author: 'Light Stalking', kind: 'photo' },
];
const blocked = /hello world|rss|comment|menu|about page|forum|opportunity|building pixls|big picture|some updates|deep links|all the articles|still writing/i;
const parser = new Parser({ timeout: 20000 });
const results = [];
for (const source of sources) {
  try {
    const feed = await parser.parseURL(source.url);
    let count = 0;
    for (const item of feed.items) {
      if (!item.link || !item.title || blocked.test(item.title) || count >= 4) continue;
      results.push({
        title: item.title.slice(0, 300), url: item.link, author: source.author, source: source.name,
        publishedAt: item.isoDate ?? item.pubDate ?? '', kind: source.kind,
      });
      count += 1;
    }
    console.log(`${source.name}: ${count} items`);
  } catch (error) {
    console.warn(`${source.name}: skipped (${error instanceof Error ? error.message : 'feed error'})`);
  }
}
if (!results.length) {
  console.log('No fresh feed items. Keeping the existing discover dataset.');
  process.exit(0);
}
const seen = new Set();
const deduped = results.filter(item => { if (seen.has(item.url)) return false; seen.add(item.url); return true; });
deduped.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
writeFileSync('packages/web/src/site/data/discover.json', JSON.stringify(deduped.slice(0, 12), null, 2));
console.log(`Wrote ${Math.min(deduped.length, 12)} discover items.`);
