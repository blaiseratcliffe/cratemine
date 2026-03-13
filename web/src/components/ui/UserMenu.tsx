"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";

interface UserMenuProps {
  user: {
    id: number;
    username: string;
    avatar_url: string;
    permalink_url: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
  };
  onLogout: () => void;
}

type ModalType = "report" | "feedback" | null;

export function UserMenu({ user, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<ModalType>(null);
  const [modalText, setModalText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const displayName =
    user.full_name ||
    [user.first_name, user.last_name].filter(Boolean).join(" ") ||
    user.username;

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function openModal(type: ModalType) {
    setModal(type);
    setOpen(false);
    setModalText("");
    setSubmitted(false);
  }

  function handleSubmitModal() {
    // For now, log to console. In a real app this would POST to an API.
    console.log(`[${modal}]`, modalText);
    setSubmitted(true);
  }

  return (
    <>
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer"
        >
          {user.avatar_url && (
            <img
              src={user.avatar_url}
              alt=""
              className="w-7 h-7 rounded-full"
            />
          )}
          <span>{user.username}</span>
          <svg
            className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M19 9l-7 7-7-7"
            />
          </svg>
        </button>

        {open && (
          <div className="absolute right-0 mt-2 w-64 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden">
            {/* User info section */}
            <div className="px-4 py-3 border-b border-zinc-800">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">
                Signed in as
              </p>
              <p className="text-sm text-white font-medium truncate">
                {displayName}
              </p>
            </div>
            <div className="px-4 py-3 border-b border-zinc-800">
              <p className="text-xs text-zinc-500 uppercase tracking-wide">
                SoundCloud account
              </p>
              <p className="text-sm text-zinc-300 font-mono">{user.id}</p>
            </div>

            {/* Menu items */}
            <div className="py-1">
              <button
                onClick={() => openModal("report")}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                Report an issue
              </button>
              <button
                onClick={() => openModal("feedback")}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                Feedback
              </button>
              <button
                onClick={() => {
                  setOpen(false);
                  router.push("/dashboard/account");
                }}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                Manage account
              </button>
            </div>

            {/* Logout */}
            <div className="border-t border-zinc-800 py-1">
              <button
                onClick={onLogout}
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-500 hover:bg-zinc-800 hover:text-white transition-colors cursor-pointer"
              >
                Logout
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Report / Feedback Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-zinc-900 border border-zinc-700 rounded-lg w-full max-w-md mx-4 shadow-2xl">
            <div className="px-5 py-4 border-b border-zinc-800">
              <h2 className="text-lg font-semibold text-white">
                {modal === "report" ? "Report an issue" : "Send feedback"}
              </h2>
              <p className="text-sm text-zinc-400 mt-1">
                {modal === "report"
                  ? "Describe the issue you encountered."
                  : "Tell us what you think or what we can improve."}
              </p>
            </div>

            <div className="px-5 py-4">
              {submitted ? (
                <p className="text-sm text-green-400">
                  Thanks! Your {modal === "report" ? "report" : "feedback"} has
                  been submitted.
                </p>
              ) : (
                <textarea
                  value={modalText}
                  onChange={(e) => setModalText(e.target.value)}
                  placeholder={
                    modal === "report"
                      ? "What went wrong?"
                      : "Your feedback..."
                  }
                  rows={5}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-white placeholder-zinc-500 focus:border-orange-500 focus:outline-none resize-none"
                  autoFocus
                />
              )}
            </div>

            <div className="px-5 py-3 border-t border-zinc-800 flex justify-end gap-3">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors cursor-pointer"
              >
                {submitted ? "Close" : "Cancel"}
              </button>
              {!submitted && (
                <button
                  onClick={handleSubmitModal}
                  disabled={!modalText.trim()}
                  className="px-4 py-2 text-sm bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Submit
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
