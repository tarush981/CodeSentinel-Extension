import os
import google.generativeai as genai
from dotenv import load_dotenv

load_dotenv()

api_key = os.getenv("GOOGLE_API_KEY")
print("API Key loaded:", bool(api_key))
genai.configure(api_key=api_key)

model = genai.GenerativeModel("gemini-1.5-flash")

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
    response = model.generate_content(ANALYSIS_PROMPT)
    print("Raw text:")
    print(response.text)
except Exception as e:
    print(f"Error: {e}")
