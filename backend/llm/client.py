"""
LLM abstraction layer — swap vendors via LLM_VENDOR env var.

Supported vendors: anthropic (default), vertex, openai, gemini

  anthropic — Direct Anthropic API (local dev)
  vertex    — Claude on Google Cloud Vertex AI (GCP prod, auth via service account)
  openai    — OpenAI GPT models
  gemini    — Google Gemini models via generativeai SDK

Task-based model routing keeps costs low:
  - classify: cheap/fast model  (gap status, risk level)
  - draft:    mid-tier model    (SSP statements, POA&M entries)

Structured output (complete_structured) uses native tool use / function calling
per vendor — returns a parsed dict, no regex parsing needed.

To switch vendor:
  LLM_VENDOR=vertex  uvicorn main:app --reload   # GCP production
  LLM_VENDOR=openai  uvicorn main:app --reload
  LLM_VENDOR=gemini  uvicorn main:app --reload
"""

import os
from typing import Literal

TaskType = Literal["classify", "draft"]

MODELS: dict[str, dict[str, str]] = {
    "anthropic": {
        "classify": "claude-haiku-4-5-20251001",
        "draft":    "claude-sonnet-4-6",
    },
    # Vertex AI uses versioned model IDs — Claude on GCP, auth via service account
    "vertex": {
        "classify": "claude-haiku-4-5-20251001@20251001",
        "draft":    "claude-sonnet-4-6@20250514",
    },
    "openai": {
        "classify": "gpt-4o-mini",
        "draft":    "gpt-4o",
    },
    "gemini": {
        "classify": "gemini-1.5-flash",
        "draft":    "gemini-1.5-pro",
    },
}

MAX_TOKENS: dict[str, int] = {
    "classify": 150,
    "draft":    450,
}


def complete(prompt: str, task: TaskType = "draft") -> str:
    """Send a prompt and return plain text response."""
    vendor = _vendor()
    model = MODELS[vendor][task]
    max_tokens = MAX_TOKENS[task]

    if vendor in ("anthropic", "vertex"):
        return _call_anthropic(prompt, model, max_tokens, use_vertex=(vendor == "vertex"))
    elif vendor == "openai":
        return _call_openai(prompt, model, max_tokens)
    elif vendor == "gemini":
        return _call_gemini(prompt, model, max_tokens)


def complete_structured(prompt: str, schema: dict, task: TaskType = "draft") -> dict:
    """
    Send a prompt and return a structured dict matching the given JSON schema.
    Uses native tool use / function calling per vendor — no regex parsing.

    Args:
        prompt: The full prompt string.
        schema: JSON Schema object describing the expected output structure.
                Must have "name", "description", and "properties".
        task:   Model tier to use (classify or draft).

    Returns:
        Parsed dict matching the schema. Empty dict on failure.
    """
    vendor = _vendor()
    model = MODELS[vendor][task]
    max_tokens = MAX_TOKENS[task] * 3  # structured output needs more tokens

    if vendor in ("anthropic", "vertex"):
        return _call_anthropic_structured(prompt, model, max_tokens, schema, use_vertex=(vendor == "vertex"))
    elif vendor == "openai":
        return _call_openai_structured(prompt, model, max_tokens, schema)
    elif vendor == "gemini":
        return _call_gemini_structured(prompt, model, max_tokens, schema)
    return {}


def complete_batch_structured(
    requests: list[dict],
    task: TaskType = "classify",
) -> dict[str, dict]:
    """
    Submit multiple structured-output requests in one Anthropic Message Batch.
    Each request dict must have: custom_id (str), prompt (str), schema (dict).
    Returns {custom_id: parsed_result_dict}. Missing keys mean that request failed.

    Falls back to threaded execution for non-Anthropic vendors (vertex, openai, gemini).
    """
    vendor = _vendor()
    if vendor != "anthropic":
        from concurrent.futures import ThreadPoolExecutor, as_completed as _as_completed
        results: dict[str, dict] = {}
        with ThreadPoolExecutor(max_workers=5) as executor:
            futures = {
                executor.submit(complete_structured, r["prompt"], r["schema"], task): r["custom_id"]
                for r in requests
            }
            for future in _as_completed(futures):
                cid = futures[future]
                try:
                    results[cid] = future.result()
                except Exception:
                    results[cid] = {}
        return results

    return _call_anthropic_batch_structured(requests, task)


