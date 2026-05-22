import { useEffect, useRef } from "react";
import type { Skill } from "../hooks/useSkills";

export type SlashCommandMenuProps = {
  // Skills filtered by the current query (text after the leading `/`).
  skills: Skill[];
  // Index of the currently highlighted item; clamped by the parent.
  highlightedIndex: number;
  onHover: (index: number) => void;
  onSelect: (skill: Skill) => void;
  onClose: () => void;
};

// Slash-command popover. Renders above the input with the matching skills.
// Keyboard handling lives in the parent (Thread) so it can coordinate with
// the textarea's keydown handler.
export function SlashCommandMenu({
  skills,
  highlightedIndex,
  onHover,
  onSelect,
  onClose,
}: SlashCommandMenuProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const highlighted = skills[highlightedIndex];

  // Click-outside dismissal. The textarea is part of the same form below the
  // popover, so the listener checks against the popover's bounding box only.
  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [onClose]);

  // Scroll the highlighted row into view when keyboard navigation moves
  // outside the visible window of the dropdown.
  useEffect(() => {
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-skill-index="${highlightedIndex}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightedIndex]);

  if (skills.length === 0) return null;

  return (
    <div
      ref={containerRef}
      role="listbox"
      aria-label="Skills"
      className="absolute bottom-full left-0 right-0 mb-2 flex gap-2 rounded-xl border border-border bg-card shadow-lg overflow-hidden"
    >
      <div className="flex-1 max-h-64 overflow-y-auto py-1">
        <div className="px-3 py-1.5 text-xs text-muted-foreground">Skills</div>
        {skills.map((skill, i) => {
          const isActive = i === highlightedIndex;
          return (
            <button
              key={skill.name}
              type="button"
              role="option"
              aria-selected={isActive}
              data-skill-index={i}
              onMouseEnter={() => onHover(i)}
              onClick={() => onSelect(skill)}
              className={`w-full text-left px-3 py-2 transition-colors ${
                isActive ? "bg-muted" : "hover:bg-muted/60"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  /{skill.name}
                </span>
                {isActive && (
                  <span aria-hidden="true" className="text-xs text-muted-foreground">
                    ↵
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground truncate">
                {skill.description}
              </p>
            </button>
          );
        })}
      </div>
      {highlighted?.longDescription && (
        <div className="hidden md:block w-64 max-h-64 overflow-y-auto p-3 border-l border-border bg-muted/40">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {highlighted.longDescription}
          </p>
        </div>
      )}
    </div>
  );
}
