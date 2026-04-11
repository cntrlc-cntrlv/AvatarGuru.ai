import { useState, useRef, useCallback, useEffect } from "react";
import { useSearchParams, useNavigate, useParams } from "react-router-dom";
import {
  Upload,
  CheckCircle,
  MessageCircle,
  BookOpen,
  FileText,
  RotateCcw,
  ArrowLeft,
  Home,
  XCircle,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  apiService,
  UploadResponse,
  QAResponse,
  ReferenceLink,
  ProcessingStatus,
  AssessmentQuestion,
  AssessmentFeedback,
  ExplanationBatch,
} from "@/lib/api";
import ReactMarkdown from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import remarkGfm from "remark-gfm";
import "katex/dist/katex.min.css";
import { Mic, Square } from "lucide-react";
import AvatarCanvas from "@/components/avatar/AvatarCanvas";

type AssessmentState = "welcome" | "question" | "answer" | "feedback";

function base64ToAudioUrl(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

// Helper to fix LaTeX delimiters for ReactMarkdown/RemarkMath
const preprocessLaTeX = (content: string) => {
  if (!content) return "";

  // Replace \[ ... \] with $$ ... $$
  // Replace \( ... \) with $ ... $
  let processed = content
    .replace(/\\\[/g, "$$$")
    .replace(/\\\]/g, "$$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");

  // Heuristic for math in parentheses e.g. (x = y) -> $x = y$
  // Only if it contains backslashes or equals and isn't already wrapped
  processed = processed
    .replace(/\(([^)\n$]*\\[^)\n$]*)\)/g, "$$$1$$")
    .replace(/\(([^)\n$]*=[^)\n$]*)\)/g, "$$$1$$");

  return processed;
};

