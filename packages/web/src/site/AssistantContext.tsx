import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

export interface PageMaterial { id: string; title: string; text: string; sourceUrl?: string; kind?: string }
interface AssistantState {
  open: boolean; setOpen: (value: boolean) => void;
  pageKey: string; pageTitle: string; materials: PageMaterial[];
  register: (title: string, materials: PageMaterial[]) => void;
  prefill: string; revisePrefill: (text: string) => void;
  revision: number;
}
const Context = createContext<AssistantState | null>(null);

export function AssistantProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [registered, setRegistered] = useState<{ key: string; title: string; materials: PageMaterial[] }>({ key: '/', title: '首页', materials: [] });
  const [prefill, setPrefill] = useState(''); const [revision, setRevision] = useState(0);
  const register = useCallback((title: string, materials: PageMaterial[]) => setRegistered({ key: pathname, title, materials }), [pathname]);
  const value = useMemo<AssistantState>(() => ({
    open, setOpen, pageKey: pathname,
    pageTitle: registered.key === pathname ? registered.title : '当前页面',
    materials: registered.key === pathname ? registered.materials : [],
    register, prefill, revision, revisePrefill: text => { setPrefill(text); setRevision(n => n + 1); setOpen(true); },
  }), [open, pathname, registered, prefill, revision, register]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useAssistant() { const value = useContext(Context); if (!value) throw new Error('缺少 AI 上下文'); return value; }
export function usePage(title: string, materials: PageMaterial[] = []) {
  const { register } = useAssistant(); const encoded = JSON.stringify(materials);
  useEffect(() => { register(title, JSON.parse(encoded) as PageMaterial[]); }, [title, encoded, register]);
}
