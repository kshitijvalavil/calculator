import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { Calculation } from "../../../contract/types";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { PAGE_SIZE } from "./components/HistoryTape";
import { createLocalStore, LOCAL_KEY, type HistoryStore } from "./lib/history";
import { resetStorageProbe } from "./lib/storage";

function renderApp(store: HistoryStore = createLocalStore()) {
  const user = userEvent.setup();
  const utils = render(<App store={store} />);
  return { user, store, ...utils };
}

const result = () => screen.getByTestId("result");
const expression = () => screen.getByTestId("expression");
const key = (name: string) => screen.getByRole("button", { name });

async function press(user: ReturnType<typeof userEvent.setup>, ...names: string[]) {
  for (const n of names) await user.click(key(n));
}

describe("display and keypad", () => {
  it("every keypad key has an accessible label", () => {
    renderApp();
    for (const name of ["all clear", "backspace", "percent", "divide", "multiply", "minus", "plus", "equals", "decimal point", "toggle sign", "0", "9"]) {
      expect(key(name)).toBeTruthy();
    }
  });

  it("shows the expression with the last token highlighted and a live preview", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3");
    expect(expression().textContent).toBe("2 + 3");
    expect(expression().querySelector("mark")?.textContent).toBe("3");
    expect(result().textContent).toBe("5");
    expect(result().dataset.state).toBe("preview");
    expect(result().getAttribute("aria-live")).toBe("polite");
  });

  it("keeps the previous preview while an operator is pending", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3", "multiply");
    expect(result().textContent).toBe("5");
  });

  it("evaluates on equals and continues from the result", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3", "equals");
    expect(result().textContent).toBe("5");
    expect(result().dataset.state).toBe("final");
    expect(expression().textContent).toBe("2 + 3 =");
    await press(user, "plus", "1");
    expect(expression().textContent).toBe("5 + 1");
    expect(result().textContent).toBe("6");
  });

  it("starts fresh when a digit follows a result", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3", "equals", "7");
    expect(expression().textContent).toBe("7");
  });

  it("auto-closes parentheses before evaluating", async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole("button", { name: "Scientific" }));
    await press(user, "2", "left parenthesis", "3", "plus", "4", "equals");
    expect(expression().textContent).toBe("2 × (3 + 4) =");
    expect(result().textContent).toBe("14");
  });

  it("shows a friendly message instead of crashing on errors", async () => {
    const { user } = renderApp();
    await press(user, "1", "divide", "0");
    expect(result().textContent).toBe("Can't divide by zero");
    await press(user, "equals");
    expect(result().textContent).toBe("Can't divide by zero");
    expect(result().dataset.state).toBe("error");
  });

  it("backspace removes the last token and AC clears", async () => {
    const { user } = renderApp();
    await press(user, "1", "2", "backspace");
    expect(expression().textContent).toBe("1");
    await press(user, "all clear");
    expect(expression().textContent?.trim()).toBe("");
    expect(result().textContent).toBe("0");
  });

  it("toggles sign", async () => {
    const { user } = renderApp();
    await press(user, "5", "toggle sign");
    expect(expression().textContent).toBe("−5");
    expect(result().textContent).toBe("-5");
  });

  it("shows scientific keys and the angle switch only in scientific mode", async () => {
    const { user } = renderApp();
    expect(screen.queryByRole("button", { name: "square root" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Scientific" }));
    expect(key("square root")).toBeTruthy();
    expect(key("degrees").getAttribute("aria-pressed")).toBe("true");
    await press(user, "sine", "9", "0");
    expect(result().textContent).toBe("1");
    await user.click(key("radians"));
    expect(result().textContent).toBe("0.89399666360055789052");
  });

  it("toggles the theme and remembers it", async () => {
    const { user } = renderApp();
    const btn = screen.getByTestId("theme-toggle");
    const before = document.documentElement.dataset.theme;
    await user.click(btn);
    expect(document.documentElement.dataset.theme).not.toBe(before);
    expect(localStorage.getItem("calc.theme")).toBe(document.documentElement.dataset.theme);
  });
});

describe("keyboard", () => {
  it("handles digits, operators, Enter, Backspace and Escape", async () => {
    const { user } = renderApp();
    await user.keyboard("12+7");
    expect(expression().textContent).toBe("12 + 7");
    await user.keyboard("{Enter}");
    expect(result().textContent).toBe("19");
    await user.keyboard("{Backspace}");
    expect(expression().textContent).toBe("12 + 7");
    await user.keyboard("{Backspace}");
    expect(expression().textContent).toBe("12 + ");
    await user.keyboard("{Escape}");
    expect(expression().textContent?.trim()).toBe("");
  });

  it("maps *, /, -, ^, %, parentheses and =", async () => {
    const { user } = renderApp();
    await user.keyboard("2*(3+4)=");
    expect(result().textContent).toBe("14");
    await user.keyboard("{Escape}50%");
    expect(expression().textContent).toBe("50%");
    expect(result().textContent).toBe("0.5");
    await user.keyboard("{Escape}2^10");
    expect(result().textContent).toBe("1024");
    await user.keyboard("{Escape}10/4");
    expect(expression().textContent).toBe("10 ÷ 4");
    await user.keyboard("{Escape}-5+3");
    expect(result().textContent).toBe("-2");
  });

  it("flashes the matching on-screen key", async () => {
    const { user } = renderApp();
    await user.keyboard("7");
    expect(key("7").className).toContain("is-pressed");
  });

  it("does not hijack typing in the label field", async () => {
    const { user } = renderApp();
    await user.keyboard("5=");
    await user.click(screen.getByRole("button", { name: "Add label to 5" }));
    await user.keyboard("Tip 15");
    expect(expression().textContent).toBe("5 =");
    expect(screen.getByRole("textbox", { name: "Label for 5" })).toHaveProperty("value", "Tip 15");
  });
});

describe("history (local mode)", () => {
  it("saves on equals and persists to localStorage", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3", "equals");
    const items = await screen.findAllByTestId("history-item");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByTestId("history-result").textContent).toBe("= 5");
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)!) as Calculation[];
    expect(stored[0]).toMatchObject({ expression: "2 + 3", result: "5", mode: "standard", angle: "deg", label: null });
  });

  it("does not save errors", async () => {
    const { user } = renderApp();
    await press(user, "1", "divide", "0", "equals");
    expect(screen.queryAllByTestId("history-item")).toHaveLength(0);
  });

  it("adds, edits and clears a label", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3", "equals");
    await user.click(await screen.findByRole("button", { name: "Add label to 2 + 3" }));
    await user.type(screen.getByRole("textbox", { name: "Label for 2 + 3" }), "Groceries{Enter}");
    expect((await screen.findByTestId("history-label")).textContent).toBe("Groceries");
    expect((JSON.parse(localStorage.getItem(LOCAL_KEY)!) as Calculation[])[0].label).toBe("Groceries");

    await user.click(screen.getByRole("button", { name: "Edit label for 2 + 3" }));
    const input = screen.getByRole("textbox", { name: "Label for 2 + 3" });
    await user.clear(input);
    await user.type(input, "{Enter}");
    await waitFor(() => expect(screen.queryByTestId("history-label")).toBeNull());
  });

  it("Escape cancels label editing without clearing the calculator", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3", "equals");
    await user.click(await screen.findByRole("button", { name: "Add label to 2 + 3" }));
    await user.type(screen.getByRole("textbox", { name: "Label for 2 + 3" }), "Draft{Escape}");
    expect(screen.queryByRole("textbox", { name: "Label for 2 + 3" })).toBeNull();
    expect(screen.queryByTestId("history-label")).toBeNull();
    expect(result().textContent).toBe("5");
  });

  it("deletes an entry", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3", "equals");
    await user.click(await screen.findByRole("button", { name: "Delete 2 + 3" }));
    await waitFor(() => expect(screen.queryAllByTestId("history-item")).toHaveLength(0));
    expect(JSON.parse(localStorage.getItem(LOCAL_KEY)!)).toEqual([]);
  });

  it("reuses a result and an expression", async () => {
    const { user } = renderApp();
    await press(user, "2", "plus", "3", "equals", "all clear", "1", "2", "plus");
    await user.click(await screen.findByRole("button", { name: "Reuse result 5" }));
    expect(expression().textContent).toBe("12 + 5");
    await user.click(screen.getByRole("button", { name: "Reuse expression 2 + 3" }));
    expect(expression().textContent).toBe("2 + 3");
    expect(result().textContent).toBe("5");
  });

  it("loads saved history on start", async () => {
    const seeded: Calculation = {
      id: "a",
      expression: "5 × 2",
      result: "10",
      mode: "standard",
      angle: "deg",
      label: "Saved",
      created_at: new Date().toISOString(),
    };
    localStorage.setItem(LOCAL_KEY, JSON.stringify([seeded]));
    renderApp();
    expect((await screen.findByTestId("history-label")).textContent).toBe("Saved");
  });

  it("uses the store's (server) result when it differs from the local one", async () => {
    const save = vi.fn<HistoryStore["save"]>(async (input) => ({
      ok: true,
      calculation: { id: "s1", ...input, result: "5.0000", label: null, created_at: new Date().toISOString() },
    }));
    const store: HistoryStore = {
      kind: "api",
      list: async () => [],
      save,
      updateLabel: vi.fn(),
      remove: vi.fn(),
    };
    const { user } = renderApp(store);
    await press(user, "2", "plus", "3", "equals");
    await waitFor(() => expect(result().textContent).toBe("5.0000"));
    expect(save).toHaveBeenCalledWith({ expression: "2 + 3", mode: "standard", angle: "deg" });
    expect(screen.getByText("Synced to your account")).toBeTruthy();
  });

  it("shows a notice and keeps the result when saving fails", async () => {
    const store: HistoryStore = {
      kind: "api",
      list: async () => [],
      save: async () => {
        throw new Error("offline");
      },
      updateLabel: vi.fn(),
      remove: vi.fn(),
    };
    const { user } = renderApp(store);
    await press(user, "2", "plus", "3", "equals");
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't save to history");
    expect(result().textContent).toBe("5");
  });
});

