'use client';
import { useRef, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
type Config = { enabled: boolean; name: string; address: string; hours: string; phone: string; districts: string[] };
const districts = ['市南区', '市北区', '李沧区', '崂山区', '黄岛区', '城阳区', '即墨区'];
export function PickupSettings({ initialConfig, owner }: { initialConfig: Config; owner: boolean }) {
  const [config, setConfig] = useState(initialConfig), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const lock = useRef(false), router = useRouter();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (lock.current || !owner) return;
    lock.current = true; setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/admin/pickup', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.error === 'PICKUP_CONFIG_INCOMPLETE' ? '请选择服务区域，并检查联系电话格式。' : '保存失败，请重试。');
      setConfig(result.config); setMessage('自提设置已保存'); router.refresh();
    } catch (error) { setMessage(error instanceof Error ? error.message : '连接中断，请刷新核对设置。'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section id="pickup" className="scroll-mt-24 rounded-lg border border-[#ddd] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-bold">线下自提</h2><span className="rounded-full bg-[#f3f3f3] px-3 py-1 text-sm">{initialConfig.enabled ? '已开启 · 全部用户' : '未开启'}</span></div>
    <form onSubmit={save} className="mt-5 grid gap-5">
      <label className="flex items-center gap-3"><input type="checkbox" checked={config.enabled} disabled={!owner || busy} onChange={e => setConfig({ ...config, enabled: e.target.checked })} />开启线下自提</label>
      <div className="grid gap-4 md:grid-cols-2">{([{ key: 'name', label: '自提点名称', max: 60 }, { key: 'phone', label: '联系电话', max: 40 }, { key: 'address', label: '详细地址', max: 240 }, { key: 'hours', label: '可取货时间', max: 120 }] as const).map(field => <label key={field.key} className="vk-field">{field.label}<input value={config[field.key]} maxLength={field.max} disabled={!owner || busy} onChange={e => setConfig({ ...config, [field.key]: e.target.value })} /></label>)}</div>
      <fieldset><legend className="mb-3 font-bold">服务区域 · 山东省青岛市</legend><div className="flex flex-wrap gap-x-6 gap-y-4">{districts.map(district => <label key={district} className="flex items-center gap-2"><input type="checkbox" checked={config.districts.includes(district)} disabled={!owner || busy} onChange={e => setConfig({ ...config, districts: e.target.checked ? [...config.districts, district] : config.districts.filter(d => d !== district) })} />{district}</label>)}</div></fieldset>
      {owner ? <button className="vk-button vk-button-dark min-h-11 justify-self-start px-8" disabled={busy}>{busy ? '正在保存…' : '保存自提设置'}</button> : <p>仅店铺负责人可修改自提设置。</p>}
      {message ? <p role="status">{message}</p> : null}
    </form>
  </section>;
}
