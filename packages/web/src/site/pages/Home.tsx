import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, BookOpen, Palette, Sparkle } from '@phosphor-icons/react';
import { useAssistant, usePage } from '../AssistantContext';
import { useNotes, useStatuses } from '../store';
import { discover, featuredTutorial, formatDate, topicMeta, tutorials } from '../data';

export function Home() {
  usePage('首页');
  const { setOpen } = useAssistant(); const [notes] = useNotes(); const [statuses] = useStatuses();
  const featured = tutorials.find(item => item.title.includes('HDR')) ?? featuredTutorial;
  const continuing = tutorials.find(item => statuses[item.id] === 'learning' || notes[item.id]);
  const news = discover.slice(0, 3);
  const starters = tutorials.filter(item => item.rawStatus === 'paired' && item.id !== featured.id).slice(0, 2);
  return <div className="home">
    <section className="home-hero">
      <div className="hero-copy">
        <p className="kicker">A LOCAL STUDY ROOM</p>
        <h1><span className="hero-line">把调色，</span><span className="hero-line">练成自己的判断。</span></h1>
        <p className="hero-sub">找到值得学的教程，拿到原片，把观察留下来。</p>
        <div className="hero-actions"><Link className="solid-button" to={continuing ? `/library/${continuing.id}` : '/library'}>{continuing ? '继续上次的教程' : '挑一条教程开始'}<ArrowRight size={16} /></Link><button className="quiet-button" onClick={() => setOpen(true)}><Sparkle size={15} />问一句</button></div>
        <div className="hero-topics">{Object.entries(topicMeta).map(([key, value]) => <span key={key}><i style={{ background: value.color }} />{value.label}<em>{value.note}</em></span>)}</div>
      </div>
      <article className="feature">
        <div className="feature-top"><span className="kicker">今日跟练</span><span className="mono">01 / {String(tutorials.length).padStart(2, '0')}</span></div>
        <div className={`feature-band ${featured.topic}`} />
        <div className="feature-body">
          <p className="meta">{topicMeta[featured.topic].label} · {featured.software}</p>
          <h2>{featured.title}</h2>
          <p className="feature-author">{featured.author || '作者未注明'}<span>·</span>{featured.rawStatus === 'paired' ? '有配套原片' : '仅教程'}</p>
          <Link className="feature-link" to={`/library/${featured.id}`}>打开这条教程<ArrowUpRight size={16} /></Link>
        </div>
      </article>
    </section>
    <section className="path-strip" aria-label="学习闭环">
      <div><span className="path-number">读</span><h2>在原站跟完步骤</h2><p>作者的顺序、参数和取舍，以原文为准。本站只做筛选和来源记录。</p></div>
      <div><span className="path-number">练</span><h2>用配套原片做一次</h2><p>有授权原片时，下载后在自己的 Camera Raw 里完成，不靠看会。</p></div>
      <div><span className="path-number">问</span><h2>把卡住的那一步问清楚</h2><p>带上当前教程或选中文字提问，AI 补充解释，不替你编作者流程。</p></div>
    </section>
    <section className="home-lower">
      <div className="home-section">
        <div className="section-line"><h2>继续</h2><Link to="/notebook">全部记录<ArrowRight size={15} /></Link></div>
        {continuing ? <Link to={`/library/${continuing.id}`} className="continue-card"><div className="continue-topic" style={{ background: topicMeta[continuing.topic].color }} /><div><p className="meta">{topicMeta[continuing.topic].label} · {statuses[continuing.id] === 'done' ? '已完成' : '在学'}</p><h3>{continuing.title}</h3><p className="clamp-two">{notes[continuing.id] || '还没有写下这次练习的判断。'}</p></div><ArrowUpRight size={18} /></Link> : <div className="blank-state"><p>还没有学习记录。先打开一条教程，把观察或疑问写下来。</p><Link to="/library" className="text-link">去教程库 <ArrowRight size={14} /></Link><div className="starter-links">{starters.map(item => <Link key={item.id} to={`/library/${item.id}`}><span className={`topic-dot ${item.topic}`} /><span>{item.title}</span><ArrowUpRight size={13} /></Link>)}</div></div>}
      </div>
      <div className="home-section">
        <div className="section-line"><h2>新发现</h2><Link to="/discover">全部来源<ArrowRight size={15} /></Link></div>
        <div className="feed-mini">{news.map(item => <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer"><span className="meta">{item.source} · {formatDate(item.publishedAt)}</span><strong>{item.title}</strong><ArrowUpRight size={15} /></a>)}</div>
      </div>
    </section>
    <section className="atlas-teaser">
      <div className="mini-wheel" aria-hidden><span /></div>
      <div><p className="kicker">COLOR ATLAS</p><h2>先会看，再会调。</h2><p>曲线、HSL、白平衡、蒙版和色轮，用一张张有来源的小卡查清楚。它们不是配方，是判断的依据。</p><Link to="/atlas" className="text-link">打开色彩手册 <ArrowRight size={14} /></Link></div>
      <div className="atlas-teaser-links"><Link to="/atlas?q=曲线"><BookOpen size={16} />曲线在重映射什么</Link><Link to="/atlas?q=HSL"><Palette size={16} />HSL 不是三个“更鲜艳”</Link><Link to="/atlas?q=互补"><Sparkle size={16} />互补色与滑块的距离</Link></div>
    </section>
    <footer className="site-foot"><span>调色书房</span><span>{new Date().getFullYear()}</span></footer>
  </div>;
}
