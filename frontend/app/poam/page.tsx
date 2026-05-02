"use client";

import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { api, type Project, type PoamItem } from "@/lib/api";

const RISK_COLORS: Record<string, string> = {
  High:   "bg-red-100 text-red-700",
  Medium: "bg-amber-100 text-amber-700",
  Low:    "bg-green-100 text-green-700",
};

const STATUS_COLORS: Record<string, string> = {
  open:        "bg-red-50 text-red-600",
  in_progress: "bg-amber-50 text-amber-600",
  closed:      "bg-green-50 text-green-600",
};

export default function PoamPage() {
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">POA&amp;M Generator</h1>
          <p className="text-sm text-gray-500 mt-1">Plan of Action &amp; Milestones from gap findings</p>
        </div>
        <div className="flex gap-2">
          {selected && (
            <>
              <button
                onClick={handleGenerate}
                disabled={generating}
                className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {generating ? "Generating..." : items.length > 0 ? "Re-generate" : "Generate POA&M"}
              </button>
              {items.length > 0 && (
                <a href={api.exportPoam(selected)} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
                  Export .xlsx
                </a>
              )}
            </>
          )}
        </div>
      </div>

      {/* Project selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex gap-4 items-center">
        <label className="text-sm font-medium text-gray-700">Project</label>
        <select
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a project...</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.baseline})</option>)}
        </select>
        {items.length > 0 && <span className="text-xs text-gray-400">{items.length} items · {summary.open} open</span>}
      </div>

      {msg   && <div className="mb-4 px-4 py-2 bg-green-50 text-green-700 text-sm rounded-lg">{msg}</div>}
      {error && <div className="mb-4 px-4 py-2 bg-red-50 text-red-600 text-sm rounded-lg">{error}</div>}
      {generating && (
        <div className="mb-4 flex items-center gap-2 text-sm text-red-700 bg-red-50 px-4 py-3 rounded-lg">
          <span className="animate-spin inline-block w-4 h-4 border-2 border-red-600 border-t-transparent rounded-full" />
          Drafting POA&M entries for all gap findings...
        </div>
      )}

      {items.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            {[
              { label: "High Risk",   value: summary.high,   color: "text-red-600" },
              { label: "Medium Risk", value: summary.medium, color: "text-amber-600" },
              { label: "Low Risk",    value: summary.low,    color: "text-green-700" },
              { label: "Open Items",  value: summary.open,   color: "text-gray-900" },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4 text-center shadow-sm">
                <p className={`text-3xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <select className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={riskFilter} onChange={(e) => setRiskFilter(e.target.value)}>
              {["All", "High", "Medium", "Low"].map((r) => <option key={r}>{r}</option>)}
            </select>
            <select className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {["All", "open", "in_progress", "closed"].map((s) => <option key={s}>{s}</option>)}
            </select>
          </div>

          {/* Items */}
          <div className="space-y-3">
            {filtered.map((item, idx) => (
              <div key={item.id} className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-gray-400">POA&M-{String(idx + 1).padStart(3, "0")}</span>
                    <span className="font-mono text-xs font-medium text-blue-700">{item.control_id.toUpperCase()}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${RISK_COLORS[item.risk_level] ?? "bg-gray-100 text-gray-600"}`}>{item.risk_level}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[item.status] ?? "bg-gray-100 text-gray-600"}`}>{item.status}</span>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {editingId === item.id ? (
                      <>
                        <button onClick={() => setEditingId(null)} className="px-3 py-1 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                        <button onClick={() => handleSave(item)} disabled={saving} className="px-3 py-1 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50">Save</button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setEditingId(item.id); setEditData({ weakness_description: item.weakness_description, risk_level: item.risk_level, remediation_steps: item.remediation_steps, milestones: item.milestones, status: item.status }); }}
                        className="px-3 py-1 text-xs text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
                      >
                        Edit
                      </button>
                    )}
                  </div>
                </div>

                {editingId === item.id ? (
                  <div className="mt-4 space-y-3">
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Weakness Description</label>
                      <textarea className={ta} value={editData.weakness_description ?? ""} onChange={(e) => setEditData({ ...editData, weakness_description: e.target.value })} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Risk Level</label>
                        <select className={sel} value={editData.risk_level ?? "Medium"} onChange={(e) => setEditData({ ...editData, risk_level: e.target.value })}>
                          <option>High</option><option>Medium</option><option>Low</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs font-medium text-gray-600 block mb-1">Status</label>
                        <select className={sel} value={editData.status ?? "open"} onChange={(e) => setEditData({ ...editData, status: e.target.value })}>
                          <option value="open">open</option>
                          <option value="in_progress">in_progress</option>
                          <option value="closed">closed</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Remediation Steps</label>
                      <textarea className={ta} value={editData.remediation_steps ?? ""} onChange={(e) => setEditData({ ...editData, remediation_steps: e.target.value })} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-gray-600 block mb-1">Milestones</label>
                      <textarea className={`${ta} h-16`} value={editData.milestones ?? ""} onChange={(e) => setEditData({ ...editData, milestones: e.target.value })} />
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-3 gap-4">
                    <div className="col-span-1">
                      <p className="text-xs font-medium text-gray-500 mb-1">Weakness</p>
                      <p className="text-xs text-gray-700">{item.weakness_description}</p>
                      {JSON.parse(item.cve_refs || "[]").length > 0 && (
                        <p className="text-xs text-red-600 font-mono mt-1">{JSON.parse(item.cve_refs).slice(0,3).join(", ")}</p>
                      )}
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Remediation Steps</p>
                      <p className="text-xs text-gray-700 whitespace-pre-line">{item.remediation_steps}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">Milestones</p>
                      <p className="text-xs text-gray-700 whitespace-pre-line">{item.milestones}</p>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {selected && items.length === 0 && !generating && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-gray-500 mb-2">No POA&M entries yet.</p>
          <p className="text-xs text-gray-400 mb-4">Run gap assessment first, then generate POA&M from the findings.</p>
          <button onClick={handleGenerate} className="px-4 py-2 bg-red-600 text-white text-sm rounded-lg hover:bg-red-700">Generate POA&M</button>
        </div>
      )}
    </div>
  );
}

const ta  = "w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 h-20 resize-none";
const sel = "w-full px-3 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500";
