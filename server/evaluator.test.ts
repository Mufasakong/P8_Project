import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  evaluateInterview,
  extractLikelyJson,
  findMostRecentParticipantId,
  normalizeEvaluation,
  parseEvaluationResponse,
  type QueryFunction,
} from "./evaluator.ts";

describe("extractLikelyJson", () => {
  test("pulls JSON out of a ```json fenced block", () => {
    const raw = 'Here you go:\n```json\n{"score": 90}\n```\nhope that helps';
    expect(extractLikelyJson(raw)).toBe('{"score": 90}');
  });

  test("pulls JSON out of an unlabeled ``` fence", () => {
    const raw = '```\n{"score": 50}\n```';
    expect(extractLikelyJson(raw)).toBe('{"score": 50}');
  });

  test("falls back to first { ... last } when no fence", () => {
    const raw = 'noise {"a": 1, "b": {"c": 2}} trailing noise';
    expect(extractLikelyJson(raw)).toBe('{"a": 1, "b": {"c": 2}}');
  });

  test("returns null when no braces are present", () => {
    expect(extractLikelyJson("just some prose, no JSON")).toBeNull();
  });

  test("returns null when } appears before {", () => {
    expect(extractLikelyJson("} then {")).toBeNull();
  });

  test("returns null for empty string", () => {
    expect(extractLikelyJson("")).toBeNull();
  });
});

describe("normalizeEvaluation", () => {
  test("clamps a too-high score to 100 and rounds", () => {
    const result = normalizeEvaluation({
      score: 173.6,
      strengthsParagraph: "good",
      weaknessesParagraph: "bad",
    });
    expect(result.score).toBe(100);
  });

  test("clamps a negative score to 0", () => {
    const result = normalizeEvaluation({ score: -42 });
    expect(result.score).toBe(0);
  });

  test("rounds non-integer scores", () => {
    expect(normalizeEvaluation({ score: 72.4 }).score).toBe(72);
    expect(normalizeEvaluation({ score: 72.6 }).score).toBe(73);
  });

  test("coerces a numeric string score", () => {
    expect(normalizeEvaluation({ score: "85" }).score).toBe(85);
  });

  test("falls back to 0 when score is missing or non-numeric", () => {
    expect(normalizeEvaluation({}).score).toBe(0);
    expect(normalizeEvaluation({ score: "not a number" }).score).toBe(0);
    expect(normalizeEvaluation({ score: NaN }).score).toBe(0);
  });

  test("uses fallbacks when paragraphs are missing", () => {
    const result = normalizeEvaluation({ score: 50 });
    expect(result.strengthsParagraph).toBe("No strengths summary returned.");
    expect(result.weaknessesParagraph).toBe("No weaknesses summary returned.");
  });

  test("uses fallback when paragraphs are empty or whitespace", () => {
    const result = normalizeEvaluation({
      score: 50,
      strengthsParagraph: "",
      weaknessesParagraph: "   ",
    });
    expect(result.strengthsParagraph).toBe("No strengths summary returned.");
    expect(result.weaknessesParagraph).toBe("No weaknesses summary returned.");
  });

  test("returns defaults for non-object input", () => {
    const result = normalizeEvaluation(null);
    expect(result.score).toBe(0);
    expect(result.strengthsParagraph).toBe("No strengths summary returned.");
    expect(result.weaknessesParagraph).toBe("No weaknesses summary returned.");
  });

  test("keeps valid paragraphs intact", () => {
    const result = normalizeEvaluation({
      score: 80,
      strengthsParagraph: "Clear communication.",
      weaknessesParagraph: "Limited examples.",
    });
    expect(result.strengthsParagraph).toBe("Clear communication.");
    expect(result.weaknessesParagraph).toBe("Limited examples.");
  });
});

describe("parseEvaluationResponse", () => {
  test("parses a fenced JSON response", () => {
    const raw = '```json\n{"score": 77, "strengthsParagraph": "S", "weaknessesParagraph": "W"}\n```';
    const result = parseEvaluationResponse(raw);
    expect(result).toEqual({
      score: 77,
      strengthsParagraph: "S",
      weaknessesParagraph: "W",
    });
  });

  test("parses a raw JSON response with surrounding noise", () => {
    const raw = 'Sure!\n{"score": 60, "strengthsParagraph": "ok", "weaknessesParagraph": "meh"}\nThanks';
    const result = parseEvaluationResponse(raw);
    expect(result.score).toBe(60);
    expect(result.strengthsParagraph).toBe("ok");
  });

  test("throws when no JSON candidate is found", () => {
    expect(() => parseEvaluationResponse("no json here")).toThrow("Evaluator did not return JSON.");
  });

  test("throws when candidate is malformed JSON", () => {
    expect(() => parseEvaluationResponse('{"score": 50, ')).toThrow();
  });
});

