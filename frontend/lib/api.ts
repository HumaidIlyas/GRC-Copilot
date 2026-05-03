import { auth } from "@/lib/firebase"
import { getIdToken } from "firebase/auth"

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000/api";

export async function apiDownload(path: string, filename: string): Promise<void> {
  let authHeader: Record<string, string> = {}
  if (auth.currentUser) {
    const token = await getIdToken(auth.currentUser)
    authHeader = { Authorization: `Bearer ${token}` }
  }
  const res = await fetch(`${BASE}${path}`, { headers: authHeader })
  if (!res.ok) throw new Error("Export failed")
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let authHeader: Record<string, string> = {}
  if (auth.currentUser) {
    const token = await getIdToken(auth.currentUser)
    authHeader = { Authorization: `Bearer ${token}` }
  }

  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...authHeader, ...options?.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail ?? "API error");
  }
  return res.json();
}

export const api = {
  // Projects
  listProjects: () => apiFetch<Project[]>("/ssp/projects"),
  getProject: (id: string) => apiFetch<Project>(`/ssp/projects/${id}`),
  createProject: (data: CreateProjectPayload) =>
    apiFetch<{ id: string; name: string }>("/ssp/projects", {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // SSP
  draftSSP: (projectId: string) =>
    apiFetch<{ drafted: number; controls: string[] }>(`/ssp/projects/${projectId}/draft`, {
      method: "POST",
    }),
  getControls: (projectId: string) =>
    apiFetch<Control[]>(`/ssp/projects/${projectId}/controls`),
  updateControl: (projectId: string, controlId: string, data: { implementation_statement: string; status: string }) =>
    apiFetch(`/ssp/projects/${projectId}/controls/${controlId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // ODP
  initODPs: (projectId: string) =>
    apiFetch<{ created: number; total: number; defined: number; undefined: number }>(
      `/odp/projects/${projectId}/initialize`,
      { method: "POST" }
    ),
  listODPs: (projectId: string, undefinedOnly = false) =>
    apiFetch<OdpRow[]>(`/odp/projects/${projectId}/params?undefined_only=${undefinedOnly}`),
  odpSummary: (projectId: string) =>
    apiFetch<OdpSummary>(`/odp/projects/${projectId}/params/summary`),
  updateODP: (projectId: string, odpId: string, value: string) =>
    apiFetch(`/odp/projects/${projectId}/params/${odpId}`, {
      method: "PATCH",
      body: JSON.stringify({ value }),
    }),

  // Gap
  assessFromSSP: (projectId: string, sspUrl: string, fetchCves = true) =>
    apiFetch<GapAssessResult>(`/gap/projects/${projectId}/assess-from-ssp`, {
      method: "POST",
      body: JSON.stringify({ ssp_url: sspUrl, fetch_cves: fetchCves }),
    }),
  getGaps: (projectId: string) =>
    apiFetch<GapRow[]>(`/gap/projects/${projectId}/gaps`),

  // POA&M
  generatePoam: (projectId: string) =>
    apiFetch<{ generated: number; items: string[] }>(`/poam/projects/${projectId}/generate`, {
      method: "POST",
    }),
  getPoamItems: (projectId: string) =>
    apiFetch<PoamItem[]>(`/poam/projects/${projectId}/items`),
  updatePoamItem: (projectId: string, itemId: string, data: Partial<PoamItem>) =>
    apiFetch(`/poam/projects/${projectId}/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify(data),
    }),

  // Exports — return URL to trigger browser download
  exportSSP: (projectId: string) => `${BASE}/export/projects/${projectId}/ssp`,
  exportGap: (projectId: string) => `${BASE}/export/projects/${projectId}/gap`,
  exportPoam: (projectId: string) => `${BASE}/export/projects/${projectId}/poam`,
  exportODP: (projectId: string) => `${BASE}/export/projects/${projectId}/odp`,
  exportEvidence: (projectId: string, gapsOnly = false) =>
    `${BASE}/export/projects/${projectId}/evidence-request?gaps_only=${gapsOnly}`,
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Project {
  id: string;
  name: string;
  system_description: string;
  system_boundary: string;
  data_classification: string;
  baseline: string;
  oscal_ssp_url?: string;
  created_at: string;
}

export interface CreateProjectPayload {
  name: string;
  system_description: string;
  system_boundary: string;
  data_classification: string;
  baseline: string;
  oscal_ssp_url?: string;
}

export interface Control {
  id: string;
  control_id: string;
  family: string;
  title: string;
  implementation_statement: string;
  status: string;
}

export interface OdpRow {
  id: string;
  control_id: string;
  param_id: string;
  label: string;
  required_definition: string;
  value: string;
  is_choice: boolean;
  choices: string[];
  defined: boolean;
}

export interface OdpSummary {
  total: number;
  defined: number;
  undefined: number;
  completion_pct: number;
  by_family: Record<string, { total: number; defined: number }>;
}

export interface GapRow {
  id: string;
  control_id: string;
  family: string;
  title: string;
  gap_status: string;
  rationale: string;
  objective_findings: { objective: string; met: string; note: string }[];
  cve_refs: string[];
}

export interface GapAssessResult {
  assessed: number;
  ssp_controls_found: number;
  cve_mappings: number;
  summary: { total: number; implemented: number; partially_implemented: number; not_implemented: number; compliance_percentage: number };
  results: { control_id: string; status: string }[];
}

export interface PoamItem {
  id: string;
  control_id: string;
  weakness_description: string;
  risk_level: string;
  remediation_steps: string;
  milestones: string;
  cve_refs: string;
  status: string;
}
