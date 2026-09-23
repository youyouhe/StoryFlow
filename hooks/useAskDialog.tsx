import { useCallback, useState } from 'react';
import { AskDialog, AskOptions } from '../components/AskDialog';

/** The ask function: shows the dialog and resolves with the chosen button's
 *  value once the user picks one. */
export type AskFn = (options: AskOptions) => Promise<string>;

/**
 * useAskDialog — in-app confirm/choice dialog (replaces window.confirm for
 * the privacy flows, which deserve real UI instead of a browser chrome box).
 *
 *   const { ask, dialog } = useAskDialog();
 *   // render {dialog} anywhere in the tree
 *   const ok = await ask({ title, body, buttons: [{label:'Yes', value:'yes', kind:'primary'}, …] });
 */
export function useAskDialog(): { ask: AskFn; dialog: React.ReactNode } {
  const [state, setState] = useState<{ options: AskOptions; resolve: (v: string) => void } | null>(null);

  const ask = useCallback<AskFn>((options) =>
    new Promise<string>(resolve => setState({ options, resolve }))
  , []);

  const close = useCallback((value: string) => {
    setState(s => {
      s?.resolve(value);
      return null;
    });
  }, []);

  const dialog = state
    ? <AskDialog options={state.options} onChoose={close} />
    : null;

  return { ask, dialog };
}