def _call_anthropic_batch_structured(requests: list[dict], task: TaskType) -> dict[str, dict]:
    """Submit an Anthropic Message Batch and block until all results are ready."""
    import time
    import re
    client = _anthropic_client(use_vertex=False)
    model = MODELS["anthropic"][task]
    max_tokens = MAX_TOKENS[task] * 3

    # Batch API custom_id must match ^[a-zA-Z0-9_-]{1,64}$  — dots in control
    # IDs (e.g. "ac-6.1") are not allowed, so we sanitize and keep a reverse map.
    def _safe_id(raw: str) -> str:
        return re.sub(r"[^a-zA-Z0-9_-]", "_", raw)[:64]

    id_map: dict[str, str] = {_safe_id(r["custom_id"]): r["custom_id"] for r in requests}

    batch_reqs = []
    for req in requests:
        schema = req["schema"]
        tool = {
            "name": schema["name"],
            "description": schema.get("description", ""),
            "input_schema": {
                "type": "object",
                "properties": schema["properties"],
                "required": schema.get("required", list(schema["properties"].keys())),
            },
        }
        batch_reqs.append({
            "custom_id": _safe_id(req["custom_id"]),
            "params": {
                "model": model,
                "max_tokens": max_tokens,
                "tools": [tool],
                "tool_choice": {"type": "tool", "name": schema["name"]},
                "messages": [{"role": "user", "content": req["prompt"]}],
            },
        })

    batch = client.messages.batches.create(requests=batch_reqs)
    print(f"[Batch] Submitted {len(batch_reqs)} requests — id={batch.id}")

    while True:
        batch = client.messages.batches.retrieve(batch.id)
        counts = batch.request_counts
        print(f"[Batch] {batch.processing_status} — "
              f"{counts.succeeded} ok / {counts.errored} err / {counts.processing} pending")
        if batch.processing_status == "ended":
            break
        time.sleep(5)

    results: dict[str, dict] = {}
    for result in client.messages.batches.results(batch.id):
        if result.result.type == "succeeded":
            for block in result.result.message.content:
                if block.type == "tool_use":
                    original_id = id_map.get(result.custom_id, result.custom_id)
                    results[original_id] = block.input
                    break
    return results


def get_active_vendor() -> str:
    return _vendor()


def get_active_models() -> dict[str, str]:
    vendor = _vendor()
    return {"vendor": vendor, **MODELS[vendor]}


# ── Provider implementations — plain text ────────────────────────────────────

def _vendor() -> str:
    v = os.getenv("LLM_VENDOR", "anthropic").lower()
    if v not in MODELS:
        raise ValueError(f"Unknown LLM_VENDOR '{v}'. Must be one of: {', '.join(MODELS)}")
    return v


def _anthropic_client(use_vertex: bool = False):
    """Return the appropriate Anthropic client based on deployment target."""
    import anthropic
    if use_vertex:
        return anthropic.AnthropicVertex(
            region=os.getenv("GCP_REGION", "us-east5"),
            project_id=os.getenv("GCP_PROJECT_ID", ""),
        )
    return anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))


def _call_anthropic(prompt: str, model: str, max_tokens: int, use_vertex: bool = False) -> str:
    client = _anthropic_client(use_vertex)
    message = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return message.content[0].text.strip()


def _call_openai(prompt: str, model: str, max_tokens: int) -> str:
    import openai
    client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content.strip()


def _call_gemini(prompt: str, model: str, max_tokens: int) -> str:
    import google.generativeai as genai
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))
    m = genai.GenerativeModel(model)
    response = m.generate_content(
        prompt,
        generation_config=genai.types.GenerationConfig(max_output_tokens=max_tokens),
    )
    return response.text.strip()


# ── Provider implementations — structured output ─────────────────────────────

def _call_anthropic_structured(
    prompt: str, model: str, max_tokens: int, schema: dict, use_vertex: bool = False
) -> dict:
    """Use Anthropic tool use to guarantee structured JSON output."""
    client = _anthropic_client(use_vertex)

    tool = {
        "name": schema["name"],
        "description": schema.get("description", ""),
        "input_schema": {
            "type": "object",
            "properties": schema["properties"],
            "required": schema.get("required", list(schema["properties"].keys())),
        },
    }

    message = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        tools=[tool],
        tool_choice={"type": "tool", "name": schema["name"]},
        messages=[{"role": "user", "content": prompt}],
    )

    for block in message.content:
        if block.type == "tool_use" and block.name == schema["name"]:
            return block.input
    return {}


def _call_openai_structured(
    prompt: str, model: str, max_tokens: int, schema: dict
) -> dict:
    """Use OpenAI function calling for structured output."""
    import openai
    import json
    client = openai.OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

    function = {
        "name": schema["name"],
        "description": schema.get("description", ""),
        "parameters": {
            "type": "object",
            "properties": schema["properties"],
            "required": schema.get("required", list(schema["properties"].keys())),
        },
    }

    response = client.chat.completions.create(
        model=model,
        max_tokens=max_tokens,
        functions=[function],
        function_call={"name": schema["name"]},
        messages=[{"role": "user", "content": prompt}],
    )

    call = response.choices[0].message.function_call
    if call and call.arguments:
        try:
            return json.loads(call.arguments)
        except Exception:
            return {}
    return {}


def _call_gemini_structured(
    prompt: str, model: str, max_tokens: int, schema: dict
) -> dict:
    """Use Gemini function declarations for structured output."""
    import google.generativeai as genai
    import json
    genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

    function_decl = genai.protos.FunctionDeclaration(
        name=schema["name"],
        description=schema.get("description", ""),
        parameters=genai.protos.Schema(
            type=genai.protos.Type.OBJECT,
            properties={
                k: genai.protos.Schema(
                    type=genai.protos.Type.STRING,
                    description=v.get("description", ""),
                )
                for k, v in schema["properties"].items()
            },
            required=schema.get("required", list(schema["properties"].keys())),
        ),
    )

    tool = genai.protos.Tool(function_declarations=[function_decl])
    m = genai.GenerativeModel(model, tools=[tool])
    response = m.generate_content(
        prompt,
        generation_config=genai.types.GenerationConfig(max_output_tokens=max_tokens),
    )

    for part in response.candidates[0].content.parts:
        if part.function_call:
            return dict(part.function_call.args)
    return {}
