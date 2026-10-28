import { useEffect, useMemo, useState, type PointerEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CaretDown, Sparkle } from '@phosphor-icons/react';
import { useAssistant, usePage } from '../AssistantContext';
import { knowledge, type KnowledgeCard } from '../data';
import { Empty, External, PageHead, Prose, Search } from '../ui';

const hsv = (h: number, s: number, v: number) => {
  const c = v / 100 * s / 100; const x = c * (1 - Math.abs((h / 60) % 2 - 1)); const m = v / 100 - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return `#${[r, g, b].map(n => Math.round((n + m) * 255).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
};
const relations = (hue: number, mode: 'complement' | 'analogous' | 'split') => mode === 'complement' ? [hue, (hue + 180) % 360] : mode === 'analogous' ? [(hue + 330) % 360, hue, (hue + 30) % 360] : [hue, (hue + 150) % 360, (hue + 210) % 360];

export function Atlas() {
  usePage('色彩手册'); const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? ''); const [category, setCategory] = useState('全部'); const [open, setOpen] = useState<string | null>(knowledge[0]?.id ?? null);
  useEffect(() => { setQuery(params.get('q') ?? ''); }, [params]);
  const categories = useMemo(() => ['全部', ...new Set(knowledge.map(card => card.category))], []);
  const cards = knowledge.filter(card => (category === '全部' || card.category === category) && [card.title, card.subtitle, card.body, ...card.tools].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  return <div className="page atlas-page">
    <PageHead kicker="COLOR ATLAS" title="色彩手册" actions={<span className="count">{knowledge.length} 张卡</span>} />
    <Wheel />
    <div className="atlas-layout">
      <aside className="atlas-index"><div className="index-title">目录</div>{categories.map(item => <button key={item} className={category === item ? 'active' : ''} onClick={() => setCategory(item)}>{item}<span>{item === '全部' ? knowledge.length : knowledge.filter(card => card.category === item).length}</span></button>)}</aside>
      <div className="atlas-entries"><div className="atlas-tools"><Search value={query} onChange={setQuery} placeholder="搜概念、工具或英文术语" /><span className="count">{cards.length} 条</span></div>
        {cards.length ? cards.map(card => <Entry key={card.id} card={card} open={open === card.id} onToggle={() => setOpen(open === card.id ? null : card.id)} />) : <Empty title="没有匹配的概念"><p>试试“曲线”“HSL”或“蒙版”。</p></Empty>}
      </div>
    </div>
  </div>;
}
function Entry({ card, open, onToggle }: { card: KnowledgeCard; open: boolean; onToggle: () => void }) {
  const { revisePrefill } = useAssistant();
  return <article className={`atlas-entry ${open ? 'open' : ''}`}><button className="entry-head" onClick={onToggle} aria-expanded={open}><div><p className="meta">{card.category}</p><h2>{card.title}</h2><p>{card.subtitle}</p></div><CaretDown size={18} /></button>{open && <div className="entry-body"><Prose>{card.body}</Prose><div className="entry-tools">{card.tools.map(tool => <Link key={tool} className="tag" to={`/library?q=${encodeURIComponent(tool)}`}>{tool}</Link>)}</div><div className="entry-foot"><div>{card.sources.map(source => <External key={source.url} href={source.url} className="source-link">{source.title}</External>)}</div><button className="text-link" onClick={() => revisePrefill(`请解释“${card.title}”这个概念。重点区分常见误解，以及它在 Camera Raw 与色轮/HSL 中的边界。\n\n参考解释：${card.body.slice(0, 2200)}`)}><Sparkle size={14} />问 AI</button></div></div>}</article>;
}
function Wheel() {
  const [hue, setHue] = useState(30); const [sat, setSat] = useState(65); const [val, setVal] = useState(85); const [mode, setMode] = useState<'complement' | 'analogous' | 'split'>('complement');
  const hues = relations(hue, mode);
  const pick = (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === 'pointermove' && !event.buttons) return;
    const rect = event.currentTarget.getBoundingClientRect(); const x = event.clientX - rect.left - rect.width / 2; const y = event.clientY - rect.top - rect.height / 2;
    setHue(Math.round((Math.atan2(y, x) * 180 / Math.PI + 450) % 360));
  };
  return <section className="wheel-panel">
    <div className="wheel-copy"><p className="kicker">HSV WHEEL</p><h2>色相关系，不是调色配方。</h2><p>互补取 H+180°，类似取 ±30°，分裂互补取 H+150°/210°。这张图只表示 HSV 色相环里的角度，不代表 RGB 数值反相，也不是颜料 RYB 混色。</p><div className="wheel-labels"><span><i style={{ background: hsv(hue, sat, val) }} />{hsv(hue, sat, val)}<small>H {hue}°</small></span><span><i style={{ background: hsv(hues[1], sat, val) }} />{hsv(hues[1], sat, val)}<small>关系色</small></span></div></div>
    <div className="wheel-stage"><div className="wheel" onPointerDown={pick} onPointerMove={pick} style={{ background: `conic-gradient(from -90deg, ${Array.from({ length: 13 }, (_, i) => `hsl(${i * 30} 70% 55%)`).join(',')})` }} role="img" aria-label={`HSV 色相环，当前色相 ${hue} 度`}><div className="wheel-hole"><strong>{hue}°</strong><small>HUE</small></div>{hues.map((h, index) => <span key={index} className="wheel-dot" style={{ background: hsv(h, sat, val), left: `${50 + 42 * Math.sin(h * Math.PI / 180)}%`, top: `${50 - 42 * Math.cos(h * Math.PI / 180)}%` }}>{index + 1}</span>)}</div></div>
    <div className="wheel-controls"><label>色相 <b>{hue}°</b><input type="range" min={0} max={359} value={hue} onChange={event => setHue(Number(event.target.value))} /></label><label>饱和度 <b>{sat}%</b><input type="range" min={0} max={100} value={sat} onChange={event => setSat(Number(event.target.value))} /></label><label>明度 <b>{val}%</b><input type="range" min={0} max={100} value={val} onChange={event => setVal(Number(event.target.value))} /></label><label>关系<select value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="complement">互补</option><option value="analogous">类似</option><option value="split">分裂互补</option></select></label></div>
  </section>;
}
