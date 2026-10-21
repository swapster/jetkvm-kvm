import { useEffect } from "react";
import { LuCommand } from "react-icons/lu";

import { useMacrosStore } from "@hooks/stores";
import useKeyboard from "@hooks/useKeyboard";
import { useJsonRpc } from "@hooks/useJsonRpc";
import { Button } from "@components/Button";
import Container from "@components/Container";

export default function MacroBar() {
  const { macros, initialized, loadMacros, setSendFn } = useMacrosStore();
  const { executeMacro } = useKeyboard();
  const { send } = useJsonRpc();

  useEffect(() => {
    setSendFn(send);

    if (!initialized) {
      loadMacros();
    }
  }, [initialized, loadMacros, setSendFn, send]);

  if (macros.length === 0) {
    return null;
  }

  return (
    <Container className="min-w-0 border-b border-b-slate-800/20 bg-white px-2 lg:px-8 dark:border-b-slate-300/20 dark:bg-slate-900">
      <div className="flex items-center gap-x-2 py-1.5">
        <div className="absolute -ml-5 hidden lg:block">
          <LuCommand className="h-4 w-4 text-slate-500" />
        </div>
        <div className="mobile-touch-controls flex min-w-0 gap-2 overflow-x-auto lg:flex-wrap lg:overflow-visible [&>button]:shrink-0">
          {macros.map(macro => (
            <Button
              key={macro.id}
              aria-label={macro.name}
              size="XS"
              theme="light"
              text={macro.name}
              onClick={() => executeMacro(macro.steps)}
            />
          ))}
        </div>
      </div>
    </Container>
  );
}
