/**
 * P5b FEEDBACK.json — the review loop's memory file stays simple, round-trips
 * and refuses foreign formats.
 */
import { describe, expect, it } from 'vitest';
import { addComment, newFeedbackFile, parseFeedback, removeComment, serializeFeedback, setCommentStatus } from '../feedback';

describe('FEEDBACK.json', () => {
  it('round-trips comments with status transitions', () => {
    let file = newFeedbackFile();
    file = addComment(file, { text: '字幕再低一点', atSec: 3.2 });
    file = addComment(file, { text: '这里换 B-roll', atSec: 8.5, blockId: 'b2' });
    const id = file.comments[0].id;

    const parsed = parseFeedback(serializeFeedback(file));
    expect(parsed.comments).toHaveLength(2);
    expect(parsed.comments[1].blockId).toBe('b2');

    const resolved = setCommentStatus(parsed, id, 'resolved');
    expect(resolved.comments[0].status).toBe('resolved');
    expect(setCommentStatus(resolved, id, 'open').comments[0].status).toBe('open');
    expect(removeComment(resolved, id).comments).toHaveLength(1);
  });

  it('refuses foreign formats', () => {
    expect(() => parseFeedback('{"format":"x@1","comments":[]}')).toThrow(/storyflow.feedback@1/);
  });
});
