import { useEffect, useRef } from 'react';

interface StackEntry {
  id: symbol;
  onClose: () => void;
}

const modalStack: StackEntry[] = [];
let prevBodyOverflow: string | null = null;
let keyListenerAttached = false;

function handleWindowKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  if (e.isComposing || e.keyCode === 229) return;
  const top = modalStack[modalStack.length - 1];
  if (!top) return;
  e.preventDefault();
  e.stopPropagation();
  top.onClose();
}

function syncGlobalState() {
  if (modalStack.length > 0) {
    if (!keyListenerAttached) {
      window.addEventListener('keydown', handleWindowKeyDown, true);
      keyListenerAttached = true;
    }
    if (prevBodyOverflow === null) {
      prevBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
  } else {
    if (keyListenerAttached) {
      window.removeEventListener('keydown', handleWindowKeyDown, true);
      keyListenerAttached = false;
    }
    if (prevBodyOverflow !== null) {
      document.body.style.overflow = prevBodyOverflow;
      prevBodyOverflow = null;
    }
  }
}

/**
 * Stack-aware Escape key handler + background scroll lock for modals.
 * Only the top-most active modal responds to Escape; ignores IME composition.
 */
export function useEscapeClose(isOpen: boolean, onClose: () => void): void {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!isOpen) return;
    const id = Symbol('modal');
    modalStack.push({
      id,
      onClose: () => onCloseRef.current(),
    });
    syncGlobalState();

    return () => {
      const idx = modalStack.findIndex((entry) => entry.id === id);
      if (idx >= 0) {
        modalStack.splice(idx, 1);
      }
      syncGlobalState();
    };
  }, [isOpen]);
}
