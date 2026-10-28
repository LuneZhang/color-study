import { Link } from 'react-router-dom';
import { ArrowUpRight, BookmarkSimple } from '@phosphor-icons/react';
import { usePage } from '../AssistantContext';
import { useFavorites, useNotes, useStatuses } from '../store';
import { formatDate, topicMeta, tutorials } from '../data';
import { Empty, PageHead } from '../ui';

export function NotebookPage() {
  usePage('学习记录');
  const [notes] = useNotes(); const [statuses] = useStatuses(); const [favorites] = useFavorites();
  const active = tutorials.filter(item => statuses[item.id] === 'learning' || (notes[item.id]?.trim() && statuses[item.id] !== 'done'));
  const done = tutorials.filter(item => statuses[item.id] === 'done');
  const saved = tutorials.filter(item => favorites.includes(item.id));
  const total = active.length + done.length;
  return <div className="page">
    <PageHead kicker="NOTEBOOK" title="记录" description="收藏、在学和已经完成的教程。笔记与状态只保存在当前浏览器。" actions={<Link className="quiet-button" to="/library">去教程库<ArrowUpRight size={15} /></Link>} />
    {total > 0 ? <>
      {active.length > 0 && <section className="record-section"><div className="section-line"><h2>在学</h2><span className="count">{active.length}</span></div>{active.map(item => <RecordRow key={item.id} id={item.id} note={notes[item.id]} status="在学" />)}</section>}
      {done.length > 0 && <section className="record-section"><div className="section-line"><h2>完成</h2><span className="count">{done.length}</span></div>{done.map(item => <RecordRow key={item.id} id={item.id} note={notes[item.id]} status="已完成" />)}</section>}
    </> : saved.length ? null : <Empty title="还没有留下记录"><p>打开一条教程，写下一句你的观察，它就会出现在这里。没有打卡，也没有完成率。</p><Link to="/library" className="solid-button">挑一条教程<ArrowUpRight size={15} /></Link></Empty>}
    {saved.length > 0 && <section className="record-section saved-section"><div className="section-line"><h2>收藏</h2><span className="count">{saved.length}</span></div><div className="saved-grid">{saved.map(item => <Link key={item.id} to={`/library/${item.id}`} className="saved-card"><BookmarkSimple size={16} weight="fill" /><div><p className="meta">{topicMeta[item.topic].label}</p><strong>{item.title}</strong><small>{item.author || '作者未注明'}</small></div></Link>)}</div></section>}
    <p className="storage-note">学习记录保存在本机浏览器。换设备或清理站点数据后不会自动同步；可在设置中导出 JSON。</p>
  </div>;
}
function RecordRow({ id, note, status }: { id: string; note?: string; status: string }) {
  const item = tutorials.find(entry => entry.id === id)!;
  return <Link to={`/library/${id}`} className="record-row"><span className={`record-topic ${item.topic}`} /><div><div className="meta">{topicMeta[item.topic].label} · {status} · {formatDate(item.reviewedAt)}</div><h3>{item.title}</h3><p className="clamp-two">{note || '还没有写笔记。'}</p></div><ArrowUpRight size={17} /></Link>;
}
