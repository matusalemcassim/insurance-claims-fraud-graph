import os
import anthropic
from app.services.scoring import get_claim_risk_score
from app.services.claims import get_claim


def _format_signals(signals: list[dict]) -> str:
    if not signals:
        return "No specific risk signals detected."
    return "\n".join(f"  - {s['signal']} (+{s['points']} pts)" for s in signals)


def _format_claim_context(claim_data: dict, score_data: dict) -> str:
    claim = claim_data.get("claim", {})
    links = claim_data.get("links", {})

    return f"""
CLAIM DETAILS:
- Claim ID: {claim.get('claim_id')}
- Claim Type: {claim.get('claim_type')}
- Claim Amount: ${claim.get('claim_amount', 0):,.2f}
- Incident Date: {claim.get('incident_date')}
- Filed Date: {claim.get('filed_date')}
- Days to File: {claim.get('days_to_file')}
- Submission Channel: {claim.get('submission_channel')}
- Status: {claim.get('status')}
- Fraud Scenario: {claim.get('fraud_scenario') or 'None'}
- Confirmed Fraud Label: {'Yes' if claim.get('label_is_fraud') == 1 else 'No'}

LINKED ENTITIES:
- Policyholder: {links.get('policyholder_id') or 'Unknown'}
- Bank Account: {links.get('bank_account_id') or 'None'}
- Adjuster: {links.get('adjuster_id') or 'None'}
- Provider: {links.get('provider_id') or 'None'}
- Vehicle: {links.get('vehicle_id') or 'None'}

FRAUD RISK SCORE: {score_data['score']}/100 — {score_data['risk_level']}

CONTRIBUTING SIGNALS:
{_format_signals(score_data.get('signals', []))}

CONTEXT:
- Bank account {score_data.get('bank_account_id')} is shared by {score_data.get('bank_claim_count', 0)} claims
- Adjuster {score_data.get('adjuster_id')} has handled {score_data.get('adjuster_claim_count', 0)} claims total
""".strip()


SYSTEM_PROMPT = """You are a senior insurance fraud investigator with 20 years of experience.
You are given structured data about an insurance claim and asked to write a concise investigator briefing.

Your briefing must:
1. Open with a one-sentence risk summary (e.g. "This claim presents strong/moderate/low indicators of fraud.")
2. Explain the most significant risk signals in plain language, connecting them to known fraud patterns
3. Note any contextual factors that increase or decrease suspicion
4. Close with a clear recommended action (e.g. "Recommend immediate investigation", "Flag for review", "Low priority")

Keep the briefing to 3-5 sentences. Write for a claims manager, not a data scientist.
Do not repeat raw numbers unnecessarily — focus on what the signals mean together.
Do not use bullet points — write in flowing paragraphs."""


def generate_claim_summary(claim_id: str) -> dict | None:
    """
    Fetch claim data + risk score, then call Claude to generate
    a natural language investigator briefing.
    """
    # Fetch claim data
    claim_data = get_claim(claim_id)
    if not claim_data:
        return None

    # Fetch risk score
    score_data = get_claim_risk_score(claim_id)
    if not score_data:
        return None

    # Build context string
    context = _format_claim_context(claim_data, score_data)

    # Call Claude
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    client = anthropic.Anthropic(api_key=api_key)

    message = client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=512,
        system=SYSTEM_PROMPT,
        messages=[
            {
                "role": "user",
                "content": f"Please write an investigator briefing for the following claim:\n\n{context}",
            }
        ],
    )

    briefing = message.content[0].text

    return {
        "claim_id":   claim_id,
        "risk_level": score_data["risk_level"],
        "score":      score_data["score"],
        "briefing":   briefing,
    }