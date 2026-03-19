export function canNotify(): boolean {
  return 'Notification' in window && Notification.permission === 'granted';
}

export function shouldAskPermission(): boolean {
  return 'Notification' in window && Notification.permission === 'default';
}

export async function requestPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function notifyEvaluationComplete(title: string, averageScore: number) {
  if (!canNotify() || !document.hidden) return;
  new Notification('Feedback Ready', {
    body: `"${title}" scored ${averageScore.toFixed(1)}/6 — tap to see feedback`,
    icon: '/favicon.ico',
  });
}
