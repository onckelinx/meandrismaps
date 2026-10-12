/**
 * Minimal modal dialogs and transient notices, rendered in-app so they look
 * the same on every platform and in the browser build.
 */
import { useEffect, useRef } from "react";
import { createStore, useStore } from "zustand";

export interface DialogButton {
  id: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
}

interface DialogRequest {
  title: string;
  message?: string;
  /** Further paragraphs under the message, one per line of text. */
  details?: string[];
  /** Image shown above the title, such as the app logo. */
  image?: string;
  /** Extra class on the dialog box, for one-off layouts such as About. */
  className?: string;
  buttons: DialogButton[];
  /** Button id returned by Escape. */
  cancelId: string;
  resolve: (id: string) => void;
}

export interface Notice {
  id: number;
  message: string;
  kind: "info" | "warning" | "error";
}

const dialogStore = createStore<{ queue: DialogRequest[]; notices: Notice[] }>(() => ({ queue: [], notices: [] }));

export function showDialog(req: Omit<DialogRequest, "resolve">): Promise<string> {
  return new Promise((resolve) => {
    const full: DialogRequest = {
      ...req,
      resolve: (id) => {
        dialogStore.setState((s) => ({ queue: s.queue.filter((q) => q !== full) }));
        resolve(id);
      },
    };
    dialogStore.setState((s) => ({ queue: [...s.queue, full] }));
  });
}

export function isDialogOpen(): boolean {
  return dialogStore.getState().queue.length > 0;
}

let noticeId = 0;
export function notify(message: string, kind: Notice["kind"] = "info") {
  const id = ++noticeId;
  dialogStore.setState((s) => ({ notices: [...s.notices, { id, message, kind }] }));
  setTimeout(() => dismissNotice(id), kind === "error" ? 12000 : 6000);
}

function dismissNotice(id: number) {
  dialogStore.setState((s) => ({ notices: s.notices.filter((n) => n.id !== id) }));
}

export async function showError(title: string, message: string) {
  await showDialog({ title, message, buttons: [{ id: "ok", label: "OK", primary: true }], cancelId: "ok" });
}

function Dialog({ req }: { req: DialogRequest }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const primary = ref.current?.querySelector<HTMLButtonElement>("button[data-primary]");
    (primary ?? ref.current?.querySelector("button"))?.focus();
  }, []);
  return (
    <div className="modal-backdrop" data-own-keys>
      <div
        ref={ref}
        className={req.className ? `modal ${req.className}` : "modal"}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="modal-title"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            req.resolve(req.cancelId);
          } else if (e.key === "Tab") {
            // Keep focus inside the dialog.
            const buttons = [...ref.current!.querySelectorAll("button")];
            const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
            e.preventDefault();
            buttons[(i + (e.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
          }
        }}
      >
        {req.image && <img className="modal-image" src={req.image} alt="" />}
        <h2 id="modal-title">{req.title}</h2>
        {req.message && <p>{req.message}</p>}
        {req.details?.map((d, i) => <p key={i}>{d}</p>)}
        <div className="modal-buttons">
          {req.buttons.map((b) => (
            <button
              key={b.id}
              data-primary={b.primary || undefined}
              className={b.primary ? "primary" : b.danger ? "danger" : undefined}
              onClick={() => req.resolve(b.id)}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function DialogHost() {
  const queue = useStore(dialogStore, (s) => s.queue);
  const notices = useStore(dialogStore, (s) => s.notices);
  return (
    <>
      {queue[0] && <Dialog key={queue.length} req={queue[0]} />}
      <div className="notices" aria-live="polite">
        {notices.map((n) => (
          <div key={n.id} className={`notice ${n.kind}`} onClick={() => dismissNotice(n.id)}>
            {n.message}
          </div>
        ))}
      </div>
    </>
  );
}
