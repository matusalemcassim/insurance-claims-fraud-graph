"""
LangGraph-orchestrated fraud investigation agent.
Primary LLM: Anthropic claude-opus-4-5
Fallback LLM: OpenAI gpt-4o
Flow: guardrails -> generate_cypher -> execute_cypher -> summarize -> respond

Supports optional claim_context to scope responses to a specific claim.
"""
from __future__ import annotations
import os
import json
import re
import time
from typing import TypedDict, Literal, Optional

from langgraph.graph import StateGraph, END
from langchain_anthropic import ChatAnthropic
from langchain_openai import ChatOpenAI
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage
from langsmith import traceable

from app.db.neo4j import get_driver

# ---------------------------------------------------------------------------
# LLM clients
# ---------------------------------------------------------------------------
anthropic_llm = ChatAnthropic(
    model="claude-opus-4-5",
    api_key=os.getenv("ANTHROPIC_API_KEY"),
    timeout=30,
    max_retries=0,
)

openai_llm = ChatOpenAI(
    model="gpt-4o",
    api_key=os.getenv("OPENAI_API_KEY"),
    timeout=30,
    max_retries=0,
)

# ---------------------------------------------------------------------------
# Graph state
# ---------------------------------------------------------------------------
class AgentState(TypedDict):
    user_message:         str
    history:              list[dict]
    claim_context:        Optional[dict]   # NEW — injected claim scope
    cypher:               Optional[str]
    explanation:          Optional[str]
    confidence:           Optional[str]
    records:              Optional[list[dict]]
    topic_blocked:        bool
    cypher_blocked:       bool
    db_offline:           bool
    llm_used:             str
    error:                Optional[str]
    final_answer:         Optional[str]
    guardrail_latency_ms: Optional[int]
    summarize_latency_ms: Optional[int]

# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------
SCHEMA = """
Neo4j Graph Schema for Insurance Fraud Detection:

NODE LABELS & PROPERTIES:
- Claim: claim_id, claim_amount, approved_amount, days_to_file,
         claim_type (AUTO/HOME/HEALTH/LIFE),
         submission_channel (WEB/PHONE/AGENT),
         status (APPROVED/DENIED/PENDING/UNDER_REVIEW),
         filed_date, label_is_fraud (0 or 1), fraud_scenario
- Policy: policy_id, policy_type, start_date, end_date, premium_amount
- PolicyHolder: policyholder_id, name, age, address, phone, email
- BankAccount: bank_account_id, account_number, bank_name, account_type
- Adjuster: adjuster_id, name, department, hire_date
- Provider: provider_id, name, specialty, location
- Vehicle: vehicle_id, make, model, year, vin
- LawFirm: law_firm_id, name, location

RELATIONSHIPS:
- (Policy)-[:HAS_CLAIM]->(Claim)
- (PolicyHolder)-[:HAS_POLICY]->(Policy)
- (Claim)-[:PAID_TO]->(BankAccount)
- (Claim)-[:HANDLED_BY]->(Adjuster)
- (Claim)-[:INVOLVES_VEHICLE]->(Vehicle)
- (Claim)-[:REPRESENTED_BY]->(LawFirm)
- (Case)-[:REGARDING]->(Claim)

FRAUD SCENARIOS: shared_bank_account_ring, shared_address_phone_cluster,
collusive_provider, triangle_lawfirm_provider, rapid_reclaim_burst,
inflated_repair_shop, adjuster_collusion, phantom_policy_exploitation

CYPHER RULES:
- Always use LIMIT (max 50) unless counting
- Use OPTIONAL MATCH for nullable relationships
- label_is_fraud is 0 or 1 (integer)
- days_to_file is an integer
- claim_amount and approved_amount are floats
"""

