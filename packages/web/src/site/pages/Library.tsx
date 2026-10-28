import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { BookmarkSimple, ArrowUpRight } from '@phosphor-icons/react';
import { usePage } from '../AssistantContext';
import { useFavorites } from '../store';
import { formatDate, qualityLabel, rawLabel, topicMeta, tutorials, type Topic } from '../data';
import { Badge, Empty, PageHead, Search } from '../ui';

export function Library() {
  usePage('教程库');
  const [params] = useSearchParams(); const [query, setQuery] = useState(params.get('q') ?? ''); const [topic, setTopic] = useState<Topic | 'all'>('all'); const [paired, setPaired] = useState(false);
  useEffect(() => { setQuery(params.get('q') ?? ''); }, [params]);
  const [favorites, setFavorites] = useFavorites();
  const items = useMemo(() => tutorials.filter(item => {
    const text = [item.title, item.author, item.summary, ...item.tools].join(' ').toLowerCase();
    return text.includes(query.trim().toLowerCase()) && (topic === 'all' || item.topic === topic) && (!paired || item.rawStatus === 'paired');
  }), [query, topic, paired]);
  const toggle = (id: string) => setFavorites(value => value.includes(id) ? value.filter(item => item !== id) : [...value, id]);
  return <div className="page">
    <PageHead kicker="LIBRARY · 已核实" title="教程" description="按题材、工具与原片状态筛选。" actions={<span className="count">{tutorials.length} 条</span>} />
    <div className="library-tools"><Search value={query} onChange={setQuery} placeholder="搜标题、作者或工具" /><div className="chip-row">
      <button className={topic === 'all' ? 'chip active' : 'chip'} onClick={() => setTopic('all')}>全部</button>
      {(Object.keys(topicMeta) as Topic[]).map(key => <button className={topic === key ? 'chip active' : 'chip'} key={key} onClick={() => setTopic(key)}>{topicMeta[key].label}</button>)}
      <button className={paired ? 'chip active' : 'chip'} onClick={() => setPaired(!paired)}>有配套原片</button>
    </div></div>
    {items.length ? <div className="tutorial-list">{items.map((item, index) => <article className={`tutorial-item topic-${item.topic}`} key={item.id}>
      <span className="item-index">{String(index + 1).padStart(2, '0')}</span>
      <div className="item-main"><div className="meta">{topicMeta[item.topic].label} · {item.software}{item.version ? ` · ${item.version}` : ''}</div><h2><Link to={`/library/${item.id}`}>{item.title}</Link></h2><p className="item-auth">{item.author || '作者未注明'} · {item.language || '语言未注明'}</p><p className="item-summary">{item.summary}</p><div className="item-badges"><Badge tone={item.quality === 'recommended' ? 'good' : ''}>{qualityLabel[item.quality]}</Badge><Badge tone={item.rawStatus === 'paired' ? 'warm' : ''}>{rawLabel[item.rawStatus]}</Badge>{item.tools.slice(0, 3).map(tool => <Badge key={tool}>{tool}</Badge>)}</div></div>
      <div className="item-side"><span className="item-date">{formatDate(item.reviewedAt)}</span><button className={`save-button ${favorites.includes(item.id) ? 'on' : ''}`} onClick={() => toggle(item.id)} aria-label={favorites.includes(item.id) ? `取消收藏 ${item.title}` : `收藏 ${item.title}`}><BookmarkSimple size={18} weight={favorites.includes(item.id) ? 'fill' : 'regular'} /></button><Link className="go" to={`/library/${item.id}`} aria-label={`打开 ${item.title}`}><ArrowUpRight size={17} /></Link></div>
    </article>)}</div> : <Empty title="没有匹配的教程"><p>试试清空搜索或换一个题材。</p><button className="text-link" onClick={() => { setQuery(''); setTopic('all'); setPaired(false); }}>清除筛选</button></Empty>}
  </div>;
}