const AssessmentTab = ({
  handleTabChange,
  navigate,
}: {
  handleTabChange: (tab: "upload" | "learning" | "assessment") => void;
  navigate: (path: string | number) => void;
}) => {
  const [currentState, setCurrentState] = useState<AssessmentState>("welcome");
  const [question, setQuestion] = useState<string>("");
  const [userAnswer, setUserAnswer] = useState<string>("");
  const [feedback, setFeedback] = useState<string>("");
  // State for MCQ
  const [mcqData, setMcqData] = useState<{
    question: string;
    options: { key: string; text: string }[];
    correctAnswer: string;
    explanation: string;
    hint: string;
  } | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [showExplanation, setShowExplanation] = useState(false);

  // State for Text/Audio
  const [isLoading, setIsLoading] = useState(false); // Used for submission
  const [generatingType, setGeneratingType] = useState<
    "theoretical" | "mcq" | null
  >(null); // Track which button is loading
  const [error, setError] = useState<string>("");
  const [score, setScore] = useState<number | null>(null); // 0-100 from backend
  const [fileName, setFileName] = useState<string>(""); // active file name

  // Parse MCQ text
  const parseMCQ = (text: string) => {
    try {
      // Regex to allow optional "Question:" prefix and be case-insensitive/flexible
      const questionMatch = text.match(/^(?:Question:\s*)?(.*?)(?=\s*A\))/is);
      const optionsMatch = text.match(
        /A\)\s*(.*?)\s*B\)\s*(.*?)\s*C\)\s*(.*?)\s*D\)\s*(.*?)(?=\s*(?:Correct Answer:|Answer:))/is,
      );
      const correctMatch = text.match(
        /(?:Correct Answer:|Answer:)\s*(.*?)(?=\s*Explanation:)/is,
      );
      const explanationMatch = text.match(
        /Explanation:\s*(.*?)(?=\s*Hint:|$)/is,
      );
      const hintMatch = text.match(/Hint:\s*(.*)/is);

      if (questionMatch && optionsMatch && correctMatch) {
        return {
          question: questionMatch[1].trim(),
          options: [
            { key: "A", text: optionsMatch[1].trim() },
            { key: "B", text: optionsMatch[2].trim() },
            { key: "C", text: optionsMatch[3].trim() },
            { key: "D", text: optionsMatch[4].trim() },
          ],
          // Normalize answer to just the letter (e.g. "Option D" -> "D", "D." -> "D")
          correctAnswer: correctMatch[1]
            .trim()
            .replace(/^Option\s+/, "")
            .replace(/\.$/, "")
            .toUpperCase(),
          explanation: explanationMatch ? explanationMatch[1].trim() : "",
          hint: hintMatch ? hintMatch[1].trim() : "",
        };
      }
      return null;
    } catch (e) {
      console.error("Failed to parse MCQ", e);
      return null;
    }
  };

  const generateQuestion = async (type: "theoretical" | "mcq") => {
    setGeneratingType(type);
    setError("");
    setScore(null);
    // Reset MCQ state
    setMcqData(null);
    setSelectedOption(null);
    setShowHint(false);
    setIsCorrect(null);
    setShowExplanation(false);

    // Resolve active fileName from the latest batches response if not set
    let activeFile = fileName;
    if (!activeFile) {
      try {
        const batchRes = await apiService.getBatches();
        activeFile = batchRes.fileName || "";
        setFileName(activeFile);
      } catch (_) {}
    }

    try {
      const response: AssessmentQuestion =
        await apiService.generateAssessment(type, activeFile || undefined);

      if (type === "mcq") {
        const parsed = parseMCQ(response.question);
        if (parsed) {
          setMcqData(parsed);
          setQuestion(parsed.question); // Fallback / Display
        } else {
          setQuestion(response.question);
        }
      } else {
        setQuestion(response.question);
      }

      setCurrentState("question");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate question",
      );
    } finally {
      setGeneratingType(null);
    }
  };

  const submitAnswer = async () => {
    if (!userAnswer.trim()) {
      setError("Please enter an answer before submitting");
      return;
    }

    setIsLoading(true);
    setError("");
    try {
      const response: AssessmentFeedback = await apiService.submitAssessment(
        question,
        userAnswer,
        fileName || undefined,
      );
      setFeedback(response.feedback);
      setScore(response.score ?? null);
      setCurrentState("feedback");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      setIsLoading(false);
    }
  };

  const resetAssessment = () => {
    setQuestion("");
    setUserAnswer("");
    setFeedback("");
    setError("");
    setScore(null);
    setCurrentState("welcome");
  };

  const startAnswering = () => {
    setCurrentState("answer");
  };

  return (
    <div className="h-full w-full flex flex-col min-h-0">
      <div className="flex-1 flex min-h-0">
        {/* Left Sidebar */}
        <div className="w-20 bg-gray-100 flex flex-col items-center py-4 gap-3">
          <button
            onClick={() => handleTabChange("upload")}
            className="w-12 h-12 rounded-lg flex items-center justify-center transition-colors bg-gray-200 text-gray-600 hover:bg-gray-300"
            title="Upload Documents"
          >
            <Upload className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleTabChange("learning")}
            className="w-12 h-12 rounded-lg flex items-center justify-center transition-colors bg-gray-200 text-gray-600 hover:bg-gray-300"
            title="Learning Hub"
          >
            <BookOpen className="w-5 h-5" />
          </button>
          {/* <button 
            onClick={() => setActiveTab("qa")}
            className="w-12 h-12 rounded-lg flex items-center justify-center transition-colors bg-gray-200 text-gray-600 hover:bg-gray-300"
            title="Q&A Assistant"
          >
            <MessageCircle className="w-5 h-5" />
          </button> */}
          <button
            onClick={() => handleTabChange("assessment")}
            className="w-12 h-12 rounded-lg flex items-center justify-center transition-colors bg-indigo-100 text-indigo-600"
            title="Assessment"
          >
            <FileText className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-8 overflow-y-auto min-h-0 hide-scrollbar">
          <div className="max-w-4xl mx-auto">
            {/* Error Display */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
                <div className="flex items-center gap-2">
                  <span className="text-red-600">❌</span>
                  <p className="text-red-800 font-medium">Error</p>
                </div>
                <p className="text-red-700 mt-1">{error}</p>
              </div>
            )}

            {/* Welcome State */}
            {currentState === "welcome" && (
              <div className="bg-white rounded-xl shadow-lg p-8">
                <div className="text-center">
                  <div className="w-20 h-20 bg-indigo-100 rounded-full flex items-center justify-center mx-auto mb-6">
                    <FileText size={40} className="text-indigo-600" />
                  </div>
                  <h2 className="text-3xl font-bold text-gray-800 mb-4">
                    Ready for Assessment?
                  </h2>
                  <p className="text-lg text-gray-600 mb-8 max-w-2xl mx-auto">
                    Test your understanding with AI-generated questions based on
                    your latest uploaded document. Get personalized feedback and
                    improve your learning.
                  </p>

                  <div className="space-y-4">
                    <div className="flex gap-4 max-w-2xl mx-auto">
                      <button
                        onClick={() => generateQuestion("theoretical")}
                        disabled={generatingType !== null}
                        className="flex-1 px-6 py-4 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {generatingType === "theoretical" ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Generating...
                          </>
                        ) : (
                          <>
                            <FileText size={20} />
                            Generate Theoretical Question
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => generateQuestion("mcq")}
                        disabled={generatingType !== null}
                        className="flex-1 px-6 py-4 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                      >
                        {generatingType === "mcq" ? (
                          <>
                            <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                            Generating...
                          </>
                        ) : (
                          <>
                            <CheckCircle size={20} />
                            Generate MCQ
                          </>
                        )}
                      </button>
                    </div>

                    <p className="text-sm text-gray-500">
                      Questions are generated from your most recently uploaded
                      document
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Assessment Tab */}
            {currentState !== "welcome" &&
              (() => {
                // Helper to improve LaTeX rendering and clean artifacts
                // Helper to improve LaTeX rendering and clean artifacts
                const formatContent = (content: string) => {
                  if (!content) return "";
                  // Remove leading/trailing artifacts like "**", "Question:", "Hint:"
                  // Also remove trailing ** which sometimes appears
                  let clean = content
                    .replace(
                      /^\s*(\*\*|Question:|Hint:|Explanation:|\*\*Question:)\s*/i,
                      "",
                    )
                    .replace(/\*\*\s*$/, "") // Remove trailing **
                    .replace(/^\*\*/, "") // Remove leading **
                    .replace(/\*\*/g, ""); // Remove ALL ** if user wants them gone from math. But usually bold is fine.
                  // User complained about "2 stars", likely artifacts. Safe to remove bolding markers for cleaner math if they are interfering.

                  // Fix LaTeX delimiters for ReactMarkdown/RemarkMath
                  // \[ ... \] -> $$ ... $$
                  // \( ... \) -> $ ... $
                  clean = clean
                    .replace(/\\\[/g, "$$$")
                    .replace(/\\\]/g, "$$$")
                    .replace(/\\\(/g, "$")
                    .replace(/\\\)/g, "$");

                  // Heuristic for (Q = ...) -> $(Q = ...)$ from previous logic
                  clean = clean
                    .replace(/\(([^)\n]*\\[^)\n]*)\)/g, "$$$1$$")
                    .replace(/\(([^)\n]*=[^)\n]*)\)/g, "$$$1$$");

                  return clean;
                };

                return (
                  <>
                    {/* Question State */}
                    {currentState === "question" && (
                      <div className="bg-white rounded-xl shadow-lg p-8">
                        <div className="mb-6">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold">
                              1
                            </div>
                            <h2 className="text-xl font-semibold text-gray-800">
                              Generated Question
                            </h2>
                          </div>

                          <div className="bg-gray-50 rounded-lg p-6 border-l-4 border-indigo-500">
                            <div className="text-lg text-gray-800 leading-relaxed prose prose-indigo max-w-none">
                              <div className="response-container">
                                <ReactMarkdown
                                  remarkPlugins={[remarkMath, remarkGfm]}
                                  rehypePlugins={[rehypeKatex]}
                                >
                                  {formatContent(question)}
                                </ReactMarkdown>
                              </div>
                            </div>
                          </div>

                          {/* MCQ Logic */}
                          {mcqData ? (
                            <div className="mt-6 space-y-4">
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                {mcqData.options.map((opt) => (
                                  <button
                                    key={opt.key}
                                    onClick={() => {
                                      setSelectedOption(opt.key);
                                      const correct =
                                        opt.key ===
                                          mcqData.correctAnswer.charAt(0) ||
                                        mcqData.correctAnswer.includes(opt.key); // Loose match
                                      setIsCorrect(correct);
                                      setShowExplanation(!correct); // Show explanation if wrong
                                    }}
                                    disabled={isCorrect === true}
                                    className={`p-4 rounded-xl border-2 text-left transition-all ${
                                      selectedOption === opt.key
                                        ? isCorrect
                                          ? "border-green-500 bg-green-50 text-green-900"
                                          : "border-red-500 bg-red-50 text-red-900"
                                        : "border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 text-gray-700"
                                    }`}
                                  >
                                    <span className="font-bold mr-2 text-lg align-top">
                                      {opt.key})
                                    </span>
                                    <div className="inline-block prose prose-sm max-w-none">
                                      <ReactMarkdown
                                        remarkPlugins={[remarkMath, remarkGfm]}
                                        rehypePlugins={[rehypeKatex]}
                                      >
                                        {formatContent(opt.text)}
                                      </ReactMarkdown>
                                    </div>
                                  </button>
                                ))}
                              </div>

                              <div className="flex items-center justify-between mt-4">
                                {mcqData.hint && (
                                  <div className="flex gap-2">
                                    <button
                                      onClick={() => setShowHint(!showHint)}
                                      className="text-sm font-medium text-indigo-600 hover:text-indigo-800 flex items-center gap-1"
                                    >
                                      {showHint ? (
                                        <EyeOff size={16} />
                                      ) : (
                                        <Eye size={16} />
                                      )}
                                      {showHint ? "Hide Hint" : "Need a Hint?"}
                                    </button>
                                  </div>
                                )}
                              </div>

                              {showHint && (
                                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-yellow-800 text-sm">
                                  <strong>Hint:</strong>
                                  <div className="mt-1 prose prose-sm max-w-none text-yellow-900">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkMath, remarkGfm]}
                                      rehypePlugins={[rehypeKatex]}
                                    >
                                      {formatContent(mcqData.hint)}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              )}

                              {selectedOption && (
                                <div
                                  className={`p-4 rounded-lg border flex items-start gap-3 ${isCorrect ? "bg-green-100 border-green-200" : "bg-red-50 border-red-200"}`}
                                >
                                  {isCorrect ? (
                                    <CheckCircle className="text-green-600 shrink-0 mt-1" />
                                  ) : (
                                    <XCircle className="text-red-600 shrink-0 mt-1" />
                                  )}
                                  <div className="w-full">
                                    <p
                                      className={`font-semibold ${isCorrect ? "text-green-800" : "text-red-800"}`}
                                    >
                                      {isCorrect
                                        ? "Correct Answer!"
                                        : "Incorrect"}
                                    </p>
                                    {!isCorrect && showExplanation && (
                                      <div className="text-red-800 mt-2 text-sm">
                                        <strong>Explanation:</strong>
                                        <div className="mt-1 prose prose-sm max-w-none text-red-900">
                                          <ReactMarkdown
                                            remarkPlugins={[
                                              remarkMath,
                                              remarkGfm,
                                            ]}
                                            rehypePlugins={[rehypeKatex]}
                                          >
                                            {formatContent(mcqData.explanation)}
                                          </ReactMarkdown>
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}

                              <div className="mt-4 flex justify-end">
                                <button
                                  onClick={() => generateQuestion("mcq")}
                                  disabled={generatingType === "mcq"}
                                  className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors flex items-center gap-2"
                                >
                                  {generatingType === "mcq" ? (
                                    <div className="w-5 h-5 border-2 border-gray-600 border-t-transparent rounded-full animate-spin"></div>
                                  ) : (
                                    <RotateCcw size={20} />
                                  )}
                                  New Question
                                </button>
                              </div>
                            </div>
                          ) : (
                            // Standard Theoretical UI Buttons
                            <div className="flex gap-4">
                              <button
                                onClick={startAnswering}
                                className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2"
                              >
                                <CheckCircle size={20} />
                                Start Answering
                              </button>
                              <button
                                onClick={resetAssessment}
                                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors flex items-center gap-2"
                              >
                                <RotateCcw size={20} />
                                New Question
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Answer State */}
                    {currentState === "answer" && (
                      <div className="bg-white rounded-xl shadow-lg p-8">
                        <div className="mb-6">
                          <div className="flex items-center gap-2 mb-4">
                            <div className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center font-bold">
                              2
                            </div>
                            <h2 className="text-xl font-semibold text-gray-800">
                              Your Answer
                            </h2>
                          </div>

                          <div className="bg-gray-50 rounded-lg p-4 mb-6 border-l-4 border-indigo-500">
                            <p className="text-sm text-gray-600 mb-2">
                              Question:
                            </p>
                            <div className="text-gray-800 prose prose-sm max-w-none">
                              <div className="response-container">
                                <ReactMarkdown
                                  remarkPlugins={[remarkMath, remarkGfm]}
                                  rehypePlugins={[rehypeKatex]}
                                >
                                  {formatContent(question)}
                                </ReactMarkdown>
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <label className="block">
                              <span className="text-sm font-medium text-gray-700 mb-2 block">
                                Your Answer:
                              </span>
                              <textarea
                                value={userAnswer}
                                onChange={(e) => setUserAnswer(e.target.value)}
                                placeholder="Type your answer here..."
                                className="w-full p-4 border border-gray-300 rounded-lg text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                                rows={6}
                              />
                            </label>
                          </div>
                        </div>

                        <div className="flex gap-4">
                          <button
                            onClick={submitAnswer}
                            disabled={isLoading || !userAnswer.trim()}
                            className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {isLoading ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                Submitting...
                              </>
                            ) : (
                              <>
                                <CheckCircle size={20} />
                                Submit Answer
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => setCurrentState("question")}
                            className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                          >
                            Back to Question
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Feedback State */}
                    {currentState === "feedback" &&
                      (() => {
                        // Score-based colour: >=80 green, 50-79 yellow, <50 red
                        const getStatusFromScore = (
                          s: number | null,
                          text: string,
                        ): "correct" | "partial" | "incorrect" => {
                          if (s !== null) {
                            if (s >= 80) return "correct";
                            if (s >= 50) return "partial";
                            return "incorrect";
                          }
                          // Fallback: parse text when score is unavailable
                          const lower = text.toLowerCase();
                          if (lower.includes("partially correct")) return "partial";
                          if (lower.includes("incorrect")) return "incorrect";
                          if (lower.includes("correct")) return "correct";
                          return "partial";
                        };

                        const status = getStatusFromScore(score, feedback);

                        const statusStyles = {
                          correct: {
                            bg: "bg-green-50",
                            border: "border-green-500",
                            icon: (
                              <CheckCircle
                                size={24}
                                className="text-green-600 mt-1"
                              />
                            ),
                            title: "text-green-800",
                          },
                          incorrect: {
                            bg: "bg-red-50",
                            border: "border-red-500",
                            icon: (
                              <XCircle
                                size={24}
                                className="text-red-600 mt-1"
                              />
                            ),
                            title: "text-red-800",
                          },
                          partial: {
                            bg: "bg-yellow-50",
                            border: "border-yellow-500",
                            icon: (
                              <CheckCircle
                                size={24}
                                className="text-yellow-600 mt-1"
                              />
                            ),
                            title: "text-yellow-800",
                          },
                        };

                        const currentStyle = statusStyles[status];

                        return (
                          <div className="bg-white rounded-xl shadow-lg p-8">
                            <div className="mb-6">
                              <div className="flex items-center gap-2 mb-4">
                                <div
                                  className={`w-8 h-8 ${status === "incorrect" ? "bg-red-600" : "bg-green-600"} text-white rounded-full flex items-center justify-center font-bold`}
                                >
                                  3
                                </div>
                                <h2 className="text-xl font-semibold text-gray-800">
                                  Assessment Feedback
                                </h2>
                              </div>

                              <div className="bg-gray-50 rounded-lg p-4 mb-6 border-l-4 border-indigo-500">
                                <p className="text-sm text-gray-600 mb-2">
                                  Question:
                                </p>
                                <div className="text-gray-800 mb-4 prose prose-sm max-w-none">
                                  <div className="response-container">
                                    <ReactMarkdown
                                      remarkPlugins={[remarkMath, remarkGfm]}
                                      rehypePlugins={[rehypeKatex]}
                                    >
                                      {formatContent(question)}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                                <p className="text-sm text-gray-600 mb-2">
                                  Your Answer:
                                </p>
                                <p className="text-gray-800">{userAnswer}</p>
                              </div>

                              <div
                                className={`${currentStyle.bg} rounded-lg p-6 border-l-4 ${currentStyle.border}`}
                              >
                                <div className="flex items-start gap-3 mb-4">
                                  {currentStyle.icon}
                                  <h3
                                    className={`text-lg font-semibold ${currentStyle.title}`}
                                  >
                                    AI Tutor Feedback
                                  </h3>
                                  {score !== null && (
                                    <span
                                      className={`ml-auto text-sm font-bold px-3 py-1 rounded-full ${
                                        status === "correct"
                                          ? "bg-green-200 text-green-800"
                                          : status === "partial"
                                            ? "bg-yellow-200 text-yellow-800"
                                            : "bg-red-200 text-red-800"
                                      }`}
                                    >
                                      Score: {score}/100
                                    </span>
                                  )}
                                </div>
                                <div className="prose prose-sm max-w-none text-gray-800 leading-relaxed">
                                  <div
                                    className={`response-container ${status}`}
                                  >
                                    <ReactMarkdown
                                      remarkPlugins={[remarkMath, remarkGfm]}
                                      rehypePlugins={[rehypeKatex]}
                                    >
                                      {formatContent(feedback)}
                                    </ReactMarkdown>
                                  </div>
                                </div>
                              </div>
                            </div>

                            <div className="flex gap-4">
                              <button
                                onClick={resetAssessment}
                                className="px-6 py-3 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center gap-2"
                              >
                                <RotateCcw size={20} />
                                New Assessment
                              </button>
                              <button
                                onClick={() => setCurrentState("answer")}
                                className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg font-semibold hover:bg-gray-50 transition-colors"
                              >
                                Try Again
                              </button>
                            </div>
                          </div>
                        );
                      })()}
                  </>
                );
              })()}
          </div>
        </div>
      </div>
    </div>
  );
};

