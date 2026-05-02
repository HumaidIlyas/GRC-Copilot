"use client";

import React, { useState, useEffect, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { api, type Project, type GapRow } from "@/lib/api";

const STATUS_COLORS: Record<string, string> = {
  "Implemented":          "bg-green-100 text-green-700",
  "Partially Implemented":"bg-amber-100 text-amber-700",
  "Not Implemented":      "bg-red-100 text-red-700",
  "Inherited":            "bg-blue-100 text-blue-700",
  "Not Applicable":       "bg-gray-100 text-gray-500",
  "Planned":              "bg-purple-100 text-purple-700",
};

const STATUS_BAR: Record<string, string> = {
  "Implemented":          "bg-green-500",
  "Partially Implemented":"bg-amber-400",
  "Not Implemented":      "bg-red-500",
  "Inherited":            "bg-blue-400",
  "Not Applicable":       "bg-gray-300",
  "Planned":              "bg-purple-400",
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
    inScope:   gaps.filter((g) => !["Inherited","Not Applicable"].includes(g.gap_status)).length,
  };

  const project = projects.find((p) => p.id === selected);

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Gap Assessment</h1>
          <p className="text-sm text-gray-500 mt-1">Assess FedRAMP OSCAL SSP + NVD CVE data against NIST 800-53 baseline</p>
        </div>
        {selected && gaps.length > 0 && (
          <div className="flex gap-2">
            <a href={api.exportGap(selected)} className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700">Export Gap .xlsx</a>
            <a href={api.exportEvidence(selected, true)} className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700">Evidence Request .xlsx</a>
          </div>
        )}
      </div>

      {/* Config panel */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-6 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
            <select
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
            >
              <option value="">Select a project...</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.baseline})</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">FedRAMP OSCAL SSP URL</label>
            <input
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://raw.githubusercontent.com/..."
              value={sspUrl}
              onChange={(e) => setSspUrl(e.target.value)}
            />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={fetchCves} onChange={(e) => setFetchCves(e.target.checked)} className="rounded" />
            Query NVD for CVEs (adds ~30s per component)
          </label>
          <button
            onClick={handleAssess}
            disabled={running || !selected || !sspUrl.trim()}
            className="px-5 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 disabled:opacity-50"
          >
            {running ? "Running assessment..." : "Run Gap Assessment"}
          </button>
        </div>
        {running && (
          <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 px-4 py-3 rounded-lg">
            <span className="animate-spin inline-block w-4 h-4 border-2 border-amber-600 border-t-transparent rounded-full" />
            Assessing {project?.baseline} baseline controls against SSP and NVD data...
          </div>
        )}
        {msg && <div className="text-sm text-green-700 bg-green-50 px-4 py-2 rounded-lg">{msg}</div>}
        {error && <div className="text-sm text-red-600 bg-red-50 px-4 py-2 rounded-lg">{error}</div>}
      </div>

      {gaps.length > 0 && (
        <>
          {/* Summary stats */}
          <div className="grid grid-cols-7 gap-3 mb-6">
            {[
              { label: "Total",        value: summary.total,     color: "text-gray-900" },
              { label: "In Scope",     value: summary.inScope,   color: "text-gray-700" },
              { label: "Implemented",  value: summary.impl,      color: "text-green-700" },
              { label: "Partial",      value: summary.partial,   color: "text-amber-600" },
              { label: "Not Impl.",    value: summary.notImpl,   color: "text-red-600" },
              { label: "Inherited",    value: summary.inherited, color: "text-blue-600" },
              { label: "N/A",          value: summary.na,        color: "text-gray-400" },
            ].map((s) => (
              <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center shadow-sm">
                <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                <p className="text-xs text-gray-500 mt-1">{s.label}</p>
              </div>
            ))}
          </div>

          {/* Status bar */}
          <div className="flex h-2 rounded-full overflow-hidden mb-6 bg-gray-100">
            {(["Implemented","Partially Implemented","Not Implemented","Inherited","Not Applicable","Planned"] as const).map((s) => {
              const count = gaps.filter((g) => g.gap_status === s).length;
              const pct = summary.total ? (count / summary.total) * 100 : 0;
              return <div key={s} className={`${STATUS_BAR[s]} transition-all`} style={{ width: `${pct}%` }} title={`${s}: ${count}`} />;
            })}
          </div>

          {/* Filters */}
          <div className="flex gap-3 mb-4 flex-wrap">
            <input
              className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-52"
              placeholder="Search controls..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              {statuses.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" value={familyFilter} onChange={(e) => setFamilyFilter(e.target.value)}>
              {families.map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>

          {/* Gap table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-24">Control</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Title</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-36">Status</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Rationale</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600 w-32">CVEs</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {filtered.map((g) => (
                  <React.Fragment key={g.id}>
                    <tr
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => setExpanded(expanded === g.id ? null : g.id)}
                    >
                      <td className="px-4 py-3 font-mono text-xs font-medium text-blue-700">{g.control_id.toUpperCase()}</td>
                      <td className="px-4 py-3 text-xs text-gray-700">{g.title}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[g.gap_status] ?? "bg-gray-100 text-gray-500"}`}>
                          {g.gap_status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-600 max-w-xs truncate">{g.rationale}</td>
                      <td className="px-4 py-3">
                        {g.cve_refs.length > 0 ? (
                          <span className="text-xs font-mono text-red-600">{g.cve_refs.slice(0, 2).join(", ")}{g.cve_refs.length > 2 ? ` +${g.cve_refs.length - 2}` : ""}</span>
                        ) : <span className="text-xs text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{expanded === g.id ? "▲" : "▼"}</td>
                    </tr>
                    {expanded === g.id && g.objective_findings.length > 0 && (
                      <tr className="bg-gray-50">
                        <td colSpan={6} className="px-8 py-3">
                          <p className="text-xs font-semibold text-gray-600 mb-2">Assessment Objectives</p>
                          <div className="space-y-1">
                            {g.objective_findings.map((f, i) => (
                              <div key={i} className="flex gap-3 text-xs">
                                <span className={`w-16 shrink-0 font-medium ${f.met === "MET" ? "text-green-600" : f.met === "PARTIAL" ? "text-amber-600" : "text-red-600"}`}>
                                  {f.met}
                                </span>
                                <span className="text-gray-600">{f.objective}</span>
                                {f.note && <span className="text-gray-400 italic">— {f.note}</span>}
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
