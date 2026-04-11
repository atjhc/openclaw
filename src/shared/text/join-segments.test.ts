import { describe, expect, it } from "vitest";
import { concatOptionalTextSegments, joinPresentTextSegments } from "./join-segments.js";

function expectTextSegmentsCase<T>(actual: T, expected: T) {
  expect(actual).toBe(expected);
}

function expectJoinedTextSegmentsCase<T>(params: { run: () => T; expected: T }) {
  expectTextSegmentsCase(params.run(), params.expected);
}

describe("concatOptionalTextSegments", () => {
  it.each([
    { params: { left: "A", right: "B" }, expected: "A\n\nB" },
    { params: { left: "A", right: "" }, expected: "" },
    { params: { left: "A" }, expected: "A" },
    { params: { right: "B" }, expected: "B" },
    { params: { left: "", right: "B" }, expected: "B" },
    { params: { left: "" }, expected: "" },
    { params: { left: "A", right: "B", separator: " | " }, expected: "A | B" },
  ] as const)("concatenates optional segments %#", ({ params, expected }) => {
    expectJoinedTextSegmentsCase({
      run: () => concatOptionalTextSegments(params),
      expected,
    });
  });

  it("falls back to whichever side is present and honors custom separators", () => {
    expect(concatOptionalTextSegments({ left: "A" })).toBe("A");
    expect(concatOptionalTextSegments({ right: "B" })).toBe("B");
    expect(concatOptionalTextSegments({ left: "", right: "B" })).toBe("B");
    expect(concatOptionalTextSegments({ left: "" })).toBe("");
    expect(concatOptionalTextSegments({ left: "A", right: "B", separator: " | " })).toBe("A | B");
  });
});

describe("joinPresentTextSegments", () => {
  it.each([
    { segments: ["A", undefined, "B"], options: undefined, expected: "A\n\nB" },
    { segments: ["", undefined, null], options: undefined, expected: undefined },
    { segments: ["  A  ", "  B  "], options: { trim: true }, expected: "A\n\nB" },
    {
      segments: ["A", "   ", "B"],
      options: { separator: " | " },
      expected: "A |     | B",
    },
    {
      segments: ["A", "   ", "B"],
      options: { trim: true, separator: " | " },
      expected: "A | B",
    },
    { segments: ["A", "  B  "], options: { separator: "|" }, expected: "A|  B  " },
  ] as const)("joins present segments %#", ({ segments, options, expected }) => {
    expectJoinedTextSegmentsCase({
      run: () => joinPresentTextSegments(segments, options),
      expected,
    });
  });

  it("keeps whitespace-only segments unless trim is enabled and supports custom separators", () => {
    expect(joinPresentTextSegments(["A", "   ", "B"], { separator: " | " })).toBe("A |     | B");
    expect(joinPresentTextSegments(["A", "   ", "B"], { trim: true, separator: " | " })).toBe(
      "A | B",
    );
  });

  it("preserves segment whitespace when trim is disabled", () => {
    expect(joinPresentTextSegments(["A", "  B  "], { separator: "|" })).toBe("A|  B  ");
  });
});
