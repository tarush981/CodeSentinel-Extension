import * as vscode from "vscode";
import axios from "axios";

type CodeSentinalPersonality = "genz" | "mentor" | "interview";
type CodeSentinalDifficulty = "beginner" | "intermediate" | "advanced";

interface CodeSentinalConfig {
  backendUrl: string;
  personality: CodeSentinalPersonality;
  difficulty: CodeSentinalDifficulty;
  debounceMs: number;
  enableStatusBar: boolean;
  quizCooldownSeconds: number;
  periodicQuestionIntervalSeconds: number;
  idleThresholdSeconds: number;
}

interface CodeSentinalAnalysisResponse {
  features: string[];
  concept: string;
  confidence: number;
  is_meaningful_dsa: boolean;
}

interface CodeSentinalSocraticResponse {
  questions: string[];
}

interface CodeSentinalValidateResponse {
  feedback: string;
}

let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel | undefined;

/** Max number of recent question texts to send to backend to avoid repeats */
const RECENT_QUESTIONS_MAX = 10;
/** Lines of context around cursor when extracting "active" code (or full function if detected) */
const CURSOR_CONTEXT_LINES = 45;

let extensionContext: vscode.ExtensionContext | undefined;

/** User chose "Disable questions for this session" — no prompts until restart */
let questionsDisabledForSession = false;
/** Last time a quiz question was shown (for cooldown between questions) */
let lastQuizPromptTime = 0;
/** 25-second countdown timer; reset on every code change */
let periodicQuestionTimer: ReturnType<typeof setTimeout> | undefined;

function getRecentQuestions(): string[] {
  if (!extensionContext) return [];
  const raw = extensionContext.globalState.get<string[]>("codesentinal.recentQuestions", []);
  return Array.isArray(raw) ? raw.slice(-RECENT_QUESTIONS_MAX) : [];
}

function pushRecentQuestion(question: string): void {
  if (!extensionContext || !question.trim()) return;
  const recent = getRecentQuestions();
  const next = [...recent.filter((q) => q !== question), question].slice(-RECENT_QUESTIONS_MAX);
  extensionContext.globalState.update("codesentinal.recentQuestions", next);
}

function log(msg: string) {
  if (!outputChannel) outputChannel = vscode.window.createOutputChannel("Code Sentinal");
  outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

function getConfig(): CodeSentinalConfig {
  const config = vscode.workspace.getConfiguration("codesentinal");
  return {
    backendUrl: config.get<string>("backendUrl", "http://localhost:8000/analyze"),
    personality: config.get<CodeSentinalPersonality>("personality", "genz"),
    difficulty: config.get<CodeSentinalDifficulty>("difficulty", "beginner"),
    debounceMs: config.get<number>("analysisDebounceMs", 2000),
    enableStatusBar: config.get<boolean>("enableStatusBar", true),
    quizCooldownSeconds: Math.max(25, Math.min(600, config.get<number>("quizCooldownSeconds", 25))),
    periodicQuestionIntervalSeconds: Math.max(25, Math.min(300, config.get<number>("periodicQuestionIntervalSeconds", 25))),
    idleThresholdSeconds: Math.max(25, Math.min(600, config.get<number>("idleThresholdSeconds", 60))),
  };
}

function ensureStatusBarItem(): vscode.StatusBarItem {
  if (!statusBarItem) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.text = "Code Sentinal: Click to analyze";
    statusBarItem.tooltip = "Click to analyze current file and get DSA feedback / quiz";
    statusBarItem.command = "codesentinal.analyzeNow";
    statusBarItem.show();
  }
  return statusBarItem;
}

/**
 * Get code context for analysis: cursor line (1-based) and a snippet focused around the cursor
 * (current function/block or a window of lines) so the backend can analyze relevant portion.
 */
