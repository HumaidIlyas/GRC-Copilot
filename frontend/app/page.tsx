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
      // Auto-initialize ODPs for the new project
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
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-sm text-gray-500 mt-1">NIST 800-53 compliance assessments</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors"
        >
          New Project
        </button>
      </div>

      {/* Feature cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        {[
          { title: "SSP Assistant", desc: "Draft control implementation statements", href: "/ssp", color: "bg-blue-600" },
          { title: "Gap Assessment", desc: "Assess your SSP + CVE data against the baseline", href: "/gap", color: "bg-amber-600" },
          { title: "POA&M Generator", desc: "Draft plan of action from gap findings", href: "/poam", color: "bg-red-600" },
        ].map((f) => (
          <Link key={f.href} href={f.href} className="block rounded-xl border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition">
            <div className={`w-8 h-8 rounded-md ${f.color} mb-3`} />
            <h2 className="font-semibold text-gray-900 mb-1">{f.title}</h2>
            <p className="text-xs text-gray-500">{f.desc}</p>
          </Link>
        ))}
      </div>

      {/* Project list */}
      {loading ? (
        <p className="text-sm text-gray-400">Loading projects...</p>
      ) : projects.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center">
          <p className="text-gray-500 mb-4">No projects yet. Create one to get started.</p>
          <button onClick={() => setShowForm(true)} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700">
            Create Project
          </button>
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white divide-y divide-gray-100 overflow-hidden shadow-sm">
          {projects.map((p) => (
            <div key={p.id} className="flex items-center justify-between px-5 py-4 hover:bg-gray-50">
              <div>
                <p className="font-medium text-gray-900">{p.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {p.baseline} baseline · {p.data_classification} · {new Date(p.created_at).toLocaleDateString()}
                </p>
              </div>
              <div className="flex gap-2">
                {[
                  { label: "SSP", href: `/ssp?project=${p.id}` },
                  { label: "ODP", href: `/odp?project=${p.id}` },
                  { label: "Gap", href: `/gap?project=${p.id}` },
                  { label: "POA&M", href: `/poam?project=${p.id}` },
                ].map((l) => (
                  <Link key={l.label} href={l.href} className="px-2.5 py-1 text-xs font-medium text-blue-700 bg-blue-50 rounded-md hover:bg-blue-100 transition">
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
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="px-6 py-5 border-b border-gray-100">
              <h2 className="text-lg font-semibold">New Project</h2>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              <Field label="System Name" required>
                <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Agency HR System" />
              </Field>
              <Field label="System Description" required>
                <textarea className={`${input} h-20 resize-none`} value={form.system_description} onChange={(e) => setForm({ ...form, system_description: e.target.value })} required placeholder="What the system does and who uses it" />
              </Field>
              <Field label="System Boundary">
                <input className={input} value={form.system_boundary} onChange={(e) => setForm({ ...form, system_boundary: e.target.value })} placeholder="Network/infrastructure scope" />
              </Field>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Data Classification">
                  <select className={input} value={form.data_classification} onChange={(e) => setForm({ ...form, data_classification: e.target.value })}>
                    <option>Low</option><option>Moderate</option><option>High</option>
                  </select>
                </Field>
                <Field label="NIST Baseline">
                  <select className={input} value={form.baseline} onChange={(e) => setForm({ ...form, baseline: e.target.value })}>
                    <option>Low</option><option>Moderate</option><option>High</option>
                  </select>
                </Field>
              </div>
              <Field label="FedRAMP OSCAL SSP URL (optional)">
                <input className={input} value={form.oscal_ssp_url} onChange={(e) => setForm({ ...form, oscal_ssp_url: e.target.value })} placeholder="https://raw.githubusercontent.com/..." />
              </Field>
              {error && <p className="text-sm text-red-600">{error}</p>}
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-lg border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
                <button type="submit" disabled={creating} className="flex-1 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
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
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

const input = "w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent";
