import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { ButtonHTMLAttributes, CSSProperties, KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { cx } from "../lib/format";
import { CheckIcon } from "./icons";

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

interface SelectProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value" | "onChange" | "children" | "defaultValue"> {
  value: string | number;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
}

const searchText = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase();

/** Select-only combobox: focus stays on the trigger while the listbox is open. */
export function Select({ value, onValueChange, options, className, disabled, onKeyDown, onClick, ...props }: SelectProps) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const listbox = useRef<HTMLDivElement>(null);
  const search = useRef({ text: "", time: 0 });
  const [expanded, setExpanded] = useState(false);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const [position, setPosition] = useState<CSSProperties>({ visibility: "hidden" });
  const selectedIndex = options.findIndex((option) => String(option.value) === String(value));
  const selected = options[selectedIndex];
  const enabled = options.flatMap((option, index) => option.disabled ? [] : [index]);
  const requestedIndex = options.findIndex((option) => String(option.value) === activeValue && !option.disabled);
  const activeIndex = requestedIndex >= 0 ? requestedIndex
    : selectedIndex >= 0 && !selected?.disabled ? selectedIndex : enabled[0] ?? -1;
  const unavailable = disabled || enabled.length === 0;
  const open = expanded && !unavailable;
  const optionId = (index: number) => `${id}-option-${index}`;

  function close() {
    setExpanded(false);
    search.current = { text: "", time: 0 };
  }

  function show(last = false) {
    if (unavailable) return;
    const index = selectedIndex >= 0 && !selected?.disabled ? selectedIndex : last ? enabled.at(-1) : enabled[0];
    setActiveValue(index === undefined ? null : String(options[index].value));
    setPosition({ visibility: "hidden" });
    setExpanded(true);
    trigger.current?.focus({ preventScroll: true });
  }

  function choose(index: number, restoreFocus = true) {
    const option = options[index];
    if (!option || option.disabled) return;
    close();
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
    if (String(option.value) !== String(value)) onValueChange(String(option.value));
  }

  // Render outside the settings cards and their masked scroll area. Reposition on
  // resize; scrolling the surrounding page dismisses the floating menu.
  useLayoutEffect(() => {
    if (!open) return;
    const button = trigger.current!;
    const menu = listbox.current!;
    const reposition = () => {
      const rect = button.getBoundingClientRect();
      const viewport = window.visualViewport;
      const leftEdge = viewport?.offsetLeft ?? 0;
      const topEdge = viewport?.offsetTop ?? 0;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const margin = 8;
      const gap = 6;
      const maxWidth = Math.min(440, width - margin * 2);
      const minWidth = Math.min(rect.width, maxWidth);
      menu.style.minWidth = `${minWidth}px`;
      menu.style.maxWidth = `${maxWidth}px`;
      const desiredHeight = Math.min(288, menu.scrollHeight + 2);
      const below = Math.max(0, topEdge + height - rect.bottom - gap - margin);
      const above = Math.max(0, rect.top - topEdge - gap - margin);
      const upward = below < desiredHeight && above > below;
      const maxHeight = Math.min(288, upward ? above : below);
      const menuHeight = Math.min(desiredHeight, maxHeight);
      const menuWidth = menu.getBoundingClientRect().width;
      const left = Math.max(leftEdge + margin, Math.min(rect.right - menuWidth, leftEdge + width - menuWidth - margin));
      const top = upward ? rect.top - gap - menuHeight : rect.bottom + gap;
      setPosition((previous) => previous.left === left && previous.top === top && previous.maxHeight === maxHeight
        && previous.minWidth === minWidth && previous.maxWidth === maxWidth && previous.visibility === "visible"
        ? previous : { left, top, minWidth, maxWidth, maxHeight, visibility: "visible" });
    };
    const outside = (event: Event) => {
      if (!(event.target instanceof Node) || (!button.contains(event.target) && !menu.contains(event.target))) close();
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node) || !menu.contains(event.target)) close();
    };
    reposition();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(reposition);
    observer?.observe(button);
    observer?.observe(menu);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("focusin", outside);
    document.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", reposition);
    window.addEventListener("blur", close);
    window.visualViewport?.addEventListener("resize", reposition);
    return () => {
      observer?.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("focusin", outside);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("blur", close);
      window.visualViewport?.removeEventListener("resize", reposition);
    };
  }, [open]);

  useEffect(() => {
    if (unavailable) close();
  }, [unavailable]);

  useLayoutEffect(() => {
    if (open && activeIndex >= 0) document.getElementById(optionId(activeIndex))?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeIndex]);

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    onKeyDown?.(event);
    if (event.defaultPrevented || unavailable) return;
    if (Date.now() - search.current.time >= 700) search.current.text = "";
    if (event.key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === "Tab") {
      if (open) {
        choose(activeIndex, false);
        close();
      }
      return;
    }
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      search.current.text = "";
      if (!open) show(event.key === "ArrowUp");
      else {
        const offset = event.key === "ArrowDown" ? 1 : -1;
        const next = enabled[Math.max(0, Math.min(enabled.length - 1, enabled.indexOf(activeIndex) + offset))];
        if (next !== undefined) setActiveValue(String(options[next].value));
      }
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      search.current.text = "";
      if (!open) show();
      const next = event.key === "Home" ? enabled[0] : enabled.at(-1);
      if (next !== undefined) setActiveValue(String(options[next].value));
    } else if (event.key === "Enter" || (event.key === " " && !search.current.text)) {
      event.preventDefault();
      if (open) choose(activeIndex);
      else show();
    } else if (event.key.length === 1) {
      event.preventDefault();
      const now = Date.now();
      const text = (now - search.current.time < 700 ? search.current.text : "") + searchText(event.key);
      search.current = { text, time: now };
      const repeating = [...text].every((character) => character === text[0]);
      const query = repeating ? text[0] : text;
      const start = open ? activeIndex : selectedIndex;
      const first = query.length === 1 ? start + 1 : Math.max(start, 0);
      const indices = options.map((_, index) => (first + index) % options.length);
      const match = indices.find((index) => !options[index].disabled && searchText(options[index].label).startsWith(query));
      if (!open) show();
      if (match !== undefined) setActiveValue(String(options[match].value));
    }
  }

  return (
    <>
      <button
        {...props}
        ref={trigger}
        type="button"
        role="combobox"
        value={value}
        disabled={unavailable}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? `${id}-listbox` : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        className={cx("select-trigger", className)}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          onClick?.(event);
          if (event.defaultPrevented) return;
          if (open) close();
          else show();
        }}
      >
        <span className="select-value" title={selected?.label}>{selected?.label ?? String(value)}</span>
        <svg className="select-chevron" aria-hidden="true" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && createPortal(
        <div
          ref={listbox}
          id={`${id}-listbox`}
          role="listbox"
          aria-label={props["aria-label"]}
          aria-labelledby={props["aria-labelledby"]}
          className="select-menu"
          style={position}
          onPointerDown={(event) => { if (event.button === 0) event.preventDefault(); }}
        >
          {options.map((option, index) => (
            <div
              key={option.value}
              id={optionId(index)}
              role="option"
              aria-selected={index === selectedIndex}
              aria-disabled={option.disabled || undefined}
              data-active={index === activeIndex || undefined}
              className="select-option"
              onPointerMove={() => { if (!option.disabled) setActiveValue(String(option.value)); }}
              onClick={() => choose(index)}
            >
              <span className="select-option-label">{option.label}</span>
              {index === selectedIndex && <CheckIcon className="select-check" aria-hidden="true" />}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}