export function StudyPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { fileId } = useParams<{ fileId: string }>();

  const [activeTab, setActiveTab] = useState<
    "upload" | "learning" | "assessment"
  >(fileId ? "learning" : "upload");
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    [key: string]: number;
  }>({});
  const [processingStatus, setProcessingStatus] = useState<{
    [key: string]: ProcessingStatus;
  }>({});
  const [successMessages, setSuccessMessages] = useState<{
    [key: string]: boolean;
  }>({});
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Resize functionality
  const [sectionWidths, setSectionWidths] = useState([33.33, 33.33, 33.34]); // Video, AI Tutor, AI Summary
  const [isResizing, setIsResizing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [backendConnected, setBackendConnected] = useState<boolean | null>(
    null,
  );

  // Handle URL parameters for tab selection
  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab && ["upload", "learning", "assessment"].includes(tab)) {
      setActiveTab(tab as "upload" | "learning" | "assessment");
    } else if (fileId) {
      setActiveTab("learning");
    }
  }, [searchParams, fileId]);

  // Clear cache when switching to learning tab to ensure fresh data
  const handleTabChange = (tab: "upload" | "learning" | "assessment") => {
    if (tab === "learning") {
      // Clear cache when switching to learning tab to get fresh data
      localStorage.removeItem("avatarguru_summary_text");
      localStorage.removeItem("avatarguru_text_timestamp");
      localStorage.removeItem("avatarguru_reference_links");
      localStorage.removeItem("avatarguru_links_timestamp");
      console.log("🗑️ Cleared cache when switching to Learning tab");
    }
    setActiveTab(tab);
  };

  // Test backend connection on component mount
  useEffect(() => {
    const testConnection = async () => {
      try {
        const connected = await apiService.testConnection();
        setBackendConnected(connected);
        if (connected) {
          console.log("✅ Backend connection successful");
        } else {
          console.log("❌ Backend connection failed");
        }
      } catch (error) {
        console.error("❌ Backend connection test failed:", error);
        setBackendConnected(false);
      }
    };

    testConnection();
  }, []);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    processFiles(droppedFiles);
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const selectedFiles = Array.from(e.target.files);
      await processFiles(selectedFiles);
    }
  };

  const processFiles = async (newFiles: File[]) => {
    const validFiles = newFiles.filter((file) => {
      if (!file.type.includes("pdf") && !file.name.endsWith(".pdf")) {
        return false;
      }
      if (file.size > 50 * 1024 * 1024) {
        return false;
      }
      return true;
    });

    if (validFiles.length > 0) {
      setFiles((prev) => [...prev, ...validFiles]);

      for (const file of validFiles) {
        try {
          // Show upload progress
          setUploadProgress((prev) => ({ ...prev, [file.name]: 0 }));

          // Simulate progress
          const progressInterval = setInterval(() => {
            setUploadProgress((prev) => {
              const current = prev[file.name] || 0;
              if (current >= 90) {
                clearInterval(progressInterval);
                return { ...prev, [file.name]: 90 };
              }
              return { ...prev, [file.name]: current + 10 };
            });
          }, 200);

          // Upload to backend
          const response: UploadResponse = await apiService.uploadFile(file);

          // Complete progress
          setUploadProgress((prev) => ({ ...prev, [file.name]: 100 }));

          console.log("Upload successful:", response);

          // Clear cache when new document is uploaded
          localStorage.removeItem("avatarguru_summary_text");
          localStorage.removeItem("avatarguru_text_timestamp");
          localStorage.removeItem("avatarguru_reference_links");
          localStorage.removeItem("avatarguru_links_timestamp");
          localStorage.removeItem("avatarguru_available_files");
          localStorage.removeItem("avatarguru_files_timestamp");
          console.log("🗑️ Cleared cache for new document upload");

          // Start polling for processing status
          if (response.filename) {
            setProcessingStatus((prev) => ({
              ...prev,
              [file.name]: {
                status: "processing",
                message: "Processing started...",
              },
            }));
            pollProcessingStatus(response.filename);
          }
        } catch (error) {
          console.error("Upload failed:", error);
          // Handle error (show toast, etc.)
          setUploadProgress((prev) => ({ ...prev, [file.name]: 0 }));
        }
      }
    }
  };

  const simulateUpload = (file: File) => {
    const fileName = file.name;
    setUploadProgress((prev) => ({ ...prev, [fileName]: 0 }));

    const interval = setInterval(() => {
      setUploadProgress((prev) => {
        const current = prev[fileName] || 0;
        if (current >= 100) {
          clearInterval(interval);
          return { ...prev, [fileName]: 100 };
        }
        return { ...prev, [fileName]: current + 10 };
      });
    }, 200);
  };

  const removeFile = (fileName: string) => {
    setFiles((prev) => prev.filter((file) => file.name !== fileName));
    setUploadProgress((prev) => {
      const updated = { ...prev };
      delete updated[fileName];
      return updated;
    });
    setProcessingStatus((prev) => {
      const updated = { ...prev };
      delete updated[fileName];
      return updated;
    });
    setSuccessMessages((prev) => {
      const updated = { ...prev };
      delete updated[fileName];
      return updated;
    });
  };

  // Poll for processing status
  const pollProcessingStatus = async (filename: string) => {
    try {
      const status = await apiService.checkProcessingStatus(filename);
      setProcessingStatus((prev) => ({ ...prev, [filename]: status }));

      if (status.status === "completed") {
        setSuccessMessages((prev) => ({ ...prev, [filename]: true }));
        console.log(`✅ Processing completed for ${filename}`);

        // Clear cache when processing is completed to ensure fresh data
        localStorage.removeItem("avatarguru_summary_text");
        localStorage.removeItem("avatarguru_text_timestamp");
        localStorage.removeItem("avatarguru_reference_links");
        localStorage.removeItem("avatarguru_links_timestamp");
        console.log("🗑️ Cleared cache after processing completion");
      } else if (status.status === "processing") {
        // Continue polling every 3 seconds
        setTimeout(() => pollProcessingStatus(filename), 3000);
      }
    } catch (error) {
      console.error(
        `Failed to check processing status for ${filename}:`,
        error,
      );
      // Retry after 5 seconds on error
      setTimeout(() => pollProcessingStatus(filename), 5000);
    }
  };

  // Resize handlers
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      e.preventDefault();
      setIsResizing(true);

      const startX = e.clientX;
      const startWidths = [...sectionWidths];

      const handleMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return;

        const containerWidth = containerRef.current.offsetWidth;
        const deltaX = e.clientX - startX;
        const deltaPercent = (deltaX / containerWidth) * 100;

        const newWidths = [...startWidths];
        newWidths[index] = Math.max(
          10,
          Math.min(80, startWidths[index] + deltaPercent),
        );
        newWidths[index + 1] = Math.max(
          10,
          Math.min(80, startWidths[index + 1] - deltaPercent),
        );

        setSectionWidths(newWidths);
      };

      const handleMouseUp = () => {
        setIsResizing(false);
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    },
    [sectionWidths],
  );

  const UploadTab = () => (
    <div className="h-full w-full flex flex-col">
      <div className="flex-1 flex">
        <div className="w-20 bg-gray-100 flex flex-col items-center py-4 gap-3">
          <button
            onClick={() => navigate("/")}
            className="w-12 h-12 rounded-lg flex items-center justify-center transition-colors bg-gray-200 text-gray-600 hover:bg-gray-300"
            title="Home"
          >
            <Home className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleTabChange("upload")}
            className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
              activeTab === "upload"
                ? "bg-indigo-100 text-indigo-600"
                : "bg-gray-200 text-gray-600 hover:bg-gray-300"
            }`}
            title="Upload Documents"
          >
            <Upload className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleTabChange("learning")}
            className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
              activeTab === "learning"
                ? "bg-indigo-100 text-indigo-600"
                : "bg-gray-200 text-gray-600 hover:bg-gray-300"
            }`}
            title="Learning Hub"
          >
            <BookOpen className="w-5 h-5" />
          </button>
          <button
            onClick={() => handleTabChange("assessment")}
            className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
              activeTab === "assessment"
                ? "bg-indigo-100 text-indigo-600"
                : "bg-gray-200 text-gray-600 hover:bg-gray-300"
            }`}
            title="Assessment"
          >
            <FileText className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 p-8">
          <div className="max-w-4xl mx-auto">
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-2xl p-12 text-center transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/50 bg-muted/20"
              }`}
            >
              <div className="mb-4">
                <Upload
                  size={48}
                  className={`mx-auto ${
                    isDragging ? "text-primary" : "text-muted-foreground"
                  }`}
                />
              </div>
              <h3 className="text-xl font-semibold text-foreground mb-2">
                Drop your files here
              </h3>
              <p className="text-muted-foreground mb-6 font-light">
                or click to browse from your computer
              </p>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".pdf"
                onChange={handleFileSelect}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-8 py-3 bg-[hsl(var(--button-lavender))] text-foreground rounded-lg font-semibold hover:opacity-90 transition-opacity"
              >
                SELECT FILES
              </button>
            </div>

            {files.length > 0 && (
              <div className="mt-8">
                <h3 className="text-lg font-semibold text-foreground mb-4">
                  Uploaded Files ({files.length})
                </h3>
                <div className="space-y-4">
                  {files.map((file) => {
                    const progress = uploadProgress[file.name] || 0;
                    const isUploadComplete = progress >= 100;
                    const status = processingStatus[file.name];
                    const isProcessingComplete = status?.status === "completed";
                    const showSuccess = successMessages[file.name];

                    return (
                      <div
                        key={file.name}
                        className={`rounded-lg p-4 border transition-colors ${
                          showSuccess
                            ? "bg-green-50 border-green-200 hover:border-green-300"
                            : "bg-muted/30 border-border hover:border-primary/30"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              {showSuccess ? (
                                <CheckCircle
                                  size={20}
                                  className="text-green-600"
                                />
                              ) : isUploadComplete ? (
                                <div className="w-5 h-5 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
                              ) : (
                                <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                              )}
                              <span className="font-medium text-foreground break-all">
                                {file.name}
                              </span>
                            </div>

                            {showSuccess ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
                                  <CheckCircle size={16} />
                                  <span>
                                    Processing completed successfully!
                                  </span>
                                </div>
                                <div className="text-xs text-green-600">
                                  Your document has been analyzed and is ready
                                  for learning.
                                </div>
                              </div>
                            ) : isUploadComplete ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2 text-sm text-blue-600">
                                  <div className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
                                  <span>Processing document...</span>
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Analyzing content and generating explanations
                                </div>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <span>
                                  {(file.size / 1024 / 1024).toFixed(2)} MB
                                </span>
                                <span>•</span>
                                <span>{Math.round(progress)}% uploaded</span>
                              </div>
                            )}

                            {!showSuccess && (
                              <div className="mt-2 w-full bg-muted rounded-full h-2">
                                <div
                                  className={`h-2 rounded-full transition-all duration-300 ${
                                    isUploadComplete
                                      ? "bg-blue-600"
                                      : "bg-primary"
                                  }`}
                                  style={{ width: `${progress}%` }}
                                />
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => removeFile(file.name)}
                            className="text-muted-foreground hover:text-primary transition-colors text-sm font-medium"
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {files.some((f) => successMessages[f.name]) && (
                  <button
                    className="mt-6 w-full px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:opacity-90 transition-opacity"
                    onClick={() => handleTabChange("learning")}
                  >
                    Continue to Learning
                  </button>
                )}
              </div>
            )}

            <div className="mt-8 space-y-6">
              <div className="rounded-lg p-6 border border-border bg-muted/20">
                <h4 className="font-semibold text-foreground mb-4">
                  Supported Formats
                </h4>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li className="flex items-center gap-2">
                    <span className="text-primary font-bold">✓</span> PDF files
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-primary font-bold">✓</span> Max 50MB
                    per file
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="text-primary font-bold">✓</span> Multiple
                    files
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const LearningTab = ({ files }: { files: File[] }) => {
    const [avatarAudioUrl, setAvatarAudioUrl] = useState<string | null>(null);

    // ── Batch-by-batch progressive display ──────────────────────────────
    const [batches, setBatches] = useState<ExplanationBatch[]>([]);
    const [currentBatchIndex, setCurrentBatchIndex] = useState(0);
    const [batchesLoading, setBatchesLoading] = useState(false);
    const [batchFileName, setBatchFileName] = useState("");
    // const batchAudioRef = useRef<HTMLAudioElement | null>(null);  // TODO: Uncomment when per-batch audio is available

    // Derived state from current batch
    const currentBatch = batches[currentBatchIndex] || null;
    const summaryText = currentBatch?.summary || "";
    const summaryImages = currentBatch?.images || [];
    const totalBatches = batches.length;

    // Convert batch links (string[]) → ReferenceLink[]
    const referenceLinks: ReferenceLink[] = (currentBatch?.links || []).map(
      (url: string) => {
        try {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname.replace("www.", "");
          const pathname = urlObj.pathname.split("/").pop() || "";
          const title = pathname
            ? pathname.replace(/[-_]/g, " ").replace(/\.[^/.]+$/, "")
            : hostname;
          return { title, url };
        } catch {
          return { title: url, url };
        }
      },
    );
    const linksLoading = batchesLoading;
    const textLoading = batchesLoading;

    const summaryHashValue =
      summaryText && summaryText.trim().length > 0
        ? `${summaryText.length}-${summaryText.slice(0, 64)}`
        : undefined;

    // ── Batch navigation helpers ────────────────────────────────────────
    const goToNextBatch = () => {
      if (currentBatchIndex < totalBatches - 1) {
        setCurrentBatchIndex((prev) => prev + 1);
      }
    };
    const goToPrevBatch = () => {
      if (currentBatchIndex > 0) {
        setCurrentBatchIndex((prev) => prev - 1);
      }
    };

    // Chat functionality
    const [chatMessages, setChatMessages] = useState<
      Array<{
        id: string;
        type: "user" | "bot";
        content: string;
        timestamp: Date;
      }>
    >(() => {
      // Load chat history from localStorage on initialization
      try {
        const cachedChat = localStorage.getItem("avatarguru_chat_history");
        if (cachedChat) {
          const parsedChat = JSON.parse(cachedChat);
          // Convert timestamp strings back to Date objects
          return parsedChat.map((msg: any) => ({
            ...msg,
            timestamp: new Date(msg.timestamp),
          }));
        }
      } catch (error) {
        console.error("Failed to load chat history from cache:", error);
      }
      // Default message if no cache
      return [
        {
          id: "1",
          type: "bot",
          content: "Heyy any doubts?",
          timestamp: new Date(),
        },
      ];
    });
    const [currentMessage, setCurrentMessage] = useState("");
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(
      null,
    );
    const [audioChunks, setAudioChunks] = useState<Blob[]>([]);

    // File selection for Q&A
    const [availableFiles, setAvailableFiles] = useState<string[]>([]);
    const [selectedFile, setSelectedFile] = useState<string>("");
    const [filesLoading, setFilesLoading] = useState(false);

    // Image Zoom State
    const [zoomedImage, setZoomedImage] = useState<string | null>(null);

    // Chat scroll ref
    const chatScrollRef = useRef<HTMLDivElement>(null);

    // Audio Context Refs for visualizer
    const audioCtx = useRef<AudioContext | null>(null);
    const analyser = useRef<AnalyserNode | null>(null);

    useEffect(() => {
      const initAudio = () => {
        try {
          const AudioContextClass =
            window.AudioContext || (window as any).webkitAudioContext;
          if (AudioContextClass) {
            const ctx = new AudioContextClass();
            const node = ctx.createAnalyser();
            audioCtx.current = ctx;
            analyser.current = node;
          }
        } catch (e) {
          console.error("Failed to initialize AudioContext:", e);
        }
      };
      initAudio();

      return () => {
        if (audioCtx.current && audioCtx.current.state !== "closed") {
          audioCtx.current.close();
        }
      };
    }, []);

    // ── Load batches for progressive display ─────────────────────────────
    useEffect(() => {
      const loadBatches = async () => {
        // Check localStorage cache first
        const cachedBatches = localStorage.getItem("avatarguru_batches");
        const cacheTimestamp = localStorage.getItem(
          "avatarguru_batches_timestamp",
        );
        const now = Date.now();
        const cacheAge = cacheTimestamp
          ? now - parseInt(cacheTimestamp)
          : Infinity;
        const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

        if (cachedBatches && cacheAge < CACHE_DURATION) {
          try {
            const parsed = JSON.parse(cachedBatches);
            setBatches(parsed.batches || []);
            setBatchFileName(parsed.fileName || "");
            setCurrentBatchIndex(0);
            console.log("📦 Loaded batches from cache");
            return;
          } catch (error) {
            console.error("Failed to parse cached batches:", error);
          }
        }

        setBatchesLoading(true);
        try {
          const data = await apiService.getBatches();
          console.log(`📦 Fetched ${data.totalBatches} batches from API`);
          setBatches(data.batches);
          setBatchFileName(data.fileName);
          setCurrentBatchIndex(0);

          // Cache the batches
          localStorage.setItem("avatarguru_batches", JSON.stringify(data));
          localStorage.setItem("avatarguru_batches_timestamp", now.toString());
          console.log("💾 Cached batches");
        } catch (error) {
          console.error("Failed to load batches:", error);
          setBatches([]);
        } finally {
          setBatchesLoading(false);
        }
      };

      loadBatches();
    }, []);

    // ── Auto-advance to next batch when audio finishes ───────────────────
    // TODO: Uncomment this entire block when per-batch audio is available.
    //       Each batch will have an `audio_url` field. When the audio
    //       for the current batch finishes playing, we auto-advance.
    //
    // useEffect(() => {
    //   const audio = batchAudioRef.current;
    //   if (!audio) return;
    //
    //   const handleAudioEnded = () => {
    //     console.log(`🔊 Batch ${currentBatchIndex + 1} audio finished`);
    //     if (currentBatchIndex < totalBatches - 1) {
    //       setCurrentBatchIndex(prev => prev + 1);
    //     }
    //   };
    //
    //   audio.addEventListener('ended', handleAudioEnded);
    //   return () => audio.removeEventListener('ended', handleAudioEnded);
    // }, [currentBatchIndex, totalBatches]);
    //
    // // Play batch audio when batch changes
    // useEffect(() => {
    //   if (!currentBatch?.audio_url) return;
    //   const audio = batchAudioRef.current;
    //   if (audio) {
    //     audio.src = currentBatch.audio_url;
    //     audio.play().catch(err => console.error('Batch audio play failed:', err));
    //   }
    // }, [currentBatchIndex, currentBatch]);

    // Load available files for Q&A
    useEffect(() => {
      const loadAvailableFiles = async () => {
        // Check localStorage first
        const cachedFiles = localStorage.getItem("avatarguru_available_files");
        const cacheTimestamp = localStorage.getItem(
          "avatarguru_files_timestamp",
        );
        const now = Date.now();
        const cacheAge = cacheTimestamp
          ? now - parseInt(cacheTimestamp)
          : Infinity;
        const CACHE_DURATION = 2 * 60 * 1000; // 2 minutes (shorter for files as they change more often)

        if (cachedFiles && cacheAge < CACHE_DURATION) {
          try {
            const fileList = JSON.parse(cachedFiles);
            setAvailableFiles(fileList);
            // Set the first file (most recent) as default
            if (fileList.length > 0 && !selectedFile) {
              setSelectedFile(fileList[0]);
            }
            console.log("📦 Loaded available files from cache");
            return;
          } catch (error) {
            console.error("Failed to parse cached files:", error);
          }
        }

        setFilesLoading(true);
        try {
          const response = await fetch(
            `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"}/api/files`,
          );
          if (response.ok) {
            const fileList = await response.json();
            setAvailableFiles(fileList);
            // Set the first file (most recent) as default
            if (fileList.length > 0 && !selectedFile) {
              setSelectedFile(fileList[0]);
            }

            // Cache the files
            localStorage.setItem(
              "avatarguru_available_files",
              JSON.stringify(fileList),
            );
            localStorage.setItem("avatarguru_files_timestamp", now.toString());
            console.log("💾 Cached available files");
          }
        } catch (error) {
          console.error("Error loading available files:", error);
        } finally {
          setFilesLoading(false);
        }
      };

      loadAvailableFiles();
    }, [selectedFile]);

    // Update bot message when file selection changes
    useEffect(() => {
      if (selectedFile) {
        setChatMessages((prev) => {
          const updated = [...prev];
          if (updated.length > 0 && updated[0].type === "bot") {
            updated[0] = {
              ...updated[0],
              content: `Heyy any doubts about ${selectedFile}?`,
            };
          }
          return updated;
        });
      }
    }, [selectedFile]);

    // Auto-scroll to bottom when new messages are added
    useEffect(() => {
      if (chatScrollRef.current) {
        chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
      }
    }, [chatMessages]);

    // Save chat history to localStorage whenever it changes
    useEffect(() => {
      try {
        localStorage.setItem(
          "avatarguru_chat_history",
          JSON.stringify(chatMessages),
        );
        console.log("💾 Saved chat history to cache");
      } catch (error) {
        console.error("Failed to save chat history to cache:", error);
      }
    }, [chatMessages]);

    // Helper function to get the latest processed filename
    const getLatestProcessedFile = async () => {
      try {
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"}/api/files`,
        );
        if (response.ok) {
          const fileList = await response.json();
          return fileList.length > 0 ? fileList[0] : "keph101.pdf";
        }
      } catch (error) {
        console.error("Error getting file list:", error);
      }
      return "keph101.pdf"; // Fallback
    };

    // Chat functions
    const startRecording = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];

        recorder.ondataavailable = (event) => {
          chunks.push(event.data);
        };

        recorder.onstop = async () => {
          const audioBlob = new Blob(chunks, { type: "audio/webm" });
          setAudioChunks(chunks);
          await processVoiceInput(audioBlob);
          stream.getTracks().forEach((track) => track.stop());
        };

        recorder.start();
        setMediaRecorder(recorder);
        setIsRecording(true);
        setAudioChunks([]);
      } catch (error) {
        console.error("Error starting recording:", error);
        alert("Could not access microphone. Please check permissions.");
      }
    };

    const stopRecording = () => {
      if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        setIsRecording(false);
      }
    };

    const processVoiceInput = async (audioBlob: Blob) => {
      setIsProcessing(true);
      try {
        // Send audio to STT endpoint
        const formData = new FormData();
        formData.append("audio", audioBlob);
        // Use the selected file for Q&A context
        const fileName = selectedFile || "keph101.pdf";
        formData.append("fileName", fileName);

        const response = await fetch(
          `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"}/api/qa-voice`,
          {
            method: "POST",
            body: formData,
          },
        );

        if (!response.ok) {
          throw new Error("STT processing failed");
        }

        const data = await response.json();
        const userMessage = data.transcript;
        const botResponse = data.response;

        if (data.audioUrl) {
          const audioBlobUrl = base64ToAudioUrl(data.audioUrl);

          // Send audio to avatar for lip sync (AvatarCanvas will play it)
          setAvatarAudioUrl(audioBlobUrl);
        }

        // Add user message to chat
        const userMsg = {
          id: Date.now().toString(),
          type: "user" as const,
          content: userMessage,
          timestamp: new Date(),
        };

        // Add bot response to chat
        const botMsg = {
          id: (Date.now() + 1).toString(),
          type: "bot" as const,
          content: botResponse,
          timestamp: new Date(),
        };

        setChatMessages((prev) => [...prev, userMsg, botMsg]);

        // Play TTS if available
        if (data.audioUrl) {
          setAvatarAudioUrl(data.audioUrl);
        }
      } catch (error) {
        console.error("Error processing voice input:", error);
        const errorMsg = {
          id: Date.now().toString(),
          type: "bot" as const,
          content:
            "Sorry, I had trouble processing your voice input. Please try again.",
          timestamp: new Date(),
        };
        setChatMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsProcessing(false);
      }
    };

    const sendTextMessage = async () => {
      if (!currentMessage.trim()) return;

      setIsProcessing(true);
      const userMessage = currentMessage;
      setCurrentMessage("");

      // Add user message to chat
      const userMsg = {
        id: Date.now().toString(),
        type: "user" as const,
        content: userMessage,
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, userMsg]);

      try {
        // Send to Q&A endpoint
        const response = await fetch(
          `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"}/api/qa`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              question: userMessage,
              fileName: selectedFile || "keph101.pdf",
            }),
          },
        );

        if (!response.ok) {
          throw new Error("Q&A processing failed");
        }

        const data = await response.json();
        const botResponse = data.response;

        // Add bot response to chat
        const botMsg = {
          id: (Date.now() + 1).toString(),
          type: "bot" as const,
          content: botResponse,
          timestamp: new Date(),
        };
        setChatMessages((prev) => [...prev, botMsg]);

        // Optional: Generate TTS for the response
        try {
          const ttsResponse = await fetch(
            `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"}/api/qa-tts`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ text: botResponse }),
            },
          );

          if (ttsResponse.ok) {
            const ttsData = await ttsResponse.json();
            if (ttsData.audioUrl) {
              setAvatarAudioUrl(ttsData.audioUrl);
            }
          }
        } catch (ttsError) {
          console.log("TTS not available:", ttsError);
        }
      } catch (error) {
        console.error("Error sending message:", error);
        const errorMsg = {
          id: Date.now().toString(),
          type: "bot" as const,
          content:
            "Sorry, I had trouble processing your message. Please try again.",
          timestamp: new Date(),
        };
        setChatMessages((prev) => [...prev, errorMsg]);
      } finally {
        setIsProcessing(false);
      }
    };

    return (
      <div className="h-full w-full flex flex-col min-h-0">
        <div className="flex-1 flex min-h-0">
          <div className="w-20 bg-gray-100 flex flex-col items-center py-4 gap-3">
            <button
              onClick={() => navigate("/")}
              className="w-12 h-12 rounded-lg flex items-center justify-center transition-colors bg-gray-200 text-gray-600 hover:bg-gray-300"
              title="Home"
            >
              <Home className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleTabChange("upload")}
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
                activeTab === "upload"
                  ? "bg-indigo-100 text-indigo-600"
                  : "bg-gray-200 text-gray-600 hover:bg-gray-300"
              }`}
              title="Upload Documents"
            >
              <Upload className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleTabChange("learning")}
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
                activeTab === "learning"
                  ? "bg-indigo-100 text-indigo-600"
                  : "bg-gray-200 text-gray-600 hover:bg-gray-300"
              }`}
              title="Learning Hub"
            >
              <BookOpen className="w-5 h-5" />
            </button>
            <button
              onClick={() => handleTabChange("assessment")}
              className={`w-12 h-12 rounded-lg flex items-center justify-center transition-colors ${
                activeTab === "assessment"
                  ? "bg-indigo-100 text-indigo-600"
                  : "bg-gray-200 text-gray-600 hover:bg-gray-300"
              }`}
              title="Assessment"
            >
              <FileText className="w-5 h-5" />
            </button>
          </div>
          {/* avatar video and reference links section */}
          <div className="flex-1 flex flex-col min-h-0">
            <div
              ref={containerRef}
              className="flex-1 flex flex-row overflow-hidden min-h-0"
            >
              <div
                className="border-r border-gray-200 flex flex-col min-w-0 min-h-0"
                style={{ width: `${sectionWidths[0]}%` }}
              >
                <div className="p-4 border-b border-gray-200 bg-blue-50 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-gray-800">AI Avatar</h4>
                    <div className="w-2 h-2 bg-gray-400 rounded-full cursor-col-resize"></div>
                  </div>
                </div>

                <div className="flex-[0_0_60%] min-h-[300px] avatr-panel">
                  <AvatarCanvas
                    audioUrl={avatarAudioUrl ?? undefined}
                    fileName={selectedFile || availableFiles[0]}
                  />
                </div>

                <div className="flex-1 bg-blue-50 flex flex-col min-h-0 h-50">
                  {/* Reference Links - Scrollable area */}
                  <div className="flex-1 p-4 pt-2 overflow-y-auto min-h-0 hide-scrollbar">
                    <div className="space-y-3">
                      <h5 className="font-semibold text-gray-800">
                        Reference Links
                      </h5>
                      {linksLoading ? (
                        <div className="flex items-center justify-center py-4">
                          <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                          <span className="ml-2 text-sm text-gray-600">
                            Loading links...
                          </span>
                        </div>
                      ) : referenceLinks.length > 0 ? (
                        <div className="space-y-2">
                          {referenceLinks.map((link, index) => (
                            <div
                              key={index}
                              className="p-3 bg-white rounded-lg border hover:bg-gray-50 transition-colors"
                            >
                              <a
                                href={link.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="block"
                              >
                                <h6 className="text-sm font-medium text-blue-600 hover:text-blue-800 mb-1">
                                  {link.title}
                                </h6>
                                {link.description && (
                                  <p className="text-xs text-gray-600 mb-2">
                                    {link.description}
                                  </p>
                                )}
                                <p className="text-xs text-gray-500 break-all">
                                  {link.url}
                                </p>
                              </a>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="text-center py-4">
                          <p className="text-xs text-gray-500">
                            No reference links available
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Resize handle between AI Tutor and AI Summary */}
              <div
                className="w-1 bg-gray-300 hover:bg-gray-400 cursor-col-resize flex-shrink-0 transition-colors"
                onMouseDown={(e) => handleMouseDown(e, 1)}
              ></div>

              <div
                className="flex flex-col min-w-0 min-h-0"
                style={{ width: `${sectionWidths[2]}%` }}
              >
                <div className="p-4 border-b border-gray-200 bg-green-50 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-gray-800">AI Summary</h4>
                    <div className="w-2 h-2 bg-gray-400 rounded-full cursor-col-resize"></div>
                  </div>
                </div>

                <div className="flex-1 bg-green-50 flex flex-col min-h-0">
                  {/* Header - Fixed at top */}
                  <div className="p-4 pb-2 bg-green-50 flex-shrink-0">
                    <div className="bg-white rounded-lg p-4 border">
                      <div className="flex items-center justify-between mb-3">
                        <h5 className="font-semibold text-gray-800 flex items-center gap-2">
                          <BookOpen size={20} className="text-green-600" />
                          AI Summary
                          {totalBatches > 0 && (
                            <span className="text-xs font-normal text-gray-500 ml-1">
                              (Batch {currentBatchIndex + 1} of {totalBatches})
                            </span>
                          )}
                        </h5>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={async () => {
                              const currentBatch = batches[currentBatchIndex];
                              if (!currentBatch || !currentBatch.audio_url) {
                                alert(
                                  "Audio is not available for this batch yet.",
                                );
                                return;
                              }

                              try {
                                const rawUrl = currentBatch.audio_url;
                                const baseUrl =
                                  import.meta.env.VITE_API_BASE_URL || "";
                                const absoluteUrl = rawUrl.startsWith("/")
                                  ? `${baseUrl.replace(/\/$/, "")}${rawUrl}`
                                  : rawUrl;

                                setAvatarAudioUrl(absoluteUrl);
                              } catch (error) {
                                console.error(
                                  "Failed to load batch audio:",
                                  error,
                                );
                                alert(
                                  "Failed to load audio. Please try again.",
                                );
                              }
                            }}
                            disabled={!summaryText || textLoading}
                            className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                            title="Play current batch as audio"
                          >
                            🔊 Play Audio
                          </button>
                          <button
                            onClick={async () => {
                              setBatchesLoading(true);
                              try {
                                // Clear cache and force fresh fetch
                                localStorage.removeItem("avatarguru_batches");
                                localStorage.removeItem(
                                  "avatarguru_batches_timestamp",
                                );

                                const data = await apiService.getBatches();
                                console.log(
                                  `🔄 Refreshed ${data.totalBatches} batches`,
                                );
                                setBatches(data.batches);
                                setBatchFileName(data.fileName);
                                setCurrentBatchIndex(0);

                                // Cache the new data
                                const now = Date.now();
                                localStorage.setItem(
                                  "avatarguru_batches",
                                  JSON.stringify(data),
                                );
                                localStorage.setItem(
                                  "avatarguru_batches_timestamp",
                                  now.toString(),
                                );
                                console.log("💾 Cached refreshed batches");
                              } catch (error) {
                                console.error(
                                  "Failed to refresh batches:",
                                  error,
                                );
                              } finally {
                                setBatchesLoading(false);
                              }
                            }}
                            className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded hover:bg-green-200 transition-colors"
                          >
                            Refresh
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Content - Scrollable area (Batch-by-batch) */}
                  <div className="flex-1 p-4 pt-2 overflow-y-auto min-h-0 hide-scrollbar">
                    {textLoading ? (
                      <div className="bg-white rounded-lg p-4 border">
                        <div className="flex items-center justify-center py-8">
                          <div className="w-6 h-6 border-2 border-green-600 border-t-transparent rounded-full animate-spin"></div>
                          <span className="ml-3 text-sm text-gray-600">
                            Loading batches...
                          </span>
                        </div>
                      </div>
                    ) : summaryText ? (
                      <div className="space-y-4">
                        {/* Batch progress bar */}
                        {totalBatches > 1 && (
                          <div className="bg-white rounded-lg p-3 border">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs font-medium text-gray-500">
                                Progress: Batch {currentBatchIndex + 1} /{" "}
                                {totalBatches}
                              </span>
                              <span className="text-xs text-green-600 font-medium">
                                {Math.round(
                                  ((currentBatchIndex + 1) / totalBatches) *
                                    100,
                                )}
                                %
                              </span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-2">
                              <div
                                className="bg-gradient-to-r from-green-500 to-emerald-500 h-2 rounded-full transition-all duration-500 ease-out"
                                style={{
                                  width: `${((currentBatchIndex + 1) / totalBatches) * 100}%`,
                                }}
                              />
                            </div>
                          </div>
                        )}

                        {/* Current batch content */}
                        <div className="bg-white rounded-lg p-4 border space-y-4">
                          {/* Batch summary text */}
                          <div className="text-sm text-gray-700 leading-relaxed prose prose-sm max-w-none">
                            <ReactMarkdown
                              remarkPlugins={[remarkMath, remarkGfm]}
                              rehypePlugins={[rehypeKatex]}
                            >
                              {preprocessLaTeX(summaryText)}
                            </ReactMarkdown>
                          </div>

                          {/* Batch images */}
                          {summaryImages.length > 0 && (
                            <div
                              className={`grid ${summaryImages.length === 1 ? "grid-cols-1" : "grid-cols-2"} gap-4 my-4`}
                            >
                              {summaryImages.map((imgUrl, idx) => (
                                <div
                                  key={`batch-${currentBatchIndex}-img-${idx}`}
                                  className="rounded-lg overflow-hidden border border-gray-200 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
                                  onClick={() => setZoomedImage(imgUrl)}
                                >
                                  <img
                                    src={imgUrl}
                                    alt={`Batch ${currentBatchIndex + 1} Diagram ${idx + 1}`}
                                    className="w-full h-48 object-cover hover:scale-105 transition-transform duration-300"
                                    loading="lazy"
                                  />
                                </div>
                              ))}
                            </div>
                          )}

                          {/* Batch keywords */}
                          {currentBatch?.keywords &&
                            currentBatch.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100">
                                {currentBatch.keywords.map((kw, idx) => (
                                  <span
                                    key={idx}
                                    className="text-[11px] px-2 py-1 bg-green-50 text-green-700 rounded-full font-medium"
                                  >
                                    {kw}
                                  </span>
                                ))}
                              </div>
                            )}
                        </div>

                        {/* Hidden audio element for per-batch audio (uncomment when audio is available) */}
                        {/* <audio ref={batchAudioRef} preload="auto" /> */}

                        {/* Batch navigation controls */}
                        {totalBatches > 1 && (
                          <div className="flex items-center justify-between bg-white rounded-lg p-3 border">
                            <button
                              onClick={goToPrevBatch}
                              disabled={currentBatchIndex === 0}
                              className="flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <ArrowLeft size={14} />
                              Previous
                            </button>

                            <div className="flex gap-1">
                              {batches.map((_, idx) => (
                                <button
                                  key={idx}
                                  onClick={() => setCurrentBatchIndex(idx)}
                                  className={`w-2.5 h-2.5 rounded-full transition-all duration-300 ${
                                    idx === currentBatchIndex
                                      ? "bg-green-500 scale-125"
                                      : idx < currentBatchIndex
                                        ? "bg-green-300"
                                        : "bg-gray-300"
                                  }`}
                                  title={`Batch ${idx + 1}`}
                                />
                              ))}
                            </div>

                            <button
                              onClick={goToNextBatch}
                              disabled={currentBatchIndex === totalBatches - 1}
                              className="flex items-center gap-1 text-sm font-medium px-3 py-1.5 rounded-lg bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              Next
                              <svg
                                className="w-3.5 h-3.5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M9 5l7 7-7 7"
                                />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-white rounded-lg p-4 border">
                        <div className="text-center text-gray-500">
                          <div className="w-12 h-12 bg-gray-200 rounded-full flex items-center justify-center mx-auto mb-3">
                            <BookOpen size={24} className="text-gray-400" />
                          </div>
                          <h5 className="font-semibold text-gray-600 mb-2">
                            AI Summary
                          </h5>
                          <p className="text-sm text-gray-500">
                            Upload a document to generate AI-powered summaries
                            and key insights
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Image Zoom Modal */}
                  {zoomedImage && (
                    <div
                      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
                      onClick={() => setZoomedImage(null)}
                    >
                      <div className="relative max-w-5xl w-full max-h-[90vh] flex flex-col items-center">
                        <button
                          className="absolute -top-10 right-0 text-white hover:text-gray-300"
                          onClick={() => setZoomedImage(null)}
                        >
                          <span className="text-2xl">&times;</span> Close
                        </button>
                        <img
                          src={zoomedImage}
                          alt="Zoomed View"
                          className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl bg-white"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Resize handle between Video and AI Tutor */}
              <div
                className="w-1 bg-gray-300 hover:bg-gray-400 cursor-col-resize flex-shrink-0 transition-colors"
                onMouseDown={(e) => handleMouseDown(e, 0)}
              ></div>

              <div
                className="border-r border-gray-200 flex flex-col min-w-0 min-h-0"
                style={{ width: `${sectionWidths[1]}%` }}
              >
                <div className="p-4 border-b border-gray-200 bg-indigo-50 flex-shrink-0">
                  <div className="flex items-center justify-between">
                    <h4 className="font-semibold text-gray-800">AI Tutor</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-600 bg-green-100 px-2 py-1 rounded">
                        Saved
                      </span>
                      <div className="w-6 h-6 bg-gray-300 rounded flex items-center justify-center">
                        <span className="text-xs">🔔</span>
                      </div>
                      <div className="w-2 h-2 bg-gray-400 rounded-full cursor-col-resize"></div>
                    </div>
                  </div>
                </div>

                <div className="flex-1 bg-indigo-50 flex flex-col min-h-0">
                  {/* File Selector - Fixed at top */}
                  <div className="p-4 pb-2 bg-indigo-50 flex-shrink-0">
                    <div className="bg-white rounded-lg p-3 border">
                      <div className="flex items-center gap-3">
                        <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
                          Ask about:
                        </label>
                        <select
                          value={selectedFile}
                          onChange={(e) => setSelectedFile(e.target.value)}
                          disabled={filesLoading}
                          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                        >
                          {filesLoading ? (
                            <option>Loading files...</option>
                          ) : availableFiles.length > 0 ? (
                            availableFiles.map((file) => (
                              <option key={file} value={file}>
                                {file}
                              </option>
                            ))
                          ) : (
                            <option>No files available</option>
                          )}
                        </select>
                        <button
                          onClick={async () => {
                            setFilesLoading(true);
                            try {
                              // Clear cache and force fresh fetch
                              localStorage.removeItem(
                                "avatarguru_available_files",
                              );
                              localStorage.removeItem(
                                "avatarguru_files_timestamp",
                              );

                              const response = await fetch(
                                `${import.meta.env.VITE_API_BASE_URL || "http://localhost:5000"}/api/files`,
                              );
                              if (response.ok) {
                                const fileList = await response.json();
                                setAvailableFiles(fileList);
                                // Update selected file if current one is no longer available
                                if (
                                  fileList.length > 0 &&
                                  !fileList.includes(selectedFile)
                                ) {
                                  setSelectedFile(fileList[0]);
                                }

                                // Cache the new files
                                const now = Date.now();
                                localStorage.setItem(
                                  "avatarguru_available_files",
                                  JSON.stringify(fileList),
                                );
                                localStorage.setItem(
                                  "avatarguru_files_timestamp",
                                  now.toString(),
                                );
                                console.log(
                                  "💾 Cached refreshed available files",
                                );
                              }
                            } catch (error) {
                              console.error("Error refreshing files:", error);
                            } finally {
                              setFilesLoading(false);
                            }
                          }}
                          disabled={filesLoading}
                          className="text-xs px-2 py-1 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 transition-colors disabled:opacity-50"
                          title="Refresh file list"
                        >
                          🔄
                        </button>
                        {selectedFile && (
                          <div className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded">
                            {availableFiles.indexOf(selectedFile) + 1} of{" "}
                            {availableFiles.length}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Chat Messages - Scrollable area */}
                  <div
                    ref={chatScrollRef}
                    className="flex-1 p-4 pt-2 overflow-y-auto min-h-0 hide-scrollbar"
                  >
                    <div className="space-y-3">
                      {chatMessages.map((message) => (
                        <div
                          key={message.id}
                          className={`flex ${message.type === "user" ? "justify-end" : "justify-start"}`}
                        >
                          <div
                            className={`max-w-[80%] rounded-lg px-3 py-2 ${
                              message.type === "user"
                                ? "bg-indigo-600 text-white"
                                : "bg-white text-gray-800 border"
                            }`}
                          >
                            <div className="text-sm prose prose-sm max-w-none dark:prose-invert">
                              <div className="response-container">
                                <ReactMarkdown
                                  remarkPlugins={[remarkMath, remarkGfm]}
                                  rehypePlugins={[rehypeKatex]}
                                >
                                  {preprocessLaTeX(message.content)}
                                </ReactMarkdown>
                              </div>
                            </div>
                            <p
                              className={`text-xs mt-1 ${
                                message.type === "user"
                                  ? "text-indigo-100"
                                  : "text-gray-500"
                              }`}
                            >
                              {message.timestamp.toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      ))}
                      {isProcessing && (
                        <div className="flex justify-start">
                          <div className="bg-white rounded-lg px-3 py-2 border">
                            <div className="flex items-center gap-2">
                              <div className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"></div>
                              <div
                                className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"
                                style={{ animationDelay: "0.1s" }}
                              ></div>
                              <div
                                className="w-2 h-2 bg-indigo-600 rounded-full animate-bounce"
                                style={{ animationDelay: "0.2s" }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="p-4 border-t border-gray-200 bg-white flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Type your question..."
                      value={currentMessage}
                      onChange={(e) => setCurrentMessage(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === "Enter" && !isProcessing) {
                          sendTextMessage();
                        }
                      }}
                      disabled={isProcessing}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    />

                    {/* Mic Button */}
                    {!isRecording ? (
                      <button
                        onClick={startRecording}
                        disabled={isProcessing}
                        className="w-8 h-8 rounded-full bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-50 flex items-center justify-center"
                        title="Start voice recording"
                      >
                        <Mic className="w-4 h-4" />
                      </button>
                    ) : (
                      <button
                        onClick={stopRecording}
                        className="w-8 h-8 rounded-full bg-red-600 text-white hover:bg-red-700 transition-colors flex items-center justify-center animate-pulse"
                        title="Stop recording"
                      >
                        <Square className="w-4 h-4" />
                      </button>
                    )}

                    {/* Send Button */}
                    <button
                      onClick={sendTextMessage}
                      disabled={isProcessing || !currentMessage.trim()}
                      className="w-8 h-8 bg-indigo-600 text-white rounded-full flex items-center justify-center hover:bg-indigo-700 transition-colors disabled:opacity-50"
                      title="Send message"
                    >
                      <span className="text-sm">↑</span>
                    </button>
                  </div>

                  {/* Recording Status */}
                  {isRecording && (
                    <div className="mt-2 text-center">
                      <p className="text-xs text-red-600 flex items-center justify-center gap-1">
                        <div className="w-2 h-2 bg-red-600 rounded-full animate-pulse"></div>
                        Recording... Click stop when done
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`h-screen w-screen bg-white flex flex-col overflow-hidden min-h-0 ${isResizing ? "cursor-col-resize" : ""}`}
    >
      <div className="flex items-center gap-4 py-4 px-6 bg-white border-b border-gray-200 flex-shrink-0">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-gray-600 hover:text-gray-800 transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
          <span className="text-sm font-medium">Back</span>
        </button>
        <div className="h-4 w-px bg-gray-300"></div>
        <h1 className="text-lg font-semibold text-gray-800">
          {activeTab === "upload"
            ? "Upload Documents"
            : activeTab === "learning"
              ? "Learning Hub"
              : "Assessment"}
        </h1>

        {/* Backend Connection Status */}
        <div className="flex items-center gap-2 ml-auto">
          {backendConnected === null && (
            <div className="flex items-center gap-2 text-gray-500">
              <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
              <span className="text-xs">Connecting...</span>
            </div>
          )}
          {backendConnected === true && (
            <div className="flex items-center gap-2 text-green-600">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span className="text-xs">Connected</span>
            </div>
          )}
          {backendConnected === false && (
            <div className="flex items-center gap-2 text-red-600">
              <div className="w-2 h-2 bg-red-500 rounded-full"></div>
              <span className="text-xs">Disconnected</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        {activeTab === "upload" && <UploadTab />}
        {activeTab === "learning" && <LearningTab files={files} />}
        {activeTab === "assessment" && (
          <AssessmentTab
            handleTabChange={handleTabChange}
            navigate={navigate}
          />
        )}
      </div>
    </div>
  );
}
