// InstructionPanel shows user-customizable prompt cards in the right dock.
// Each card is one prompt text. Click to send, hover to edit/delete.
// Data is persisted to ~/.reasonix/custom-instructions.json via Go backend.
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Pencil } from "lucide-react";
import { useT } from "../lib/i18n";

interface PromptItem {
  id: string;
  text: string;
  count: number;
}

let _idSeq = Date.now();
function genId(): string {
  return `p_${++_idSeq}`;
}

/** Migrate from old localStorage key to ~/.reasonix file on first load. */
async function migrateFromLocalStorage(): Promise<boolean> {
  try {
    const raw = localStorage.getItem("reasonix.customInstructions");
    if (!raw) return false;
    localStorage.removeItem("reasonix.customInstructions");
    // Already in ~/.reasonix via Go backend? Don't overwrite.
    const existing = window.go?.main?.App ? await window.go.main.App.LoadCustomInstructions() : "";
    if (existing) return false;
    // Write to Go backend
    if (window.go?.main?.App) {
      await window.go.main.App.SaveCustomInstructions(raw);
    }
    return true;
  } catch {
    return false;
  }
}

function parsePrompts(raw: string): PromptItem[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
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

function readLocalFallback(): PromptItem[] {
  try {
    const raw = localStorage.getItem("reasonix.customInstructions");
    return raw ? parsePrompts(raw) : [];
  } catch {
    return [];
  }
}

export function InstructionPanel({ onPrompt }: { onPrompt?: (text: string) => void }) {
  const t = useT();
  const [prompts, setPrompts] = useState<PromptItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [loaded, setLoaded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const initialRef = useRef(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initial load: try Go backend → localStorage fallback → migration
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await migrateFromLocalStorage();
      let data = "";
      if (window.go?.main?.App) {
        data = await window.go.main.App.LoadCustomInstructions();
      }
      if (cancelled) return;
      let items: PromptItem[];
      if (data) {
        items = parsePrompts(data);
      } else {
        // fallback to localStorage for backwards compat
        items = readLocalFallback();
      }
      setPrompts(items);
      setLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  // Debounced save to Go backend when prompts change
  useEffect(() => {
    if (!loaded || initialRef.current) {
      initialRef.current = false;
      return;
    }
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const json = JSON.stringify(prompts);
      if (window.go?.main?.App) {
        window.go.main.App.SaveCustomInstructions(json).catch(() => {});
      }
    }, 300);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [prompts, loaded]);

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