function getCodeContext(editor: vscode.TextEditor): { code: string; cursorLine: number; codeSnippet: string } {
  const document = editor.document;
  const fullCode = document.getText();
  const cursorLine = editor.selection.active.line + 1; // 1-based for backend

  const lines = document.getText().split(/\r?\n/);
  const totalLines = lines.length;
  const cursorIndex = editor.selection.active.line;

  // Try to find function/block boundaries around cursor (common patterns)
  const languageId = document.languageId.toLowerCase();
  const isPy = languageId === "python";
  const isJs = /^(javascript|typescript|jsx|tsx)$/.test(languageId);
  const isJava = /^(java|kotlin)$/.test(languageId);
  const isCpp = /^(c|cpp|c\+\+)$/.test(languageId);

  let start = Math.max(0, cursorIndex - CURSOR_CONTEXT_LINES);
  let end = Math.min(totalLines, cursorIndex + CURSOR_CONTEXT_LINES + 1);

  if (isPy) {
    for (let i = cursorIndex; i >= 0; i--) {
      const t = lines[i].trim();
      if (t.startsWith("def ") || t.startsWith("class ") || (t && !t.startsWith("#") && t.endsWith(":"))) {
        start = i;
        break;
      }
    }
    for (let i = cursorIndex + 1; i < totalLines; i++) {
      const t = lines[i].trim();
      const indent = lines[i].search(/\S/);
      if (indent >= 0 && indent <= (lines[start].search(/\S/) || 0) && t && !t.startsWith("#")) {
        end = i;
        break;
      }
    }
  } else if (isJs || isJava || isCpp) {
    for (let i = cursorIndex; i >= 0; i--) {
      const t = lines[i].trim();
      if (/^(function|def|void|int|bool|string|const|let|var)\s+\w+\s*\(/.test(t) || /\{\s*$/.test(t) || /^\s*(public|private|protected)\s+/.test(t)) {
        start = i;
        break;
      }
    }
    let brace = 0;
    for (let i = start; i < totalLines; i++) {
      for (const c of lines[i]) {
        if (c === "{") brace++;
        else if (c === "}") brace--;
      }
      if (brace > 0 && i > cursorIndex) { end = i + 1; break; }
      if (brace === 0 && i > start) { end = i + 1; break; }
    }
  }

  const snippetLines = lines.slice(start, end);
  const codeSnippet = snippetLines.join("\n").trim() || fullCode.slice(0, 8000);

  return { code: fullCode, cursorLine, codeSnippet: codeSnippet.slice(0, 6000) };
}

/**
 * @param forceShowQuiz When true (e.g. user ran "Analyze current file now"), skip the "Want to try?" prompt and show the quiz directly.
 */
async function analyzeActiveDocument(forceShowQuiz = false) {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    if (forceShowQuiz) {
      // Called manually by user — show a helpful message
      vscode.window.showWarningMessage("Code Sentinal: Open a code file first.");
    }
    // Called by timer — silently skip
    return;
  }

  const document = editor.document;
  const fullCode = document.getText();
  if (!fullCode.trim()) {
    if (forceShowQuiz) {
      vscode.window.showWarningMessage("Code Sentinal: The current file is empty. Add some code first.");
    }
    return;
  }

  const { code, cursorLine, codeSnippet } = getCodeContext(editor);
  const recentQuestions = getRecentQuestions();

  const cfg = getConfig();
  log(`Analyzing ${document.fileName} (${document.languageId}) line ${cursorLine} → ${cfg.backendUrl}`);

  const status = ensureStatusBarItem();
  if (cfg.enableStatusBar) {
    status.text = "Code Sentinal: Analyzing…";
    status.show();
  }

  try {
    const response = await axios.post<CodeSentinalAnalysisResponse>(cfg.backendUrl, {
      code,
      language: document.languageId,
      fileName: document.fileName,
      difficulty: cfg.difficulty,
      cursorLine,
      codeSnippet: codeSnippet || undefined,
      recent_questions: recentQuestions.length > 0 ? recentQuestions : undefined,
      personality: cfg.personality,
    }, { timeout: 25000 }); // Increased timeout for AI reasoning

    const data = response.data || {};
    const features = data.features || [];
    const isMeaningfulPattern = data.is_meaningful_dsa || false;

    log(`Layer 1 response: features=[${features.join(", ")}], meaningful=${isMeaningfulPattern}`);

    if (cfg.enableStatusBar) {
      status.text = `Code Sentinal: Analyzing...`;
      status.show();
    }

    let userWantsQuiz = false;

    if (!isMeaningfulPattern) {
      log("Quiz skipped — no meaningful algorithm pattern detected.");
    } else if (questionsDisabledForSession) {
      log("Quiz skipped — questions disabled for this session.");
    } else {
      const cooldownMs = cfg.quizCooldownSeconds * 1000;
      const now = Date.now();
      if (!forceShowQuiz && now - lastQuizPromptTime < cooldownMs) {
        log(`Quiz prompt skipped — cooldown (${cfg.quizCooldownSeconds}s) not elapsed.`);
      } else {
        lastQuizPromptTime = now;
        userWantsQuiz = true;
      }
    }

    if (userWantsQuiz) {
      status.text = "Code Sentinal: Loading question...";

      const socraticRes = await axios.post<CodeSentinalSocraticResponse>(`${cfg.backendUrl.replace("/analyze", "")}/generate_questions`, {
        code,
        features,
        language: document.languageId,
        recent_questions: recentQuestions.length > 0 ? recentQuestions : undefined,
        personality: cfg.personality,
      }, { timeout: 25000 });

      const sData = socraticRes.data;
      if (sData && sData.questions && sData.questions.length > 0) {
        for (let i = 0; i < sData.questions.length; i++) {
          const q = sData.questions[i];
          pushRecentQuestion(q);

          // Step 1: Show the question as a notification with Answer / Skip / Disable
          const choice = await vscode.window.showInformationMessage(
            `Quick question 🤔\n${q}`,
            "Answer",
            "Skip",
            "Disable"
          );

          if (choice === "Disable") {
            questionsDisabledForSession = true;
            vscode.window.showInformationMessage("Code Sentinal: Questions are off for this session. Restart VS Code to re-enable.");
            break;
          }

          if (choice !== "Answer") {
            // User chose Skip or dismissed — move on
            break;
          }

          // Step 2: User chose Answer — open the input box
          status.text = "Code Sentinal: Waiting for your answer...";
          const userAnswer = await vscode.window.showInputBox({
            title: `Code Sentinal — Question ${i + 1} of ${sData.questions.length}`,
            prompt: q,
            placeHolder: "Type your answer here, or press Escape to skip...",
            ignoreFocusOut: true
          });

          if (!userAnswer) {
            break;
          }

          // Step 3: Validate answer
          status.text = "Code Sentinal: Checking your answer...";
          const valRes = await axios.post<CodeSentinalValidateResponse>(`${cfg.backendUrl.replace("/analyze", "")}/validate`, {
            user_answer: userAnswer,
            question: q,
            code: codeSnippet,
            features,
            language: document.languageId,
            personality: cfg.personality,
          }, { timeout: 15000 });

          if (i < sData.questions.length - 1) {
            const next = await vscode.window.showInformationMessage(
              `Code Sentinal 💡\n${valRes.data.feedback}`,
              "Next Question",
              "Stop"
            );
            if (next !== "Next Question") {
              break;
            }
          } else {
            vscode.window.showInformationMessage(`Code Sentinal 💡\n${valRes.data.feedback}`);
          }
        }
        status.text = "Code Sentinal: Ready";
      }
    } else if (forceShowQuiz && !isMeaningfulPattern) {
      vscode.window.showInformationMessage(
        "Code Sentinal: No algorithm patterns found here yet. Keep coding! 💻",
        "OK"
      );
    }

  } catch (err: any) {
    log(`Backend error: ${err?.message ?? err}`);
    if (cfg.enableStatusBar) {
      status.text = "Code Sentinal: Backend unreachable";
      status.show();
    }
    // Always notify so user knows why there are no quizzes/feedback
    const msg = axios.isAxiosError(err) && err.code === "ECONNREFUSED"
      ? `Code Sentinal: Backend not running. Start your FastAPI server at ${cfg.backendUrl.replace(/\/analyze.*$/, "")} to get analysis and quizzes.`
      : "Code Sentinal: Could not reach backend. Check that the FastAPI server is running at the URL in settings.";
    vscode.window.showWarningMessage(msg, "Open settings").then((choice) => {
      if (choice === "Open settings") {
        vscode.commands.executeCommand("workbench.action.openSettings", "codesentinal.backendUrl");
      }
    });
  }
}

function scheduleQuestionTimer() {
  // Reset the 25-second countdown every time the user types.
  // The question fires once after the user has paused for 25 seconds.
  if (periodicQuestionTimer) {
    clearTimeout(periodicQuestionTimer);
  }
  const cfg = getConfig();
  periodicQuestionTimer = setTimeout(async () => {
    if (questionsDisabledForSession) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor?.document.getText().trim()) return;
    // Fire the question, then restart the countdown
    await analyzeActiveDocument(true);
    scheduleQuestionTimer();
  }, cfg.periodicQuestionIntervalSeconds * 1000);
}

