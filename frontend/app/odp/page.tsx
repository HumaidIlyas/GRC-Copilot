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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">ODP Tracking</h1>
          <p className="text-sm text-gray-500 mt-1">Organization-Defined Parameters from NIST 800-53A</p>
        </div>
        <div className="flex gap-2">
          {selected && (
            <>
              <button onClick={handleInit} disabled={initializing} className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {initializing ? "Initializing..." : "Initialize ODPs"}
              </button>
              <button onClick={() => apiDownload(`/export/projects/${selected}/odp`, "odp.xlsx")} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">
                Export .xlsx
              </button>
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
      </div>

      {msg && <div className="mb-4 px-4 py-2 bg-blue-50 text-blue-700 text-sm rounded-lg">{msg}</div>}

      {summary && (
        <>
          {/* Progress bar */}
          <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6">
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-medium text-gray-700">Completion</span>
              <span className="text-sm font-bold text-gray-900">{completionPct}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-3">
              <div
                className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                style={{ width: `${completionPct}%` }}
              />
            </div>
            <div className="flex gap-6 mt-3 text-sm text-gray-500">
              <span><strong className="text-gray-900">{summary.defined}</strong> defined</span>
              <span><strong className="text-amber-600">{summary.undefined}</strong> undefined</span>
              <span><strong className="text-gray-900">{summary.total}</strong> total</span>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <input
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
              placeholder="Search by control or definition..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
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
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">Control</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-28">Param ID</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Required Definition</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-64">Org Value</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((o) => (
                  <tr key={o.id} className={`hover:bg-gray-50 ${!o.defined ? "bg-amber-50/30" : ""}`}>
                    <td className="px-4 py-3 font-mono text-xs font-medium text-blue-700">{o.control_id.toUpperCase()}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{o.param_id}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{o.required_definition}</td>
                    <td className="px-4 py-3">
                      {editingId === o.id ? (
                        o.is_choice ? (
                          <select
                            className="w-full px-2 py-1 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                          >
                            <option value="">— select —</option>
                            {o.choices.map((ch) => <option key={ch} value={ch}>{ch}</option>)}
                          </select>
                        ) : (
                          <input
                            className="w-full px-2 py-1 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            placeholder="Enter value..."
                          />
                        )
                      ) : (
                        <span className={`text-xs ${o.value ? "text-gray-800" : "text-gray-300 italic"}`}>
                          {o.value || "not defined"}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === o.id ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                          <button onClick={() => handleSave(o)} disabled={saving} className="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">Save</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingId(o.id); setEditValue(o.value); }}
                          className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800"
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
              <p className="text-center text-sm text-gray-400 py-8">No parameters found.</p>
            )}
          </div>
        </>
      )}

      {!summary && selected && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-gray-500 mb-4">ODP parameters not initialized for this project.</p>
          <button onClick={handleInit} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            Initialize ODPs
          </button>
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
