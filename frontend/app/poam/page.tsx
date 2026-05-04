"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, apiDownload, type Project, type PoamItem } from "@/lib/api";

const RISK_COLORS: Record<string, string> = {
  High:   "bg-[#F0DADA] text-[#8A2828]",
  Medium: "bg-[#F5EDD4] text-[#8A6020]",
  Low:    "bg-[#DCF0E2] text-[#2A6040]",
};

const STATUS_COLORS: Record<string, string> = {
  open:        "bg-[#F0DADA] text-[#8A2828]",
  in_progress: "bg-[#F5EDD4] text-[#8A6020]",
  closed:      "bg-[#DCF0E2] text-[#2A6040]",
};

function PoamPageInner() {
  const params = useSearchParams();
  const projectId = params.get("project") ?? "";

  const [projects, setProjects]     = useState<Project[]>([]);
  const [selected, setSelected]     = useState(projectId);
  const [items, setItems]           = useState<PoamItem[]>([]);
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [editData, setEditData]     = useState<Partial<PoamItem>>({});
  const [saving, setSaving]         = useState(false);
  const [msg, setMsg]               = useState("");
  const [error, setError]           = useState("");
  const [riskFilter, setRiskFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      if (!selected && ps.length > 0) setSelected(ps[0].id);
    });
  }, [selected]);

  const loadItems = useCallback(() => {
    if (!selected) return;
    api.getPoamItems(selected).then(setItems).catch(console.error);
  }, [selected]);

  useEffect(() => { loadItems(); }, [loadItems]);

  async function handleGenerate() {
    if (!selected) return;
    setGenerating(true);
    setMsg("");
    setError("");
    try {
      const res = await api.generatePoam(selected);
      setMsg(res.generated > 0 ? `Generated ${res.generated} POA&M entries.` : "No gaps found.");
      loadItems();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave(item: PoamItem) {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updatePoamItem(selected, item.id, editData);
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, ...editData } : i));
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  const filtered = items.filter((i) => {
    const matchRisk   = riskFilter   === "All" || i.risk_level === riskFilter;
    const matchStatus = statusFilter === "All" || i.status === statusFilter;
    return matchRisk && matchStatus;
  });

  const summary = {
    high:   items.filter((i) => i.risk_level === "High").length,
    medium: items.filter((i) => i.risk_level === "Medium").length,
    low:    items.filter((i) => i.risk_level === "Low").length,
    open:   items.filter((i) => i.status === "open").length,
  };

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-serif text-4xl text-[#1A1916]">POA&amp;M Generator</h1>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#ACA9A4] mt-2">Plan of Action &amp; Milestones</p>
        </div>
        <div className="flex gap-2">
          {selected && (
            <>
              <button onClick={handleGenerate} disabled={generating} className={btn}>
                {generating ? "Generating..." : items.length > 0 ? "Re-generate" : "Generate POA&M"}
              </button>
              {items.length > 0 && (
                <button onClick={() => apiDownload(`/export/projects/${selected}/poam`, "poam.xlsx")} className={btnOut}>
                  Export .xlsx
                </button>
              )}
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
        {items.length > 0 && <span className="font-mono text-[10px] text-[#ACA9A4] whitespace-nowrap">{items.length} items · {summary.open} open</span>}
      </div>

      {msg       && <div className="mb-4 px-4 py-2 bg-[#DCF0E2] text-[#2A6040] text-xs rounded-md font-mono">{msg}</div>}
      {error     && <div className="mb-4 px-4 py-2 bg-[#F0DADA] text-[#8A2828] text-xs rounded-md font-mono">{error}</div>}
      {generating && (
        <div className="mb-4 flex items-center gap-2 text-xs text-[#8A2828] bg-[#F0DADA] px-4 py-3 rounded-md font-mono">
          <span className="animate-spin inline-block w-3 h-3 border-2 border-[#8A2828] border-t-transparent rounded-full" />
          Drafting POA&M entries for all gap findings...
        </div>
      )}

      {items.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: "High Risk",   value: summary.high,   color: "text-[#8A2828]" },
              { label: "Medium Risk", value: summary.medium, color: "text-[#8A6020]" },
              { label: "Low Risk",    value: summary.low,    color: "text-[#2A6040]" },
              { label: "Open Items",  value: summary.open,   color: "text-[#1A1916]" },
            ].map((s) => (
              <div key={s.label} className="bg-white border border-[#E5E0D8] rounded-xl p-4 text-center">
                <p className={`font-serif text-3xl ${s.color}`}>{s.value}</p>
                <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <select className="px-3 py-2 text-sm text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916]" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
              {["All", "High", "Medium", "Low"].map((r) => <option key={r}>{r}</option>)}
            </select>
            <select className="px-3 py-2 text-sm text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {["All", "open", "in_progress", "closed"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Items */}
          <div className="space-y-3">
            {filtered.map((item, idx) => (
              <div key={item.id} className="bg-white border border-[#E5E0D8] rounded-xl p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3 flex-wrap">
                    <span className="font-mono text-[10px] tracking-wide text-[#ACA9A4]">POA&M-{String(idx + 1).padStart(3, "0")}</span>
                    <span className="font-mono text-xs font-medium text-[#1A1916]">{item.control_id.toUpperCase()}</span>
                    <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-medium ${RISK_COLORS[item.risk_level] ?? "bg-[#EAEAE8] text-[#5A5A58]"}`}>{item.risk_level}</span>
                    <span className={`px-2 py-0.5 rounded font-mono text-[10px] font-medium ${STATUS_COLORS[item.status] ?? "bg-[#EAEAE8] text-[#5A5A58]"}`}>{item.status}</span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {editingId === item.id ? (
                      <>
                        <button onClick={() => setEditingId(null)} className="px-3 py-1 font-mono text-[10px] text-[#ACA9A4] border border-[#E5E0D8] rounded-md hover:text-[#6B6762] transition-colors">Cancel</button>
                        <button onClick={() => handleSave(item)} disabled={saving} className="px-3 py-1 font-mono text-[10px] text-white bg-[#1A1916] rounded-md hover:bg-[#2A2926] disabled:opacity-40 transition-colors">Save</button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setEditingId(item.id); setEditData({ weakness_description: item.weakness_description, risk_level: item.risk_level, remediation_steps: item.remediation_steps, milestones: item.milestones, status: item.status }); }}
                        className="px-3 py-1 font-mono text-[10px] text-[#6B6762] border border-[#E5E0D8] rounded-md hover:border-[#1A1916] hover:text-[#1A1916] transition-colors"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                {editingId === item.id ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] block mb-1.5">Weakness Description</label>
                      <textarea className={ta} value={editData.weakness_description ?? ""} onChange={(e) => setEditData({ ...editData, weakness_description: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] block mb-1.5">Risk Level</label>
                        <select className={sel} value={editData.risk_level ?? "Medium"} onChange={(e) => setEditData({ ...editData, risk_level: e.target.value })}>
                          <option>High</option><option>Medium</option><option>Low</option>
                        </select>
                      </div>
                      <div>
                        <label className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] block mb-1.5">Status</label>
                        <select className={sel} value={editData.status ?? "open"} onChange={(e) => setEditData({ ...editData, status: e.target.value })}>
                          <option value="open">open</option>
                          <option value="in_progress">in_progress</option>
                          <option value="closed">closed</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] block mb-1.5">Remediation Steps</label>
                      <textarea className={ta} value={editData.remediation_steps ?? ""} onChange={(e) => setEditData({ ...editData, remediation_steps: e.target.value })} />
                    </div>
                    <div>
                      <label className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] block mb-1.5">Milestones</label>
                      <textarea className={`${ta} h-16`} value={editData.milestones ?? ""} onChange={(e) => setEditData({ ...editData, milestones: e.target.value })} />
                    </div>
                  </div>
                ) : (
                  <div className="mt-4 grid grid-cols-3 gap-4 pt-4 border-t border-[#E5E0D8]">
                    <div>
                      <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] mb-1.5">Weakness</p>
                      <p className="text-xs text-[#6B6762]">{item.weakness_description}</p>
                      {JSON.parse(item.cve_refs || "[]").length > 0 && (
                        <p className="font-mono text-[10px] text-[#8A2828] mt-1.5">{JSON.parse(item.cve_refs).slice(0, 3).join(", ")}</p>
                      )}
                    </div>
                    <div>
                      <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] mb-1.5">Remediation Steps</p>
                      <p className="text-xs text-[#6B6762] whitespace-pre-line">{item.remediation_steps}</p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] mb-1.5">Milestones</p>
                      <p className="text-xs text-[#6B6762] whitespace-pre-line">{item.milestones}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {selected && items.length === 0 && !generating && (
        <div className="border border-dashed border-[#E5E0D8] rounded-xl p-12 text-center">
          <p className="text-sm text-[#6B6762] mb-2">No POA&M entries yet.</p>
          <p className="font-mono text-[10px] text-[#ACA9A4] mb-4 tracking-wide">Run gap assessment first, then generate POA&M from the findings.</p>
          <button onClick={handleGenerate} className={btn}>Generate POA&M</button>
        </div>
      )}
    </div>
  );
}

export default function PoamPage() {
  return (
    <Suspense>
      <PoamPageInner />
    </Suspense>
  );
}

const btn    = "px-4 py-2 bg-[#1A1916] text-white text-xs font-medium rounded-md hover:bg-[#2A2926] disabled:opacity-40 transition-colors";
const btnOut = "px-4 py-2 border border-[#E5E0D8] text-[#6B6762] text-xs font-medium rounded-md hover:border-[#1A1916] hover:text-[#1A1916] transition-colors";
const inp    = "w-full px-3 py-2 text-sm text-[#1A1916] bg-white border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] focus:border-[#1A1916] transition-colors placeholder:text-[#C8C5C0]";
const ta     = "w-full px-3 py-2 text-xs text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] h-20 resize-none";
const sel    = "w-full px-3 py-2 text-xs text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916]";
