import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowUpRight, BookmarkSimple, Check, Sparkle } from '@phosphor-icons/react';
import { useAssistant, usePage } from '../AssistantContext';
import { useFavorites, useNotes, useStatuses, type StudyStatus } from '../store';
import { accessLabel, byId, formatDate, qualityLabel, rawLabel, topicMeta } from '../data';
import { Back, Badge, External } from '../ui';

export function TutorialPage() {
  const { id } = useParams(); const item = id ? byId(id) : undefined;
  if (!item) return <div className="not-found"><p className="kicker">未找到</p><h1>这条教程不在资料库里。</h1><Back to="/library">返回教程库</Back></div>;
  return <TutorialContent id={item.id} />;
}
function TutorialContent({ id }: { id: string }) {
  const item = byId(id)!; const { revisePrefill } = useAssistant();
  const [favorites, setFavorites] = useFavorites(); const [notes, setNotes] = useNotes(); const [statuses, setStatuses] = useStatuses();
  const [note, setNote] = useState(notes[id] ?? ''); const [saved, setSaved] = useState(false);
  usePage(item.title, [{ id: `tutorial-${id}`, title: item.title, text: item.summary, sourceUrl: item.url, kind: '教程简介' }]);
  useEffect(() => { setNote(notes[id] ?? ''); setSaved(false); }, [id]);
  const status = statuses[id] ?? 'none';
  const save = () => { setNotes(value => ({ ...value, [id]: note })); setSaved(true); };
  const setStatus = (next: StudyStatus) => setStatuses(value => ({ ...value, [id]: next }));
  const favorited = favorites.includes(id);
  return <div className="page tutorial-page">
    <Back to="/library">教程库</Back>
    <header className="tutorial-head">
      <p className="kicker">{topicMeta[item.topic].label} · {item.software} {item.version && `· ${item.version}`}</p>
      <h1>{item.title}</h1>
      <p className="tutorial-lede">{item.summary}</p>
      <div className="tutorial-by"><span>{item.author || '作者未注明'}</span><span>·</span><span>{item.language || '语言未注明'}</span><span>·</span><span>审核于 {formatDate(item.reviewedAt)}</span></div>
      <div className="tutorial-badges"><Badge tone="good">{qualityLabel[item.quality]}</Badge><Badge tone={item.rawStatus === 'paired' ? 'warm' : ''}>{rawLabel[item.rawStatus]}</Badge><Badge>{accessLabel[item.access]}</Badge></div>
      <div className="resource-bar">
        <a className="solid-button" href={item.url} target="_blank" rel="noopener noreferrer">去作者原站<ArrowUpRight size={16} /></a>
        {item.rawUrl && <a className="quiet-button" href={item.rawUrl} target="_blank" rel="noopener noreferrer">获取配套原片<ArrowUpRight size={15} /></a>}
        <button className={`quiet-button ${favorited ? 'on' : ''}`} onClick={() => setFavorites(value => favorited ? value.filter(entry => entry !== id) : [...value, id])}><BookmarkSimple size={16} weight={favorited ? 'fill' : 'regular'} />{favorited ? '已收藏' : '收藏'}</button>
        <button className="quiet-button" onClick={() => revisePrefill('我正在看这条教程。请基于页面上的简介，帮我判断该先观察什么；哪些部分需要我回到原站确认。')}><Sparkle size={16} />问 AI</button>
      </div>
    </header>
    <div className="tutorial-layout">
      <article className="tutorial-body">
        <section><h2>审核记录</h2><p className="meta">审核范围：{{ metadata: '仅简介和元信息', excerpt: '实际选段', content: '公开教学内容' }[item.reviewScope]} · {formatDate(item.reviewedAt)}</p><p>{item.reviewSummary || '尚未记录审核依据。'}</p></section>
        <section><h2>原片与使用边界</h2>{item.rawStatus === 'paired' ? <><p>{item.rawEvidence}</p><p className="fine">{item.rights}</p></> : <p>{item.rawEvidence || '这条教程没有可核实的配套原片。可以在原站查看作者是否另有素材说明。'}</p>}</section>
        <section className="source-note"><span className="kicker">SOURCE</span><h2>出处</h2><p>{item.author || '作者未注明'} · {new URL(item.url).hostname}</p><External href={item.url} className="text-link">打开原始页面</External></section>
      </article>
      <aside className="tutorial-aside">
        <section className="study-card">
          <div className="study-head"><span className="kicker">MY NOTE</span><span className={`status ${status}`}>{status === 'done' ? '已完成' : status === 'learning' ? '在学' : '未开始'}</span></div>
          <h2>带走一句话</h2>
          <textarea value={note} onChange={event => { setNote(event.target.value); setSaved(false); }} rows={7} placeholder="这张照片里，我先注意到了什么？哪一个调整改变了它？" aria-label="学习笔记" />
          <div className="study-actions"><button className="solid-button small" onClick={save}>{saved ? <Check size={15} /> : null}{saved ? '已保存' : '保存记录'}</button></div>
          <div className="status-row" role="group" aria-label="学习状态">{(['none', 'learning', 'done'] as const).map(value => <button key={value} className={status === value ? 'active' : ''} onClick={() => setStatus(value)}>{value === 'none' ? '未开始' : value === 'learning' ? '在学' : '完成'}</button>)}</div>
        </section>
        <section className="fact-card"><h2>教程信息</h2><dl><div><dt>软件</dt><dd>{item.software || '未注明'}</dd></div><div><dt>版本</dt><dd>{item.version || '未注明'}</dd></div><div><dt>难度</dt><dd>{item.level === 'beginner' ? '入门' : '进阶'}</dd></div><div><dt>工具</dt><dd>{item.tools.join('、') || '未注明'}</dd></div></dl><Link className="text-link" to={`/atlas?q=${encodeURIComponent(item.tools[0] || '')}`}>在色彩手册里查工具 <ArrowUpRight size={14} /></Link></section>
      </aside>
    </div>
  </div>;
}
