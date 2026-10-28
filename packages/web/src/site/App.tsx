import { lazy, Suspense, useEffect } from 'react';
import { HashRouter, Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { BookOpen, Compass, House, Notebook, Palette, GearSix, Sparkle, Sun, Moon } from '@phosphor-icons/react';
import { AssistantProvider, useAssistant } from './AssistantContext';
import { useNotes, useStatuses, useTheme } from './store';
import { tutorials } from './data';
const Home = lazy(() => import('./pages/Home').then(module => ({ default: module.Home })));
const Library = lazy(() => import('./pages/Library').then(module => ({ default: module.Library })));
const TutorialPage = lazy(() => import('./pages/TutorialPage').then(module => ({ default: module.TutorialPage })));
const Atlas = lazy(() => import('./pages/Atlas').then(module => ({ default: module.Atlas })));
const NotebookPage = lazy(() => import('./pages/NotebookPage').then(module => ({ default: module.NotebookPage })));
const DiscoverPage = lazy(() => import('./pages/DiscoverPage').then(module => ({ default: module.DiscoverPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));
const Assistant = lazy(() => import('./Assistant').then(module => ({ default: module.Assistant })));

const nav = [
  { to: '/', label: '首页', icon: House, end: true },
  { to: '/library', label: '教程', icon: BookOpen },
  { to: '/atlas', label: '色彩', icon: Palette },
  { to: '/discover', label: '发现', icon: Compass },
  { to: '/notebook', label: '记录', icon: Notebook },
];
export function Site() {
  return <HashRouter><AssistantProvider><Chrome /></AssistantProvider></HashRouter>;
}
function Chrome() {
  const { open, setOpen } = useAssistant(); const [theme, setTheme] = useTheme();
  const [notes] = useNotes(); const [statuses] = useStatuses();
  const location = useLocation();
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [location.pathname]);
  const studying = tutorials.filter(item => statuses[item.id] === 'learning' || notes[item.id]).slice(0, 4);
  return <div className={`shell ${open ? 'assistant-open' : ''}`}>
    <button className="skip" onClick={() => document.getElementById('main')?.focus()}>跳到主要内容</button>
    <aside className="rail">
      <Link to="/" className="brand" aria-label="调色书房首页"><span className="brand-mark" aria-hidden /><span><strong>调色书房</strong><small>A STUDY ROOM</small></span></Link>
      <nav className="rail-nav" aria-label="主导航">{nav.map(item => <NavLink key={item.to} to={item.to} end={item.end}><item.icon size={18} weight="regular" aria-hidden />{item.label}</NavLink>)}</nav>
      <div className="rail-study">
        <p className="rail-label">正在学习</p>
        {studying.length ? studying.map(item => <Link key={item.id} to={`/library/${item.id}`} className="rail-study-item"><span className={`topic-dot ${item.topic}`} /> <span>{item.title}</span></Link>) : <p className="rail-empty">还没有记录。<br /><Link to="/library">找一条教程开始</Link></p>}
      </div>
      <div className="rail-footer">
        <button className="rail-ai" onClick={() => setOpen(!open)} aria-expanded={open}><Sparkle size={17} />AI 答疑<small>针对当前页面</small></button>
        <div className="rail-meta"><button className="icon-button" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={theme === 'dark' ? '切换到浅色' : '切换到深色'}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button><Link className="icon-button" to="/settings" aria-label="设置"><GearSix size={18} /></Link></div>
      </div>
    </aside>
    <header className="mobile-head">
      <Link to="/" className="brand"><span className="brand-mark" aria-hidden /><strong>调色书房</strong></Link>
      <div><button className="icon-button" onClick={() => setOpen(!open)} aria-label="AI 答疑"><Sparkle size={18} /></button><Link className="icon-button" to="/settings" aria-label="设置"><GearSix size={18} /></Link></div>
    </header>
    <main id="main" className="main" tabIndex={-1}><Suspense fallback={<div className="route-loading" role="status">正在打开书房…</div>}><Routes>
      <Route path="/" element={<Home />} />
      <Route path="/library" element={<Library />} />
      <Route path="/library/:id" element={<TutorialPage />} />
      <Route path="/atlas" element={<Atlas />} />
      <Route path="/discover" element={<DiscoverPage />} />
      <Route path="/notebook" element={<NotebookPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="*" element={<div className="not-found"><p className="kicker">404</p><h1>这页不在书房里。</h1><Link to="/" className="text-link">回到首页</Link></div>} />
    </Routes></Suspense></main>
    <nav className="mobile-nav" aria-label="移动端导航">{nav.map(item => <NavLink key={item.to} to={item.to} end={item.end} aria-label={item.label}><item.icon size={20} /><span>{item.label}</span></NavLink>)}</nav>
    {open && <Suspense fallback={null}><Assistant /></Suspense>}
  </div>;
}
