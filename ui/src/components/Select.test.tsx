import { useState, type ComponentProps } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Select } from "./Select";

afterEach(() => cleanup());

const options = [
  { value: "auto", label: "Automatic" },
  { value: "offline", label: "Offline display", disabled: true },
  { value: "primary", label: "Primary display" },
  { value: "secondary", label: "Secondary display" },
] as const;

function ControlledSelect({ onValueChange = vi.fn(), value = "auto", ...props }: Partial<ComponentProps<typeof Select>>) {
  const [selected, setSelected] = useState(value);
  return <Select aria-label="Monitor" options={options} {...props} value={selected} onValueChange={(next) => {
    setSelected(next);
    onValueChange(next);
  }} />;
}

function activeOption(combobox: HTMLElement) {
  const id = combobox.getAttribute("aria-activedescendant");
  return id ? document.getElementById(id) : null;
}

it("exposes its selected value and opens an associated portal listbox", () => {
  const { container } = render(<ControlledSelect value="primary" />);
  const combobox = screen.getByRole("combobox", { name: "Monitor" }) as HTMLButtonElement;
  expect(combobox.value).toBe("primary");
  expect(combobox.textContent).toContain("Primary display");
  expect(combobox.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("listbox")).toBeNull();

  fireEvent.click(combobox);
  const listbox = screen.getByRole("listbox");
  expect(combobox.getAttribute("aria-expanded")).toBe("true");
  expect(combobox.getAttribute("aria-controls")).toBe(listbox.id);
  expect(container.contains(listbox)).toBe(false);
  expect(screen.getByRole("option", { name: "Primary display" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("option", { name: "Automatic" }).getAttribute("aria-selected")).toBe("false");
  expect(screen.getByRole("option", { name: "Offline display" }).getAttribute("aria-disabled")).toBe("true");
});

it("commits a pointer selection, closes, and returns focus to the trigger", () => {
  const onValueChange = vi.fn();
  render(<ControlledSelect onValueChange={onValueChange} />);
  const combobox = screen.getByRole("combobox") as HTMLButtonElement;
  fireEvent.click(combobox);
  fireEvent.click(screen.getByRole("option", { name: "Secondary display" }));
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("secondary");
  expect(combobox.value).toBe("secondary");
  expect(combobox.textContent).toContain("Secondary display");
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(combobox);

  fireEvent.click(combobox);
  fireEvent.click(screen.getByRole("option", { name: "Secondary display" }));
  expect(onValueChange).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("keeps keyboard navigation separate from selection and skips disabled options", () => {
  const onValueChange = vi.fn();
  render(<ControlledSelect onValueChange={onValueChange} />);
  const combobox = screen.getByRole("combobox") as HTMLButtonElement;
  act(() => combobox.focus());
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  expect(activeOption(combobox)?.textContent).toContain("Automatic");
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  expect(activeOption(combobox)?.textContent).toContain("Primary display");
  expect(screen.getByRole("option", { name: "Automatic" }).getAttribute("aria-selected")).toBe("true");
  expect(combobox.value).toBe("auto");
  expect(onValueChange).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(combobox);

  fireEvent.keyDown(combobox, { key: "ArrowUp" });
  expect(activeOption(combobox)?.textContent).toContain("Automatic");
  fireEvent.keyDown(combobox, { key: "End" });
  expect(activeOption(combobox)?.textContent).toContain("Secondary display");
  fireEvent.keyDown(combobox, { key: "Home" });
  expect(activeOption(combobox)?.textContent).toContain("Automatic");
  fireEvent.keyDown(combobox, { key: "End" });
  fireEvent.keyDown(combobox, { key: "Enter" });
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("secondary");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it.each([["ArrowDown", "Automatic"], ["ArrowUp", "Secondary display"]])(
  "opens from the appropriate end for %s when the saved option is unavailable",
  (key, label) => {
    const onValueChange = vi.fn();
    render(<ControlledSelect value="disconnected" onValueChange={onValueChange} />);
    const combobox = screen.getByRole("combobox");
    fireEvent.keyDown(combobox, { key });
    expect(activeOption(combobox)?.textContent).toContain(label);
    expect(onValueChange).not.toHaveBeenCalled();
  },
);

it("discards the active keyboard choice on Escape and reopens at the committed choice", () => {
  const onValueChange = vi.fn();
  render(<ControlledSelect value="primary" onValueChange={onValueChange} />);
  const combobox = screen.getByRole("combobox") as HTMLButtonElement;
  fireEvent.keyDown(combobox, { key: "ArrowUp" });
  expect(activeOption(combobox)?.textContent).toContain("Primary display");
  fireEvent.keyDown(combobox, { key: "End" });
  fireEvent.keyDown(combobox, { key: "Escape" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(combobox.value).toBe("primary");
  expect(onValueChange).not.toHaveBeenCalled();
  fireEvent.keyDown(combobox, { key: " " });
  expect(activeOption(combobox)?.textContent).toContain("Primary display");
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  fireEvent.keyDown(combobox, { key: " " });
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("secondary");
});

it("commits the active choice on Tab without preventing normal focus navigation", () => {
  const onValueChange = vi.fn();
  render(<ControlledSelect onValueChange={onValueChange} />);
  const combobox = screen.getByRole("combobox");
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const defaultAllowed = fireEvent.keyDown(combobox, { key: "Tab" });
  expect(defaultAllowed).toBe(true);
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("primary");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("searches labels without case or accents and cycles repeated letters before committing", () => {
  const onValueChange = vi.fn();
  render(<ControlledSelect onValueChange={onValueChange} options={[
    { value: "auto", label: "Automatic" },
    { value: "first", label: "Érintett monitor" },
    { value: "disabled", label: "Extra monitor", disabled: true },
    { value: "last", label: "Elsődleges monitor" },
  ]} />);
  const combobox = screen.getByRole("combobox");
  fireEvent.keyDown(combobox, { key: "e" });
  expect(activeOption(combobox)?.textContent).toContain("Érintett monitor");
  expect(onValueChange).not.toHaveBeenCalled();
  fireEvent.keyDown(combobox, { key: "E" });
  expect(activeOption(combobox)?.textContent).toContain("Elsődleges monitor");
  fireEvent.keyDown(combobox, { key: "Enter" });
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("last");
});

it("narrows typeahead by a typed prefix", () => {
  const onValueChange = vi.fn();
  render(<ControlledSelect onValueChange={onValueChange} options={[
    { value: "auto", label: "Automatic" },
    { value: "one", label: "Display one" },
    { value: "two", label: "Display two" },
  ]} />);
  const combobox = screen.getByRole("combobox");
  for (const key of "display t") fireEvent.keyDown(combobox, { key });
  expect(activeOption(combobox)?.textContent).toContain("Display two");
  expect(onValueChange).not.toHaveBeenCalled();
  fireEvent.keyDown(combobox, { key: "Enter" });
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("two");
});

it("lets Space commit after the typeahead timeout expires", () => {
  const clock = vi.spyOn(Date, "now").mockReturnValue(1000);
  const onValueChange = vi.fn();
  render(<ControlledSelect onValueChange={onValueChange} />);
  const combobox = screen.getByRole("combobox");
  fireEvent.keyDown(combobox, { key: "s" });
  expect(activeOption(combobox)?.textContent).toContain("Secondary display");
  clock.mockReturnValue(1800);
  fireEvent.keyDown(combobox, { key: " " });
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("secondary");
  expect(screen.queryByRole("listbox")).toBeNull();
});

it.each(["left", "right"])("places the popup above a low trigger and keeps its %s edge inside the viewport", (edge) => {
  const menuWidth = 440;
  const menuHeight = 200;
  const triggerTop = window.innerHeight - 42;
  const triggerLeft = edge === "right" ? window.innerWidth - 200 : -200;
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return this.getAttribute("role") === "combobox"
      ? new DOMRect(triggerLeft, triggerTop, 300, 32)
      : new DOMRect(0, 0, menuWidth, menuHeight);
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(menuHeight - 2);
  render(<ControlledSelect />);
  fireEvent.click(screen.getByRole("combobox"));
  const listbox = screen.getByRole("listbox");
  const left = Number.parseFloat(listbox.style.left);
  const top = Number.parseFloat(listbox.style.top);
  expect(top + menuHeight).toBeLessThan(triggerTop);
  expect(top).toBeGreaterThanOrEqual(8);
  expect(left).toBeGreaterThanOrEqual(8);
  expect(left + menuWidth).toBeLessThanOrEqual(window.innerWidth - 8);
  expect(left).toBe(edge === "right" ? window.innerWidth - menuWidth - 8 : 8);
  expect(listbox.style.visibility).toBe("visible");
});

it("dismisses outside pointer and focus interactions without changing selection", () => {
  const onValueChange = vi.fn();
  render(<><ControlledSelect onValueChange={onValueChange} /><button>Outside</button></>);
  const combobox = screen.getByRole("combobox");
  const outside = screen.getByRole("button", { name: "Outside" });
  act(() => combobox.focus());
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  fireEvent.keyDown(combobox, { key: "End" });
  fireEvent.pointerDown(outside);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onValueChange).not.toHaveBeenCalled();
  fireEvent.click(combobox);
  fireEvent.keyDown(combobox, { key: "End" });
  act(() => outside.focus());
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(document.activeElement).toBe(outside);
  expect(onValueChange).not.toHaveBeenCalled();
});

it("ignores disabled choices even when clicked", () => {
  const onValueChange = vi.fn();
  render(<ControlledSelect onValueChange={onValueChange} />);
  fireEvent.click(screen.getByRole("combobox"));
  fireEvent.click(screen.getByRole("option", { name: "Offline display" }));
  expect(onValueChange).not.toHaveBeenCalled();
  expect(screen.getByRole("listbox")).toBeTruthy();
});

it.each([
  { disabled: true, options },
  { disabled: false, options: [] },
  { disabled: false, options: [{ value: "auto", label: "Unavailable", disabled: true }] },
])("cannot open when disabled or without enabled choices (%j)", (props) => {
  const onValueChange = vi.fn();
  render(<ControlledSelect {...props} onValueChange={onValueChange} />);
  const combobox = screen.getByRole("combobox");
  fireEvent.click(combobox);
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  fireEvent.keyDown(combobox, { key: "Enter" });
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onValueChange).not.toHaveBeenCalled();
});

it("uses refreshed labels and values and never commits an option removed while open", () => {
  const onValueChange = vi.fn();
  const { rerender } = render(<Select aria-label="Monitor" options={options} value="primary" onValueChange={onValueChange} />);
  const combobox = screen.getByRole("combobox") as HTMLButtonElement;
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  fireEvent.keyDown(combobox, { key: "End" });
  expect(activeOption(combobox)?.textContent).toContain("Secondary display");

  const refreshed = [{ value: "primary", label: "Renamed display" }, { value: "new", label: "New display" }];
  rerender(<Select aria-label="Monitor" options={refreshed} value="new" onValueChange={onValueChange} />);
  expect(combobox.textContent).toContain("New display");
  expect(combobox.value).toBe("new");
  expect(screen.queryByRole("option", { name: "Secondary display" })).toBeNull();
  expect(screen.getByRole("option", { name: "New display" }).getAttribute("aria-selected")).toBe("true");
  expect(activeOption(combobox)?.getAttribute("role")).toBe("option");
  fireEvent.keyDown(combobox, { key: "Enter" });
  expect(onValueChange.mock.calls.some(([value]) => value === "secondary")).toBe(false);
  expect(screen.queryByRole("listbox")).toBeNull();
});

it("closes safely when options disappear or the control becomes disabled", () => {
  const onValueChange = vi.fn();
  const { rerender } = render(<Select aria-label="Monitor" options={options} value="auto" onValueChange={onValueChange} />);
  fireEvent.click(screen.getByRole("combobox"));
  rerender(<Select aria-label="Monitor" options={[]} value="auto" onValueChange={onValueChange} />);
  expect(screen.queryByRole("listbox")).toBeNull();

  rerender(<Select aria-label="Monitor" options={options} value="auto" onValueChange={onValueChange} />);
  fireEvent.click(screen.getByRole("combobox"));
  rerender(<Select aria-label="Monitor" options={options} value="auto" onValueChange={onValueChange} disabled />);
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(onValueChange).not.toHaveBeenCalled();
});

it("normalizes numeric values and changes selection without submitting its surrounding form", () => {
  const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
  const onValueChange = vi.fn();
  render(<form onSubmit={onSubmit}><ControlledSelect value={60} options={[
    { value: 30, label: "30 FPS" }, { value: 60, label: "60 FPS" },
  ]} onValueChange={onValueChange} /></form>);
  const combobox = screen.getByRole("combobox") as HTMLButtonElement;
  expect(combobox.value).toBe("60");
  fireEvent.click(combobox);
  expect(screen.getByRole("option", { name: "60 FPS" }).getAttribute("aria-selected")).toBe("true");
  fireEvent.click(screen.getByRole("option", { name: "30 FPS" }));
  expect(onValueChange).toHaveBeenCalledExactlyOnceWith("30");
  expect(combobox.value).toBe("30");
  expect(onSubmit).not.toHaveBeenCalled();
});
