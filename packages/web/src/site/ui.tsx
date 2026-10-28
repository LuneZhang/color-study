import type { ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, FolderOpen } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import Markdown from 'react-markdown';

export function PageHead({ title, description, actions, kicker }: { title: string; description?: string; actions?: ReactNode; kicker?: string }) {
  return <header className="page-head">{kicker && <p className="kicker">{kicker}</p>}<div className="page-head-row"><div><h1>{title}</h1>{description && <p className="page-sub">{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div></header>;
}
export function Back({ to, children = '返回' }: { to: string; children?: ReactNode }) {
  return <Link className="back" to={to}><ArrowLeft size={15} />{children}</Link>;
}
export function Badge({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="empty"><FolderOpen size={26} /><h2>{title}</h2>{children && <div>{children}</div>}</div>;
}
export function External({ href, children, className = '' }: { href: string; children: ReactNode; className?: string }) {
  return <a className={className} href={href} target="_blank" rel="noopener noreferrer">{children}<ArrowUpRight size={14} /></a>;
}
export function Prose({ children }: { children: string }) {
  return <div className="prose"><Markdown skipHtml components={{
    a: ({ href, children: text }) => href && /^https?:\/\//.test(href) ? <a href={href} target="_blank" rel="noopener noreferrer">{text}</a> : <span>{text}</span>,
    h2: ({ children: text }) => <h2>{text}</h2>,
  }}>{children}</Markdown></div>;
}
export function Search({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder: string }) {
  return <label className="search-field"><span className="search-icon" aria-hidden>⌕</span><input type="search" value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} aria-label={placeholder} />{value && <button type="button" onClick={() => onChange('')} aria-label="清除搜索">×</button>}</label>;
}