def _build_cypher_system(claim_context: Optional[dict] = None) -> str:
    """Build the Cypher generation system prompt, optionally scoped to a claim."""
    base = f"""You are an expert fraud investigation assistant for an insurance company.
You help investigators query and analyze claims, policyholders, adjusters, and fraud patterns.

{SCHEMA}

TOPIC GUARDRAIL:
Only answer questions about insurance claims, fraud detection, policyholders,
adjusters, bank accounts, data analysis, or general insurance/fraud concepts.
For unrelated questions, set type to "off_topic".

Reply ONLY with valid JSON - no markdown, no backticks:
{{
  "type": "query" or "answer" or "off_topic",
  "cypher": "MATCH ... RETURN ... LIMIT 20",
  "explanation": "One sentence describing what the query finds",
  "answer": "Direct answer for non-query responses",
  "confidence": "high" or "medium" or "low"
}}"""

    if claim_context:
        claim_id       = claim_context.get("claim_id", "")
        claim_type     = claim_context.get("claim_type", "unknown")
        claim_amount   = claim_context.get("claim_amount")
        status         = claim_context.get("status", "unknown")
        fraud_scenario = claim_context.get("fraud_scenario")
        label          = claim_context.get("label_is_fraud")

        fraud_note = ""
        if label == 1:
            fraud_note = "CONFIRMED FRAUD"
        elif fraud_scenario:
            fraud_note = f"potential fraud — scenario: {fraud_scenario}"

        amount_str = f"${claim_amount:,.2f}" if claim_amount is not None else "unknown"

        scope = f"""

ACTIVE CLAIM CONTEXT:
You are currently investigating claim {claim_id}.
- Type: {claim_type}
- Amount: {amount_str}
- Status: {status}
- Fraud flag: {fraud_note or "none"}
{f'- Scenario: {fraud_scenario}' if fraud_scenario else ''}

When the user asks about "this claim", "this case", "the claim", or uses pronouns
referring to the current context, always scope your Cypher query to claim_id = "{claim_id}".
You may also query related entities (policyholder, bank account, adjuster, vehicle)
linked to this specific claim. You can still answer broader dataset questions if asked."""

        return base + scope

    return base


SUMMARIZE_SYSTEM = """You are a fraud investigation assistant summarizing database query results.

Write a natural, conversational response that:
- Directly answers the user's original question in plain English
- Highlights the most important findings with specific values
- Adds brief investigative context where useful
- If results are empty, clearly says no data was found
- If confidence is low, acknowledges uncertainty
- Keeps it concise - 2 to 5 sentences maximum
- Never mentions Cypher, queries, or databases
- Never uses bullet points or markdown

Respond with plain conversational text only."""

# ---------------------------------------------------------------------------
# Guardrails
# ---------------------------------------------------------------------------
DESTRUCTIVE_PATTERNS = re.compile(
    r"\b(DELETE|DETACH\s+DELETE|REMOVE|DROP|SET|MERGE|CREATE|CALL\s+db\.)",
    re.IGNORECASE,
)

def _is_destructive(cypher: str) -> bool:
    return bool(DESTRUCTIVE_PATTERNS.search(cypher))

def _sanitize_cypher(cypher: str) -> str:
    return cypher.strip().rstrip(";")

def _strip_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        parts = text.split("```")
        text = parts[1] if len(parts) > 1 else text
        if text.startswith("json"):
            text = text[4:]
    return text.strip()

# ---------------------------------------------------------------------------
# LLM caller with Anthropic -> retry -> OpenAI fallback
# ---------------------------------------------------------------------------
def _call_llm(messages: list, system: str, max_tokens: int = 1024) -> tuple[str, str]:
    lc_messages = []
    for m in messages:
        if m["role"] == "user":
            lc_messages.append(HumanMessage(content=m["content"]))
        elif m["role"] == "assistant":
            lc_messages.append(AIMessage(content=m["content"]))

    anthropic_with_system = anthropic_llm.bind(system=system)
    openai_messages = [SystemMessage(content=system)] + lc_messages

    try:
        response = anthropic_with_system.invoke(lc_messages)
        return response.content, "anthropic"
    except Exception as e1:
        print(f"[Agent] Anthropic attempt 1 failed: {e1}")
        time.sleep(1.5)

    try:
        response = anthropic_with_system.invoke(lc_messages)
        return response.content, "anthropic"
    except Exception as e2:
        print(f"[Agent] Anthropic attempt 2 failed: {e2}")

    try:
        print("[Agent] Falling back to OpenAI gpt-4o")
        response = openai_llm.invoke(openai_messages)
        return response.content, "openai"
    except Exception as e3:
        print(f"[Agent] OpenAI fallback failed: {e3}")
        raise RuntimeError("All LLM providers are currently unavailable.")

