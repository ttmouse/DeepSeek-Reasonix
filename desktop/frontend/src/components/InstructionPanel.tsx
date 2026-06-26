// InstructionPanel shows user-customizable prompt cards in the right dock.
// Each card is one prompt text. Click to send, hover to edit/delete.
// Data is persisted to localStorage.
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useT } from "../lib/i18n";

const STORAGE_KEY = "reasonix.customInstructions";

interface PromptItem {
  id: string;
  text: string;
  count: number;
}

let _idSeq = Date.now();
function genId(): string {
  return `p_${++_idSeq}`;
}

function loadPrompts(): PromptItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // migration: plain strings → { id, text } objects
    return parsed.map((p: unknown) => {
      if (typeof p === "object" && p !== null) {
        const obj = p as { id?: string; text?: string; content?: string; count?: number };
        return { id: obj.id ?? genId(), text: obj.text ?? obj.content ?? "", count: obj.count ?? 0 };
      }
      return { id: genId(), text: String(p), count: 0 };
    });
  } catch {
    return [];
  }
}

function savePrompts(prompts: PromptItem[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  } catch {
    /* ignore storage errors */
  }
}

export function InstructionPanel({ onPrompt }: { onPrompt?: (text: string) => void }) {
  const t = useT();
  const [prompts, setPrompts] = useState<PromptItem[]>(loadPrompts);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    savePrompts(prompts);
  }, [prompts]);

  useEffect(() => {
    if (editingId) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [editingId]);

  const addPrompt = useCallback(() => {
    const id = genId();
    setPrompts((prev) => [...prev, { id, text: "", count: 0 }]);
    setEditingId(id);
    setEditValue("");
  }, []);

  const deletePrompt = useCallback((id: string) => {
    setPrompts((prev) => prev.filter((p) => p.id !== id));
    setEditingId((cur) => (cur === id ? null : cur));
  }, []);

  const startEdit = useCallback((item: PromptItem) => {
    setEditingId(item.id);
    setEditValue(item.text);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editingId) return;
    setPrompts((prev) =>
      prev.map((p) => (p.id === editingId ? { ...p, text: editValue } : p)),
    );
    setEditingId(null);
  }, [editingId, editValue]);

  const cancelEdit = useCallback(() => {
    setEditingId(null);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelEdit();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        commitEdit();
      }
    },
    [commitEdit, cancelEdit],
  );

  const handleCardClick = useCallback(
    (prompt: PromptItem) => {
      if (!prompt.text.trim() || editingId) return;
      // increment usage count
      setPrompts((prev) => prev.map((p) => (p.id === prompt.id ? { ...p, count: p.count + 1 } : p)));
      onPrompt?.(prompt.text.trim());
    },
    [onPrompt, editingId],
  );

  const handleCardKeyDown = useCallback(
    (e: React.KeyboardEvent, prompt: PromptItem) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleCardClick(prompt);
      }
    },
    [handleCardClick],
  );

  return (
    <div className="instruction-panel">
      <div className="instruction-panel__header">
        <span className="instruction-panel__title">{t("instruction.title")}</span>
        <button type="button" className="instruction-panel__add-btn" onClick={addPrompt} title={t("instruction.add")}>
          <Plus size={14} />
        </button>
      </div>

      {prompts.length === 0 && !editingId && (
        <div className="instruction-panel__empty">{t("instruction.empty")}</div>
      )}

      <div className="instruction-panel__list">
        {prompts.map((prompt) => (
          <div
            key={prompt.id}
            className="instruction-panel__card"
          >
            {editingId === prompt.id ? (
              // ── Edit mode ──
              <div className="instruction-panel__edit">
                <textarea
                  ref={textareaRef}
                  className="instruction-panel__textarea"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  rows={3}
                  placeholder={t("instruction.contentPlaceholder")}
                />
                <div className="instruction-panel__edit-actions">
                  <button type="button" className="instruction-panel__save-btn" onClick={commitEdit}>
                    {t("instruction.save")}
                  </button>
                  <button type="button" className="instruction-panel__cancel-btn" onClick={cancelEdit}>
                    {t("instruction.cancel")}
                  </button>
                </div>
              </div>
            ) : (
              // ── Display mode ──
              <div
                className="instruction-panel__card-body"
                onClick={() => handleCardClick(prompt)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => handleCardKeyDown(e, prompt)}
              >
                <div className="instruction-panel__card-header">
                  <span className="instruction-panel__card-text">{prompt.text || t("instruction.emptyPrompt")}</span>
                  <span className="instruction-panel__count">{prompt.count}</span>
                  <div className="instruction-panel__card-actions">
                    <button
                      type="button"
                      className="instruction-panel__icon-btn"
                      onClick={(e) => { e.stopPropagation(); startEdit(prompt); }}
                      title={t("instruction.edit")}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      type="button"
                      className="instruction-panel__icon-btn instruction-panel__icon-btn--danger"
                      onClick={(e) => { e.stopPropagation(); deletePrompt(prompt.id); }}
                      title={t("instruction.delete")}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
