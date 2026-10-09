import React, { useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  subtitle?: string;
  icon?: React.ReactNode;
  maxWidth?: string;
  children: React.ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';
const modalStack: HTMLElement[] = [];

/**
 * Shared dialog shell for every modal in the app — flat rounded-3xl container,
 * hairline border, header with icon badge, and a scrollable body.
 */
export const Modal: React.FC<ModalProps> = ({
  isOpen,
  onClose,
  title,
  subtitle,
  icon,
  maxWidth = 'max-w-lg',
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();

  // Close on Escape, trap Tab/Shift+Tab inside the dialog, and restore focus to
  // whatever triggered the modal once it closes — without this a keyboard or
  // screen-reader user could tab straight through into the page behind it.
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    if (dialog) modalStack.push(dialog);
    const focusables = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    (focusables?.[0] ?? dialogRef.current)?.focus();

    function handleKeyDown(e: KeyboardEvent) {
      // A payment dialog can be opened inside a job card; only the top dialog
      // handles keyboard input and returns focus when it closes.
      if (modalStack.at(-1) !== dialogRef.current) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        close.current();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;

      const nodes = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      const wasTop = modalStack.at(-1) === dialog;
      const index = dialog ? modalStack.indexOf(dialog) : -1;
      if (index >= 0) modalStack.splice(index, 1);
      if (wasTop && previouslyFocused.current?.isConnected) previouslyFocused.current.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop scrim */}
      <div
        onClick={onClose}
        className="fixed inset-0 bg-charcoal-950/50 transition-opacity"
      />

      <div
        ref={dialogRef}
        tabIndex={-1}
        className={`relative w-full ${maxWidth} glass-strong rounded-3xl shadow-popover border border-gold-500/30 overflow-hidden z-10 my-6 flex flex-col max-h-[90vh] animate-in fade-in zoom-in-95 duration-200 outline-none`}
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 sm:px-7 sm:py-5 border-b border-gray-200/80 bg-cream-100 shrink-0">
          <div className="flex items-center gap-3.5 min-w-0">
            {icon && (
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-gold-50 to-accent-50 text-accent-800 border border-gold-500/20 flex items-center justify-center shrink-0 shadow-sm">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              <h2 id={titleId} className="text-base sm:text-lg font-semibold text-gray-900 truncate font-display tracking-wide">{title}</h2>
              {subtitle && <p className="text-xs text-gray-500 truncate font-sans">{subtitle}</p>}
            </div>
          </div>

          <button
            onClick={onClose}
            aria-label="Close modal"
            className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-gray-800 transition-colors shrink-0"
          >
            <X size={17} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto">{children}</div>
      </div>
    </div>
  );
};

export default Modal;
