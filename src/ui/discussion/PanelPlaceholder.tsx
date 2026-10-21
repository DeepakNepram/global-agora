import type { JSX } from 'react';

const BAR = 'rounded-full bg-ink/10';

/** The panel while it slides in: the shape of what is coming, and nothing that costs a render. */
export function PanelPlaceholder(): JSX.Element {
  return (
    <div aria-hidden="true" className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border border-ink/10 p-3">
        <span className={`${BAR} h-2 w-full`} />
        <span className={`${BAR} h-3 w-3/4`} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <span className="h-11 rounded-xl border border-ink/10" />
        <span className="h-11 rounded-xl border border-ink/10" />
        <span className="h-11 rounded-xl border border-ink/10" />
      </div>
      <span className="h-20 rounded-xl border border-ink/10" />
      <span className={`${BAR} h-3 w-2/3`} />
      <span className={`${BAR} h-3 w-1/2`} />
    </div>
  );
}
