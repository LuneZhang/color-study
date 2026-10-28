import { useState, type FormEvent } from 'react';
import { ArrowUpRight, Plus, Trash } from '@phosphor-icons/react';
import { usePage } from '../AssistantContext';
import { useWorks } from '../store';
import { discover, formatDate } from '../data';
import { Empty, External, PageHead } from '../ui';

export function DiscoverPage() {
  usePage('发现'); const [works, setWorks] = useWorks();
  const [source, setSource] = useState('全部'); const [form, setForm] = useState({ title: '', url: '', author: '', note: '' }); const [error, setError] = useState('');
  const sources = ['全部', ...new Set(discover.map(item => item.source))];
  const items = discover.filter(item => source === '全部' || item.source === source);
  function add(event: FormEvent) {
    event.preventDefault();
    try { const url = new URL(form.url); if (!['http:', 'https:'].includes(url.protocol)) throw new Error(); }
    catch { setError('请填写完整的 http(s) 作品链接。'); return; }
    if (!form.title.trim()) { setError('给作品一个标题。'); return; }
    setWorks(value => [{ id: crypto.randomUUID(), title: form.title.trim(), url: form.url, author: form.author.trim(), note: form.note.trim(), addedAt: new Date().toISOString() }, ...value]);
    setForm({ title: '', url: '', author: '', note: '' }); setError('');
  }
  return <div className="page discover-page">
    <PageHead kicker="DISCOVERY" title="发现" description="来源更新与参考作品。" actions={<span className="count">{discover.length} 条来源更新</span>} />
    <div className="discover-layout">
      <section className="discover-feed"><div className="section-line"><h2>来源更新</h2><div className="chip-row">{sources.map(item => <button key={item} className={source === item ? 'chip active' : 'chip'} onClick={() => setSource(item)}>{item.replace('www.', '')}</button>)}</div></div>
        <div className="timeline">{items.map((item, index) => <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer" className="timeline-row"><span className="timeline-index">{String(index + 1).padStart(2, '0')}</span><div><div className="meta">{item.source} · {formatDate(item.publishedAt)} · {item.kind === 'practice' ? '实践文章' : '摄影文章'}</div><h3>{item.title}</h3><p>作者：{item.author}</p></div><ArrowUpRight size={16} /></a>)}</div>
      </section>
      <aside className="works-panel"><div className="section-line"><h2>我的参考作品</h2><span className="count">{works.length}</span></div><form className="work-form" onSubmit={add}><label>标题<input value={form.title} onChange={event => setForm({ ...form, title: event.target.value })} maxLength={200} /></label><label>作品链接<input type="url" value={form.url} onChange={event => setForm({ ...form, url: event.target.value })} placeholder="https://" /></label><label>作者<input value={form.author} onChange={event => setForm({ ...form, author: event.target.value })} maxLength={120} /></label><label>我为什么记住它<textarea rows={3} value={form.note} onChange={event => setForm({ ...form, note: event.target.value })} maxLength={1000} /></label>{error && <p className="form-error" role="alert">{error}</p>}<button className="solid-button small"><Plus size={15} />收藏作品</button></form>
        {works.length ? <div className="work-list">{works.map(work => <div className="work-row" key={work.id}><div><p className="meta">{work.author || '作者未注明'} · {formatDate(work.addedAt)}</p><strong>{work.title}</strong>{work.note && <p>{work.note}</p>}<External href={work.url} className="source-link">原站</External></div><button className="mini" onClick={() => setWorks(value => value.filter(item => item.id !== work.id))} aria-label={`删除 ${work.title}`}><Trash size={15} /></button></div>)}</div> : <Empty title="还没有参考作品"><p>从喜欢的作品出处开始，不必先有答案。</p></Empty>}
      </aside>
    </div>
  </div>;
}
