import { useState, type FormEvent } from 'react';
import { DownloadSimple, UploadSimple, Trash, Check } from '@phosphor-icons/react';
import { usePage } from '../AssistantContext';
import { clearApiKey, clearLocalData, exportLocalData, hasApiKey, importLocalData, readApiKey, saveApiKey, useAi, useTheme } from '../store';
import { PageHead } from '../ui';

export function SettingsPage() {
  usePage('设置'); const [ai, setAi] = useAi(); const [theme, setTheme] = useTheme();
  const [form, setForm] = useState({ ...ai, key: '' }); const [hasKey, setHasKey] = useState(() => hasApiKey(ai.remember));
  const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [importError, setImportError] = useState('');
  function save(event: FormEvent) {
    event.preventDefault(); setError(''); setNotice('');
    let url: URL; try { url = new URL(form.baseUrl); } catch { setError('请填写完整的 API 地址。'); return; }
    if (!['http:', 'https:'].includes(url.protocol)) { setError('地址必须以 http(s) 开头。'); return; }
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1'].includes(url.hostname)) { setError('远端服务请使用 HTTPS，避免 Key 以明文传输。'); return; }
    if (!form.model.trim()) { setError('填写模型 ID。'); return; }
    const secret = form.key.trim() || readApiKey(ai.remember);
    if (!secret) { setError('填写 API Key。'); return; }
    saveApiKey(secret, form.remember);
    setAi({ baseUrl: form.baseUrl.trim(), model: form.model.trim(), imageSupport: form.imageSupport, remember: form.remember });
    setHasKey(true); setForm(value => ({ ...value, key: '' })); setNotice('连接配置已保存在这个浏览器。');
  }
  function exportData() {
    const value = exportLocalData(); const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `color-study-${new Date().toISOString().slice(0, 10)}.json`; link.click(); URL.revokeObjectURL(url);
  }
  async function importFile(file: File) {
    setImportError('');
    try { importLocalData(JSON.parse(await file.text())); location.reload(); }
    catch (cause) { setImportError(cause instanceof Error ? cause.message : '导入失败。'); }
  }
  return <div className="page settings-page">
    <PageHead kicker="SETTINGS" title="设置" />
    <div className="settings-layout">
      <section className="settings-block"><div className="section-line"><h2>AI 连接</h2><span className={`badge ${hasKey ? 'good' : ''}`}>{hasKey ? '已保存 Key' : '未连接'}</span></div>
        <form className="settings-form" onSubmit={save} autoComplete="off"><label>Base URL<input value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></label><label>模型 ID<input value={form.model} onChange={event => setForm({ ...form, model: event.target.value })} placeholder="例如 gpt-4.1-mini" /></label><label>{hasKey ? '更新 API Key（留空保留现有）' : 'API Key'}<input type="password" value={form.key} onChange={event => setForm({ ...form, key: event.target.value })} autoComplete="new-password" /></label><label className="inline-check"><input type="checkbox" checked={form.imageSupport} onChange={event => setForm({ ...form, imageSupport: event.target.checked })} />我的模型支持图片输入</label><label className="inline-check"><input type="checkbox" checked={form.remember} onChange={event => setForm({ ...form, remember: event.target.checked })} />在这台设备上记住 Key</label>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="form-success"><Check size={14} />{notice}</p>}<button className="solid-button small">保存连接</button></form>
        {hasKey && <button className="text-link danger-text" onClick={() => { clearApiKey(); setHasKey(false); setAi({ ...ai }); setNotice('已删除浏览器中的 Key。'); }}>删除 Key</button>}
      </section>
      <section className="settings-block"><div className="section-line"><h2>外观</h2></div><div className="theme-choice"><button className={theme === 'dark' ? 'active' : ''} onClick={() => setTheme('dark')}><span className="theme-swatch dark" />深色暗房</button><button className={theme === 'light' ? 'active' : ''} onClick={() => setTheme('light')}><span className="theme-swatch light" />浅色纸面</button></div><p className="fine">深色是默认阅读环境；图片区域保持中性，不让界面颜色干扰判断。</p></section>
      <section className="settings-block"><div className="section-line"><h2>本地数据</h2></div><div className="settings-actions"><button className="quiet-button" onClick={exportData}><DownloadSimple size={15} />导出数据</button><label className="quiet-button"><UploadSimple size={15} />导入 JSON<input type="file" accept="application/json" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void importFile(file); }} /></label></div>{importError && <p className="form-error" role="alert">{importError}</p>}<button className="text-link danger-text" onClick={() => { if (confirm('清除全部本地记录？此操作不可撤销。')) { clearLocalData(); clearApiKey(); location.reload(); } }}><Trash size={14} />清除全部本地记录</button></section>
    </div>
  </div>;
}
