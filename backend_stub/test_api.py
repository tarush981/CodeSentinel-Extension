import requests
import json
import time

base_url = "http://localhost:8000"

req_data = {
    "code": "arr = []\nfor i in range(n):\n  arr.append(i * 2)\nmp = {}",
    "language": "python",
}

print("1. /analyze")
res_analyze = requests.post(f"{base_url}/analyze", json=req_data)
analysis = res_analyze.json()
print(json.dumps(analysis, indent=2))

if analysis.get("is_meaningful_dsa"):
    print("\n2. /generate_questions")
    quiz_req = {
        "code": req_data["code"],
        "features": analysis["features"],
        "language": "python",
        "recent_questions": ["What is O(n)?"],
        "personality": "genz"
    }
    t = time.time()
    res_quiz = requests.post(f"{base_url}/generate_questions", json=quiz_req)
    print(f"Time: {time.time() - t:.2f}s")
    questions_res = res_quiz.json()
    print(json.dumps(questions_res, indent=2))
    
    if questions_res.get("questions"):
        # simulate answering the first question
        q = questions_res["questions"][0]
        print("\n3. /validate")
        print(f"Question: {q}")
        val_req = {
            "user_answer": "It is O(n) loops.",
            "question": q,
            "features": analysis["features"],
            "code": req_data["code"],
            "personality": "genz"
        }
        res_val = requests.post(f"{base_url}/validate", json=val_req)
        print(json.dumps(res_val.json(), indent=2))
