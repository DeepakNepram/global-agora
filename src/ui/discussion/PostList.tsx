import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from 'react';

import type { DiscussionPost } from '@/core/discussion';

export interface PostListProps {
  /** The panel's scrolling area. */
  readonly scroller: RefObject<HTMLElement | null>;
  /** The reader's own new posts, then the rest best first. */
  readonly posts: readonly DiscussionPost[];
  /** Arrived live and not yet seen. */
  readonly fresh: readonly string[];
  readonly more: boolean;
  readonly loadingMore: boolean;
  readonly onMore: () => void;
  /** A highlighted post has been on screen long enough. */
  readonly onSeen: (id: string) => void;
  readonly renderPost: (post: DiscussionPost) => ReactNode;
}

/** A live post keeps its highlight this long once on screen (static under reduced motion). */
const SEEN_AFTER_MS = 4000;

interface Anchor {
  readonly id: string;
  readonly top: number;
}

function topOf(element: Element, scroller: HTMLElement): number {
  return element.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
}

/**
 * The posts (Prompt 4.5). A post arriving live goes in at its rank place
 * and never moves what the reader is looking at: the first post on screen is
 * held at the same offset across every change (manual anchoring, the same
 * in every browser). A live post off screen is announced by a button that
 * brings it into view. Finite: 50 at a time, more on request.
 */
export function PostList(props: PostListProps): JSX.Element {
  const { scroller, posts, fresh, more, loadingMore, onMore, onSeen, renderPost } = props;
  const anchor = useRef<Anchor | null>(null);
  const [offscreen, setOffscreen] = useState<readonly string[]>([]);

  // Remembers the first post on screen, after each scroll.
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let frame = 0;
    const measure = (): void => {
      frame = 0;
      const box = element.getBoundingClientRect();
      const first = [...element.querySelectorAll('[data-post-id]')].find(
        (item) => item.getBoundingClientRect().bottom > box.top,
      );
      const id = first?.getAttribute('data-post-id');
      anchor.current = first && id ? { id, top: topOf(first, element) } : null;
    };
    const onScroll = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(measure);
    };
    measure();
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      element.removeEventListener('scroll', onScroll);
      window.cancelAnimationFrame(frame);
    };
  }, [scroller]);

  // After the list changes, puts that post back where it was.
  useLayoutEffect(() => {
    const element = scroller.current;
    const held = anchor.current;
    if (!element || !held) return;
    const item = element.querySelector(`[data-post-id="${CSS.escape(held.id)}"]`);
    if (!item) return;
    const drift = topOf(item, element) - held.top;
    if (Math.abs(drift) >= 0.5) element.scrollTop += drift;
  }, [posts, scroller]);

  // Live posts: highlighted until they have been on screen a while; those
  // off screen are counted for the button.
  useEffect(() => {
    const element = scroller.current;
    if (!element || fresh.length === 0) {
      setOffscreen([]);
      return;
    }
    const timers = new Map<string, number>();
    const hidden = new Set(fresh);
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.getAttribute('data-post-id') ?? '';
          if (entry.isIntersecting) {
            hidden.delete(id);
            if (!timers.has(id))
              timers.set(
                id,
                window.setTimeout(() => onSeen(id), SEEN_AFTER_MS),
              );
          } else {
            hidden.add(id);
          }
        }
        setOffscreen([...hidden]);
      },
      { root: element },
    );
    for (const id of fresh) {
      const item = element.querySelector(`[data-post-id="${CSS.escape(id)}"]`);
      if (item) observer.observe(item);
    }
    return () => {
      observer.disconnect();
      for (const timer of timers.values()) window.clearTimeout(timer);
    };
  }, [fresh, scroller, onSeen]);

  const showFresh = (): void => {
    const id = offscreen[0];
    const item = id ? scroller.current?.querySelector(`[data-post-id="${CSS.escape(id)}"]`) : null;
    item?.scrollIntoView({ block: 'center' });
    item?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
  };

  return (
    <section aria-label="Posts" className="flex flex-col">
      {posts.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No posts yet. The first one sets the tone.
        </p>
      ) : (
        <ol className="flex flex-col divide-y divide-ink/10">
          {posts.map((post) => (
            <li key={post.id}>{renderPost(post)}</li>
          ))}
        </ol>
      )}
      {more && (
        <button
          type="button"
          aria-busy={loadingMore}
          onClick={onMore}
          className="mt-3 h-11 self-center rounded-full border border-ink/20 px-5 text-sm text-ink hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        >
          {loadingMore ? 'Loading…' : 'Show more posts'}
        </button>
      )}
      {offscreen.length > 0 && (
        <button
          type="button"
          onClick={showFresh}
          className="sticky bottom-3 mt-3 h-10 self-center rounded-full bg-accent px-4 text-sm font-semibold text-void shadow-[0_6px_20px_rgb(0_0_0/0.5)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          {offscreen.length === 1 ? '1 new post' : `${offscreen.length} new posts`}
        </button>
      )}
    </section>
  );
}
