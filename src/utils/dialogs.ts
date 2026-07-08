import { modals } from '@mantine/modals';
import { notifications } from '@mantine/notifications';

/**
 * App-wide dialog helpers. Replace native browser `alert` / `confirm` with
 * these so dialogs match the EssayCoach design system (Warm Editorial, blue
 * primary, amber accent). See DESIGN.md → "Dialogs and Notifications" for
 * which helper to reach for.
 *
 * Three primitives:
 *   - confirmAction — destructive or significant choice the user must accept
 *     before something happens (analog of window.confirm).
 *   - alertAction — error or warning that has a follow-up the user can take
 *     (e.g. "Open settings"). Has an OK button + optional action button.
 *   - showError — non-blocking error toast for failures with no follow-up.
 */

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Mark as destructive — confirm button renders red. */
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
}

export function confirmAction(opts: ConfirmOptions): void {
  modals.openConfirmModal({
    title: opts.title,
    children: opts.message,
    labels: {
      confirm: opts.confirmLabel ?? 'Continue',
      cancel: opts.cancelLabel ?? 'Cancel',
    },
    confirmProps: opts.danger ? { color: 'red' } : undefined,
    onConfirm: () => { void opts.onConfirm(); },
    onCancel: opts.onCancel,
    centered: true,
  });
}

interface AlertOptions {
  title: string;
  message: string;
  /** Optional follow-up action; renders a second button labelled actionLabel. */
  actionLabel?: string;
  onAction?: () => void;
  okLabel?: string;
}

export function alertAction(opts: AlertOptions): void {
  // Reuse openConfirmModal: when no action is provided we hide the cancel
  // button so the modal reads as a single-button alert.
  modals.openConfirmModal({
    title: opts.title,
    children: opts.message,
    labels: {
      confirm: opts.actionLabel ?? opts.okLabel ?? 'OK',
      cancel: opts.actionLabel ? (opts.okLabel ?? 'Close') : '',
    },
    cancelProps: opts.actionLabel ? undefined : { display: 'none' },
    onConfirm: () => {
      if (opts.actionLabel && opts.onAction) opts.onAction();
    },
    centered: true,
  });
}

interface ErrorOptions {
  title?: string;
  message: string;
}

export function showError(opts: ErrorOptions): void {
  notifications.show({
    color: 'red',
    title: opts.title ?? 'Something went wrong',
    message: opts.message,
    autoClose: 6000,
  });
}
