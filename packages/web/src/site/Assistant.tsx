import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Images, PaperPlaneTilt, Quotes, Stop, X } from '@phosphor-icons/react';
import { readSse } from '../lib/sse';
import { useAssistant } from './AssistantContext';
import { readApiKey, useAi } from './store';

interface Message { role: 'user' | 'assistant'; content: string; images?: string[]; error?: boolean }
const SYSTEM = `你是调色学习助手。作者教程是教学主体，你不能编造或还原作者的真实参数、流程、章节或原话，也不从成片逆推作者操作。
页面资料只代表已保存的简介或知识卡；没有正文时不要假装读过完整教程。区分“资料中的内容”和“你的通用解释”。
涉及颜色调整时先区分当前工具、偏色、饱和度、明度与互补色概念，不把颜色词直接变成固定滑块配方。
回答使用简体中文，先直接回答，再给必要的条件。你不是作者的代言人。`;

function prepareImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image(); const url = URL.createObjectURL(file);
    image.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(image.width * scale); canvas.height = Math.round(image.height * scale);
      const context = canvas.getContext('2d'); if (!context) { URL.revokeObjectURL(url); reject(new Error('无法处理图片')); return; }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url); resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('无法读取这张图片')); };
    image.src = url;
  });
}
function contentOf(data: string) {
  if (!data || data === '[DONE]') return '';
  try { return (JSON.parse(data) as { choices?: { delta?: { content?: string }; message?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? (JSON.parse(data) as { choices?: { message?: { content?: string } }[] }).choices?.[0]?.message?.content ?? ''; } catch { return ''; }
}

export function Assistant() {
  const state = useAssistant(); const [ai] = useAi();
  const [hidden, setHidden] = useState<string[]>([]); const [selected, setSelected] = useState<{ id: string; text: string }[]>([]);
  const [messages, setMessages] = useState<Message[]>([]); const [draft, setDraft] = useState(''); const [tool, setTool] = useState('');
  const [images, setImages] = useState<string[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [stream, setStream] = useState(''); const [attaching, setAttaching] = useState(false);
  const abort = useRef<AbortController | null>(null); const bottom = useRef<HTMLDivElement>(null); const textarea = useRef<HTMLTextAreaElement>(null);
  const key = readApiKey(ai.remember); const configured = Boolean(ai.baseUrl.trim() && ai.model.trim() && key);
  const materials = state.materials.filter(item => !hidden.includes(item.id));
  const contextChars = (draft + tool + materials.map(item => item.title + item.text).join('') + selected.map(item => item.text).join('')).length;
  useEffect(() => {
    if (!state.open) return;
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) state.setOpen(false); };
    window.addEventListener('keydown', close); textarea.current?.focus();
    return () => window.removeEventListener('keydown', close);
  }, [state.open, busy, state]);
  useEffect(() => { if (state.revision) setDraft(state.prefill); }, [state.revision, state.prefill]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: 'nearest' }); }, [messages, stream]);
  useEffect(() => { setMessages([]); setSelected([]); setHidden([]); setError(''); setStream(''); setDraft(''); setImages([]); abort.current?.abort(); }, [state.pageKey]);
  function quote() {
    const text = window.getSelection()?.toString().trim().replace(/\s+/g, ' ').slice(0, 4000);
    if (!text) { setError('先在页面正文中选中文字，再点击引用。'); return; }
    setSelected(value => [...value, { id: `sel-${crypto.randomUUID()}`, text }]); setError('');
  }
  async function attach(file: File) {
    if (images.length >= 2) { setError('每次最多两张图片。'); return; }
    if (!ai.imageSupport) { setError('当前配置未声明支持图片。请先在设置中确认模型能力。'); return; }
    setAttaching(true); setError('');
    try { const data = await prepareImage(file); setImages(value => [...value, data].slice(0, 2)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : '图片处理失败'); }
    finally { setAttaching(false); }
  }
  async function send(event: React.FormEvent) {
    event.preventDefault();
    if (!configured) { setError('请先在设置中连接 AI 服务。'); return; }
    if (!draft.trim() || busy) return;
    if (contextChars > 12000) { setError('问题与当前资料超过 12,000 字，请移除部分资料或缩短问题。'); return; }
    const question = draft.trim();
    const packet = [materials.map(item => `【资料】${item.title}\n${item.text}`).join('\n\n'), selected.map(item => `【选中文字】${item.text}`).join('\n\n'), tool ? `【当前工具】${tool}` : '', `【问题】${question}`].filter(Boolean).join('\n\n');
    const turn: Message = { role: 'user', content: question, images: [...images] };
    const history = messages.filter(item => !item.error).slice(-6).map(item => ({ role: item.role, content: item.content }));
    setMessages(value => [...value, turn]); setDraft(''); setBusy(true); setError(''); setStream('');
    const controller = new AbortController(); abort.current = controller;
    let received = '';
    try {
      const response = await fetch(`${ai.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: ai.model, stream: true, max_tokens: 1024, messages: [
          { role: 'system', content: SYSTEM }, ...history,
          { role: 'user', content: images.length ? [{ type: 'text', text: packet }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] : packet },
        ] }),
      });
      if (!response.ok) throw new Error(response.status === 401 ? '密钥被拒绝（401）。' : response.status === 403 ? '服务商拒绝直连（403），请检查代理地址。' : `服务返回 ${response.status}。`);
      const type = response.headers.get('content-type') ?? '';
      if (type.includes('text/event-stream') && response.body) {
        for await (const item of readSse(response.body)) { const delta = contentOf(item.data); if (delta) { received += delta; setStream(received); } }
      } else {
        const data = await response.json() as { choices?: { message?: { content?: string } }[] };
        received = data.choices?.[0]?.message?.content ?? '';
      }
      if (!received.trim()) throw new Error('服务返回了空回答。');
      setMessages(value => [...value, { role: 'assistant', content: received }]); setStream('');
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) setError(cause instanceof Error ? cause.message : '请求失败，请稍后重试。');
      else if (received) setMessages(value => [...value, { role: 'assistant', content: received, error: false }]);
      setStream('');
    } finally { setBusy(false); abort.current = null; }
  }
  if (!state.open) return null;
  return <div className="assistant-layer">
    <button className="assistant-backdrop" aria-label="关闭 AI 答疑" onClick={() => !busy && state.setOpen(false)} />
    <aside className="assistant-panel" aria-label="学习答疑">
      <header className="assistant-head"><div><span className="assistant-mark" aria-hidden /><div><h2>学习答疑</h2><p>{configured ? ai.model : '未连接 AI 服务'}</p></div></div><button className="icon-button" onClick={() => !busy && state.setOpen(false)} aria-label="关闭"><X size={19} /></button></header>
      <div className="assistant-log">
        {messages.map((message, index) => <article className={`message ${message.role} ${message.error ? 'error' : ''}`} key={index}><span>{message.role === 'user' ? '你' : 'AI'}</span>{message.images?.map((src, i) => <img key={i} src={src} alt="发送的附图" />)}<p>{message.content}</p></article>)}
        {stream && <article className="message assistant"><span>AI</span><p>{stream}</p></article>}
        {busy && !stream && <p className="assistant-wait">正在等待回答…</p>}
        {error && <p className="assistant-error" role="alert">{error}</p>}
        <div ref={bottom} />
      </div>
      <form className="assistant-compose" onSubmit={send}>
        {(materials.length > 0 || selected.length > 0 || images.length > 0) && <div className="context-box">
          <div className="context-title"><span>本次带上</span><span>{contextChars.toLocaleString()} 字</span></div>
          {materials.map(item => <div className="context-row" key={item.id}><span><strong>{item.title}</strong><small>{item.kind ?? '页面资料'}</small></span><button type="button" className="mini" onClick={() => setHidden(value => [...value, item.id])} aria-label={`移除 ${item.title}`}><X size={13} /></button></div>)}
          {selected.map(item => <div className="context-row" key={item.id}><span><strong>选中文字</strong><small>{item.text.slice(0, 42)}…</small></span><button type="button" className="mini" onClick={() => setSelected(value => value.filter(entry => entry.id !== item.id))} aria-label="移除选中文字"><X size={13} /></button></div>)}
          {images.map((src, index) => <div className="context-row" key={index}><span><strong>附图 {index + 1}</strong><small>发送前已重编码、去元数据</small></span><button type="button" className="mini" onClick={() => setImages(value => value.filter((_, i) => i !== index))} aria-label="移除附图"><X size={13} /></button></div>)}
        </div>}
        <textarea ref={textarea} value={draft} onChange={event => setDraft(event.target.value)} rows={3} maxLength={8000} placeholder="比如：在 Camera Raw 里想让蓝色更纯净，应该先分清什么？" aria-label="你的问题" />
        <div className="compose-tools">
          <input value={tool} onChange={event => setTool(event.target.value)} placeholder="当前工具（可选）" aria-label="当前工具" maxLength={120} />
          <button type="button" className="tool-button" onMouseDown={event => event.preventDefault()} onClick={quote}><Quotes size={16} />选中文字</button>
          <label className="tool-button" title="附上一张截图或 JPEG/PNG"><Images size={16} />{attaching ? '处理中' : '附图'}<input type="file" accept="image/jpeg,image/png" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void attach(file); event.target.value = ''; }} /></label>
        </div>
        {!configured && <p className="assistant-wait">未连接 AI · <Link to="/settings">去设置</Link></p>}
        <div className="compose-footer">{busy ? <button type="button" className="danger-button" onClick={event => { event.preventDefault(); abort.current?.abort(); }}><Stop size={15} />停止</button> : <button className="send-button" disabled={!configured || !draft.trim()}><PaperPlaneTilt size={15} />发送</button>}</div>
      </form>
    </aside>
  </div>;
}