# ---------------------------------------------------------------------------
# Graph nodes
# ---------------------------------------------------------------------------
@traceable(name="guardrails", tags=["node"])
def node_guardrails(state: AgentState) -> AgentState:
    start         = time.time()
    history       = state["history"]
    user_msg      = state["user_message"]
    claim_context = state.get("claim_context")

    context = []
    for msg in history[-10:]:
        if msg["role"] in ("user", "assistant"):
            context.append({"role": msg["role"], "content": msg["content"]})
    context.append({"role": "user", "content": user_msg})

    # Build system prompt — claim-scoped if context provided
    cypher_system = _build_cypher_system(claim_context)

    try:
        raw, llm_used = _call_llm(context, cypher_system)
    except RuntimeError:
        return {
            **state,
            "topic_blocked":        False,
            "cypher_blocked":       False,
            "db_offline":           False,
            "llm_used":             "none",
            "error":                "all_llms_down",
            "guardrail_latency_ms": int((time.time() - start) * 1000),
            "final_answer": (
                "I'm sorry, both AI providers are currently unavailable. "
                "Please try again in a few minutes."
            ),
        }

    raw = _strip_fences(raw)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {
            **state,
            "topic_blocked":        False,
            "cypher_blocked":       False,
            "db_offline":           False,
            "llm_used":             llm_used,
            "error":                None,
            "guardrail_latency_ms": int((time.time() - start) * 1000),
            "final_answer":         raw,
        }

    response_type = parsed.get("type", "answer")
    confidence    = parsed.get("confidence", "high")

    if response_type == "off_topic":
        return {
            **state,
            "topic_blocked":        True,
            "cypher_blocked":       False,
            "db_offline":           False,
            "llm_used":             llm_used,
            "confidence":           confidence,
            "error":                None,
            "guardrail_latency_ms": int((time.time() - start) * 1000),
            "final_answer": parsed.get(
                "answer",
                "I can only help with fraud investigation and insurance claims topics. "
                "Please ask me about claims, policyholders, adjusters, or fraud patterns."
            ),
        }

    if response_type == "answer":
        answer = parsed.get("answer", raw)
        if confidence == "low":
            answer = f"I'm not entirely certain, but: {answer}"
        return {
            **state,
            "topic_blocked":        False,
            "cypher_blocked":       False,
            "db_offline":           False,
            "llm_used":             llm_used,
            "confidence":           confidence,
            "error":                None,
            "guardrail_latency_ms": int((time.time() - start) * 1000),
            "final_answer":         answer,
        }

    cypher = _sanitize_cypher(parsed.get("cypher", ""))

    if _is_destructive(cypher):
        return {
            **state,
            "topic_blocked":        False,
            "cypher_blocked":       True,
            "db_offline":           False,
            "llm_used":             llm_used,
            "cypher":               cypher,
            "confidence":           confidence,
            "error":                None,
            "guardrail_latency_ms": int((time.time() - start) * 1000),
            "final_answer": (
                "I can't run that query - it contains write operations that could "
                "modify the database. I only run read-only queries."
            ),
        }

    return {
        **state,
        "topic_blocked":        False,
        "cypher_blocked":       False,
        "db_offline":           False,
        "llm_used":             llm_used,
        "cypher":               cypher,
        "explanation":          parsed.get("explanation", ""),
        "confidence":           confidence,
        "error":                None,
        "guardrail_latency_ms": int((time.time() - start) * 1000),
        "final_answer":         None,
    }


@traceable(name="execute_cypher", tags=["node"])
def node_execute_cypher(state: AgentState) -> AgentState:
    cypher = state.get("cypher", "")
    if not cypher:
        return {**state, "records": [], "db_offline": False}

    try:
        driver = get_driver()
        with driver.session() as session:
            result  = session.run(cypher)
            records = []
            for record in result:
                row = {}
                for key in record.keys():
                    val = record[key]
                    if hasattr(val, "_properties"):
                        row[key] = dict(val._properties)
                    elif hasattr(val, "isoformat"):
                        row[key] = val.isoformat()
                    else:
                        row[key] = val
                records.append(row)
            return {**state, "records": records[:50], "db_offline": False}

    except Exception as e:
        error_msg = str(e).lower()
        is_conn = any(w in error_msg for w in [
            "connection", "unavailable", "refused", "timeout",
            "routing", "unable to retrieve", "serviceunavailable",
        ])
        if is_conn:
            return {
                **state,
                "records":      [],
                "db_offline":   True,
                "final_answer": (
                    "I generated a query but the database appears to be offline. "
                    "Please check that Neo4j is running and try again."
                ),
            }
        return {
            **state,
            "records":      [],
            "db_offline":   False,
            "final_answer": (
                f"I generated a query but it failed to execute. "
                f"This might be a schema mismatch. Error: {str(e)}"
            ),
        }


