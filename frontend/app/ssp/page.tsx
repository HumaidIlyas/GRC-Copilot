"use client";

import { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, apiDownload, type Project, type Control } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  draft:    "bg-[#EAEAE8] text-[#5A5A58]",
  reviewed: "bg-[#DAE3F0] text-[#2A4A8A]",
  approved: "bg-[#DCF0E2] text-[#2A6040]",
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
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-serif text-4xl text-[#1A1916]">SSP Assistant</h1>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#ACA9A4] mt-2">Control Implementation Statements</p>
        </div>
        <div className="flex gap-2">
          {selected && (
            <>
              <button onClick={handleDraft} disabled={drafting} className={btn}>
                {drafting ? "Drafting..." : controls.length > 0 ? "Re-draft All" : "Draft SSP"}
              </button>
              <button onClick={() => apiDownload(`/export/projects/${selected}/ssp`, "ssp.xlsx")} className={btnOut}>
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
        {project && <span className="font-mono text-[10px] text-[#ACA9A4] whitespace-nowrap">{controls.length} controls</span>}
      </div>

      {msg && <div className="mb-4 px-4 py-2 bg-[#DCF0E2] text-[#2A6040] text-xs rounded-md font-mono">{msg}</div>}

      {controls.length > 0 && (
        <>
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {(["draft", "reviewed", "approved"] as const).map((s) => {
              const count = controls.filter((c) => c.status === s).length;
              return (
                <div key={s} className="bg-white border border-[#E5E0D8] rounded-xl p-4 text-center">
                  <p className="font-serif text-3xl text-[#1A1916]">{count}</p>
                  <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] mt-1">{s}</p>
                </div>
              );
            })}
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4">
            <input
              className="px-3 py-2 text-sm text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] w-56 placeholder:text-[#C8C5C0]"
              placeholder="Search controls..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="px-3 py-2 text-sm text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916]" value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value)}>
              {families.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>

          {/* Controls table */}
          <div className="bg-white border border-[#E5E0D8] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F7F5F0] border-b border-[#E5E0D8]">
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] w-24">Control</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4]">Title</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4]">Implementation Statement</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] w-24">Status</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E0D8]">
                {filtered.map((c) => (
                  <tr key={c.control_id} className="hover:bg-[#F7F5F0] transition-colors">
                    <td className="px-4 py-3 font-mono text-xs font-medium text-[#1A1916]">{c.control_id.toUpperCase()}</td>
                    <td className="px-4 py-3 text-xs text-[#6B6762] max-w-[150px]">{c.title}</td>
                    <td className="px-4 py-3">
                      {editingId === c.control_id ? (
                        <textarea
                          className="w-full px-2 py-1.5 text-xs text-[#1A1916] border border-[#1A1916] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] h-24 resize-none"
                          value={editText}
                          onChange={(e) => setEditText(e.target.value)}
                        />
                      ) : (
                        <p className="text-xs text-[#6B6762] line-clamp-3">{c.implementation_statement ?? "—"}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded font-mono text-[10px] font-medium ${STATUS_COLORS[c.status] ?? "bg-[#EAEAE8] text-[#5A5A58]"}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {editingId === c.control_id ? (
                        <div className="flex gap-1 justify-end">
                          <button onClick={() => setEditingId(null)} className="px-2 py-1 font-mono text-[10px] text-[#ACA9A4] hover:text-[#6B6762] transition-colors">Cancel</button>
                          <button onClick={() => handleSave(c)} disabled={saving} className="px-2 py-1 font-mono text-[10px] text-white bg-[#1A1916] rounded hover:bg-[#2A2926] disabled:opacity-40 transition-colors">Save</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => { setEditingId(c.control_id); setEditText(c.implementation_statement ?? ""); }}
                          className="px-2 py-1 font-mono text-[10px] text-[#6B6762] hover:text-[#1A1916] transition-colors"
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
        <div className="border border-dashed border-[#E5E0D8] rounded-xl p-12 text-center">
          <p className="text-sm text-[#6B6762] mb-4">No SSP drafted yet for this project.</p>
          <button onClick={handleDraft} className={btn}>Draft SSP</button>
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

const btn    = "px-4 py-2 bg-[#1A1916] text-white text-xs font-medium rounded-md hover:bg-[#2A2926] disabled:opacity-40 transition-colors";
const btnOut = "px-4 py-2 border border-[#E5E0D8] text-[#6B6762] text-xs font-medium rounded-md hover:border-[#1A1916] hover:text-[#1A1916] transition-colors";
const inp    = "w-full px-3 py-2 text-sm text-[#1A1916] bg-white border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] focus:border-[#1A1916] transition-colors placeholder:text-[#C8C5C0]";