describe("findMostRecentParticipantId", () => {
  test("returns the latest valid participantId", () => {
    const lines = [
      JSON.stringify({ participantId: "p1", role: "user", prompt: "hi" }),
      JSON.stringify({ participantId: "p2", role: "assistant", response: "hello" }),
    ];
    expect(findMostRecentParticipantId(lines)).toBe("p2");
  });

  test("skips entries without a role", () => {
    const lines = [
      JSON.stringify({ participantId: "p1", role: "user", prompt: "hi" }),
      JSON.stringify({ participantId: "p2", evaluation: { score: 90 } }),
    ];
    expect(findMostRecentParticipantId(lines)).toBe("p1");
  });

  test("skips entries with participantId 'unknown' or missing", () => {
    const lines = [
      JSON.stringify({ participantId: "p1", role: "user", prompt: "hi" }),
      JSON.stringify({ participantId: "unknown", role: "user", prompt: "x" }),
      JSON.stringify({ role: "assistant", response: "no id" }),
    ];
    expect(findMostRecentParticipantId(lines)).toBe("p1");
  });

  test("skips malformed JSON lines", () => {
    const lines = [
      JSON.stringify({ participantId: "p1", role: "user", prompt: "hi" }),
      "this is not json",
    ];
    expect(findMostRecentParticipantId(lines)).toBe("p1");
  });

  test("returns null when no usable entries exist", () => {
    expect(findMostRecentParticipantId([])).toBeNull();
    expect(findMostRecentParticipantId(["garbage", JSON.stringify({})])).toBeNull();
  });

  test("trims surrounding whitespace from participantId", () => {
    const lines = [
      JSON.stringify({ participantId: "  p1  ", role: "user", prompt: "hi" }),
    ];
    expect(findMostRecentParticipantId(lines)).toBe("p1");
  });
});

describe("evaluateInterview", () => {
  let tmpDir: string;
  let logPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "evaluator-test-"));
    logPath = join(tmpDir, "chat_log.jsonl");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeLog(entries: object[]) {
    writeFileSync(logPath, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }

  function fakeQuery(response: string): QueryFunction {
    return async () => response;
  }

  test("evaluates the requested participant when given", async () => {
    writeLog([
      { participantId: "alice", role: "user", prompt: "Tell me about yourself" },
      { participantId: "alice", role: "assistant", response: "Glad to. I have ten years..." },
      { participantId: "bob", role: "user", prompt: "different session" },
    ]);

    const result = await evaluateInterview(
      "alice",
      logPath,
      fakeQuery('{"score": 88, "strengthsParagraph": "S", "weaknessesParagraph": "W"}'),
    );

    expect(result.participantId).toBe("alice");
    expect(result.evaluation.score).toBe(88);
    expect(result.transcriptTurns).toBe(2);
    expect(result.model).toBe("qwen2.5:14b");
  });

  test("falls back to most-recent participant when none provided", async () => {
    writeLog([
      { participantId: "alice", role: "user", prompt: "first" },
      { participantId: "bob", role: "user", prompt: "second" },
      { participantId: "bob", role: "assistant", response: "answer" },
    ]);

    const result = await evaluateInterview(
      undefined,
      logPath,
      fakeQuery('{"score": 50, "strengthsParagraph": "x", "weaknessesParagraph": "y"}'),
    );

    expect(result.participantId).toBe("bob");
    expect(result.transcriptTurns).toBe(2);
  });

  test("treats whitespace-only participantId as absent", async () => {
    writeLog([
      { participantId: "alice", role: "user", prompt: "hi" },
      { participantId: "alice", role: "assistant", response: "hello" },
    ]);

    const result = await evaluateInterview(
      "   ",
      logPath,
      fakeQuery('{"score": 70, "strengthsParagraph": "s", "weaknessesParagraph": "w"}'),
    );

    expect(result.participantId).toBe("alice");
  });

  test("formats user turns as CANDIDATE: and assistant turns as INTERVIEWER:", async () => {
    writeLog([
      { participantId: "alice", role: "user", prompt: "Question one" },
      { participantId: "alice", role: "assistant", response: "Answer one" },
    ]);

    let capturedPrompt = "";
    const queryFn: QueryFunction = async (body) => {
      capturedPrompt = body.prompt;
      return '{"score": 1, "strengthsParagraph": "s", "weaknessesParagraph": "w"}';
    };

    await evaluateInterview("alice", logPath, queryFn);

    expect(capturedPrompt).toContain("CANDIDATE: Question one");
    expect(capturedPrompt).toContain("INTERVIEWER: Answer one");
  });

  test("passes the configured evaluator model through to the query", async () => {
    writeLog([
      { participantId: "alice", role: "user", prompt: "hi" },
      { participantId: "alice", role: "assistant", response: "hello" },
    ]);

    let capturedModel = "";
    const queryFn: QueryFunction = async (body) => {
      capturedModel = body.model;
      return '{"score": 1, "strengthsParagraph": "s", "weaknessesParagraph": "w"}';
    };

    const result = await evaluateInterview("alice", logPath, queryFn, "custom-model:7b");

    expect(capturedModel).toBe("custom-model:7b");
    expect(result.model).toBe("custom-model:7b");
  });

  test("skips entries with empty/whitespace prompts and responses", async () => {
    writeLog([
      { participantId: "alice", role: "user", prompt: "real question" },
      { participantId: "alice", role: "user", prompt: "   " },
      { participantId: "alice", role: "assistant", response: "" },
      { participantId: "alice", role: "assistant", response: "real answer" },
    ]);

    const result = await evaluateInterview(
      "alice",
      logPath,
      fakeQuery('{"score": 1, "strengthsParagraph": "s", "weaknessesParagraph": "w"}'),
    );

    expect(result.transcriptTurns).toBe(2);
  });

  test("throws when no participant can be identified", async () => {
    writeLog([{ role: "user", prompt: "no id" }]);

    await expect(
      evaluateInterview(undefined, logPath, fakeQuery("{}")),
    ).rejects.toThrow("No participant found in chat_log for evaluation.");
  });

  test("throws when the requested participant has no transcript", async () => {
    writeLog([
      { participantId: "alice", role: "user", prompt: "hi" },
    ]);

    await expect(
      evaluateInterview("ghost", logPath, fakeQuery("{}")),
    ).rejects.toThrow(/No transcript found in chat_log for participantId: ghost/);
  });
});