@traceable(name="summarize", tags=["node"])
def node_summarize(state: AgentState) -> AgentState:
    start       = time.time()
    records     = state.get("records", [])
    explanation = state.get("explanation", "")
    confidence  = state.get("confidence", "high")
    user_msg    = state["user_message"]

    if not records:
        return {
            **state,
            "summarize_latency_ms": int((time.time() - start) * 1000),
            "final_answer": (
                "I searched the database but found no results matching your query. "
                "This could mean the data doesn't exist, or the criteria may need adjusting."
            ),
        }

    confidence_note = ""
    if confidence == "low":
        confidence_note = "\nNote: Express uncertainty in your response."
    elif confidence == "medium":
        confidence_note = "\nNote: Acknowledge any ambiguity briefly."

    results_text   = json.dumps(records[:20], indent=2, default=str)
    prompt_content = (
        f"User question: {user_msg}\n\n"
        f"Context: {explanation}\n\n"
        f"Data ({len(records)} results):\n{results_text}"
    )

    try:
        summary, llm_used = _call_llm(
            [{"role": "user", "content": prompt_content}],
            SUMMARIZE_SYSTEM + confidence_note,
            max_tokens=300,
        )
        return {
            **state,
            "final_answer":         summary,
            "llm_used":             llm_used,
            "summarize_latency_ms": int((time.time() - start) * 1000),
        }
    except RuntimeError:
        return {
            **state,
            "summarize_latency_ms": int((time.time() - start) * 1000),
            "final_answer":         f"Found {len(records)} result(s). {explanation}",
        }


def node_respond(state: AgentState) -> AgentState:
    return state

# ---------------------------------------------------------------------------
# Routing
# ---------------------------------------------------------------------------
def route_after_guardrails(state: AgentState) -> Literal["execute_cypher", "respond"]:
    if (state.get("topic_blocked") or
        state.get("cypher_blocked") or
        state.get("final_answer") is not None):
        return "respond"
    return "execute_cypher"


def route_after_execute(state: AgentState) -> Literal["summarize", "respond"]:
    if state.get("db_offline") or state.get("final_answer") is not None:
        return "respond"
    return "summarize"

# ---------------------------------------------------------------------------
# Build graph
# ---------------------------------------------------------------------------
def _build_graph():
    graph = StateGraph(AgentState)
    graph.add_node("guardrails",     node_guardrails)
    graph.add_node("execute_cypher", node_execute_cypher)
    graph.add_node("summarize",      node_summarize)
    graph.add_node("respond",        node_respond)
    graph.set_entry_point("guardrails")
    graph.add_conditional_edges(
        "guardrails",
        route_after_guardrails,
        {"execute_cypher": "execute_cypher", "respond": "respond"},
    )
    graph.add_conditional_edges(
        "execute_cypher",
        route_after_execute,
        {"summarize": "summarize", "respond": "respond"},
    )
    graph.add_edge("summarize", "respond")
    graph.add_edge("respond",   END)
    return graph.compile()


_graph = _build_graph()

# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------
@traceable(
    run_type="chain",
    name="FraudInvestigationAgent",
    tags=["fraud-agent", "production"],
)
def run_agent(
    user_message:  str,
    history:       list[dict],
    claim_context: Optional[dict] = None,   # NEW optional param
) -> dict:
    initial_state: AgentState = {
        "user_message":         user_message,
        "history":              history,
        "claim_context":        claim_context,
        "cypher":               None,
        "explanation":          None,
        "confidence":           None,
        "records":              None,
        "topic_blocked":        False,
        "cypher_blocked":       False,
        "db_offline":           False,
        "llm_used":             "none",
        "error":                None,
        "final_answer":         None,
        "guardrail_latency_ms": None,
        "summarize_latency_ms": None,
    }

    result = _graph.invoke(
        initial_state,
        config={
            "metadata": {
                "message_length":       len(user_message),
                "history_length":       len(history),
                "claim_scoped":         claim_context is not None,
                "claim_id":             claim_context.get("claim_id") if claim_context else None,
            }
        },
    )

    return {
        "type": (
            "off_topic" if result.get("topic_blocked") else
            "error"     if result.get("error") else
            "query"     if result.get("cypher") and not result.get("cypher_blocked") else
            "answer"
        ),
        "answer":   result.get("final_answer", "I wasn't sure how to handle that. Could you rephrase?"),
        "cypher":   result.get("cypher") if not result.get("cypher_blocked") else None,
        "results":  json.dumps(result.get("records", [])[:20]) if result.get("records") else None,
        "llm_used": result.get("llm_used", "none"),
        "topic_blocked":        result.get("topic_blocked", False),
        "cypher_blocked":       result.get("cypher_blocked", False),
        "db_offline":           result.get("db_offline", False),
        "had_fallback":         result.get("llm_used") == "openai",
        "had_cypher_error":     result.get("error") is not None,
        "guardrail_latency_ms": result.get("guardrail_latency_ms"),
        "summarize_latency_ms": result.get("summarize_latency_ms"),
    }