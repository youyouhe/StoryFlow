/**
 * FEEDBACK.json — the review loop's memory file (P5b of
 * docs/storyflow-adoption-plan.md).
 *
 * Watch the export, pin comments at timestamps, let the Agent read and
 * resolve them ("done means watched"). The file lives in the project
 * directory next to BRIEF.md / TREATMENT.md / PROGRESS.md so an agent
 * session recovers the whole production state from files alone.
 */

export const FEEDBACK_FILE = 'FEEDBACK.json';
export const FEEDBACK_FORMAT = 'storyflow.feedback@1';

export interface FeedbackComment {
  id: string;
  /** Position in the program (seconds). */
  atSec: number;
  text: string;
  /** Optional block the comment targets. */
  blockId?: string;
  status: 'open' | 'resolved';
  createdAt: number;
  resolvedAt?: number;
}

export interface FeedbackFile {
  format: typeof FEEDBACK_FORMAT;
  comments: FeedbackComment[];
}

export const newFeedbackFile = (): FeedbackFile => ({ format: FEEDBACK_FORMAT, comments: [] });

export const serializeFeedback = (file: FeedbackFile): string =>
  JSON.stringify(file, null, 2) + '\n';

export const parseFeedback = (text: string): FeedbackFile => {
  const parsed = JSON.parse(text) as Partial<FeedbackFile>;
  if (parsed?.format !== FEEDBACK_FORMAT) {
    throw new Error(`FEEDBACK.json 格式应为 ${FEEDBACK_FORMAT}，收到 ${String(parsed?.format)}`);
  }
  return { format: FEEDBACK_FORMAT, comments: Array.isArray(parsed.comments) ? parsed.comments : [] };
};

let counter = 0;
export const nextFeedbackId = (): string => `c${Date.now().toString(36)}${(counter++).toString(36)}`;

export const addComment = (
  file: FeedbackFile,
  comment: { text: string; atSec: number; blockId?: string },
): FeedbackFile => ({
  ...file,
  comments: [...file.comments, {
    id: nextFeedbackId(),
    atSec: Math.max(0, comment.atSec),
    text: comment.text,
    blockId: comment.blockId,
    status: 'open',
    createdAt: Date.now(),
  }],
});

export const setCommentStatus = (
  file: FeedbackFile,
  id: string,
  status: FeedbackComment['status'],
): FeedbackFile => ({
  ...file,
  comments: file.comments.map(c => (c.id === id
    ? { ...c, status, resolvedAt: status === 'resolved' ? Date.now() : undefined }
    : c)),
});

export const removeComment = (file: FeedbackFile, id: string): FeedbackFile => ({
  ...file,
  comments: file.comments.filter(c => c.id !== id),
});
