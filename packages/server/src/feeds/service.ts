import Parser from 'rss-parser';
import type { Source, LibraryItem } from '@color-study/shared';
import { libraryInput } from '@color-study/shared';
import { Store, entity } from '../db/store';
import { safeRequest, limitedText, canonicalUrl } from '../network';
import { AppError, notFound } from '../errors';

const interval = 6 * 60 * 60 * 1000;
export class FeedService {
  private running = new Set<string>();
  private timer?: ReturnType<typeof setInterval>;
  constructor(private store: Store, private fetcher = safeRequest) {}
  async refresh(id: string, force = false) {
    const source = notFound(this.store.get<Source>('sources', id));
    if (this.store.maintenance || this.running.has(id)) return { added: 0, skipped: true };
    if (!force && source.lastAttempt && Date.now() - Date.parse(source.lastAttempt) < 60_000) return { added: 0, skipped: true };
    const dataDir = this.store.dataDir; this.running.add(id);
    const lastAttempt = new Date().toISOString();
    this.store.put('sources', { ...source, lastAttempt });
    try {
      const result = await this.fetch(source);
      if (dataDir !== this.store.dataDir || this.store.maintenance || !this.store.get('sources', id)) return { added: 0, skipped: true };
      const added = result.text ? await this.importXml(source, result.text) : 0;
      const current = notFound(this.store.get<Source>('sources', id));
      this.store.put('sources', { ...current, lastAttempt, lastSuccess: new Date().toISOString(), error: '', errorCount: 0,
        nextCheck: new Date(Date.now() + interval).toISOString(), etag: result.etag || source.etag, lastModified: result.lastModified || source.lastModified });
      return { added };
    } catch (error) {
      const current = this.store.get<Source>('sources', id);
      if (current && dataDir === this.store.dataDir && !this.store.maintenance) {
        const errorCount = current.errorCount + 1;
        const message = error instanceof AppError ? error.message : '无法读取该订阅源，请检查网络或来源地址';
        this.store.put('sources', { ...current, lastAttempt, errorCount, error: message,
          nextCheck: new Date(Date.now() + Math.min(24 * 60 * 60 * 1000, 15 * 60 * 1000 * 4 ** Math.min(errorCount - 1, 4))).toISOString() });
      }
      throw error instanceof AppError ? error : new AppError(502, 'FEED_UNAVAILABLE', '暂时无法更新，已保留已有资料');
    } finally { this.running.delete(id); }
  }
  private async fetch(source: Source) {
    const headers: Record<string, string> = { accept: 'application/rss+xml,application/atom+xml,application/xml,text/xml', 'user-agent': 'ColorStudy/0.1 personal feed reader' };
    if (source.etag) headers['if-none-match'] = source.etag;
    if (source.lastModified) headers['if-modified-since'] = source.lastModified;
    let url = source.url;
    const signal = AbortSignal.timeout(15_000);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await this.fetcher(url, { headers, signal, timeout: 15000 });
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.body.destroy();
        if (!response.headers.location || redirects === 3) throw new AppError(502, 'FEED_REDIRECT', '订阅源重定向次数过多');
        url = new URL(String(response.headers.location), url).href; continue;
      }
      const etag = String(response.headers.etag ?? ''); const lastModified = String(response.headers['last-modified'] ?? '');
      if (response.statusCode === 304) { response.body.destroy(); return { text: '', etag, lastModified }; }
      if (response.statusCode !== 200) { response.body.destroy(); throw new AppError(502, 'FEED_STATUS', `订阅源返回 HTTP ${response.statusCode}`); }
      const text = await limitedText(response.body, 2 * 1024 ** 2);
      if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new AppError(400, 'UNSAFE_XML', '订阅包含不允许的 XML 定义');
      return { text, etag, lastModified };
    }
    throw new AppError(502, 'FEED_REDIRECT', '无法完成订阅重定向');
  }
  async importXml(source: Source, xml: string) {
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new AppError(400, 'UNSAFE_XML', '不允许外部实体');
    const feed = await new Parser().parseString(xml);
    let added = 0;
    this.store.db.transaction(() => {
      for (const entry of feed.items.slice(0, 200)) {
        if (!entry.link || !entry.title) continue;
        const parsed = libraryInput.safeParse({ title: entry.title.slice(0, 300), url: new URL(entry.link, source.siteUrl || source.url).href,
          author: (entry.creator || source.name).slice(0, 160), publishedAt: entry.isoDate ?? entry.pubDate ?? '', origin: 'feed' });
        if (!parsed.success) continue;
        parsed.data.url = canonicalUrl(parsed.data.url);
        parsed.data.author = parsed.data.author.replace(/^[^\s@]+@[^\s@]+\s+\((.+)\)$/, '$1');
        const guid = (entry.guid || parsed.data.url).slice(0, 2048);
        const previousEntry = this.store.db.prepare('SELECT item_id FROM source_entries WHERE source_id=? AND guid=?').get(source.id, guid);
        if (previousEntry) continue;
        const row = this.store.db.prepare("SELECT data FROM library WHERE json_extract(data,'$.url')=?").get(parsed.data.url) as { data: string } | undefined;
        const item = row ? JSON.parse(row.data) as LibraryItem : entity(parsed.data);
        if (!row) { this.store.put('library', item); added++; }
        this.store.db.prepare('INSERT OR IGNORE INTO source_entries(source_id,guid,item_id) VALUES (?,?,?)').run(source.id, guid, item.id);
      }
    })();
    return added;
  }
  start() {
    const tick = async () => {
      if (this.store.maintenance) return;
      for (const source of this.store.list<Source>('sources')) {
        if (source.enabled && (!source.nextCheck || Date.parse(source.nextCheck) <= Date.now())) await this.refresh(source.id).catch(() => {});
      }
    };
    void tick(); this.timer = setInterval(() => void tick(), 60_000); this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); }
}