function createOrRevealPanel(context: vscode.ExtensionContext) {
  const panel = vscode.window.createWebviewPanel(
    "codeSentinalPanel",
    "Code Sentinal",
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
    }
  );

  const cfg = getConfig();

  panel.webview.html = getWebviewHtml(cfg);
}

function getWebviewHtml(cfg: CodeSentinalConfig): string {
  const personalityLabel =
    cfg.personality === "genz"
      ? "Gen-Z"
      : cfg.personality === "mentor"
        ? "Mentor"
        : "Interview";

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Code Sentinal</title>
    <style>
      body {
        margin: 0;
        padding: 0;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0b1020;
        color: #f5f5f5;
      }
      .container {
        padding: 16px 20px;
      }
      .header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 16px;
      }
      .title {
        font-size: 18px;
        font-weight: 600;
      }
      .badge-row {
        display: flex;
        gap: 8px;
        font-size: 11px;
      }
      .badge {
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.15);
        background: rgba(255, 255, 255, 0.03);
      }
      .card {
        border-radius: 12px;
        padding: 12px 14px;
        background: radial-gradient(circle at top left, #20264b, #0b1020);
        border: 1px solid rgba(255, 255, 255, 0.06);
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
        margin-bottom: 12px;
      }
      .card-label {
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        color: rgba(255, 255, 255, 0.6);
        margin-bottom: 6px;
      }
      .card-main {
        display: flex;
        justify-content: space-between;
        align-items: center;
      }
      .card-main strong {
        font-size: 13px;
      }
      .hint {
        font-size: 12px;
        color: rgba(255, 255, 255, 0.7);
      }
      .metric-row {
        display: flex;
        gap: 8px;
        font-size: 12px;
        margin-top: 4px;
      }
      .metric-pill {
        padding: 2px 8px;
        border-radius: 999px;
        background: rgba(0, 255, 163, 0.1);
        border: 1px solid rgba(0, 255, 163, 0.2);
        color: #a9ffdd;
      }
      .footer {
        margin-top: 14px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.5);
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="title">Code Sentinal</div>
        <div class="badge-row">
          <div class="badge">${personalityLabel} mode</div>
          <div class="badge">${cfg.difficulty} level</div>
        </div>
      </div>

      <div class="card">
        <div class="card-label">Status</div>
        <div class="card-main">
          <div>
            <strong>Real-time DSA mentor running</strong>
            <div class="hint">
              Edit a file with algorithms to see live feedback in popups and the status bar.
            </div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-label">What Code Sentinal watches for</div>
        <div class="metric-row">
          <div class="metric-pill">Nested loops</div>
          <div class="metric-pill">Recursion</div>
        </div>
        <div class="metric-row">
          <div class="metric-pill">Hash maps</div>
          <div class="metric-pill">Binary search</div>
        </div>
        <div class="metric-row">
          <div class="metric-pill">Sliding window</div>
          <div class="metric-pill">Dynamic programming</div>
        </div>
      </div>

      <div class="footer">
        Tips:
        <br />• Adjust personality & difficulty in VS Code settings (search for "Code Sentinal").
        <br />• Ensure your FastAPI backend is running at the configured URL.
      </div>
    </div>
  </body>
</html>`;
}

export function activate(context: vscode.ExtensionContext) {
  console.log("Code Sentinal activated");

  const cfg = getConfig();
  if (cfg.enableStatusBar) {
    ensureStatusBarItem();
  }

  const changeSubscription = vscode.workspace.onDidChangeTextDocument(() => {
    scheduleQuestionTimer(); // Reset 25-second timer on every code change
  });

  const activeEditorSubscription = vscode.window.onDidChangeActiveTextEditor(() => {
    scheduleQuestionTimer();
  });

  const openDocSubscription = vscode.workspace.onDidOpenTextDocument((doc) => {
    if (doc.languageId && doc.getText().trim()) scheduleQuestionTimer();
  });

  const openPanelCommand = vscode.commands.registerCommand("codesentinal.openPanel", () => {
    createOrRevealPanel(context);
  });

  const analyzeNowCommand = vscode.commands.registerCommand("codesentinal.analyzeNow", () => {
    if (periodicQuestionTimer) {
      clearTimeout(periodicQuestionTimer);
      periodicQuestionTimer = undefined;
    }
    analyzeActiveDocument(true);
  });

  extensionContext = context;

  // No separate periodic timer needed — scheduleQuestionTimer() resets itself after each question.
  // It is started automatically on the first code change via onDidChangeTextDocument.

  context.subscriptions.push(
    changeSubscription,
    activeEditorSubscription,
    openDocSubscription,
    openPanelCommand,
    analyzeNowCommand,
    {
      dispose() {
        if (periodicQuestionTimer) {
          clearTimeout(periodicQuestionTimer);
          periodicQuestionTimer = undefined;
        }
      },
    }
  );
}

export function deactivate() {
  if (statusBarItem) {
    statusBarItem.dispose();
    statusBarItem = undefined;
  }
  if (periodicQuestionTimer) {
    clearTimeout(periodicQuestionTimer);
    periodicQuestionTimer = undefined;
  }
  outputChannel = undefined;
}

