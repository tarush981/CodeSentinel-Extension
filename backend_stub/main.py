import os
import re
import json
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Literal
from dotenv import load_dotenv
import google.generativeai as genai
from openai import OpenAI
from analyzer import analyze_code

load_dotenv()

app = FastAPI(title="Code Sentinal Socratic Mentor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# --- Models & Schema ---

class AnalyzeRequest(BaseModel):
    code: str
    language: Optional[str] = "python"
    fileName: Optional[str] = "snippet.py"

class AnalyzeResponse(BaseModel):
    features: List[str]
    concept: str
    confidence: float
    is_meaningful_dsa: bool = False

class SocraticRequest(BaseModel):
    code: str
    features: List[str]
    language: Optional[str] = "python"
    recent_questions: Optional[List[str]] = None
    personality: Optional[Literal["genz", "mentor", "interview"]] = "genz"

class SocraticResponse(BaseModel):
    questions: List[str]

class ValidateRequest(BaseModel):
    user_answer: str
    question: str
    code: str
    features: List[str]
    language: Optional[str] = "python"
    personality: Optional[Literal["genz", "mentor", "interview"]] = "genz"

class ValidateResponse(BaseModel):
    feedback: str

# --- AI Clients ---

def get_groq_client():
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key: return None
    return OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")

def get_gemini_client():
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key: return None
    genai.configure(api_key=api_key)
    return genai.GenerativeModel("gemini-1.5-flash")

# --- Prompts ---

SOCRATIC_PROMPT = """You are a simple, clear, beginner-friendly coding teacher. ({personality_tone})

LANGUAGE RULES — follow these strictly:
- Use simple, short sentences.
- Use easy, everyday words.
- Do NOT use slang, casual expressions, or regional phrases.
- Add exactly ONE emoji at the end of each question. Only use these: 🤔 💡 ⚡ ❓
- Be polite and encouraging.

Generate 2 to 4 very short, Socratic, open-ended questions based strictly on the decisions made in the code snippet.

Detected micro-features: {features}
Detected Language: {language}

Code snippet:
```
{code}
```

ANTI-REPETITION: Do NOT ask questions conceptually identical to these recent ones:
{recent_questions}

Requirements:
- Ask "WHY" the code is written this way (e.g. why a list instead of a set?).
- Ask "WHAT" happens if things change.
- Ask "HOW" efficient it is (complexity).
- LANGUAGE-AGNOSTIC: Do not ask about syntax. Ask about concepts (e.g. time complexity, data structure choice).
- Do NOT generate generic topics ("What is DFS?"). Focus tightly on the snippet itself.
- Return ONLY valid JSON matching this schema:
{{
  "questions": ["Question 1 🤔", "Question 2 ⚡"]
}}
"""

VALIDATE_PROMPT = """You are a simple, clear, beginner-friendly coding teacher. ({personality_tone})

LANGUAGE RULES — follow these strictly:
- Use simple, short sentences.
- Use easy, everyday words.
- Do NOT use slang, casual expressions, or regional phrases.
- Do NOT use emojis.
- Be polite, neutral, and encouraging.

Evaluate the user's natural language answer to your Socratic question.

Detected micro-features: {features}
Language: {language}

Code snippet:
```
{code}
```

Question Asked: {question}
User's Answer: {user_answer}

Task:
- Briefly validate if their reasoning or answer is correct.
- If they are completely correct, say so clearly (e.g. "Correct. Good job.").
- If they are partially correct or wrong, explain precisely WHY they are wrong based strictly on the code.
- Provide reasoning and a conceptual explanation concisely.
- Do NOT be overly wordy. Maintain a tight 2-3 sentence limit.

Return ONLY valid JSON matching this schema:
{{
  "feedback": "..."
}}
"""

TONES = {
    "genz": "Be a simple, beginner-friendly teacher.",
    "mentor": "Be a simple, beginner-friendly teacher.",
    "interview": "Be a simple, beginner-friendly teacher. Ask clear, direct questions."
}

def construct_recent_context(recent: List[str]) -> str:
    if not recent: return "None"
    return "\n".join([f"- {q}" for q in recent[-10:]])

# --- Endpoints ---

@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_endpoint(req: AnalyzeRequest):
    result = analyze_code(req.code, req.language)
    features = result.get("features", [])
    
    # Needs at least one conceptual structural decision to trigger the question flow.
    meaningful = len(features) > 0 and len([f for f in features if f not in ["function_def", "condition_compare", "indexing", "break_statement"]]) > 0
    
    return AnalyzeResponse(
        features=features,
        concept=result.get("concept", "generic"),
        confidence=result.get("confidence", 0.0),
        is_meaningful_dsa=meaningful
    )

@app.post("/generate_questions", response_model=SocraticResponse)
async def generate_questions(req: SocraticRequest):
    # Groq used strictly for FAST question generation
    client = get_groq_client()
    prompt = SOCRATIC_PROMPT.format(
        personality_tone=TONES.get(req.personality, TONES["genz"]),
        language=req.language or "Unknown",
        features=req.features,
        code=req.code[:1500],
        recent_questions=construct_recent_context(req.recent_questions)
    )
    
    if client:
        try:
            completion = client.chat.completions.create(
                model="llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.8,
                response_format={"type": "json_object"}
            )
            data = json.loads(completion.choices[0].message.content)
            return SocraticResponse(**data)
        except Exception as e:
            print(f"Groq question generation failed: {e}")
            
    # Fallback structure (should not hit unless Groq is out)
    return SocraticResponse(questions=["What is the time complexity of this code block?", "How could you optimize this?"])

@app.post("/validate", response_model=ValidateResponse)
async def validate_endpoint(req: ValidateRequest):
    # Gemini used strictly for REASONING and EXPLANATION mapping
    model = get_gemini_client()
    prompt = VALIDATE_PROMPT.format(
        personality_tone=TONES.get(req.personality, TONES["genz"]),
        language=req.language or "Unknown",
        features=req.features,
        code=req.code[:1500],
        question=req.question,
        user_answer=req.user_answer
    )
    
    if model:
        try:
            res = model.generate_content(prompt)
            data = json.loads(re.search(r'\{.*\}', res.text, re.DOTALL).group())
            return ValidateResponse(**data)
        except Exception as e:
            print(f"Gemini Validation error: {e}")
            
    # Fallback to Groq if Gemini fails
    client = get_groq_client()
    if client:
        try:
            completion = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.4,
                response_format={"type": "json_object"}
            )
            data = json.loads(completion.choices[0].message.content)
            return ValidateResponse(**data)
        except Exception:
            pass
            
    return ValidateResponse(feedback="Thanks for answering! Good to keep practicing your reasoning.")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
