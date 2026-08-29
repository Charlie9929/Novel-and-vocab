import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../../src/App";

describe("app first-use vocabulary gate", () => {
  it("requires a vocabulary choice before showing the local book shelf", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("先选择你的词库");
    expect(markup).toContain("CET4");
    expect(markup).toContain("CET6");
    expect(markup).toContain("IELTS");
    expect(markup).toContain("TOEFL");
    expect(markup).not.toContain("选择 .txt / .pdf 小说");
  });
});