describe("mobile history sheet", () => {
  it("opens as a dialog and closes with Escape", async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ ...mm(q), matches: false })) as typeof window.matchMedia;
    try {
      const { user } = renderApp();
      await user.click(screen.getByRole("button", { name: /Open history/ }));
      expect(screen.getByRole("dialog")).toBeTruthy();
      act(() => {
        fireEvent.keyDown(window, { key: "Escape" });
      });
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      window.matchMedia = mm;
    }
  });
});

describe("paste", () => {
  const paste = (text: string) => {
    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { getData: (type: string) => (type === "text/plain" ? text : "<b>html</b>") };
    act(() => {
      document.body.dispatchEvent(event);
    });
    return event;
  };

  it("inserts a sanitized plain-text expression", () => {
    renderApp();
    const ev = paste("12*3 + <script>alert(1)</script>4");
    expect(ev.defaultPrevented).toBe(true);
    expect(expression().textContent).toBe("12 × 3 + 4");
    expect(document.querySelector("script")).toBeNull();
  });

  it("continues from the current expression", async () => {
    const { user } = renderApp();
    await user.keyboard("2+");
    paste("3");
    expect(expression().textContent).toBe("2 + 3");
    expect(result().textContent).toBe("5");
  });

  it("ignores pastes into the label field", async () => {
    const { user } = renderApp();
    await user.keyboard("5=");
    await user.click(screen.getByRole("button", { name: "Add label to 5" }));
    const input = screen.getByRole("textbox", { name: "Label for 5" });
    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { getData: () => "9" };
    act(() => {
      input.dispatchEvent(event);
    });
    expect(expression().textContent).toBe("5 =");
  });
});

