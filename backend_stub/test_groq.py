import os
import json
from openai import OpenAI
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GROQ_API_KEY")
client = OpenAI(api_key=api_key, base_url="https://api.groq.com/openai/v1")

ANALYSIS_PROMPT = """You are an expert DSA mentor. Analyze the following code snippet.
1. Detect the primary Data Structure or Algorithm (DSA) concept being used.
2. Determine Time and Space Complexity.
3. Suggest one optimization or best practice.
4. Decide if this is a 'meaningful' DSA pattern (e.g., loops, recursion, Hash Maps, DP, etc.) that warrants a quiz.

Return ONLY valid JSON with keys: "concept", "pattern", "complexity", "spaceComplexity", "suggestion", "is_meaningful_dsa", "tip".

Code:
```python
def binary_search(arr, x):
    pass
```
"""

try:
    completion = client.chat.completions.create(
        model="llama3-8b-8192",
        messages=[{"role": "user", "content": ANALYSIS_PROMPT}],
        temperature=0.2,
        response_format={"type": "json_object"}
    )
    print("Groq response:")
    print(completion.choices[0].message.content)
except Exception as e:
    print(f"Error: {e}")
