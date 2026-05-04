"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, apiDownload, type Project, type OdpRow, type OdpSummary } from "@/lib/api";

function ODPPageInner() {
  const params = useSearchParams();
  const projectId = params.get("project") ?? "";

  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(projectId);
  const [odps, setOdps] = useState<OdpRow[]>([]);
  const [summary, setSummary] = useState<OdpSummary | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [undefinedOnly, setUndefinedOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      if (!selected && ps.length > 0) setSelected(ps[0].id);
    });
  }, [selected]);

  const reload = useCallback(() => {
    if (!selected) return;
    api.listODPs(selected, undefinedOnly).then(setOdps);
    api.odpSummary(selected).then(setSummary);
  }, [selected, undefinedOnly]);

  useEffect(() => { reload(); }, [reload]);

  async function handleInit() {
    if (!selected) return;
    setInitializing(true);
    try {
      const res = await api.initODPs(selected);
      setMsg(`Initialized ${res.total} ODPs (${res.defined} already defined).`);
      reload();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Init failed");
    } finally {
      setInitializing(false);
    }
  }

  async function handleSave(odp: OdpRow) {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updateODP(selected, odp.id, editValue);
      setOdps((prev) => prev.map((o) => o.id === odp.id ? { ...o, value: editValue, defined: !!editValue } : o));
      setSummary((s) => s ? {
        ...s,
        defined: s.defined + (editValue && !odp.defined ? 1 : !editValue && odp.defined ? -1 : 0),
      } : s);
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  const filtered = odps.filter((o) => {
    if (!search) return true;
    return o.control_id.includes(search.toLowerCase()) || o.required_definition.toLowerCase().includes(search.toLowerCase());
  });

  const completionPct = summary?.completion_pct ?? 0;

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-serif text-4xl text-[#1A1916]">ODP Tracking</h1>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#ACA9A4] mt-2">Organization-Defined Parameters · NIST 800-53A</p>
        </div>
        <div className="flex gap-2">
          {selected && (
            <>
              <button onClick={handleInit} disabled={initializing} className={btn}>
                {initializing ? "Initializing..." : "Initialize ODPs"}
              </button>
              <button onClick={() => apiDownload(`/export/projects/${selected}/odp`, "odp.xlsx")} className={btnOut}>
                Export .xlsx
              </button>
            </>
          )}
        </div>
      </div>

      {/* Project selector */}
      <div className="bg-white border border-[#E5E0D8] rounded-xl p-4 mb-6 flex gap-4 items-center">
        <label className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] whitespace-nowrap">Project</label>
        <select className={inp} value={selected} onChange={(e) => setSelected(e.target.value)}>
          <option value="">Select a project...</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.baseline})</option>)}
        </select>
      </div>

      {msg && <div className="mb-4 px-4 py-2 bg-[#DAE3F0] text-[#2A4A8A] text-xs rounded-md font-mono">{msg}</div>}

      {summary && (
        <>
          {/* Progress */}
          <div className="bg-white border border-[#E5E0D8] rounded-xl p-5 mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762]">Completion</span>
              <span className="font-serif text-lg text-[#1A1916]">{completionPct}%</span>
            </div>
            <div className="w-full bg-[#E5E0D8] rounded-full h-1.5">
              <div
                className="bg-[#5C9A6E] h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <div className="flex gap-6 mt-3">
              <span className="font-mono text-[10px] tracking-wide text-[#ACA9A4]"><strong className="text-[#2A6040]">{summary.defined}</strong> defined</span>
              <span className="font-mono text-[10px] tracking-wide text-[#ACA9A4]"><strong className="text-[#8A6020]">{summary.undefined}</strong> undefined</span>
              <span className="font-mono text-[10px] tracking-wide text-[#ACA9A4]"><strong className="text-[#1A1916]">{summary.total}</strong> total</span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <input
              className="px-3 py-2 text-sm text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] w-64 placeholder:text-[#C8C5C0]"
              placeholder="Search by control or definition..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-2 text-xs text-[#6B6762] cursor-pointer font-mono tracking-wide">
              <input
                type="checkbox"
                checked={undefinedOnly}
                onChange={(e) => setUndefinedOnly(e.target.checked)}
                className="rounded"
              />
              Show undefined only
            </label>
          </div>

          {/* ODP table */}
          <div className="bg-white border border-[#E5E0D8] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F7F5F0] border-b border-[#E5E0D8]">
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] w-24">Control</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] w-28">Param ID</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4]">Required Definition</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] w-64">Org Value</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E0D8]">
                {filtered.map((o) => (
                  <tr key={o.id} className={`hover:bg-[#F7F5F0] transition-colors ${!o.defined ? "bg-[#FDFAF5]" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-[#1A1916]">{o.control_id.toUpperCase()}</td>
                    <td className="px-4 py-3 font-mono text-[10px] text-[#6B6762]">{o.param_id}</td>
                    <td className="px-4 py-3 text-xs text-[#6B6762]">{o.required_definition}</td>
                    <td className="px-4 py-3">
                      {editingId === o.id ? (
                        o.is_choice ? (
                          <select
                            className="w-full px-2 py-1.5 text-xs text-[#1A1916] border border-[#1A1916] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916]"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                          >
                            <option value="">— select —</option>
                            {o.choices.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                          </select>
                        ) : (
                          <input
                            className="w-full px-2 py-1.5 text-xs text-[#1A1916] border border-[#1A1916] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] placeholder:text-[#C8C5C0]"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            placeholder="Enter value..."
                          />
                        )
                      ) : (
                        <span className={`font-mono text-[10px] ${o.value ? "text-[#1A1916]" : "text-[#C8C5C0] italic"}`}>
                          {o.value || "not defined"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === o.id ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 font-mono text-[10px] text-[#ACA9A4] hover:text-[#6B6762] transition-colors">Cancel</button>
                          <button onClick={() => handleSave(o)} disabled={saving} className="px-2 py-1 font-mono text-[10px] text-white bg-[#1A1916] rounded hover:bg-[#2A2926] disabled:opacity-40 transition-colors">Save</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingId(o.id); setEditValue(o.value); }}
                          className="px-2 py-1 font-mono text-[10px] text-[#6B6762] hover:text-[#1A1916] transition-colors"
                        >
                          {o.value ? "Edit" : "Define"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-center font-mono text-xs text-[#ACA9A4] py-10 tracking-wide">No parameters found.</p>
            )}
          </div>
        </>
      )}

      {!summary && selected && (
        <div className="border border-dashed border-[#E5E0D8] rounded-xl p-12 text-center">
          <p className="text-sm text-[#6B6762] mb-4">ODP parameters not initialized for this project.</p>
          <button onClick={handleInit} className={btn}>Initialize ODPs</button>
        </div>
      )}
    </div>
  );
}

export default function ODPPage() {
  return (
    <Suspense>
      <ODPPageInner />
    </Suspense>
  );
}

const btn    = "px-4 py-2 bg-[#1A1916] text-white text-xs font-medium rounded-md hover:bg-[#2A2926] disabled:opacity-40 transition-colors";
const btnOut = "px-4 py-2 border border-[#E5E0D8] text-[#6B6762] text-xs font-medium rounded-md hover:border-[#1A1916] hover:text-[#1A1916] transition-colors";
const inp    = "w-full px-3 py-2 text-sm text-[#1A1916] bg-white border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] focus:border-[#1A1916] transition-colors placeholder:text-[#C8C5C0]";
