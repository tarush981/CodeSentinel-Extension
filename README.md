# Code Sentinal VS Code Extension 🤖

> **Improve your DSA understanding while you code.**

Code Sentinal is not just a syntax checker—it is a **real-time, multi-language Socratic AI Mentor** living inside your VS Code. Instead of blindly pointing out errors or giving you the answers, it tracks your logic, recognizes your architectural decisions, and actively challenges your thinking with context-aware, open-ended questions.

---

## 💡 The Motive

Many developers write code without fully understanding why it works. Code Sentinal is built to change that.

It asks small, meaningful questions while you code:
👉 **Why** did you use a HashMap instead of an Array?
👉 **What** happens to your execution time if `n` scales to 1 million?
👉 **How** efficient is the `.append()` operation you just placed inside a loop?

Code Sentinal makes you articulate your reasoning, cementing fundamental computer science concepts as you type.

---

## 🏗️ How It Works (3-Layer System)

To make this feel like a blazing-fast, deterministic mentor rather than a laggy, hallucinating LLM wrapper, Code Sentinal uses a strict **3-Layer Hybrid Pipeline**:

### Layer 1: Code Analyzer (Fast & Local)
* Runs instantly (no AI delay)
* Detects loops, recursion, data structures, and patterns
* Works across Python, Java, and C++

### Layer 2: Question Generator (Groq AI)
* Generates simple, clear questions
* Based on your actual code
* Avoids repeating the same questions

### Layer 3: Answer Evaluation (Gemini / Groq)
* Checks your answer
* Gives clear feedback
* Explains mistakes in simple terms

---

## 🚀 Key Features

* ✅ Real-time code analysis inside VS Code
* ✅ Supports Python, Java, and C++
* ✅ Simple, easy-to-understand questions
* ✅ Helps improve DSA concepts step by step
* ✅ Non-intrusive popup system
* ✅ Works like a coding mentor

---

## 🧠 How It Helps

Code Sentinal does not give answers directly. It helps you:
* think about your code
* understand complexity
* choose better data structures
* improve problem-solving skills

---

## 🛠️ Getting Started

### 1. Backend Setup

```bash
cd backend_stub
pip install -r requirements.txt
```

Create a `.env` file:

```env
GOOGLE_API_KEY=your-gemini-key
GROQ_API_KEY=your-groq-key
```

Run backend:

```bash
uvicorn main:app --reload --port 8000
```

---

### 2. Extension Setup

```bash
npm install
npm run compile
```

Press **F5** to run the extension.

---

### 3. Try It

* Open a `.py`, `.java`, or `.cpp` file
* Write some code (loop, array, map, etc.)
* Wait a few seconds
* A question will appear automatically

---

## ⚙️ Configuration

You can tweak Code Sentinal in your VS Code Settings:
- `codesentinal.backendUrl` – Point to your local FastAPI server.
- `codesentinal.personality` – Set the mentor's tone.
- `codesentinal.quizCooldownSeconds` – Control how often you want to be interrupted.

---

## 🎯 Final Goal

Code Sentinal acts like:
👉 **A simple mentor sitting beside you while you code**

It helps you understand:
* why your code works
* how efficient it is
* how it can be improved

---

## 📦 Build & Package

To create extension file:

```bash
vsce package
```

Install manually using `.vsix` file.

---

## ⭐ Summary

Code Sentinal is not just a tool — it is a **learning companion** that helps you build strong DSA fundamentals while coding in real time.
