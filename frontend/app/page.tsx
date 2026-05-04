"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { api, type Project, type CreateProjectPayload } from "@/lib/api";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<CreateProjectPayload>({
    name: "", system_description: "", system_boundary: "",
    data_classification: "Moderate", baseline: "Moderate", oscal_ssp_url: "",
  });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.listProjects().then(setProjects).catch(console.error).finally(() => setLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    setError("");
    try {
      const { id } = await api.createProject(form);
      await api.initODPs(id).catch(() => {});
      const updated = await api.listProjects();
      setProjects(updated);
      setShowForm(false);
      setForm({ name: "", system_description: "", system_boundary: "", data_classification: "Moderate", baseline: "Moderate", oscal_ssp_url: "" });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-serif text-4xl text-[#1A1916]">Projects</h1>
          <p className="font-mono text-[10px] tracking-[0.2em] uppercase text-[#ACA9A4] mt-2">NIST 800-53 Compliance Assessments</p>
        </div>
        <button onClick={() => setShowForm(true)} className={btn}>
          New Project
        </button>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-3 gap-4 mb-10">
        {[
          { num: "01", title: "Gap Assessment",   desc: "Assess your SSP + CVE data against the baseline", href: "/gap" },
          { num: "02", title: "POA&M Generator", desc: "Draft plan of action from gap findings",          href: "/poam" },
          { num: "03", title: "ODP Tracking",    desc: "Define organization-defined parameters",           href: "/odp" },
        ].map((f) => (
          <Link key={f.href} href={f.href} className="block bg-white border border-[#E5E0D8] rounded-xl p-5 hover:border-[#1A1916] transition-colors group">
            <p className="font-mono text-[10px] tracking-widest text-[#ACA9A4] mb-3 group-hover:text-[#6B6762] transition-colors">{f.num}</p>
            <h2 className="font-serif text-lg text-[#1A1916] mb-1">{f.title}</h2>
            <p className="text-xs text-[#6B6762]">{f.desc}</p>
          </Link>
        ))}
      </div>

      {/* Project list */}
      {loading ? (
        <p className="font-mono text-xs text-[#ACA9A4] tracking-wide">Loading...</p>
      ) : projects.length === 0 ? (
        <div className="border border-dashed border-[#E5E0D8] rounded-xl p-12 text-center">
          <p className="text-sm text-[#6B6762] mb-4">No projects yet. Create one to get started.</p>
          <button onClick={() => setShowForm(true)} className={btn}>Create Project</button>
        </div>
      ) : (
        <div className="bg-white border border-[#E5E0D8] rounded-xl overflow-hidden">
          <div className="px-5 py-3 border-b border-[#E5E0D8] bg-[#F7F5F0] flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4]">Project</span>
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase text-[#ACA9A4]">Actions</span>
          </div>
          {projects.map((p, i) => (
            <div key={p.id} className={`flex items-center justify-between px-5 py-4 hover:bg-[#F7F5F0] transition-colors ${i > 0 ? "border-t border-[#E5E0D8]" : ""}`}>
              <div>
                <p className="text-sm font-medium text-[#1A1916]">{p.name}</p>
                <p className="font-mono text-[10px] text-[#ACA9A4] mt-0.5 tracking-wide">
                  {p.baseline} · {p.data_classification} · {new Date(p.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-2">
                {[
                  { label: "ODP",   href: `/odp?project=${p.id}` },
                  { label: "Gap",   href: `/gap?project=${p.id}` },
                  { label: "POA&M", href: `/poam?project=${p.id}` },
                ].map((l) => (
                  <Link key={l.label} href={l.href} className="px-2.5 py-1 font-mono text-[10px] tracking-wide border border-[#E5E0D8] rounded text-[#6B6762] hover:border-[#1A1916] hover:text-[#1A1916] transition-colors">
                    {l.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create project modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/25 flex items-center justify-center z-50 p-4">
          <div className="bg-white border border-[#E5E0D8] rounded-xl shadow-xl w-full max-w-lg">
            <div className="px-6 py-5 border-b border-[#E5E0D8] flex items-center justify-between">
              <h2 className="font-serif text-xl text-[#1A1916]">New Project</h2>
              <button onClick={() => setShowForm(false)} className="font-mono text-[10px] tracking-widest text-[#ACA9A4] hover:text-[#1A1916] transition-colors uppercase">
                Esc
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              <Field label="System Name" required>
                <input className={inp} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Agency HR System" />
              </Field>
              <Field label="System Description" required>
                <textarea className={`${inp} h-20 resize-none`} value={form.system_description} onChange={(e) => setForm({ ...form, system_description: e.target.value })} required placeholder="What the system does and who uses it" />
              </Field>
              <Field label="System Boundary">
                <input className={inp} value={form.system_boundary} onChange={(e) => setForm({ ...form, system_boundary: e.target.value })} placeholder="Network/infrastructure scope" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Data Classification">
                  <select className={inp} value={form.data_classification} onChange={(e) => setForm({ ...form, data_classification: e.target.value })}>
                    <option>Low</option><option>Moderate</option><option>High</option>
                  </select>
                </Field>
                <Field label="NIST Baseline">
                  <select className={inp} value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value })}>
                    <option>Low</option><option>Moderate</option><option>High</option>
                  </select>
                </Field>
              </div>
              <Field label="FedRAMP OSCAL SSP URL">
                <input className={inp} value={form.oscal_ssp_url} onChange={(e) => setForm({ ...form, oscal_ssp_url: e.target.value })} placeholder="https://raw.githubusercontent.com/..." />
              </Field>
              {error && <p className="text-xs text-red-600 font-mono">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className={btnOut + " flex-1 py-2"}>Cancel</button>
                <button type="submit" disabled={creating} className={btn + " flex-1 py-2"}>
                  {creating ? "Creating..." : "Create Project"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-mono text-[10px] tracking-[0.15em] uppercase text-[#6B6762] mb-1.5">
        {label}{required && <span className="text-red-400 ml-1">*</span>}
      </label>
      {children}
    </div>
  );
}

const btn    = "px-4 py-2 bg-[#1A1916] text-white text-xs font-medium rounded-md hover:bg-[#2A2926] disabled:opacity-40 transition-colors";
const btnOut = "px-4 py-2 border border-[#E5E0D8] text-[#6B6762] text-xs font-medium rounded-md hover:border-[#1A1916] hover:text-[#1A1916] transition-colors";
const inp    = "w-full px-3 py-2 text-sm text-[#1A1916] bg-white border border-[#E5E0D8] rounded-md focus:outline-none focus:ring-1 focus:ring-[#1A1916] focus:border-[#1A1916] transition-colors placeholder:text-[#C8C5C0]";