describe("resilience", () => {
  it.each([["[null]"], ["[{}]"], ["[1]"]])("renders with corrupted history %s", async (raw) => {
    localStorage.setItem(LOCAL_KEY, raw);
    renderApp();
    expect(await screen.findByText("No calculations yet.")).toBeTruthy();
    expect(result().textContent).toBe("0");
  });

  it("error boundary shows a recovery screen instead of a blank page", () => {
    const Boom = () => {
      throw new Error("boom");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Something went wrong");
    expect(screen.getByRole("button", { name: "Reset and reload" })).toBeTruthy();
    spy.mockRestore();
  });

  it(`renders only ${PAGE_SIZE} history rows at first`, async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      expression: "2 + 3",
      result: "5",
      mode: "standard",
      angle: "deg",
      label: null,
      created_at: new Date().toISOString(),
    }));
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
    const { user } = renderApp();
    expect(await screen.findAllByTestId("history-item")).toHaveLength(PAGE_SIZE);
    await user.click(screen.getByRole("button", { name: /Show 100 more of 400/ }));
    expect(screen.getAllByTestId("history-item")).toHaveLength(PAGE_SIZE * 2);
  });
});

describe("round 2 regressions", () => {
  it("N1: after saving a label with the mouse, Enter evaluates and keys go to the calculator", async () => {
    const { user } = renderApp();
    await user.keyboard("1+1{Enter}");
    await user.click(await screen.findByRole("button", { name: "Add label to 1 + 1" }));
    await user.keyboard("groceries");
    await user.click(screen.getByRole("button", { name: "Save label" }));
    expect((await screen.findByTestId("history-label")).textContent).toBe("groceries");
    await waitFor(() => expect(document.activeElement).toBe(expression()));
    await user.keyboard("2+3{Enter}");
    expect(result().textContent).toBe("5");
    expect(screen.queryByRole("textbox", { name: /Label for/ })).toBeNull();
    const stored = JSON.parse(localStorage.getItem(LOCAL_KEY)!) as Calculation[];
    expect(stored.map((r) => `${r.expression}=${r.result} [${r.label}]`)).toEqual(["2 + 3=5 [null]", "1 + 1=2 [groceries]"]);
  });

  it("N1: cancelling a label also returns focus to the calculator", async () => {
    const { user } = renderApp();
    await user.keyboard("5=");
    await user.click(await screen.findByRole("button", { name: "Add label to 5" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(expression()));
  });

  it("N3: works with history in memory when localStorage access throws", async () => {
    const desc = Object.getOwnPropertyDescriptor(window, "localStorage")!;
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("denied", "SecurityError");
      },
    });
    resetStorageProbe();
    try {
      const { user } = renderApp(createLocalStore());
      expect(screen.getByText(/Storage is blocked/)).toBeTruthy();
      await user.keyboard("3+4{Enter}");
      expect(result().textContent).toBe("7");
      expect(await screen.findAllByTestId("history-item")).toHaveLength(1);
      await user.click(screen.getByTestId("theme-toggle"));
      await user.click(screen.getByRole("button", { name: "Scientific" }));
    } finally {
      Object.defineProperty(window, "localStorage", desc);
      resetStorageProbe();
    }
  });

  it("N4: a label holds 80 emoji (code points, not UTF-16 units)", async () => {
    const { user } = renderApp();
    await user.keyboard("5=");
    await user.click(await screen.findByRole("button", { name: "Add label to 5" }));
    const input = screen.getByRole("textbox", { name: "Label for 5" });
    fireEvent.change(input, { target: { value: "😀".repeat(85) } });
    expect(Array.from((input as HTMLInputElement).value)).toHaveLength(80);
    expect(screen.getByText("80/80")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Save label" }));
    const label = (await screen.findByTestId("history-label")).textContent!;
    expect(Array.from(label)).toHaveLength(80);
    expect((JSON.parse(localStorage.getItem(LOCAL_KEY)!) as Calculation[])[0].label).toBe("😀".repeat(80));
  });

  it("N5: an over-long paste is rejected with a visible message", () => {
    renderApp();
    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { getData: () => "1+".repeat(400) + "1" };
    act(() => {
      document.body.dispatchEvent(event);
    });
    expect(screen.getByRole("alert").textContent).toContain("That's too long to paste, max 500 characters");
    expect(expression().textContent?.trim()).toBe("");
  });

  it("N6: the error boundary moves focus to its heading", () => {
    const Boom = () => {
      throw new Error("boom");
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Something went wrong" }));
    spy.mockRestore();
  });

  it("error boundary Try again remounts the app once the fault is gone", async () => {
    let fail = true;
    const Flaky = () => {
      if (fail) throw new Error("boom");
      return <p>recovered</p>;
    };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <Flaky />
      </ErrorBoundary>,
    );
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("recovered")).toBeTruthy();
    spy.mockRestore();
  });
});
