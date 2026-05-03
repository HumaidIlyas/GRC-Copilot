"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, apiDownload, type Project, type Control } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-600",
  reviewed: "bg-blue-100 text-blue-700",
  approved: "bg-green-100 text-green-700",
};

function SSPPageInner() {
  const params = useSearchParams();
  const projectId = params.get("project") ?? "";

  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(projectId);
  const [controls, setControls] = useState<Control[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [search, setSearch] = useState("");
  const [familyFilter, setFamilyFilter] = useState("All");

  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      if (!selected && ps.length > 0) setSelected(ps[0].id);
    });
  }, [selected]);

  const loadControls = useCallback(() => {
    if (!selected) return;
    api.getControls(selected).then(setControls).catch(console.error);
  }, [selected]);

  useEffect(() => { loadControls(); }, [loadControls]);

  async function handleDraft() {
    if (!selected) return;
    setDrafting(true);
    setMsg("");
    try {
      const res = await api.draftSSP(selected);
      setMsg(`Drafted ${res.drafted} controls.`);
      loadControls();
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : "Drafting failed");
    } finally {
      setDrafting(false);
    }
  }

  async function handleSave(control: Control) {
    if (!selected) return;
    setSaving(true);
    try {
      await api.updateControl(selected, control.control_id, {
        implementation_statement: editText,
        status: "reviewed",
      });
      setControls((prev) =>
        prev.map((c) =>
          c.control_id === control.control_id
            ? { ...c, implementation_statement: editText, status: "reviewed" }
            : c
        )
      );
      setEditingId(null);
    } finally {
      setSaving(false);
    }
  }

  const families = ["All", ...Array.from(new Set(controls.map((c) => c.family))).sort()];
  const filtered = controls.filter((c) => {
    const matchFamily = familyFilter === "All" || c.family === familyFilter;
    const matchSearch = !search || c.control_id.includes(search.toLowerCase()) || c.title.toLowerCase().includes(search.toLowerCase());
    return matchFamily && matchSearch;
  });

  const project = projects.find((p) => p.id === selected);

  return (
    <div className="max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">SSP Assistant</h1>
          <p className="text-sm text-gray-500 mt-1">Draft and review control implementation statements</p>
        </div>
        <div className="flex gap-2">
          {selected && (
            <>
              <button
                onClick={handleDraft}
                disabled={drafting}
                className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {drafting ? "Drafting..." : controls.length > 0 ? "Re-draft All" : "Draft SSP"}
              </button>
              <button
                onClick={() => apiDownload(`/export/projects/${selected}/ssp`, "ssp.xlsx")}
                className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
              >
                Export .xlsx
              </button>
            </>
          )}
        </div>
      </div>

      {/* Project selector */}
      <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 flex gap-4 items-center">
        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">Project</label>
        <select
          className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
        >
          <option value="">Select a project...</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name} ({p.baseline})</option>
          ))}
        </select>
        {project && (
          <span className="text-xs text-gray-400">{controls.length} controls</span>
        )}
      </div>

      {msg && <div className="mb-4 px-4 py-2 bg-blue-50 text-blue-700 text-sm rounded-lg">{msg}</div>}

      {controls.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-4">
            {(["draft", "reviewed", "approved"] as const).map((s) => {
              const count = controls.filter((c) => c.status === s).length;
              return (
                <div key={s} className="bg-white rounded-lg border border-gray-200 p-4 text-center">
                  <p className="text-2xl font-bold text-gray-900">{count}</p>
                  <p className="text-xs text-gray-500 capitalize mt-1">{s}</p>
                </div>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <input
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-56"
              placeholder="Search controls..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={familyFilter}
              onChange={(e) => setFamilyFilter(e.target.value)}
            >
              {families.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>

          {/* Controls table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">Control</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Implementation Statement</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">Status</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((c) => (
                  <tr key={c.control_id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-blue-700">{c.control_id.toUpperCase()}</td>
                    <td className="px-4 py-3 text-xs text-gray-700 max-w-[150px]">{c.title}</td>
                    <td className="px-4 py-3">
                      {editingId === c.control_id ? (
                        <textarea
                          className="w-full px-2 py-1 text-xs border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500 h-24 resize-none"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                      ) : (
                        <p className="text-xs text-gray-600 line-clamp-3">{c.implementation_statement ?? "—"}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[c.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === c.control_id ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 text-xs text-gray-500 hover:text-gray-700">Cancel</button>
                          <button onClick={() => handleSave(c)} disabled={saving} className="px-2 py-1 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50">Save</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingId(c.control_id); setEditText(c.implementation_statement ?? ""); }}
                          className="px-2 py-1 text-xs text-blue-600 hover:text-blue-800"
                        >
                          Edit
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {selected && controls.length === 0 && !drafting && (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-gray-500 mb-4">No SSP drafted yet for this project.</p>
          <button onClick={handleDraft} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            Draft SSP
          </button>
        </div>
      )}
    </div>
  );
}

export default function SSPPage() {
  return (
    <Suspense>
      <SSPPageInner />
    </Suspense>
  );
}
