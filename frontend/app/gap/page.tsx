"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, apiDownload, type Project, type GapRow } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  "Implemented":           "bg-[#DCF0E2] text-[#2A6040]",
  "Partially Implemented": "bg-[#F5EDD4] text-[#8A6020]",
  "Not Implemented":       "bg-[#F0DADA] text-[#8A2828]",
  "Inherited":             "bg-[#DAE3F0] text-[#2A4A8A]",
  "Not Applicable":        "bg-[#EAEAE8] text-[#5A5A58]",
  "Planned":               "bg-[#E8D8F0] text-[#6A2A8A]",
};

const STATUS_BAR: Record<string, string> = {
  "Implemented":           "bg-[#5C9A6E]",
  "Partially Implemented": "bg-[#C4963A]",
  "Not Implemented":       "bg-[#C45A5A]",
  "Inherited":             "bg-[#5A7AC4]",
  "Not Applicable":        "bg-[#C0BDB8]",
  "Planned":               "bg-[#9A5AC4]",
};

function GapPageInner() {
  const params = useSearchParams();
  const projectId = params.get("project") ?? "";

  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState(projectId);
  const [sspUrl, setSspUrl] = useState("");
  const [fetchCves, setFetchCves] = useState(true);
  const [running, setRunning] = useState(false);
  const [gaps, setGaps] = useState<GapRow[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [familyFilter, setFamilyFilter] = useState("All");
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.listProjects().then((ps) => {
      setProjects(ps);
      if (!selected && ps.length > 0) {
        const p = ps[0];
        setSelected(p.id);
        if (p.oscal_ssp_url) setSspUrl(p.oscal_ssp_url);
      }
    });
  }, [selected]);

  const loadGaps = useCallback(() => {
    if (!selected) return;
    api.getGaps(selected).then(setGaps).catch(console.error);
  }, [selected]);

  useEffect(() => { loadGaps(); }, [loadGaps]);

  useEffect(() => {
    const p = projects.find((p) => p.id === selected);
    if (p?.oscal_ssp_url) setSspUrl(p.oscal_ssp_url);
  }, [selected, projects]);

  async function handleAssess() {
    if (!selected || !sspUrl.trim()) {
      setError("Please select a project and provide an SSP URL.");
      return;
    }
    setRunning(true);
    setError("");
    setMsg("");
    try {
      const res = await api.assessFromSSP(selected, sspUrl.trim(), fetchCves);
      setMsg(
        `Assessed ${res.assessed} controls. ${res.ssp_controls_found} found in SSP. ` +
        `${res.cve_mappings} CVE mappings. Compliance: ${res.summary.compliance_percentage}%`
      );
      loadGaps();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Assessment failed");
    } finally {
      setRunning(false);
    }
  }

  const families = ["All", ...Array.from(new Set(gaps.map((g) => g.family))).sort()];
  const statuses = ["All", "Implemented", "Partially Implemented", "Not Implemented", "Inherited", "Not Applicable", "Planned"];

  const filtered = gaps.filter((g) => {
    const matchStatus = statusFilter === "All" || g.gap_status === statusFilter;
    const matchFamily = familyFilter === "All" || g.family === familyFilter;
    const matchSearch = !search || g.control_id.toLowerCase().includes(search.toLowerCase()) || g.title.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchFamily && matchSearch;
  });

  const summary = {
    total:     gaps.length,
    impl:      gaps.filter((g) => g.gap_status === "Implemented").length,
    partial:   gaps.filter((g) => g.gap_status === "Partially Implemented").length,
    notImpl:   gaps.filter((g) => g.gap_status === "Not Implemented").length,
    inherited: gaps.filter((g) => g.gap_status === "Inherited").length,
    na:        gaps.filter((g) => g.gap_status === "Not Applicable").length,
    planned:   gaps.filter((g) => g.gap_status === "Planned").length,
    inScope:   gaps.filter((g) => !["Inherited", "Not Applicable"].includes(g.gap_status)).length,
  };

  const project = projects.find((p) => p.id === selected);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-serif text-4xl text-[#1A1916]">Gap Assessment</h1>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#ACA9A4] mt-2">OSCAL SSP · NIST 800-53 · NVD CVE</p>
        </div>
        {selected && gaps.length > 0 && (
          <div className="flex gap-2">
            <button onClick={() => apiDownload(`/export/projects/${selected}/gap`, "gap-assessment.xlsx")} className={btnOut}>Export Gap .xlsx</button>
            <button onClick={() => apiDownload(`/export/projects/${selected}/evidence-request?gaps_only=true`, "evidence-request.xlsx")} className={btnOut}>Evidence Request .xlsx</button>
          </div>
        )}
      </div>

      {/* Config panel */}
      <div className="bg-white border border-[#E5E0D8] rounded-xl p-5 mb-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] mb-1.5">Project</label>
            <select className={inp} value={selected} onChange={(e) => setSelected(e.target.value)}>
              <option value="">Select a project...</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.baseline})</option>)}
            </select>
          </div>
          <div>
            <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] mb-1.5">FedRAMP OSCAL SSP URL</label>
            <input className={inp} placeholder="https://raw.githubusercontent.com/..." value={sspUrl} onChange={(e) => setSspUrl(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-[#6B6762] cursor-pointer">
            <input type="checkbox" checked={fetchCves} onChange={(e) => setFetchCves(e.target.checked)} className="rounded" />
            Query NVD for CVEs (adds ~30s per component)
          </label>
          <button onClick={handleAssess} disabled={running || !selected || !sspUrl.trim()} className={btn}>
            {running ? "Running assessment..." : "Run Gap Assessment"}
          </button>
        </div>
        {running && (
          <div className="flex items-center gap-2 text-xs text-[#8A6020] bg-[#F5EDD4] px-4 py-3 rounded-md font-mono">
            <span className="animate-spin inline-block w-3 h-3 border-2 border-[#8A6020] border-t-transparent rounded-full" />
            Assessing {project?.baseline} baseline controls against SSP and NVD data...
          </div>
        )}
        {msg   && <div className="text-xs text-[#2A6040] bg-[#DCF0E2] px-4 py-2 rounded-md font-mono">{msg}</div>}
        {error && <div className="text-xs text-[#8A2828] bg-[#F0DADA] px-4 py-2 rounded-md font-mono">{error}</div>}
      </div>

      {gaps.length > 0 && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-7 gap-3 mb-6">
            {[
              { label: "Total",       value: summary.total,     color: "text-[#1A1916]" },
              { label: "In Scope",    value: summary.inScope,   color: "text-[#1A1916]" },
              { label: "Implemented", value: summary.impl,      color: "text-[#2A6040]" },
              { label: "Partial",     value: summary.partial,   color: "text-[#8A6020]" },
              { label: "Not Impl.",   value: summary.notImpl,   color: "text-[#8A2828]" },
              { label: "Inherited",   value: summary.inherited, color: "text-[#2A4A8A]" },
              { label: "N/A",         value: summary.na,        color: "text-[#5A5A58]" },
            ].map((s) => (
              <div key={s.label} className="bg-white border border-[#E5E0D8] rounded-xl p-3 text-center">
                <p className={`font-serif text-2xl ${s.color}`}>{s.value}</p>
                <p className="font-mono text-[9px] tracking-[0.15em] uppercase text-[#ACA9A4] mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Status bar */}
          <div className="flex h-1.5 rounded-full overflow-hidden mb-6 bg-[#E5E0D8]">
            {(["Implemented","Partially Implemented","Not Implemented","Inherited","Not Applicable","Planned"] as const).map((s) => {
              const count = gaps.filter((g) => g.gap_status === s).length;
              const pct = summary.total ? (count / summary.total) * 100 : 0;
              return <div key={s} className={`${STATUS_BAR[s]} transition-all`} style={{ width: `${pct}%` }} title={`${s}: ${count}`} />;
            })}
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            <input
              className="px-3 py-2 text-sm text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] w-52 placeholder:text-[#C8C5C0]"
              placeholder="Search controls..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="px-3 py-2 text-sm text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="px-3 py-2 text-sm text-[#1A1916] border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916]" value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value)}>
              {families.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>

          {/* Gap table */}
          <div className="bg-white border border-[#E5E0D8] rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[#F7F5F0] border-b border-[#E5E0D8]">
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] w-24">Control</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4]">Title</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] w-40">Status</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4]">Rationale</th>
                  <th className="text-left px-4 py-3 font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] w-32">CVEs</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E0D8]">
                {filtered.map((g) => (
                  <React.Fragment key={g.id}>
                    <tr className="hover:bg-[#F7F5F0] cursor-pointer transition-colors" onClick={() => setExpanded(expanded === g.id ? null : g.id)}>
                      <td className="px-4 py-3 font-mono text-xs font-medium text-[#1A1916]">{g.control_id.toUpperCase()}</td>
                      <td className="px-4 py-3 text-xs text-[#6B6762]">{g.title}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded font-mono text-[10px] font-medium ${STATUS_COLORS[g.gap_status] ?? "bg-[#EAEAE8] text-[#5A5A58]"}`}>
                          {g.gap_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-[#6B6762]">{g.rationale}</td>
                      <td className="px-4 py-3">
                        {g.cve_refs.length > 0 ? (
                          <span className="font-mono text-[10px] text-[#8A2828]">{g.cve_refs.slice(0, 2).join(", ")}{g.cve_refs.length > 2 ? ` +${g.cve_refs.length - 2}` : ""}</span>
                        ) : <span className="font-mono text-[10px] text-[#C8C5C0]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-[#ACA9A4] font-mono text-[10px]">{expanded === g.id ? "▲" : "▼"}</td>
                    </tr>
                    {expanded === g.id && g.objective_findings.length > 0 && (
                      <tr className="bg-[#F7F5F0]">
                        <td colSpan={6} className="px-8 py-4">
                          <p className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4] mb-3">Assessment Objectives</p>
                          <div className="space-y-1.5">
                            {g.objective_findings.map((f, i) => (
                              <div key={i} className="flex gap-3 text-xs">
                                <span className={`font-mono text-[10px] w-16 shrink-0 font-medium ${f.met === "MET" ? "text-[#2A6040]" : f.met === "PARTIAL" ? "text-[#8A6020]" : "text-[#8A2828]"}`}>
                                  {f.met}
                                </span>
                                <span className="text-[#6B6762]">{f.objective}</span>
                                {f.note && <span className="text-[#ACA9A4] italic">— {f.note}</span>}
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && (
              <p className="text-center font-mono text-xs text-[#ACA9A4] py-10 tracking-wide">No controls found.</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default function GapPage() {
  return (
    <Suspense>
      <GapPageInner />
    </Suspense>
  );
}

const btn    = "px-4 py-2 bg-[#1A1916] text-white text-xs font-medium rounded-md hover:bg-[#2A2926] disabled:opacity-40 transition-colors";
const btnOut = "px-4 py-2 border border-[#E5E0D8] text-[#6B6762] text-xs font-medium rounded-md hover:border-[#1A1916] hover:text-[#1A1916] transition-colors";
const inp    = "w-full px-3 py-2 text-sm text-[#1A1916] bg-white border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] focus:border-[#1A1916] transition-colors placeholder:text-[#C8C5C0]";
